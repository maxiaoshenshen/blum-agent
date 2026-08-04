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
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
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

  const hasInvalidOrder =
    messages[0]?.role !== "user" ||
    messages.at(-1)?.role !== "user" ||
    messages.some(
      (message, index) =>
        index > 0 && message.role === messages[index - 1]?.role,
    );
  if (hasInvalidOrder) {
    throw new ValidationError(
      "invalid_message_order",
      "对话消息顺序无效，请开启新对话后重试。",
    );
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

function decodeBase64(base64: string): Uint8Array | undefined {
  try {
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function isExpectedImageFormat(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return bytes.length >= 8 && bytes.slice(0, 8).every((byte, index) => byte === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]);
  }
  // WebP is a RIFF container whose format marker starts at byte 8.
  return bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}

function parseImage(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !supportedImagePattern.test(value)) {
    throw new ValidationError(
      "unsupported_image",
      "图片仅支持 JPG、PNG 或 WebP 格式。",
    );
  }
  const [header, encodedPayload] = value.split(",", 2);
  const base64Payload = encodedPayload?.replace(/\s/g, "") ?? "";
  const paddingLength = base64Payload.endsWith("==")
    ? 2
    : base64Payload.endsWith("=")
      ? 1
      : 0;
  const decodedBytes = Math.floor((base64Payload.length * 3) / 4) - paddingLength;
  if (decodedBytes > MAX_IMAGE_BYTES) {
    throw new ValidationError("image_too_large", "图片不能超过 5 MB。");
  }
  const bytes = decodeBase64(base64Payload);
  const mimeType = header!.toLowerCase().replace(/^data:/, "").replace(";base64", "");
  if (!bytes || !isExpectedImageFormat(mimeType, bytes)) {
    throw new ValidationError("unsupported_image", "图片内容与声明格式不匹配。");
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
