import { describe, expect, it } from "vitest";
import { getRole } from "@/src/domain/roles";
import { retrieveKnowledge } from "@/src/domain/retrieval";
import { buildSystemPrompt } from "./prompt";

describe("Blum Agent system prompt", () => {
  it("forbids common plausible inferences that are absent from official summaries", () => {
    const prompt = buildSystemPrompt({
      role: getRole("consumer"),
      matches: retrieveKnowledge("blumotion 是什么？"),
      risk: "standard",
    });

    expect(prompt).toContain("不需要为了完整或好听而扩写");
    expect(prompt).toContain("防夹手");
    expect(prompt).toContain("延长寿命");
    expect(prompt).toContain("只写摘要直接支持的作用");
    expect(prompt).toContain("最多四个陈述句");
    expect(prompt).toContain("不得引用或摘录原文");
  });
});
