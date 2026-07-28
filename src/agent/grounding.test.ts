import { describe, expect, it } from "vitest";
import { OFFICIAL_SOURCES } from "@/src/domain/knowledge";
import { isGroundedModelAnswer } from "./grounding";

const boxSource = OFFICIAL_SOURCES.find(
  (source) => source.id === "box-systems",
)!;

describe("deterministic model grounding gate", () => {
  it("accepts a concise claim directly supported by the official summary", () => {
    expect(
      isGroundedModelAnswer(
        "结论：MERIVOBOX 魅宝是 Blum 金属抽屉系统中的产品系列。",
        [boxSource],
      ),
    ).toBe(true);
  });

  it.each([
    "MERIVOBOX 属于电动气压弹簧反弹开启系统。",
    "MERIVOBOX 可以搭配 ADUBO 和 SORTMATIC。",
    "MERIVOBOX 的调节范围是 2 mm。",
  ])("rejects unsupported product claims: %s", (answer) => {
    expect(isGroundedModelAnswer(answer, [boxSource])).toBe(false);
  });

  it("allows unknown details only when clearly framed as questions", () => {
    expect(
      isGroundedModelAnswer(
        "结论：MERIVOBOX 魅宝是金属抽屉系统。\n还需确认：柜体尺寸和面板重量是多少？",
        [boxSource],
      ),
    ).toBe(true);
  });
});
