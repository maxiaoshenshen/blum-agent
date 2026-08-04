import type { ChatMessage } from "./schema";
import { sanitizeModelText } from "./sanitize";

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export type ChunkHandler = (text: string) => void | Promise<void>;

export interface ProviderRequest {
  config: ProviderConfig;
  systemPrompt: string;
  messages: ChatMessage[];
  image?: string;
  timeoutMs?: number;
}

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const MAX_OUTPUT_CHARACTERS = 12_000;
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1_000;

export class ProviderError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
  }
}

function toProviderMessages(
  systemPrompt: string,
  messages: ChatMessage[],
  image?: string,
) {
  const lastUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );

  return [
    { role: "system", content: systemPrompt },
    ...messages.map((message, index) => {
      if (!image || message.role !== "user" || index !== lastUserIndex) {
        return message;
      }

      return {
        role: message.role,
        content: [
          { type: "text", text: message.content },
          { type: "image_url", image_url: { url: image } },
        ],
      };
    }),
  ];
}

async function mapStatus(response: Response): Promise<ProviderError> {
  let upstreamCode = "";
  try {
    const body = (await response.clone().json()) as {
      error?: { code?: unknown; type?: unknown };
    };
    upstreamCode = String(body.error?.code ?? body.error?.type ?? "");
  } catch {
    // A non-JSON upstream response is still handled safely by its status.
  }

  const { status } = response;
  if (status === 429) {
    return new ProviderError(
      "rate_limited",
      "问题较多，模型服务正在排队，请稍后重试。",
      503,
    );
  }
  if (status === 401 || status === 403) {
    return new ProviderError(
      "provider_auth",
      "模型服务配置暂时不可用。",
      503,
    );
  }
  if (status === 400 || upstreamCode === "context_length_exceeded") {
    return new ProviderError(
      "provider_request",
      upstreamCode === "context_length_exceeded"
        ? "问题内容或图片过大，请缩短后重试。"
        : "模型服务无法处理当前请求，请缩短问题或稍后重试。",
      502,
    );
  }
  return new ProviderError(
    "upstream_error",
    "模型服务暂时不可用，请稍后重试。",
    502,
  );
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError"
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestChatCompletion(
  request: ProviderRequest,
  fetchImpl: FetchImplementation = fetch,
  onChunk?: ChunkHandler,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    request.timeoutMs ?? 45_000,
  );

  try {
    const input = `${request.config.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
    const init: RequestInit = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.config.model,
        temperature: 0.2,
        max_tokens: 1800,
        stream: Boolean(onChunk),
        messages: toProviderMessages(
          request.systemPrompt,
          request.messages,
          request.image,
        ),
      }),
      signal: controller.signal,
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      let response: Response;
      try {
        response = await fetchImpl(input, init);
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        if (attempt < MAX_RETRIES) {
          await delay(RETRY_DELAY_MS);
          continue;
        }
        throw new ProviderError(
          "network_error",
          "暂时无法连接模型服务，请检查网络后重试。",
          502,
        );
      }

      if (!response.ok) {
        if (attempt < MAX_RETRIES && RETRYABLE_STATUSES.has(response.status)) {
          await delay(RETRY_DELAY_MS);
          continue;
        }
        throw await mapStatus(response);
      }

      if (onChunk) {
        const streamBody = response.body;
        if (!streamBody) {
          throw new ProviderError(
            "invalid_response",
            "模型返回了无法识别的结果，请重新提问。",
            502,
          );
        }
        const reader = streamBody.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalText = "";
        let completed = false;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              completed = true;
              break;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data: ")) continue;
              const data = trimmed.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data) as {
                  choices?: Array<{
                    delta?: { content?: string };
                  }>;
                };
                const content = parsed.choices?.[0]?.delta?.content;
                if (typeof content === "string" && content.length > 0) {
                  finalText += content;
                  await onChunk(content);
                }
              } catch {
                // ignore malformed chunk
              }
            }
          }
        } catch (error) {
          if (!completed) {
            await reader.cancel(error).catch(() => undefined);
          }
          throw error;
        } finally {
          reader.releaseLock();
        }
        if (!finalText.trim()) {
          throw new ProviderError(
            "empty_response",
            "模型没有生成可显示的答案，请重新提问。",
            502,
          );
        }
        if (finalText.length > MAX_OUTPUT_CHARACTERS) {
          return `${finalText.slice(0, MAX_OUTPUT_CHARACTERS).trimEnd()}\n\n（回答过长，已截断）`;
        }
        const sanitized = sanitizeModelText(finalText);
        if (!sanitized) {
          throw new ProviderError(
            "empty_response",
            "模型没有生成可显示的答案，请重新提问。",
            502,
          );
        }
        return sanitized;
      }

      let body: ChatCompletionResponse;
      try {
        body = (await response.json()) as ChatCompletionResponse;
      } catch {
        throw new ProviderError(
          "invalid_response",
          "模型返回了无法识别的结果，请重新提问。",
          502,
        );
      }
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new ProviderError(
          "invalid_response",
          "模型返回了无法识别的结果，请重新提问。",
          502,
        );
      }

      const sanitized = sanitizeModelText(content);
      if (!sanitized) {
        throw new ProviderError(
          "empty_response",
          "模型没有生成可显示的答案，请重新提问。",
          502,
        );
      }
      if (sanitized.length > MAX_OUTPUT_CHARACTERS) {
        return `${sanitized.slice(0, MAX_OUTPUT_CHARACTERS).trimEnd()}\n\n（回答过长，已截断）`;
      }
      return sanitized;
    }

    throw new ProviderError(
      "upstream_error",
      "模型服务暂时不可用，请稍后重试。",
      502,
    );
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (isAbortError(error)) {
      throw new ProviderError(
        "timeout",
        "模型服务响应较慢，请稍后重试。",
        504,
      );
    }
    throw new ProviderError(
      "network_error",
      "暂时无法连接模型服务，请检查网络后重试。",
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}
