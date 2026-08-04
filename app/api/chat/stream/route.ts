import {
  providerConfigFromEnvironment,
} from "@/src/agent/chat";
import { requestChatCompletion } from "@/src/agent/provider";
import { parseChatRequest, ValidationError } from "@/src/agent/schema";
import { chatRateLimiter } from "@/src/security/chat-rate-limit";
import { clientIdentity } from "@/src/security/client-identity";
import { buildSystemPrompt } from "@/src/agent/prompt";
import { getRole } from "@/src/domain/roles";
import { retrieveKnowledge, classifyRisk } from "@/src/domain/retrieval";
import type { OfficialSource } from "@/src/domain/types";
import { ProviderError } from "@/src/agent/provider";
import { resolveLocale } from "@/src/i18n/messages";
import {
  createRequestId,
  recordChatCompletion,
  recordChatFailure,
  recordChatRequestReceived,
  recordRateLimitExceeded,
} from "@/src/observability/chat-analytics";

const API_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;
const MAX_REQUEST_BYTES = 7_500_000;
const STREAM_TIMEOUT_MS = 60_000;
const HEARTBEAT_MS = 15_000;

async function readJsonBody(request: Request): Promise<unknown> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new BodyReadError("unsupported_media_type", "请求必须使用 application/json 格式。", 415);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new BodyReadError("request_too_large", "请求内容过大。", 413);
  }
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  const reader = request.body?.getReader();
  if (!reader) {
    throw new BodyReadError("invalid_json", "请求内容不是有效的 JSON。", 400);
  }
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new BodyReadError("request_too_large", "请求内容过大。", 413);
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

class BodyReadError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function sse(key: string, data: unknown): string {
  return `event: ${key}\ndata: ${JSON.stringify(data)}\n\n`;
}

function providerUnavailableAnswer(sources: readonly {
  title: string;
  summary: string;
}[]): string {
  const confirmed = sources
    .slice(0, 2)
    .map((source) => `- ${source.title}：${source.summary}`)
    .join("\n");
  return `模型服务暂时不可用，以下仅提供当前可确认的 Blum 官方资料：\n\n${confirmed}\n\n如需精确参数，请打开下方官方资料并按当前市场复核。`;
}

function requestIdFor(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && /^[a-zA-Z0-9_-]{8,128}$/.test(supplied) ? supplied : createRequestId();
}

