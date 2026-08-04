import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/chat", () => {
  it("returns a stable validation error contract", async () => {
    const response = await post({
      role: "designer",
      messages: [{ role: "user", content: "" }],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "missing_message",
        message: "请先输入一个关于 Blum 的问题。",
      },
    });
  });

  it("returns the demo contract when provider variables are absent", async () => {
    vi.stubEnv("PROVIDER_BASE_URL", "");
    vi.stubEnv("PROVIDER_API_KEY", "");
    vi.stubEnv("PROVIDER_MODEL", "");

    const response = await post({
      role: "consumer",
      messages: [{ role: "user", content: "BLUMOTION 是什么？" }],
    });
    const body = (await response.json()) as {
      mode: string;
      sources: Array<{ id: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.mode).toBe("demo");
    expect(body.sources[0].id).toBe("aventos-hf");
  });

  it("records structured anonymous success analytics in development without logging question text", async () => {
    vi.stubEnv("PROVIDER_BASE_URL", "");
    vi.stubEnv("PROVIDER_API_KEY", "");
    vi.stubEnv("PROVIDER_MODEL", "");
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await post({
      role: "installer",
      messages: [{ role: "user", content: "MERIVOBOX 安装要注意什么？" }],
    });

    const events = log.mock.calls.map(([message]) => JSON.parse(String(message)) as Record<string, unknown>);
    expect(events).toContainEqual(expect.objectContaining({
      event: "blum_agent.chat.completed",
      role: "installer",
      question_length: expect.any(Number),
      has_image: false,
      risk_level: "standard",
      retrieval_matches: expect.any(Number),
      model_provider_used: false,
      mode: "demo",
      confidence: expect.any(String),
      response_time_ms: expect.any(Number),
      retrieval_time_ms: expect.any(Number),
      model_response_time_ms: expect.any(Number),
      sources_count: expect.any(Number),
      followups_count: expect.any(Number),
      quality: {
        is_guarded: false,
        is_demo: true,
        grounding_intercepted: false,
      },
      timestamp: expect.any(String),
    }));
    expect(log.mock.calls.flat().join(" ")).not.toContain("MERIVOBOX 安装要注意什么？");
  });

  it("records validation errors by anonymous error type in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await post({ role: "designer", messages: [{ role: "user", content: "" }] });

    const events = log.mock.calls.map(([message]) => JSON.parse(String(message)) as Record<string, unknown>);
    expect(events).toContainEqual(expect.objectContaining({
      event: "blum_agent.chat.failed",
      error_type: "validation",
      response_time_ms: expect.any(Number),
      timestamp: expect.any(String),
    }));
  });

  it("rejects malformed JSON without leaking implementation details", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_json",
        message: "请求内容不是有效的 JSON。",
      },
    });
  });

  it("requires JSON and bounds the request before parsing it", async () => {
    const wrongType = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "{}",
      }),
    );
    expect(wrongType.status).toBe(415);
    expect(await wrongType.json()).toMatchObject({
      error: { code: "unsupported_media_type" },
    });

    const oversized = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "7500001",
        },
        body: "{}",
      }),
    );
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({
      error: { code: "request_too_large" },
    });
  });

  it("adds no-store and content-sniffing protection to every response", async () => {
    const response = await post({
      role: "designer",
      messages: [{ role: "user", content: "" }],
    });

    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("rate limits the thirty-first request from the same client IP", async () => {
    const clientIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const makeRequest = () =>
      POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": clientIp,
          },
          body: "{}",
        }),
      );

    for (let index = 0; index < 30; index += 1) {
      expect((await makeRequest()).status).toBe(400);
    }

    const response = await makeRequest();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await response.json()).toMatchObject({
      error: { code: "rate_limited" },
    });
  });

  it("prefers Cloudflare's client IP over x-forwarded-for", async () => {
    const cfIp = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const forwardedIp = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
    const requestWithBothHeaders = () =>
      POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": cfIp,
            "x-forwarded-for": `${forwardedIp}, 10.0.0.1`,
          },
          body: "{}",
        }),
      );

    for (let index = 0; index < 30; index += 1) {
      expect((await requestWithBothHeaders()).status).toBe(400);
    }
    expect((await requestWithBothHeaders()).status).toBe(429);

    const forwardedOnly = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `${forwardedIp}, 10.0.0.1`,
        },
        body: "{}",
      }),
    );
    expect(forwardedOnly.status).toBe(400);
  });
});
