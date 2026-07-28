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
    expect(body.sources[0].id).toBe("motion-technologies");
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
});
