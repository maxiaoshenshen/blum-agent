import { describe, expect, it } from "vitest";
import { getRole, ROLES } from "@/src/domain/roles";
import type { RoleProfile } from "@/src/domain/types";
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
    // Match the actual prompt text
    expect(prompt).toContain("渐进式选型时，保留已确认参数");
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

  it("keeps the no-coverage instruction in English for English conversations", () => {
    const prompt = buildSystemPrompt({
      role: getRole("consumer"),
      matches: [],
      risk: "standard",
      knowledgeCoverage: "none",
      locale: "en",
    });

    expect(prompt).toContain("The first sentence must say");
    expect(prompt).not.toContain("第一句必须是：这个问题超出了当前知识范围");
  });

  it.each([
    ["designer", "结构化、技术参数化、图纸友好"],
    ["sales", "卖点清晰、对比简洁、成交导向"],
    ["installer", "步骤明确、工具清单、故障导向"],
    ["production", "工艺参数、误差范围、流程规范"],
    ["procurement", "规格精准、交期明确，成本可控"],
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

  it.each([
    ["designer", "参数 → 方案 → 参考 → 待确认"],
    ["sales", "卖点 → 对比 → 建议 → 下一步"],
    ["installer", "工具 → 步骤 → 注意事项 → 验证"],
    ["consumer", "原因 → 解决方案 → 预防 → 何时需帮助"],
  ] as const)("requires the dedicated response layout for %s", (roleId, layout) => {
    const prompt = buildSystemPrompt({
      role: getRole(roleId),
      matches: retrieveKnowledge("MERIVOBOX 是什么产品？"),
      risk: "standard",
    });

    expect(prompt).toContain(layout);
  });

  it("states explicit answer caps and prohibited unverified output", () => {
    const prompt = buildSystemPrompt({
      role: getRole("sales"),
      matches: retrieveKnowledge("MERIVOBOX 是什么产品？"),
      risk: "standard",
    });

    expect(prompt).toContain("操作答案最多七步");
    expect(prompt).toContain("选型答案最多六项");
    expect(prompt).toContain("禁止输出清单");
    expect(prompt).toContain("竞品对比");
    expect(prompt).toContain("价格");
  });
});

describe("R36: Prompt edge cases", () => {
  it("buildSystemPrompt handles unknown role gracefully", () => {
    const testRole: RoleProfile = ROLES[0];
    const unknownRole: RoleProfile = {
      ...testRole,
      id: "unknown" as RoleProfile["id"],
    };
    const prompt = buildSystemPrompt({
      role: unknownRole,
      matches: [],
      risk: "standard",
      knowledgeCoverage: "none",
    });
    expect(prompt).toContain("Blum Agent");
    expect(prompt).toContain("这个问题超出了当前知识范围");
  });

  it("buildSystemPrompt applies image context when matches are empty", () => {
    const role: RoleProfile = {
      id: "installer",
      label: "安装工",
      eyebrow: "安装与排障",
      description: "步骤明确",
      starterPrompts: [],
    };
    const prompt = buildSystemPrompt({
      role,
      matches: [],
      risk: "precision",
      knowledgeCoverage: "none",
      locale: "zh",
    });
    expect(prompt).toContain("图片中的文字");
  });

  it("buildSystemPrompt limits conversation history to 6 messages", () => {
    const role: RoleProfile = {
      id: "designer",
      label: "设计师",
      eyebrow: "方案",
      description: "结构化",
      starterPrompts: [],
    };
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `消息 ${i}`,
    }));
    const prompt = buildSystemPrompt({ role, matches: [], risk: "standard", conversationHistory: messages });
    const userCount = (prompt.match(/\[用户/g) || []).length;
    expect(userCount).toBeLessThanOrEqual(6);
  });

  it("buildSystemPrompt enforces metric units rule in prompt", () => {
    const role: RoleProfile = {
      id: "designer",
      label: "设计师",
      eyebrow: "方案",
      description: "结构化",
      starterPrompts: [],
    };
    const prompt = buildSystemPrompt({ role, matches: [], risk: "standard", locale: "zh" });
    expect(prompt).toContain("mm、kg");
    expect(prompt).toContain("禁止混用英制单位");
  });
});
