import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRequestId,
  recordChatCompletion,
  recordChatFailure,
  recordChatRequestReceived,
  recordRateLimitExceeded,
  resetAlertStateForTests,
} from "./chat-analytics";

afterEach(() => {
  vi.restoreAllMocks();
  resetAlertStateForTests();
});

function parsedLog(call: unknown[]): Record<string, unknown> {
  return JSON.parse(String(call[0])) as Record<string, unknown>;
}

describe("chat observability", () => {
  it("emits a JSON request event with ISO timestamp and request ID", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    recordChatRequestReceived({ requestId: "req-test", role: "consumer", risk: "standard" });

    expect(log).toHaveBeenCalledTimes(1);
    expect(parsedLog(log.mock.calls[0])).toMatchObject({
      level: "INFO",
      request_id: "req-test",
      event: "chat_request_received",
      role: "consumer",
      risk: "standard",
    });
    expect(parsedLog(log.mock.calls[0]).timestamp).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
  });

  it("emits a response event and warns for a response over 30 seconds", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    recordChatCompletion({
      requestId: "req-slow",
      role: "consumer",
      question_length: 12,
      has_image: false,
      risk_level: "standard",
      retrieval_matches: 2,
      model_provider_used: true,
      mode: "live",
      confidence: "guided",
      response_time_ms: 30_001,
      retrieval_time_ms: 2,
      model_response_time_ms: 30_000,
      sources_count: 2,
      followups_count: 1,
      quality: { is_guarded: false, is_demo: false, grounding_intercepted: false },
    });

    expect(parsedLog(log.mock.calls[0])).toMatchObject({
      level: "INFO",
      request_id: "req-slow",
      event: "chat_response_sent",
      duration_ms: 30_001,
      mode: "live",
      sources: 2,
    });
    expect(parsedLog(warn.mock.calls[0])).toMatchObject({
      level: "WARN",
      event: "slow_api_response",
      request_id: "req-slow",
    });
  });

  it("logs rate limits with a hashed IP and alerts after more than 50 in a minute", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    for (let index = 0; index < 51; index += 1) {
      recordRateLimitExceeded({ requestId: `req-${index}`, clientIp: "198.51.100.27" });
    }

    expect(parsedLog(warn.mock.calls[0])).toMatchObject({
      level: "WARN",
      event: "rate_limit_exceeded",
      request_id: "req-0",
      ip_hash: expect.any(String),
    });
    expect(parsedLog(warn.mock.calls.at(-1)!)).toMatchObject({
      level: "WARN",
      event: "rate_limit_alert",
      count: 51,
    });
  });

  it("logs provider failures as errors and alerts on non-200 responses", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    recordChatFailure({
      requestId: "req-provider",
      errorType: "timeout",
      responseTimeMs: 120,
      providerStatus: 504,
    });

    expect(parsedLog(error.mock.calls[0])).toMatchObject({
      level: "ERROR",
      event: "provider_error",
      request_id: "req-provider",
      error_type: "timeout",
      provider_status: 504,
    });
    expect(parsedLog(error.mock.calls[1])).toMatchObject({
      level: "ERROR",
      event: "provider_non_200",
      provider_status: 504,
    });
  });

  it("creates opaque request IDs", () => {
    expect(createRequestId()).toMatch(/^req_[a-z0-9-]+$/);
  });
});
