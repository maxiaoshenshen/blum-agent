import { describe, expect, it, vi } from "vitest";
import type { ParsedChatRequest } from "./schema";
import { answerChat } from "./chat";

const request: ParsedChatRequest = {
  role: "designer",
  messages: [{ role: "user", content: "MERIVOBOX 是什么产品？" }],
};

describe("Blum chat orchestration", () => {
  it("returns a grounded live answer with official sources", async () => {
    const requestCompletion = vi.fn(async () => "MERIVOBOX 是金属抽屉系统。");

    const response = await answerChat(request, {
      providerConfig: {
        apiKey: "test-secret",
        baseUrl: "https://provider.example",
        model: "claude-opus-5",
      },
      requestCompletion,
    });

    expect(response).toMatchObject({
      answer: "MERIVOBOX 是金属抽屉系统。",
      confidence: "guided",
      mode: "live",
    });
    expect(response.sources[0]).toMatchObject({
      id: "box-systems",
      official: true,
    });
    expect(requestCompletion).toHaveBeenCalledOnce();
  });

  it("falls back to a transparent demo answer without provider configuration", async () => {
    const response = await answerChat(request, {});

    expect(response.mode).toBe("demo");
    expect(response.answer).toContain("演示模式");
    expect(response.answer).toContain("MERIVOBOX");
    expect(response.sources[0].id).toBe("box-systems");
  });

  it("marks precise purchasing decisions for review", async () => {
    const response = await answerChat(
      {
        role: "procurement",
        messages: [
          {
            role: "user",
            content: "请确认这个料号兼容并给我最终 BOM 下单。",
          },
        ],
      },
      {
        providerConfig: {
          apiKey: "test-secret",
          baseUrl: "https://provider.example",
          model: "claude-opus-5",
        },
        requestCompletion: vi.fn(async () => "需要先确认完整型号。"),
      },
    );

    expect(response.confidence).toBe("needs-review");
    expect(response.followUps).toContain("补充完整产品编号与所在市场");
  });
});
