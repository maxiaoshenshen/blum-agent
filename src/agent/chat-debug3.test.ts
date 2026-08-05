import { describe, expect, it, vi } from "vitest";
import { retrieveKnowledge as directRetrieval } from "@/src/domain/retrieval";
import * as chatModule from "./chat";

describe("debug chat3", () => {
  it("checks function identity", async () => {
    const directResult = directRetrieval("MERIVOBOX 是什么产品？", 4);
    const requestCompletion = vi.fn(async () =>
      "MERIVOBOX 魅宝是 Blum 中端金属抽屉系列，侧板厚度为 17mm，标准承重 30kg，采用 Z35E 导轨（内置 BLUMOTION 阻尼）。",
    );

    const response = await (chatModule.answerChat as Function)({
      role: "designer",
      messages: [{ role: "user", content: "MERIVOBOX 是什么产品？" }],
    }, {
      providerConfig: {
        apiKey: "test-secret",
        baseUrl: "https://provider.example",
        model: "claude-opus-5",
      },
      requestCompletion,
    });

    // Check the global debug from chat.ts
    const dbg = globalThis as Record<string, unknown>;
    console.log(">>> chat.ts __debug_matches:", dbg.__debug_matches);
    console.log(">>> chat.ts __debug_risk:", dbg.__debug_risk);
    console.log(">>> chat.ts __debug_hasConfig:", dbg.__debug_hasConfig);
    console.log(">>> direct result length:", directResult.length);
    console.log(">>> chat sources length:", response.sources.length);
    
    // Verify debug values are set and retrievals work
    const dbg_matches = Number(dbg.__debug_matches);
    const chat_sources = response.sources.length;
    console.log(`values: dbg_matches=${dbg_matches}, chat_sources=${chat_sources}, direct=${directResult.length}`);
    // Both should be > 0 since we have matching knowledge
    expect(dbg_matches).toBeGreaterThan(0);
    expect(chat_sources).toBeGreaterThan(0);
    expect(directResult.length).toBeGreaterThan(0);
    expect(response.mode).toBeTruthy();
  });
});
