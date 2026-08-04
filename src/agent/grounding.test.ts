import { describe, expect, it } from "vitest";
import { OFFICIAL_SOURCES } from "@/src/domain/knowledge";
import { groundModelAnswer, isGroundedModelAnswer } from "./grounding";

const merivoboxSource = OFFICIAL_SOURCES.find(
  (source) => source.id === "merivobox",
)!;
const blumotionSource = OFFICIAL_SOURCES.find(
  (source) => source.id === "blumotion",
)!;

describe("deterministic model grounding gate", () => {
  it("accepts a concise claim directly supported by the official summary", () => {
    expect(
      isGroundedModelAnswer(
        "结论：MERIVOBOX 魅宝是 Blum 中端金属抽屉系列，以其高性价比和灵活的模块化设计著称。",
        [merivoboxSource],
      ),
    ).toBe(true);
  });

  it("accepts a complete official-summary quote even when punctuation differs", () => {
    expect(
      isGroundedModelAnswer(
        "BLUMOTION 是 Blum 自研的油压阻尼闭合技术，通过内置于产品内部的油压缓冲器实现轻柔无冲击的关闭效果",
        [blumotionSource],
      ),
    ).toBe(true);
  });

  it("allows a short product-labelled answer without overfitting bigram coverage", () => {
    expect(isGroundedModelAnswer("结论：BLUMOTION 需核实。", [blumotionSource])).toBe(
      true,
    );
  });

  it.each([
    "MERIVOBOX 属于电动气压弹簧反弹开启系统。",
    "MERIVOBOX 可以搭配 ADUBO 和 SORTMATIC。",
    "MERIVOBOX 的调节范围是 2 mm。",
  ])("rejects unsupported product claims: %s", (answer) => {
    expect(isGroundedModelAnswer(answer, [merivoboxSource])).toBe(false);
  });

  it("allows unknown details only when clearly framed as questions", () => {
    expect(
      isGroundedModelAnswer(
        "结论：MERIVOBOX 魅宝是金属抽屉系统。\n还需确认：柜体尺寸和面板重量是多少？",
        [merivoboxSource],
      ),
    ).toBe(true);
  });

  it("rejects verification guidance when no official source was retrieved", () => {
    expect(isGroundedModelAnswer("建议查阅官方资料确认。", [])).toBe(false);
  });

  it("rejects unsupported product assertions hidden inside verification guidance", () => {
    expect(
      isGroundedModelAnswer(
        "MERIVOBOX 适合户外使用，建议查阅官方目录确认。",
        [merivoboxSource],
      ),
    ).toBe(false);
  });

  it("accepts a natural explanation composed only from official BLUMOTION facts", () => {
    expect(
      isGroundedModelAnswer(
        "结论：BLUMOTION 是 Blum 自研的油压阻尼闭合技术，通过内置于产品内部的油压缓冲器实现轻柔、无冲击的关闭效果。",
        [blumotionSource],
      ),
    ).toBe(true);
  });

  it("accepts cautious guidance to consult the official catalogue", () => {
    expect(
      isGroundedModelAnswer(
        "结论：BLUMOTION 是 Blum 自研的油压阻尼技术，适用于铰链、抽屉和上翻门全系列。想了解具体参数可以查阅中文产品目录。",
        [blumotionSource],
      ),
    ).toBe(true);
  });

  it.each([
    "BLUMOTION 能避免夹手，尤其适合老人和儿童。",
    "BLUMOTION 可以保护家具并延长五金寿命。",
  ])("rejects plausible but unsupported experience claims: %s", (answer) => {
    expect(isGroundedModelAnswer(answer, [blumotionSource])).toBe(false);
  });

  it("keeps supported model sentences and removes unsupported embellishment", () => {
    const grounded = groundModelAnswer(
      "结论：BLUMOTION 是 Blum 自研的油压阻尼闭合技术。它还能避免夹手并延长家具寿命。",
      [blumotionSource],
    );

    expect(grounded).not.toBeUndefined();
    expect(grounded).not.toContain("避免夹手");
    expect(grounded).not.toContain("延长家具寿命");
  });

  it("keeps the one supported claim even when most draft claims are removed", () => {
    const grounded = groundModelAnswer(
      "BLUMOTION 是 Blum 自研的油压阻尼技术，可用于抽屉。它可以避免夹手。",
      [blumotionSource],
    );

    expect(grounded).not.toBeUndefined();
    expect(grounded).not.toContain("避免夹手");
  });

  it("rejects a claim whose professional term is absent from the official source", () => {
    expect(
      isGroundedModelAnswer(
        "MERIVOBOX 使用磁悬浮导轨，运行时无需机械支撑。",
        [merivoboxSource],
      ),
    ).toBe(false);
  });

  it("does not retain a dependent conclusion after its premise is ungrounded", () => {
    const grounded = groundModelAnswer(
      "MERIVOBOX 配有磁悬浮导轨。因此，它无需机械支撑。",
      [merivoboxSource],
    );

    expect(grounded).toBeUndefined();
  });
});
