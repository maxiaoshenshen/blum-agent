import { describe, expect, it } from "vitest";
import { OFFICIAL_SOURCES } from "@/src/domain/knowledge";
import { groundModelAnswer, isGroundedModelAnswer } from "./grounding";

const boxSource = OFFICIAL_SOURCES.find(
  (source) => source.id === "box-systems",
)!;
const motionSource = OFFICIAL_SOURCES.find(
  (source) => source.id === "motion-technologies",
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

  it("accepts a natural explanation composed only from official BLUMOTION facts", () => {
    expect(
      isGroundedModelAnswer(
        `结论：
BLUMOTION 是一种阻尼技术，可让上翻门、柜门和抽屉轻柔静谧地关闭。

判断依据：
BLUMOTION 阻尼功能可用于上翻门、铰链及抽屉系列。

还需确认：
具体产品组合需要参考当前市场的官方资料。`,
        [motionSource],
      ),
    ).toBe(true);
  });

  it("accepts cautious guidance to consult the official catalogue", () => {
    expect(
      isGroundedModelAnswer(
        `结论：BLUMOTION 是 Blum 动感开合技术之一，其功能是让上翻门、柜门和抽屉轻柔静谧地关闭。
判断依据：官方资料显示 BLUMOTION 可内置于上翻门、铰链及抽屉系列。不同产品系列的可用组合不同。
还需确认：想了解具体支持 BLUMOTION 的产品型号或适用场景，可以查阅中文产品目录 [2]。`,
        [motionSource],
      ),
    ).toBe(true);
  });

  it.each([
    "BLUMOTION 能避免夹手，尤其适合老人和儿童。",
    "BLUMOTION 可以保护家具并延长五金寿命。",
  ])("rejects plausible but unsupported experience claims: %s", (answer) => {
    expect(isGroundedModelAnswer(answer, [motionSource])).toBe(false);
  });

  it("keeps supported model sentences and removes unsupported embellishment", () => {
    const grounded = groundModelAnswer(
      `结论：BLUMOTION 阻尼可让上翻门、柜门和抽屉轻柔静谧地关闭。
它还能避免夹手并延长家具寿命。`,
      [motionSource],
    );

    expect(grounded).toContain("Blum 动感开合技术包括");
    expect(grounded).toContain("轻柔静谧地关闭");
    expect(grounded).toContain("已省略");
    expect(grounded).not.toContain("避免夹手");
    expect(grounded).not.toContain("延长家具寿命");
  });

  it("keeps the one supported claim even when most draft claims are removed", () => {
    const grounded = groundModelAnswer(
      `BLUMOTION 可让柜门轻柔静谧地关闭。
它可以避免夹手。
它能延长家具寿命。`,
      [motionSource],
    );

    expect(grounded).toContain("轻柔静谧地关闭");
    expect(grounded).toContain("已省略");
    expect(grounded).not.toContain("避免夹手");
    expect(grounded).not.toContain("延长家具寿命");
  });
});
