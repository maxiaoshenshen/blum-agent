import type { ConfidenceLevel, RiskLevel, RoleId } from "@/src/domain/types";

type ChatMode = "live" | "demo" | "guarded";
type AnalyticsErrorType = "rate_limit" | "validation" | "provider" | "unknown" | string;
type LogLevel = "INFO" | "WARN" | "ERROR";

interface BaseAnalytics {
  requestId: string;
  response_time_ms: number;
}

interface CompletedChatAnalytics extends BaseAnalytics {
  role: RoleId;
  question_length: number;
  has_image: boolean;
  risk_level: RiskLevel;
  retrieval_matches: number;
  model_provider_used: boolean;
  mode: ChatMode;
  confidence: ConfidenceLevel;
  retrieval_time_ms: number;
  model_response_time_ms: number;
  sources_count: number;
  followups_count: number;
  quality: {
    is_guarded: boolean;
    is_demo: boolean;
    grounding_intercepted: boolean;
  };
}

interface FailedChatAnalytics {
  requestId: string;
  responseTimeMs: number;
  errorType: AnalyticsErrorType;
  providerStatus?: number;
}

interface RequestReceivedAnalytics {
  requestId: string;
  role: RoleId;
  risk: RiskLevel;
}

interface RateLimitAnalytics {
  requestId: string;
  clientIp: string;
}

const ERROR_RATE_WINDOW_MS = 10 * 60_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const SLOW_RESPONSE_MS = 30_000;
const RATE_LIMIT_ALERT_THRESHOLD = 50;

const requestOutcomes: Array<{ timestamp: number; failed: boolean }> = [];
const rateLimitEvents: number[] = [];
let errorRateAlertActive = false;

function emit(level: LogLevel, event: string, payload: Record<string, unknown>): void {
  const message = JSON.stringify({
    level,
    timestamp: new Date().toISOString(),
    ...payload,
    event,
  });

  if (level === "ERROR") {
    console.error(message);
  } else if (level === "WARN") {
    console.warn(message);
  } else {
    console.log(message);
  }
}

function prune<T extends { timestamp: number }>(events: T[], cutoff: number): void {
  while (events[0]?.timestamp < cutoff) events.shift();
}

function stableIpHash(value: string): string {
  // The IP is never logged. This keyed, non-reversible operational fingerprint
  // is only used to correlate repeated rate-limit events within an instance.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `ip_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function recordOutcome(requestId: string, failed: boolean): void {
  const now = Date.now();
  requestOutcomes.push({ timestamp: now, failed });
  prune(requestOutcomes, now - ERROR_RATE_WINDOW_MS);

  const failures = requestOutcomes.filter((outcome) => outcome.failed).length;
  const errorRate = failures / requestOutcomes.length;
  const exceedsThreshold = errorRate > 0.1;
  if (exceedsThreshold && !errorRateAlertActive) {
    errorRateAlertActive = true;
    emit("WARN", "chat_error_rate_exceeded", {
      request_id: requestId,
      window_ms: ERROR_RATE_WINDOW_MS,
      requests: requestOutcomes.length,
      failures,
      error_rate: Number(errorRate.toFixed(4)),
      threshold: 0.1,
    });
  } else if (!exceedsThreshold) {
    errorRateAlertActive = false;
  }
}

export function createRequestId(): string {
  const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `req_${randomPart.toLowerCase()}`;
}

export function recordChatRequestReceived(analytics: RequestReceivedAnalytics): void {
  emit("INFO", "chat_request_received", {
    request_id: analytics.requestId,
    role: analytics.role,
    risk: analytics.risk,
  });
}

export function recordChatCompletion(analytics: CompletedChatAnalytics): void {
  recordOutcome(analytics.requestId, false);
  emit("INFO", "chat_response_sent", {
    request_id: analytics.requestId,
    duration_ms: analytics.response_time_ms,
    mode: analytics.mode,
    sources: analytics.sources_count,
    role: analytics.role,
    risk: analytics.risk_level,
    confidence: analytics.confidence,
    retrieval_matches: analytics.retrieval_matches,
    retrieval_time_ms: analytics.retrieval_time_ms,
    model_response_time_ms: analytics.model_response_time_ms,
    model_provider_used: analytics.model_provider_used,
    question_length: analytics.question_length,
    has_image: analytics.has_image,
    followups_count: analytics.followups_count,
    quality: analytics.quality,
  });
  if (analytics.response_time_ms > SLOW_RESPONSE_MS) {
    emit("WARN", "slow_api_response", {
      request_id: analytics.requestId,
      duration_ms: analytics.response_time_ms,
      threshold_ms: SLOW_RESPONSE_MS,
      mode: analytics.mode,
    });
  }
}

export function recordChatFailure(analytics: FailedChatAnalytics): void {
  recordOutcome(analytics.requestId, true);
  const isProviderError = analytics.providerStatus !== undefined || analytics.errorType === "provider";
  emit("ERROR", isProviderError ? "provider_error" : "chat_request_failed", {
    request_id: analytics.requestId,
    duration_ms: analytics.responseTimeMs,
    error_type: analytics.errorType,
    ...(analytics.providerStatus !== undefined ? { provider_status: analytics.providerStatus } : {}),
  });
  if (analytics.providerStatus !== undefined && analytics.providerStatus !== 200) {
    emit("ERROR", "provider_non_200", {
      request_id: analytics.requestId,
      provider_status: analytics.providerStatus,
      error_type: analytics.errorType,
    });
  }
}

export function recordRateLimitExceeded(analytics: RateLimitAnalytics): void {
  const now = Date.now();
  rateLimitEvents.push(now);
  while (rateLimitEvents[0] !== undefined && rateLimitEvents[0] < now - RATE_LIMIT_WINDOW_MS) {
    rateLimitEvents.shift();
  }
  emit("WARN", "rate_limit_exceeded", {
    request_id: analytics.requestId,
    ip_hash: stableIpHash(analytics.clientIp),
  });
  if (rateLimitEvents.length > RATE_LIMIT_ALERT_THRESHOLD) {
    emit("WARN", "rate_limit_alert", {
      request_id: analytics.requestId,
      count: rateLimitEvents.length,
      window_ms: RATE_LIMIT_WINDOW_MS,
      threshold: RATE_LIMIT_ALERT_THRESHOLD,
    });
  }
}

export function resetAlertStateForTests(): void {
  requestOutcomes.length = 0;
  rateLimitEvents.length = 0;
  errorRateAlertActive = false;
}
