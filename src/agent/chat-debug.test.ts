import { describe, expect, it, vi } from "vitest";
import { answerChat } from "./chat";

const merivoboxRequest = {
  role: "designer" as const,
  messages: [{ role: "user" as const, content: "MERIVOBOX 是什么产品？" }],
};

describe("debug chat", () => {
  it("traces through answerChat", async () => {
    const requestCompletion = vi.fn(async () =>
      "MERIVOBOX 魅宝是 Blum 中端金属抽屉系列，侧板厚度为 17mm，标准承重 30kg，采用 Z35E 导轨（内置 BLUMOTION 阻尼）。",
    );

    const response = await answerChat(merivoboxRequest, {
      providerConfig: {
        apiKey: "test-secret",
        baseUrl: "https://provider.example",
        model: "claude-opus-5",
      },
      requestCompletion,
    });

    console.log("mode:", response.mode);
    console.log("sources length:", response.sources.length);
    console.log("sources[0]:", JSON.stringify(response.sources[0]));
    console.log("confidence:", response.confidence);

    expect(response.sources[0]).toMatchObject({
      id: "merivobox",
      official: true,
    });
  });
});
