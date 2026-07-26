import { ROLES } from "@/src/domain/roles";
import type { RoleId } from "@/src/domain/types";

export type ChatMessageRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatMessageRole;
  content: string;
}

export interface ParsedChatRequest {
  role: RoleId;
  messages: ChatMessage[];
  image?: string;
}

const MAX_MESSAGE_LENGTH = 4_000;
const MAX_TOTAL_LENGTH = 12_000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_IMAGE_DATA_URL_LENGTH = 7_000_000;
const supportedRoleIds = new Set(ROLES.map((role) => role.id));
const supportedImagePattern =
  /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i;

export class ValidationError extends Error {
  readonly code: string;
  readonly status = 400;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
  }
}

function parseMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError("missing_message", "请先输入一个关于 Blum 的问题。");
  }

  const messages = value.map((item): ChatMessage => {
    if (!item || typeof item !== "object") {
      throw new ValidationError("invalid_message", "对话消息格式无效。");
    }

    const role = Reflect.get(item, "role");
    const content = Reflect.get(item, "content");
    if (
      (role !== "user" && role !== "assistant") ||
      typeof content !== "string"
    ) {
      throw new ValidationError("invalid_message", "对话消息格式无效。");
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
      throw new ValidationError(
        "message_too_long",
        `单条问题不能超过 ${MAX_MESSAGE_LENGTH} 个字符。`,
      );
    }

    return { role, content: content.trim() };
  });

  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  if (!latestUserMessage?.content) {
    throw new ValidationError("missing_message", "请先输入一个关于 Blum 的问题。");
  }

  const totalLength = messages.reduce(
    (sum, message) => sum + message.content.length,
    0,
  );
  if (totalLength > MAX_TOTAL_LENGTH) {
    throw new ValidationError(
      "conversation_too_long",
      "当前对话过长，请开启一个新问题继续。",
    );
  }

  return messages.slice(-MAX_HISTORY_MESSAGES);
}

function parseImage(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !supportedImagePattern.test(value)) {
    throw new ValidationError(
      "unsupported_image",
      "图片仅支持 JPG、PNG 或 WebP 格式。",
    );
  }
  if (value.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new ValidationError("image_too_large", "图片不能超过 5 MB。");
  }
  return value.replace(/\s/g, "");
}

export function parseChatRequest(value: unknown): ParsedChatRequest {
  if (!value || typeof value !== "object") {
    throw new ValidationError("invalid_request", "请求格式无效。");
  }

  const role = Reflect.get(value, "role");
  if (typeof role !== "string" || !supportedRoleIds.has(role as RoleId)) {
    throw new ValidationError("invalid_role", "请选择有效的用户角色。");
  }

  const parsed: ParsedChatRequest = {
    role: role as RoleId,
    messages: parseMessages(Reflect.get(value, "messages")),
  };
  const image = parseImage(Reflect.get(value, "image"));
  if (image) parsed.image = image;
  return parsed;
}
