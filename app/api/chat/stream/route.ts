import {
  providerConfigFromEnvironment,
} from "@/src/agent/chat";
import { requestChatCompletion } from "@/src/agent/provider";
import { parseChatRequest, ValidationError } from "@/src/agent/schema";
import { FixedWindowRateLimiter } from "@/src/security/rate-limit";
import { buildSystemPrompt } from "@/src/agent/prompt";
import { getRole } from "@/src/domain/roles";
import { retrieveKnowledge, classifyRisk } from "@/src/domain/retrieval";
import type { OfficialSource } from "@/src/domain/types";
import { ProviderError } from "@/src/agent/provider";

const API_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;
const MAX_REQUEST_BYTES = 7_500_000;
const STREAM_TIMEOUT_MS = 60_000;
const HEARTBEAT_MS = 15_000;

const globalRateLimiter = new FixedWindowRateLimiter({
  limit: 30,
  windowMs: 60_000,
  maxEntries: 10_000,
});

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
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

export async function POST(request: Request): Promise<Response> {
  const start = Date.now();
  const clientIp =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  const decision = globalRateLimiter.attempt(clientIp);
  if (!decision.allowed) {
    return new Response(
      sse("error", { code: "rate_limited", message: "请求过于频繁，请稍后重试。" }),
      { status: 429, headers: { ...API_RESPONSE_HEADERS, "Retry-After": String(decision.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof BodyReadError) {
      return new Response(
        sse("error", { code: error.code, message: error.message }),
        { status: error.status, headers: API_RESPONSE_HEADERS },
      );
    }
    return new Response(
      sse("error", { code: "invalid_json", message: "请求内容不是有效的 JSON。" }),
      { status: 400, headers: API_RESPONSE_HEADERS },
    );
  }

  let parsed;
  try {
    parsed = parseChatRequest(body);
  } catch (error) {
    if (error instanceof ValidationError) {
      return new Response(
        sse("error", { code: error.code, message: error.message }),
        { status: 400, headers: API_RESPONSE_HEADERS },
      );
    }
    return new Response(
      sse("error", { code: "internal_error", message: "请求解析失败。" }),
      { status: 500, headers: API_RESPONSE_HEADERS },
    );
  }

  const config = providerConfigFromEnvironment();
  if (!config) {
    return new Response(
      sse("error", { code: "no_config", message: "模型服务未配置。" }),
      { status: 503, headers: API_RESPONSE_HEADERS },
    );
  }

  const question = [...parsed.messages]
    .reverse()
    .find((m) => m.role === "user")!.content;
  const matches = retrieveKnowledge(question);
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
  console.log(JSON.stringify({
    type: "chat_request",
    role: parsed.role,
    risk,
    hasImage: Boolean(parsed.image),
    matchCount: matches.length,
    timestamp: new Date().toISOString(),
  }));
  const role = getRole(parsed.role);
  const systemPrompt = buildSystemPrompt({
    role,
    matches,
    risk,
    conversationHistory: parsed.messages,
    knowledgeCoverage: hasDirectKnowledgeMatch ? "direct" : "none",
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
        console.log(JSON.stringify({
          type: "chat_response_time_ms",
          duration: Date.now() - start,
        }));
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
          send("done", {
            answer: finalAnswer,
            confidence: risk === "precision" ? "needs-review" : "guided",
            followUps: risk === "precision"
              ? ["补充完整产品编号与所在市场", "提供柜体、面板和应用场景参数", "用官方配置器或当前订购手册做最终复核"]
              : ["提供柜体尺寸、门型和期望开合方式", "说明空间、风格与收纳目标"],
            sources,
          });
        } catch (error) {
          if (!cancelled) {
            const providerError = error instanceof ProviderError ? error : undefined;
            send("error", {
              code: providerError?.code ?? "internal_error",
              message: providerError?.message ?? "Blum Agent 暂时无法处理这个问题，请稍后重试。",
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
      "Content-Type": "text/event-stream; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Connection": "keep-alive",
    },
  });
}
