import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const ONE_PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL6XQAAAABJRU5ErkJggg==";

function payload(question: string, image?: string) {
  return {
    role: "consumer",
    messages: [{ role: "user", content: question }],
    ...(image ? { image } : {}),
  };
}

async function measureRequest(body: ReturnType<typeof payload>): Promise<number> {
  const startedAt = performance.now();
  const response = await POST(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: JSON.stringify(body),
  }));
  expect(response.status).toBe(200);
  await response.json();
  return performance.now() - startedAt;
}

describe("POST /api/chat local performance budget", () => {
  beforeEach(() => {
    // 只测量本应用的解析、检索和响应开销；实时模型时延由上游 Provider 独立监控。
    vi.stubEnv("PROVIDER_BASE_URL", "");
    vi.stubEnv("PROVIDER_API_KEY", "");
    vi.stubEnv("PROVIDER_MODEL", "");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns a short question in under 2 seconds", async () => {
    expect(await measureRequest(payload("BLUMOTION 是什么？"))).toBeLessThan(2_000);
  });

  it("returns a medium question in under 5 seconds", async () => {
    const question = "我正在设计厨房高柜，想使用百隆上翻门五金。请说明选型时需要准备的门板、柜体和开启空间信息，以及应如何复核官方资料。";
    expect(question.length).toBeGreaterThanOrEqual(50);
    expect(question.length).toBeLessThanOrEqual(200);
    expect(await measureRequest(payload(question))).toBeLessThan(5_000);
  });

  it("returns a complex question in under 10 seconds", async () => {
    const question = "我正在为一套总高 2300mm、门板厚度 22mm、门重约 18kg 的高柜设计上翻门方案，需要同时考虑柜体与门板参数、开启空间、动感功能、五金产品号确认、CAD/BXF 加工资料、首件验证、BOM 复核、市场可供性、安装调节、现场验收、长期维护和安全边界。项目还需要与销售报价、采购批次、生产设备、现场工人协作和消费者使用预期保持一致，并在出现版本变化时能够追溯决策依据。请整理可执行的信息清单，并标注哪些项目必须通过当前官方配置器或技术图复核。";
    expect(question.length).toBeGreaterThan(200);
    expect(await measureRequest(payload(question))).toBeLessThan(10_000);
  });

  it("validates and accepts an image request in under 3 seconds", async () => {
    expect(await measureRequest(payload("请协助判断这张五金现场图片。", ONE_PIXEL_PNG))).toBeLessThan(3_000);
  });
});