export async function POST(request: Request): Promise<Response> {
  const startTime = Date.now();
  const requestId = requestIdFor(request);
  const clientIp = clientIdentity(request);

  const decision = chatRateLimiter.attempt(clientIp);
  if (!decision.allowed) {
    recordRateLimitExceeded({ requestId, clientIp });
    recordChatFailure({ requestId, errorType: "rate_limit", responseTimeMs: Date.now() - startTime });
    return new Response(
      sse("error", { code: "rate_limited", message: "请求过于频繁，请稍后重试。" }),
      { status: 429, headers: { ...API_RESPONSE_HEADERS, "X-Request-ID": requestId, "Retry-After": String(decision.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof BodyReadError) {
      recordChatFailure({ requestId, errorType: "validation", responseTimeMs: Date.now() - startTime });
      return new Response(
        sse("error", { code: error.code, message: error.message }),
        { status: error.status, headers: { ...API_RESPONSE_HEADERS, "X-Request-ID": requestId } },
      );
    }
    recordChatFailure({ requestId, errorType: "validation", responseTimeMs: Date.now() - startTime });
    return new Response(
      sse("error", { code: "invalid_json", message: "请求内容不是有效的 JSON。" }),
      { status: 400, headers: { ...API_RESPONSE_HEADERS, "X-Request-ID": requestId } },
    );
  }

  let parsed;
  try {
    parsed = parseChatRequest(body);
  } catch (error) {
    if (error instanceof ValidationError) {
      recordChatFailure({ requestId, errorType: "validation", responseTimeMs: Date.now() - startTime });
      return new Response(
        sse("error", { code: error.code, message: error.message }),
        { status: 400, headers: { ...API_RESPONSE_HEADERS, "X-Request-ID": requestId } },
      );
    }
    recordChatFailure({ requestId, errorType: "unknown", responseTimeMs: Date.now() - startTime });
    return new Response(
      sse("error", { code: "internal_error", message: "请求解析失败。" }),
      { status: 500, headers: { ...API_RESPONSE_HEADERS, "X-Request-ID": requestId } },
    );
  }

  const config = providerConfigFromEnvironment();
  if (!config) {
    recordChatFailure({ requestId, errorType: "provider", responseTimeMs: Date.now() - startTime });
    return new Response(
      sse("error", { code: "no_config", message: "模型服务未配置。" }),
      { status: 503, headers: { ...API_RESPONSE_HEADERS, "X-Request-ID": requestId } },
    );
  }

  const question = [...parsed.messages]
    .reverse()
    .find((m) => m.role === "user")!.content;
  const retrievalStartedAt = Date.now();
  const matches = retrieveKnowledge(question, 4, parsed.messages);
  const retrievalTimeMs = Date.now() - retrievalStartedAt;
  const hasDirectKnowledgeMatch = matches.some(
    (match) =>
      match.score > 0 &&
      match.matchedKeywords.some(
        (keyword) =>
          keyword.replace(/[\s-]/g, "").length > 2 &&
          !["blum", "百隆", "五金", "家具", "柜门"].includes(keyword.toLowerCase()),
      ),
  );
  const risk = classifyRisk(question);
  recordChatRequestReceived({ requestId, role: parsed.role, risk });
  const role = getRole(parsed.role);
  const systemPrompt = buildSystemPrompt({
    role,
    matches,
    risk,
    conversationHistory: parsed.messages,
    knowledgeCoverage: hasDirectKnowledgeMatch ? "direct" : "none",
    locale: resolveLocale(question, request.headers.get("accept-language")),
  });
  const sources = matches.map(({ source }: { source: OfficialSource }) => ({
    id: source.id,
    title: source.title,
    url: source.url,
    summary: source.summary,
    official: true as const,
  }));

  const encoder = new TextEncoder();

  const upstreamController = new AbortController();
  let cancelled = request.signal.aborted;
  const abortUpstream = () => {
    cancelled = true;
    upstreamController.abort();
  };
  request.signal.addEventListener("abort", abortUpstream, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timeout);
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", abortUpstream);
        try { controller.close(); } catch { /* client may have disconnected */ }
      };
      const send = (key: string, data: unknown) => {
        if (closed || cancelled) return;
        try { controller.enqueue(encoder.encode(sse(key, data))); } catch { close(); }
      };
      const timeout = setTimeout(() => upstreamController.abort(), STREAM_TIMEOUT_MS);
      const heartbeat = setInterval(() => {
        if (!closed && !cancelled) {
          try { controller.enqueue(encoder.encode(":\n\n")); } catch { close(); }
        }
      }, HEARTBEAT_MS);
      const fetchWithCancellation: typeof fetch = (input, init) => fetch(input, {
        ...init,
        signal: AbortSignal.any(
          [upstreamController.signal, init?.signal].filter(Boolean) as AbortSignal[],
        ),
      });

      send("start", { sources });
      void (async () => {
        const modelStartedAt = Date.now();
        try {
          let fullText = "";
          const finalAnswer = await requestChatCompletion(
            {
              config,
              systemPrompt,
              messages: parsed.messages,
              image: parsed.image,
              timeoutMs: STREAM_TIMEOUT_MS,
            },
            fetchWithCancellation,
            async (chunk: string) => {
              fullText += chunk;
              send("chunk", { text: chunk, accumulated: fullText });
            },
          );
          if (cancelled) return;
          const confidence = risk === "precision" ? "needs-review" : "guided";
          const followUps = risk === "precision"
            ? ["补充完整产品编号与所在市场", "提供柜体、面板和应用场景参数", "用官方配置器或当前订购手册做最终复核"]
            : ["提供柜体尺寸、门型和期望开合方式", "说明空间、风格与收纳目标"];
          recordChatCompletion({
            requestId,
            role: parsed.role,
            question_length: question.length,
            has_image: Boolean(parsed.image),
            risk_level: risk,
            retrieval_matches: matches.length,
            model_provider_used: Boolean(config),
            mode: "live",
            confidence,
            response_time_ms: Date.now() - startTime,
            retrieval_time_ms: retrievalTimeMs,
            model_response_time_ms: Date.now() - modelStartedAt,
            sources_count: sources.length,
            followups_count: followUps.length,
            quality: {
              is_guarded: false,
              is_demo: false,
              grounding_intercepted: false,
            },
          });
          send("done", {
            answer: finalAnswer,
            confidence,
            followUps,
            sources,
          });
        } catch (error) {
          if (!cancelled) {
            const providerError = error instanceof ProviderError ? error : undefined;
            recordChatFailure({
              requestId,
              errorType: providerError?.code ?? "unknown",
              responseTimeMs: Date.now() - startTime,
              providerStatus: providerError?.status,
            });
            if (providerError) {
              const fallbackAnswer = providerUnavailableAnswer(sources);
              const confidence = risk === "precision" ? "needs-review" : "guided";
              const followUps = risk === "precision"
                ? ["补充完整产品编号与所在市场", "提供柜体、面板和应用场景参数", "用官方配置器或当前订购手册做最终复核"]
                : ["提供产品型号和现场照片", "说明柜体应用和当前故障现象"];
              send("chunk", { text: fallbackAnswer, accumulated: fallbackAnswer });
              send("done", { answer: fallbackAnswer, confidence, followUps, sources });
              return;
            }
            send("error", {
              code: "internal_error",
              message: "Blum Agent 暂时无法处理这个问题，请稍后重试。",
            });
          }
        } finally {
          close();
        }
      })();
    },
    cancel() {
      abortUpstream();
    },
  });

  return new Response(stream, {
    headers: {
      ...API_RESPONSE_HEADERS,
      "X-Request-ID": requestId,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Connection": "keep-alive",
    },
  });
}
