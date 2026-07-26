import {
  answerChat,
  providerConfigFromEnvironment,
} from "@/src/agent/chat";
import { ProviderError } from "@/src/agent/provider";
import { parseChatRequest, ValidationError } from "@/src/agent/schema";

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(
      "invalid_json",
      "请求内容不是有效的 JSON。",
      400,
    );
  }

  try {
    const parsed = parseChatRequest(body);
    const answer = await answerChat(parsed, {
      providerConfig: providerConfigFromEnvironment(),
    });
    return Response.json(answer);
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
