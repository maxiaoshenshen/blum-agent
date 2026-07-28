import type { ChatMessage } from "./schema";
import { sanitizeModelText } from "./sanitize";

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface ProviderRequest {
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
const RETRYABLE_STATUSES = new Set([408, 500, 502, 503, 504]);

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

function mapStatus(status: number): ProviderError {
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
  return new ProviderError(
    "upstream_error",
    "模型服务暂时不可用，请稍后重试。",
    502,
  );
}

export async function requestChatCompletion(
  request: ProviderRequest,
  fetchImpl: FetchImplementation = fetch,
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
        messages: toProviderMessages(
          request.systemPrompt,
          request.messages,
          request.image,
        ),
      }),
      signal: controller.signal,
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;
      try {
        response = await fetchImpl(input, init);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        if (attempt === 0) continue;
        throw error;
      }

      if (!response.ok) {
        if (attempt === 0 && RETRYABLE_STATUSES.has(response.status)) continue;
        throw mapStatus(response.status);
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
    if (error instanceof DOMException && error.name === "AbortError") {
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
