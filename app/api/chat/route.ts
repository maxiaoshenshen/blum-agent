import {
  answerChat,
  providerConfigFromEnvironment,
} from "@/src/agent/chat";
import { ProviderError } from "@/src/agent/provider";
import { parseChatRequest, ValidationError } from "@/src/agent/schema";
import { FixedWindowRateLimiter } from "@/src/security/rate-limit";
import { classifyRisk, retrieveKnowledge } from "@/src/domain/retrieval";
import { resolveLocale } from "@/src/i18n/messages";
import {
  recordChatCompletion,
  recordChatFailure,
} from "@/src/observability/chat-analytics";

const MAX_REQUEST_BYTES = 7_500_000;
const API_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

// 全局限流器实例：30次请求/分钟，按IP追踪
const globalRateLimiter = new FixedWindowRateLimiter({
  limit: 30,
  windowMs: 60_000,
  maxEntries: 10_000,
});

class BodyReadError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: API_RESPONSE_HEADERS,
  });
}

function errorResponse(code: string, message: string, status: number) {
  return jsonResponse({ error: { code, message } }, status);
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new BodyReadError(
      "unsupported_media_type",
      "请求必须使用 application/json 格式。",
      415,
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new BodyReadError(
      "request_too_large",
      "请求内容过大，请缩短问题或压缩图片后重试。",
      413,
    );
  }

  const reader = request.body?.getReader();
  if (!reader) {
    throw new BodyReadError("invalid_json", "请求内容不是有效的 JSON。", 400);
  }

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new BodyReadError(
        "request_too_large",
        "请求内容过大，请缩短问题或压缩图片后重试。",
        413,
      );
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BodyReadError("invalid_json", "请求内容不是有效的 JSON。", 400);
  }
}

export async function POST(request: Request): Promise<Response> {
  const startTime = Date.now();
  // 从请求头获取真实IP（支持 CloudFlare 等代理）
  const clientIp =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  // 限流检查
  const decision = globalRateLimiter.attempt(clientIp);
  if (!decision.allowed) {
    recordChatFailure("rate_limit", Date.now() - startTime);
    return Response.json(
      {
        error: {
          code: "rate_limited",
          message: "请求过于频繁，请稍后重试。",
        },
      },
      {
        status: 429,
        headers: {
          ...API_RESPONSE_HEADERS,
          "Retry-After": String(decision.retryAfterSeconds),
          "X-RateLimit-Limit": "30",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(decision.retryAfterSeconds),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof BodyReadError) {
      recordChatFailure("validation", Date.now() - startTime);
      return errorResponse(error.code, error.message, error.status);
    }
    recordChatFailure("validation", Date.now() - startTime);
    return errorResponse("invalid_json", "请求内容不是有效的 JSON。", 400);
  }

  try {
    const parsed = parseChatRequest(body);
    const question = [...parsed.messages]
      .reverse()
      .find((message) => message.role === "user")!.content;
    const retrievalStartedAt = Date.now();
    const matches = retrieveKnowledge(question);
    const retrievalTimeMs = Date.now() - retrievalStartedAt;
    const risk = classifyRisk(question);
    const providerConfig = providerConfigFromEnvironment();
    let modelStartedAt: number | undefined;
    let groundingIntercepted = false;
    const answer = await answerChat(parsed, {
      providerConfig,
      locale: resolveLocale(question, request.headers.get("accept-language")),
      onModelRequest: () => {
        modelStartedAt = Date.now();
      },
      onGroundingIntercept: () => {
        groundingIntercepted = true;
      },
    });
    recordChatCompletion({
      role: parsed.role,
      question_length: question.length,
      has_image: Boolean(parsed.image),
      risk_level: risk,
      retrieval_matches: matches.length,
      model_provider_used: Boolean(providerConfig),
      mode: answer.mode,
      confidence: answer.confidence,
      response_time_ms: Date.now() - startTime,
      retrieval_time_ms: retrievalTimeMs,
      model_response_time_ms: modelStartedAt ? Date.now() - modelStartedAt : 0,
      sources_count: answer.sources.length,
      followups_count: answer.followUps.length,
      quality: {
        is_guarded: answer.mode === "guarded",
        is_demo: answer.mode === "demo",
        grounding_intercepted: groundingIntercepted,
      },
    });
    return jsonResponse(answer);
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ProviderError) {
      recordChatFailure(
        error instanceof ProviderError ? "provider" : "validation",
        Date.now() - startTime,
      );
      return errorResponse(error.code, error.message, error.status);
    }

    recordChatFailure("unknown", Date.now() - startTime);
    return errorResponse(
      "internal_error",
      "Blum Agent 暂时无法处理这个问题，请稍后重试。",
      500,
    );
  }
}
