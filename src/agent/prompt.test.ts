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

  it.each([
    ["designer", "结构化、技术参数化、图纸友好"],
    ["sales", "卖点清晰、对比简洁、成交导向"],
    ["installer", "步骤明确、工具清单、故障导向"],
    ["production", "工艺参数、误差范围、流程规范"],
    ["procurement", "规格精准、交期明确、成本可控"],
    ["consumer", "易懂、不需要专业术语、安全第一"],
  ] as const)("adapts output style for %s", (roleId, style) => {
    const prompt = buildSystemPrompt({
      role: getRole(roleId),
      matches: retrieveKnowledge("MERIVOBOX 是什么产品？"),
      risk: "standard",
    });

    expect(prompt).toContain(style);
    expect(prompt).toContain("结论 → 判断依据 → 建议");
    expect(prompt).toContain("步骤 → 工具 → 注意事项 → 验证方法");
    expect(prompt).toContain("方案 → 参数 → 参考链接 → 待确认");
    expect(prompt).toContain("根据现有资料");
    expect(prompt).toContain("以下信息待确认");
  });
});
