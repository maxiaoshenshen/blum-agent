import { FixedWindowRateLimiter } from "@/src/security/rate-limit";
import { clientIdentity } from "@/src/security/client-identity";

const API_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;
const MAX_COMMENT_LENGTH = 1_000;
const MAX_REQUEST_BYTES = 16_384;
const feedbackRateLimiter = new FixedWindowRateLimiter({
  limit: 3,
  windowMs: 60_000,
  maxEntries: 10_000,
});

type FeedbackRating = "helpful" | "inaccurate";

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { ...API_RESPONSE_HEADERS, ...headers },
  });
}

async function readFeedbackBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new Error("request_too_large");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_json");
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error("request_too_large");
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
    throw new Error("invalid_json");
  }
}

function parseFeedback(value: unknown): {
  answerId: string;
  rating: FeedbackRating;
  comment?: string;
  timestamp: number;
} | null {
  if (!value || typeof value !== "object") return null;
  const answerId = Reflect.get(value, "answerId");
  const rating = Reflect.get(value, "rating");
  const comment = Reflect.get(value, "comment");
  const timestamp = Reflect.get(value, "timestamp");
  if (
    typeof answerId !== "string" ||
    !answerId.trim() ||
    answerId.length > 160 ||
    (rating !== "helpful" && rating !== "inaccurate") ||
    !Number.isFinite(timestamp)
  ) {
    return null;
  }
  if (comment !== undefined && (typeof comment !== "string" || comment.length > MAX_COMMENT_LENGTH)) {
    return null;
  }
  return {
    answerId: answerId.trim(),
    rating,
    ...(typeof comment === "string" && comment.trim() ? { comment: comment.trim() } : {}),
    timestamp,
  };
}

export async function POST(request: Request): Promise<Response> {
  const decision = feedbackRateLimiter.attempt(clientIdentity(request));
  if (!decision.allowed) {
    return jsonResponse(
      { error: { code: "rate_limited", message: "反馈提交过于频繁，请稍后再试。" } },
      429,
      { "Retry-After": String(decision.retryAfterSeconds) },
    );
  }

  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return jsonResponse({ error: { code: "unsupported_media_type", message: "请求必须使用 application/json 格式。" } }, 415);
  }

  let body: unknown;
  try {
    body = await readFeedbackBody(request);
  } catch (error) {
    if (error instanceof Error && error.message === "request_too_large") {
      return jsonResponse({ error: { code: "request_too_large", message: "反馈内容过大。" } }, 413);
    }
    return jsonResponse({ error: { code: "invalid_json", message: "请求内容不是有效的 JSON。" } }, 400);
  }
  const feedback = parseFeedback(body);
  if (!feedback) {
    return jsonResponse({ error: { code: "invalid_feedback", message: "反馈内容格式无效。" } }, 400);
  }

  // Feedback persistence is intentionally not implemented in this demo.
  // Never log user comments or identifiers here: logs are a separate trust
  // boundary and may be retained longer than the product data.
  return jsonResponse({ success: true });
}
