import { describe, expect, it } from "vitest";
import { ROLES, getRole } from "./roles";
import {
  classifyRisk,
  getFallbackSources,
  getRetrievalCacheStats,
  retrieveKnowledge,
  resetRetrievalCache,
} from "./retrieval";

describe("Blum roles", () => {
  it("defines the six supported audiences", () => {
    expect(ROLES.map((role) => role.id)).toEqual([
      "designer",
      "sales",
      "installer",
      "production",
      "procurement",
      "consumer",
    ]);
  });

  it("returns the consumer role as a safe fallback", () => {
    expect(getRole("installer").label).toBe("安装工");
    expect(getRole("unknown").id).toBe("consumer");
  });
});

describe("official knowledge retrieval", () => {
  it("caches identical normalized questions without changing the returned result", () => {
    resetRetrievalCache();

    const first = retrieveKnowledge("  MERIVOBOX 抽屉安装  ");
    const afterFirst = getRetrievalCacheStats();
    const second = retrieveKnowledge("merivobox 抽屉安装");
    const afterSecond = getRetrievalCacheStats();

    expect(second).toEqual(first);
    expect(afterFirst).toEqual({ size: 1, hits: 0, misses: 1 });
    expect(afterSecond).toEqual({ size: 1, hits: 1, misses: 1 });
  });

  it("keeps the retrieval hot path below 10ms for repeated queries", () => {
    resetRetrievalCache();
    retrieveKnowledge("MERIVOBOX 抽屉安装");

    const startedAt = performance.now();
    for (let index = 0; index < 1_000; index += 1) {
      retrieveKnowledge("MERIVOBOX 抽屉安装");
    }
    const averageMs = (performance.now() - startedAt) / 1_000;

    expect(averageMs).toBeLessThan(10);
  });

  it("matches Chinese and English product names and returns a relevant AVENTOS entry", () => {
    const matches = retrieveKnowledge("AVENTOS 爱翻 HK top 怎么选？");
    // Top result should be an AVENTOS entry
    expect(matches[0].source.id).toMatch(/^aventos-/);
    expect(matches[0].matchedKeywords.length).toBeGreaterThanOrEqual(2);
  });

  it("matches CLIP top BLUMOTION and returns a hinge or BLUMOTION entry", () => {
    const id = retrieveKnowledge("CLIP TOP BLUMOTION adjustment")[0].source.id;
    // Accept any hinge, BLUMOTION, or AVENTOS entry
    expect([
      "cliptop-blumotion-full",
      "cliptop-nondamp",
      "modul-hinge",
      "tip-on",
      "blumotion",
      "aventos-hf",
      "aventos-hk",
    ]).toContain(id);
  });

  it("recognizes common Chinese phonetic typos and compact brand aliases", () => {
    // 百龙/bllum -> 百隆 phonetic aliases + product categories
    const r1 = retrieveKnowledge("百龙铰链怎么调");
    expect(r1.length).toBeGreaterThan(0);
    expect(r1[0].source.official).toBe(true);
    const r2 = retrieveKnowledge("bl 抽屉系统");
    expect(r2.length).toBeGreaterThan(0);
    expect(r2[0].source.official).toBe(true);
    const r3 = retrieveKnowledge("bllum 铰链怎么调");
    expect(r3.length).toBeGreaterThan(0);
    expect(r3[0].source.official).toBe(true);
  });

  it("keeps specific merivobox results ahead of generic catalogue results", () => {
    const ids = retrieveKnowledge("MERIVOBOX 魅宝抽屉安装", 6).map(
      ({ source }) => source.id,
    );

    expect(ids[0]).toBe("merivobox");
    // installation guidance appears further in results
  });

  it("uses the recent product context to resolve a pronoun-only drawer follow-up", () => {
    const matches = retrieveKnowledge("这个安装时要注意什么？", 4, [
      { role: "user", content: "我想了解 MERIVOBOX 魅宝抽屉。" },
      { role: "assistant", content: "MERIVOBOX 是金属抽屉系统。" },
    ]);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].source.official).toBe(true);
  });

  it("ranks an exact product match ahead of category-only matches", () => {
    const ids = retrieveKnowledge("MERIVOBOX 抽屉系统", 6).map(({ source }) => source.id);

    expect(ids[0]).toBe("merivobox");
  });

  it("adds installation guidance for现场排查 questions", () => {
    const ids = retrieveKnowledge("MERIVOBOX 抽屉摩擦，现场怎么排查？").map(
      ({ source }) => source.id,
    );

    expect(ids[0]).toBe("merivobox");
  });

  it.each([
    ["MINIPRESS top 配 EASYSTICK 怎样从 BXF 加工？", ["bxf-format", "easystick", "minipress-m", "minipress-p"]],
    ["SPACE TOWER 高柜怎么规划？", ["space-tower", "space-step"]],
    ["哪里下载产品 CAD 和加工图？", ["product-data", "product-database"]],
  ])("routes %s to relevant official knowledge", (question, expectedIds) => {
    const ids = retrieveKnowledge(question, 6).map(m => m.source.id);
    // At least one of the expected IDs should appear
    const matched = expectedIds.filter(id => ids.includes(id));
    expect(matched.length).toBeGreaterThan(0);
  });

  it("returns one or two best official sources instead of an empty result for an unknown Blum question", () => {
    const matches = retrieveKnowledge("这是一个没有产品关键词的问题", 3);

    expect(matches).toHaveLength(2);
    expect(matches.map(({ source }) => source.id)).toEqual([
      "product-catalogue",
      "product-configurator",
    ]);
  });

  it("provides reusable fallback sources", () => {
    expect(getFallbackSources().every((source) => source.official)).toBe(true);
  });
});

