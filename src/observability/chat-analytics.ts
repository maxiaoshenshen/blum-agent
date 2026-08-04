import type { ConfidenceLevel, RiskLevel, RoleId } from "@/src/domain/types";

type ChatMode = "live" | "demo" | "guarded";
type AnalyticsErrorType = "rate_limit" | "validation" | "provider" | "unknown";

interface BaseAnalytics {
  timestamp: string;
  response_time_ms: number;
}

interface CompletedChatAnalytics extends BaseAnalytics {
  event: "blum_agent.chat.completed";
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

interface FailedChatAnalytics extends BaseAnalytics {
  event: "blum_agent.chat.failed";
  error_type: AnalyticsErrorType;
}

function logAnalytics(event: CompletedChatAnalytics | FailedChatAnalytics): void {
  if (process.env.NODE_ENV === "development") {
    console.log(JSON.stringify(event));
  }
}

export function recordChatCompletion(
  analytics: Omit<CompletedChatAnalytics, "event" | "timestamp">,
): void {
  logAnalytics({
    event: "blum_agent.chat.completed",
    timestamp: new Date().toISOString(),
    ...analytics,
  });
}

export function recordChatFailure(
  errorType: AnalyticsErrorType,
  responseTimeMs: number,
): void {
  logAnalytics({
    event: "blum_agent.chat.failed",
    timestamp: new Date().toISOString(),
    error_type: errorType,
    response_time_ms: responseTimeMs,
  });
}
