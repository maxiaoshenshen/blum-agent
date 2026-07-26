import { describe, expect, it } from "vitest";
import { ValidationError, parseChatRequest } from "./schema";

const validRequest = {
  role: "designer",
  messages: [{ role: "user", content: "AVENTOS HK top 怎么选？" }],
};

describe("chat request validation", () => {
  it("accepts a bounded request", () => {
    expect(parseChatRequest(validRequest)).toMatchObject(validRequest);
  });

  it("rejects an empty latest question", () => {
    expect(() =>
      parseChatRequest({
        role: "designer",
        messages: [{ role: "user", content: "   " }],
      }),
    ).toThrowError(ValidationError);
  });

  it("rejects oversized message content", () => {
    expect(() =>
      parseChatRequest({
        role: "designer",
        messages: [{ role: "user", content: "问".repeat(4_001) }],
      }),
    ).toThrowError(/4000/);
  });

  it("rejects unsupported roles", () => {
    expect(() => parseChatRequest({ ...validRequest, role: "engineer" })).toThrow(
      /角色/,
    );
  });

  it("rejects unsupported image media types", () => {
    expect(() =>
      parseChatRequest({
        ...validRequest,
        image: "data:image/svg+xml;base64,PHN2Zy8+",
      }),
    ).toThrow(/JPG、PNG 或 WebP/);
  });

  it("keeps the latest bounded conversation turns", () => {
    const parsed = parseChatRequest({
      role: "sales",
      messages: Array.from({ length: 20 }, (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `message-${index}`,
      })),
    });

    expect(parsed.messages).toHaveLength(12);
    expect(parsed.messages[0].content).toBe("message-8");
    expect(parsed.messages.at(-1)?.content).toBe("message-19");
  });
});
