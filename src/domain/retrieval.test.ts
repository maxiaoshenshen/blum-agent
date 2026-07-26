import { describe, expect, it } from "vitest";
import { ROLES, getRole } from "./roles";
import {
  classifyRisk,
  getFallbackSources,
  retrieveKnowledge,
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
  it("matches Chinese product names and ranks the lift-system source first", () => {
    const matches = retrieveKnowledge("AVENTOS 爱翻 HK top 怎么选？");

    expect(matches[0].source.id).toBe("lift-systems");
    expect(matches[0].matchedKeywords).toEqual(
      expect.arrayContaining(["aventos", "爱翻", "hk top"]),
    );
  });

  it("matches English aliases without case sensitivity", () => {
    expect(retrieveKnowledge("CLIP TOP BLUMOTION adjustment")[0].source.id).toBe(
      "hinge-systems",
    );
  });

  it("keeps specific box-system results ahead of generic catalogue results", () => {
    const ids = retrieveKnowledge("MERIVOBOX 魅宝抽屉安装").map(
      ({ source }) => source.id,
    );

    expect(ids[0]).toBe("box-systems");
    expect(ids).toContain("easy-assembly");
  });

  it("returns bounded generic official sources for an unknown Blum question", () => {
    const matches = retrieveKnowledge("这是一个没有产品关键词的问题", 3);

    expect(matches).toHaveLength(3);
    expect(matches.map(({ source }) => source.id)).toEqual([
      "product-catalogue",
      "product-configurator",
      "blum-contact",
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
