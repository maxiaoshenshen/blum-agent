import {
  answerChat,
  providerConfigFromEnvironment,
} from "@/src/agent/chat";
import { requestChatCompletion } from "@/src/agent/provider";
import { parseChatRequest, ValidationError } from "@/src/agent/schema";
import { FixedWindowRateLimiter } from "@/src/security/rate-limit";
import { buildSystemPrompt } from "@/src/agent/prompt";
import { getRole } from "@/src/domain/roles";
import { retrieveKnowledge, classifyRisk } from "@/src/domain/retrieval";
import type { OfficialSource } from "@/src/domain/types";

const API_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

const globalRateLimiter = new FixedWindowRateLimiter({
  limit: 30,
  windowMs: 60_000,
  maxEntries: 10_000,
});

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return { error: { code: "unsupported_media_type", message: "请求必须使用 application/json 格式。", status: 415 } };
  }
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  const reader = request.body?.getReader();
  if (!reader) {
    return { error: { code: "invalid_json", message: "请求内容不是有效的 JSON。", status: 400 } };
  }
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > 7_500_000) {
      await reader.cancel();
      return { error: { code: "request_too_large", message: "请求内容过大。", status: 413 } };
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
    return { error: { code: "invalid_json", message: "请求内容不是有效的 JSON。", status: 400 } };
  }
}

function sse(key: string, data: unknown): string {
  return `event: ${key}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request): Promise<Response> {
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

  const bodyOrError = await readJsonBody(request);
  if ("error" in bodyOrError) {
    return new Response(
      sse("error", { code: bodyOrError.error.code, message: bodyOrError.error.message }),
      { status: bodyOrError.error.status, headers: API_RESPONSE_HEADERS },
    );
  }

  let parsed;
  try {
    parsed = parseChatRequest(bodyOrError);
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
  const risk = classifyRisk(question);
  const role = getRole(parsed.role);
  const systemPrompt = buildSystemPrompt({ role, matches, risk });
  const sources = matches.map(({ source }: { source: OfficialSource }) => ({
    id: source.id,
    title: source.title,
    url: source.url,
    summary: source.summary,
    official: true as const,
  }));

  const controller = new ReadableStreamDefaultController();
  const encoder = new TextEncoder();

  function send(key: string, data: unknown) {
    try {
      controller.enqueue(encoder.encode(sse(key, data)));
    } catch { /* stream may already be closed */ }
  }

  send("start", { sources });

  try {
    let fullText = "";
    const finalAnswer = await requestChatCompletion(
      {
        config,
        systemPrompt,
        messages: parsed.messages,
        image: parsed.image,
      },
      fetch,
      async (chunk: string) => {
        fullText += chunk;
        send("chunk", { text: chunk, accumulated: fullText });
      },
    );

    send("done", {
      answer: finalAnswer,
      confidence: risk === "precision" ? "needs-review" : "guided",
      followUps: risk === "precision"
        ? [
            "补充完整产品编号与所在市场",
            "提供柜体、面板和应用场景参数",
            "用官方配置器或当前订购手册做最终复核",
          ]
        : [
            "提供柜体尺寸、门型和期望开合方式",
            "说明空间、风格与收纳目标",
          ],
      sources,
    });

    controller.close();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Blum Agent 暂时无法处理这个问题，请稍后重试。";
    send("error", { code: "internal_error", message });
    controller.close();
  }

  return new Response(controller.stream, {
    headers: {
      ...API_RESPONSE_HEADERS,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Connection": "keep-alive",
    },
  });
}
