import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/src/agent/provider";

const requestChatCompletion = vi.hoisted(() => vi.fn());

vi.mock("@/src/agent/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/agent/provider")>();
  return { ...actual, requestChatCompletion };
});

import { POST } from "./route";

function post(body: unknown, headers: HeadersInit = {}) {
  return POST(
    new Request("http://localhost/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const validBody = {
  role: "designer",
  messages: [{ role: "user", content: "MERIVOBOX 是什么产品？" }],
};

beforeEach(() => {
  vi.stubEnv("PROVIDER_BASE_URL", "https://provider.example");
  vi.stubEnv("PROVIDER_API_KEY", "test-secret");
  vi.stubEnv("PROVIDER_MODEL", "claude-opus-5");
  requestChatCompletion.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/chat/stream", () => {
  it("emits start, chunk and done SSE events for a successful provider stream", async () => {
    requestChatCompletion.mockImplementation(async (_request: unknown, _fetch: unknown, onChunk: (chunk: string) => Promise<void>) => {
      await onChunk("MERIVOBOX ");
      await onChunk("是金属抽屉系统。");
      return "MERIVOBOX 是金属抽屉系统。";
    });

    const response = await post(validBody);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("event: start\n");
    expect(text).toContain('event: chunk\ndata: {"text":"MERIVOBOX "');
    expect(text).toContain("event: done\n");
    expect(text).toContain('"answer":"MERIVOBOX 是金属抽屉系统。"');
  });

  it("records structured anonymous stream analytics after the response finishes in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    requestChatCompletion.mockResolvedValue("已完成");

    const response = await post(validBody);
    await response.text();

    const events = log.mock.calls.map(([message]) => JSON.parse(String(message)) as Record<string, unknown>);
    expect(events).toContainEqual(expect.objectContaining({
      level: "INFO",
      event: "chat_response_sent",
      request_id: expect.any(String),
      role: "designer",
      question_length: expect.any(Number),
      has_image: false,
      risk: "standard",
      retrieval_matches: expect.any(Number),
      model_provider_used: true,
      mode: "live",
      confidence: "guided",
      duration_ms: expect.any(Number),
      retrieval_time_ms: expect.any(Number),
      model_response_time_ms: expect.any(Number),
      sources: expect.any(Number),
      followups_count: expect.any(Number),
      quality: {
        is_guarded: false,
        is_demo: false,
        grounding_intercepted: false,
      },
      timestamp: expect.any(String),
    }));
    expect(log.mock.calls.flat().join(" ")).not.toContain("MERIVOBOX 是什么产品？");
  });

  it("finishes with verified official material when the provider times out", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    requestChatCompletion.mockRejectedValue(
      new ProviderError("timeout", "模型服务响应较慢，请稍后重试。", 504),
    );

    const response = await post(validBody);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain("event: start\n");
    expect(text).toContain("event: chunk\n");
    expect(text).toContain("模型服务暂时不可用");
    expect(text).toContain("event: done\n");
    expect(text).not.toContain("event: error\n");
    const events = log.mock.calls.map(([message]) => JSON.parse(String(message)) as Record<string, unknown>);
    expect(events).toContainEqual(expect.objectContaining({
      level: "ERROR",
      event: "provider_error",
      error_type: "timeout",
      provider_status: 504,
      duration_ms: expect.any(Number),
      request_id: expect.any(String),
      timestamp: expect.any(String),
    }));
  });

  it("returns 503 SSE when provider configuration is unavailable", async () => {
    vi.stubEnv("PROVIDER_BASE_URL", "");
    vi.stubEnv("PROVIDER_API_KEY", "");
    vi.stubEnv("PROVIDER_MODEL", "");

    const response = await post(validBody);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('event: error\ndata: {"code":"no_config"');
  });

  it("returns 400 SSE for malformed JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('event: error\ndata: {"code":"invalid_json"');
  });

  it("rate limits the thirty-first request from the same IP", async () => {
    const clientIp = `198.18.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}`;
    const makeRequest = () => post({}, { "cf-connecting-ip": clientIp });

    for (let index = 0; index < 30; index += 1) {
      expect((await makeRequest()).status).toBe(400);
    }

    const response = await makeRequest();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await response.text()).toContain('event: error\ndata: {"code":"rate_limited"');
  });
});
