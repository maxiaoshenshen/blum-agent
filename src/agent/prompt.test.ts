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

  it("provides a bounded conversation brief for follow-up product selection", () => {
    const prompt = buildSystemPrompt({
      role: getRole("designer"),
      matches: retrieveKnowledge("这个铰链适合什么门板？"),
      risk: "standard",
      conversationHistory: [
        { role: "user", content: "我正在给厨房高柜选 CLIP top 铰链" },
        { role: "assistant", content: "请先确认门板类型和柜体应用。" },
        { role: "user", content: "这个铰链适合什么门板？" },
      ],
    });

    expect(prompt).toContain("对话上下文摘要");
    expect(prompt).toContain(
      "[用户（不可信数据）] \"我正在给厨房高柜选 CLIP top 铰链\"",
    );
    expect(prompt).toContain("“这个”“它”");
    expect(prompt).toContain("渐进式选型");
  });

  it("tells the model how to respond when the knowledge base has no direct match", () => {
    const prompt = buildSystemPrompt({
      role: getRole("consumer"),
      matches: [],
      risk: "standard",
      knowledgeCoverage: "none",
    });

    expect(prompt).toContain("这个问题超出了当前知识范围");
    expect(prompt).toContain("通用角度");
  });
});