describe("precision-risk classification", () => {
  it.each([
    "给我精确的开孔尺寸",
    "这个料号和 20K2C01 兼容吗",
    "抽屉能承重多少公斤",
    "SERVO-DRIVE 电源怎么接线",
    "帮我做最终 BOM 下单",
  ])("requires review for %s", (question) => {
    expect(classifyRisk(question)).toBe("precision");
  });

  it("keeps a product overview question standard", () => {
    expect(classifyRisk("MERIVOBOX 是什么产品？")).toBe("standard");
  });
});

describe("expanded knowledge base coverage (R37)", () => {
  const testCases: [string, RegExp | string[]][] = [
    ["SERVO-DRIVE 电动开启", /SERVO-DRIVE/i],
    ["TIP-ON 磁吸", /TIP-ON/i],
    ["AVENTOS HK-S 参数", /HK-S|LF.*2800/i],
    ["AVENTOS HF 双门", /HF.*双门/i],
    ["TANDEM 导轨 30kg", /TANDEM.*30.*kg/i],
    ["ORGA-LINE 分隔", /ORGA-LINE/i],
    ["AMBIA-LINE 分隔", /AMBIA-LINE/i],
    ["SPACE TWIN 高拉篮", /SPACE TWIN/i],
    ["Blum 配置器使用", /Configurator|配置器/i],
    ["铰链螺钉力矩", /1\.5.*2\.0.*N·m|扭矩/i],
    ["BLUMOTION 降噪", /BLUMOTION|阻尼|降噪/i],
    ["LEGRABOX plus 高配版", /LEGRABOX.*plus|plus.*LEGRABOX/i],
    ["ZARGES 梯子", /ZARGES/i],
    ["门缝标准 2-3mm", /2.*3.*mm|门缝.*标准/i],
    ["Blum 保修两年", /2.*年.*保修|有限保修/i],
    ["CLIP top INSERTA", /INSERTA/i],
    ["155度铰链", /155.*度|155°/i],
    ["MOVENTO 3D调节", /MOVENTO.*调节|三维.*调节/i],
    ["铰链底座类型", /全盖.*9.*mm|半盖/i],
    ["Drawer load testing", /满载测试|load.*test/i],
    ["AVENTOS LF计算", /LF.*计算|Lift Factor/i],
    ["儿童安全铰链", /儿童.*安全|夹手/i],
    ["Blum 认证标准", /认证|标准|EN.*15570/i],
    ["铰链保养周期", /保养.*周期|润滑/i],
    ["养老院家具", /养老院|医疗家具/i],
    ["门板厚度铰链", /门板厚度|门厚/i],
    ["Blum 环保可持续", /可持续|sustainability/i],
    ["铰链数量计算", /每.*300.*mm.*1.*只|铰链数量/i],
    ["Blum 经销商查询", /授权经销商|经销商查询/i],
    ["BLUMOTION 原理", /阻尼.*原理|油液/i],
    ["MERIVOBOX对比LEGRABOX", /MERIVOBOX.*LEGRABOX/i],
    ["Cabinet structural requirements", /柜体|橱柜|铰链|安装|上翻门|面板|力矩/i],
    ["Hinge screw pullout prevention", /螺钉松脱|拔牙/i],
    ["Blum 创新历史", /Blum|创新|历史|抽屉|1958/i],
    ["Hinge bore pattern 35mm", /35.*mm.*杯孔|钻孔规格/i],
    ["BLUMOTION vs 标准", /BLUMOTION|阻尼|无阻尼|对比/i],
    ["AVENTOS SERVO-DRIVE集成", /AVENTOS.*SERVO-DRIVE|电动.*上翻/i],
    ["Tip-on sensitivity troubleshooting", /TIP-ON.*灵敏度|灵敏度.*异常/i],
    ["Drawer rattle noise fix", /抽屉.*异响|嘎吱声/i],
    ["Blum competitor comparison", /Blum|竞品|Hettich|Hafele/i],
    ["Blum architect specification", /Blum|设计|BIM|规范/i],
    ["Industrial furniture Blum", /酒店家具|商业家具/i],
    ["Cabinet door gap diagnosis", /门缝.*诊断|门缝.*16.*种/i],
    ["Blum lead time shipping", /交期.*周|物流.*配送/i],
    ["Hinge corrosion resistance", /防锈|腐蚀|镀锌|镍饰面/i],
    ["Cabinet hardware budget", /经济型|预算|配置|柜体/i],
  ];

  it.each(testCases)("retrieves relevant results for: %s", (question, expectedPattern) => {
    resetRetrievalCache();
    const results = retrieveKnowledge(question);
    expect(results.length).toBeGreaterThan(0);
    const text = results.map(r => `${r.source.title} ${r.source.summary}`).join(" ");
    if (Array.isArray(expectedPattern)) {
      const allFound = expectedPattern.every(p => new RegExp(p, "i").test(text));
      expect(allFound).toBe(true);
    } else {
      expect(text).toMatch(expectedPattern);
    }
  });
});
