import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  it("returns a machine-readable healthy status", async () => {
    const response = await GET();
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "healthy", version: expect.any(String) });
    expect(body.timestamp).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(body.uptime).toEqual(expect.any(Number));
  });
});
