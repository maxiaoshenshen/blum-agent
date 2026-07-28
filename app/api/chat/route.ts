import {
  answerChat,
  providerConfigFromEnvironment,
} from "@/src/agent/chat";
import { ProviderError } from "@/src/agent/provider";
import { parseChatRequest, ValidationError } from "@/src/agent/schema";

const MAX_REQUEST_BYTES = 7_500_000;
const API_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

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
  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof BodyReadError) {
      return errorResponse(error.code, error.message, error.status);
    }
    return errorResponse("invalid_json", "请求内容不是有效的 JSON。", 400);
  }

  try {
    const parsed = parseChatRequest(body);
    const answer = await answerChat(parsed, {
      providerConfig: providerConfigFromEnvironment(),
    });
    return jsonResponse(answer);
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ProviderError) {
      return errorResponse(error.code, error.message, error.status);
    }

    return errorResponse(
      "internal_error",
      "Blum Agent 暂时无法处理这个问题，请稍后重试。",
      500,
    );
  }
}
