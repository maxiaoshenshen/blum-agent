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
