import { FixedWindowRateLimiter } from "@/src/security/rate-limit";

const API_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;
const MAX_COMMENT_LENGTH = 1_000;
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

function clientIdentity(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
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

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return jsonResponse({ error: { code: "unsupported_media_type", message: "请求必须使用 application/json 格式。" } }, 415);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: { code: "invalid_json", message: "请求内容不是有效的 JSON。" } }, 400);
  }
  const feedback = parseFeedback(body);
  if (!feedback) {
    return jsonResponse({ error: { code: "invalid_feedback", message: "反馈内容格式无效。" } }, 400);
  }

  console.log("Blum Agent feedback", feedback);
  return jsonResponse({ success: true });
}
