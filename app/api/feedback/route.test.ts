import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

function post(body: unknown, ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`) {
  return POST(
    new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": ip,
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/feedback", () => {
  it("accepts a valid rating and writes no-cache JSON", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = await post({
      answerId: "answer-123",
      rating: "helpful",
      comment: "步骤很清楚",
      timestamp: Date.now(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(log).toHaveBeenCalledWith(
      "Blum Agent feedback",
      expect.objectContaining({ answerId: "answer-123", rating: "helpful" }),
    );
    log.mockRestore();
  });

  it("rejects malformed feedback and limits the fourth feedback from one IP", async () => {
    const invalid = await post({ answerId: "", rating: "great" });
    expect(invalid.status).toBe(400);

    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const payload = { answerId: "answer-123", rating: "inaccurate", timestamp: Date.now() };
    for (let index = 0; index < 3; index += 1) {
      expect((await post(payload, ip)).status).toBe(200);
    }
    const limited = await post(payload, ip);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
  });
});
