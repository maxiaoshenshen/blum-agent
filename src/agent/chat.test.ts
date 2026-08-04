import { describe, expect, it, vi } from "vitest";
import type { ParsedChatRequest } from "./schema";
import { answerChat, providerConfigFromEnvironment } from "./chat";

const merivoboxRequest: ParsedChatRequest = {
  role: "designer",
  messages: [{ role: "user", content: "MERIVOBOX 是什么产品？" }],
};

const hingeRequest: ParsedChatRequest = {
  role: "sales",
  messages: [{ role: "user", content: "介绍 CLIP top BLUMOTION 的特点" }],
};

describe("Blum chat orchestration", () => {
  it("returns a grounded live answer with official sources", async () => {
    const requestCompletion = vi.fn(async () => "MERIVOBOX 是 Blum 金属抽屉系统 MERIVOBOX 系列。");

    const response = await answerChat(merivoboxRequest, {
      providerConfig: {
        apiKey: "test-secret",
        baseUrl: "https://provider.example",
        model: "claude-opus-5",
      },
      requestCompletion,
    });

    expect(response.mode).toMatch(/^(live|guarded)$/);
    expect(response.sources[0]).toMatchObject({
      id: "merivobox",
      official: true,
    });
    expect(requestCompletion).toHaveBeenCalledOnce();
  });

  it("falls back to a transparent demo answer without provider configuration", async () => {
    const response = await answerChat(merivoboxRequest, {});

    expect(response.mode).toBe("demo");
    expect(response.answer).toContain("演示模式");
    expect(response.answer).toContain("MERIVOBOX");
    expect(response.sources[0].id).toBe("merivobox");
  });

  it("replaces an ungrounded live draft with the official safe answer", async () => {
    const response = await answerChat(merivoboxRequest, {
      providerConfig: {
        apiKey: "test-secret",
        baseUrl: "https://provider.example",
        model: "claude-opus-5",
      },
      requestCompletion: vi.fn(
        async () => "MERIVOBOX 属于气压弹簧系统，可搭配 ADUBO。",
      ),
    });

    expect(response.mode).toBe("guarded");
    expect(response.answer).toContain("MERIVOBOX");
    expect(response.answer).not.toContain("气压弹簧");
    expect(response.answer).not.toContain("ADUBO");
  });

  it("returns a live answer after removing unsupported model sentences", async () => {
    const response = await answerChat(merivoboxRequest, {
      providerConfig: {
        apiKey: "test-secret",
        baseUrl: "https://provider.example",
        model: "claude-opus-5",
      },
      requestCompletion: vi.fn(
        async () =>
          "MERIVOBOX 是 Blum 中端金属抽屉系列。标准承重可达 100kg。",
      ),
    });

    expect(response.mode).toMatch(/^(live|guarded)$/);
    expect(response.answer).toContain("MERIVOBOX");
    expect(response.answer).toContain("已省略");
    expect(response.answer).not.toContain("自动识别餐具");
  });

  it("marks precise purchasing decisions for review", async () => {
    const requestCompletion = vi.fn(async () => "不应调用的自由生成回答。");
    const response = await answerChat(
      {
        role: "procurement",
        messages: [
          {
            role: "user",
            content: "请确认这个料号兼容并给我最终 BOM 下单。",
          },
        ],
      },
      {
        providerConfig: {
          apiKey: "test-secret",
          baseUrl: "https://provider.example",
          model: "claude-opus-5",
        },
        requestCompletion,
      },
    );

    expect(response.confidence).toBe("needs-review");
    expect(response.mode).toBe("guarded");
    expect(response.answer).toContain("当前不能安全确认");
    expect(response.followUps).toContain("补充完整产品编号与所在市场");
    expect(requestCompletion).not.toHaveBeenCalled();
  });

  it("gives role-specific next steps", async () => {
    const response = await answerChat(
      {
        role: "installer",
        messages: [{ role: "user", content: "铰链关门不齐怎么排查？" }],
      },
      {},
    );

    expect(response.followUps).toContain("提供产品型号和正面、侧面现场照片");
    expect(response.followUps).toContain("说明故障现象及已经尝试的调节步骤");
  });

  it("guards exact drilling-dimension questions without calling the provider", async () => {
    const requestCompletion = vi.fn(async () => "不应调用模型。");

    const response = await answerChat(
      {
        role: "production",
        messages: [{ role: "user", content: "请给我精确开孔尺寸和钻孔位置" }],
      },
      {
        providerConfig: {
          apiKey: "test-secret",
          baseUrl: "https://provider.example",
          model: "claude-opus-5",
        },
        requestCompletion,
      },
    );

    expect(response.mode).toBe("guarded");
    expect(response.confidence).toBe("needs-review");
    expect(response.answer).toContain("当前不能安全确认");
    expect(requestCompletion).not.toHaveBeenCalled();
  });

  it("keeps an out-of-scope question in transparent demo mode", async () => {
    const response = await answerChat(
      {
        role: "consumer",
        messages: [{ role: "user", content: "怎么做红烧肉？" }],
      },
      {},
    );

    expect(response.mode).toBe("demo");
    expect(response.answer).toContain("演示模式");
    expect(response.sources.every((source) => source.official)).toBe(true);
  });

  it("falls back when every model claim extends beyond official grounding", async () => {
    const response = await answerChat(merivoboxRequest, {
      providerConfig: {
        apiKey: "test-secret",
        baseUrl: "https://provider.example",
        model: "claude-opus-5",
      },
      requestCompletion: vi.fn(
        async () => "MERIVOBOX 可以自动烹饪，并配有 8K 激光投影。",
      ),
    });

    expect(response.mode).toBe("guarded");
    expect(response.answer).toContain("无法由当前官方摘要直接核实");
    expect(response.answer).not.toContain("8K 激光投影");
  });

  it("declines questions outside Blum's service scope without calling the provider", async () => {
    const requestCompletion = vi.fn(async () => "不应调用");
    const response = await answerChat(
      { role: "consumer", messages: [{ role: "user", content: "今天天气怎么样？" }] },
      { providerConfig: { apiKey: "test-secret", baseUrl: "https://provider.example", model: "claude-opus-5" }, requestCompletion },
    );

    expect(response.mode).toBe("guarded");
    expect(response.answer).toContain("不在 Blum Agent 的服务范围内");
    expect(requestCompletion).not.toHaveBeenCalled();
  });

  it("adds a Chinese-language hint for non-Chinese Blum questions", async () => {
    const response = await answerChat(
      { role: "consumer", messages: [{ role: "user", content: "What is MERIVOBOX?" }] },
      {},
    );

    expect(response.answer).toContain("建议用中文提问");
  });

  it("keeps prior turns in the system conversation brief for a product follow-up", async () => {
    const requestCompletion = vi.fn(async () => "CLIP top BLUMOTION 是 Blum 铰链系列。");
    await answerChat(
      {
        role: "designer",
        messages: [
          { role: "user", content: "我在厨房高柜使用 CLIP top BLUMOTION" },
          { role: "assistant", content: "请确认门板形式。" },
          { role: "user", content: "这个铰链适合什么门板？" },
        ],
      },
      { providerConfig: { apiKey: "test-secret", baseUrl: "https://provider.example", model: "claude-opus-5" }, requestCompletion },
    );

    expect(requestCompletion.mock.calls[0]?.[0].systemPrompt).toContain(
      "[用户] 我在厨房高柜使用 CLIP top BLUMOTION",
    );
  });

  it("instructs the model to disclose a missing direct knowledge match", async () => {
    const requestCompletion = vi.fn(async () => "这个问题超出了当前知识范围，但我可以尝试从通用角度回答。请提供产品标识。");
    await answerChat(
      { role: "consumer", messages: [{ role: "user", content: "Blum 的月球柜门应该怎样维护？" }] },
      { providerConfig: { apiKey: "test-secret", baseUrl: "https://provider.example", model: "claude-opus-5" }, requestCompletion },
    );

    expect(requestCompletion).toHaveBeenCalledOnce();
    expect(requestCompletion.mock.calls[0]?.[0].systemPrompt).toContain(
      "当前检索没有找到与问题直接匹配的官方资料",
    );
  });
});

describe("provider environment validation", () => {
  it("accepts HTTPS providers and localhost development endpoints", () => {
    expect(
      providerConfigFromEnvironment({
        PROVIDER_API_KEY: "secret",
        PROVIDER_BASE_URL: "https://provider.example/base/",
        PROVIDER_MODEL: "claude-opus-5",
      }),
    ).toEqual({
      apiKey: "secret",
      baseUrl: "https://provider.example/base",
      model: "claude-opus-5",
    });
    expect(
      providerConfigFromEnvironment({
        PROVIDER_API_KEY: "secret",
        PROVIDER_BASE_URL: "http://localhost:9999",
        PROVIDER_MODEL: "local-model",
      }),
    ).toBeDefined();
  });

  it("rejects insecure, credentialed or malformed provider URLs", () => {
    for (const baseUrl of [
      "http://provider.example",
      "https://user:pass@provider.example",
      "not-a-url",
      "ftp://provider.example",
    ]) {
      expect(
        providerConfigFromEnvironment({
          PROVIDER_API_KEY: "secret",
          PROVIDER_BASE_URL: baseUrl,
          PROVIDER_MODEL: "claude-opus-5",
        }),
      ).toBeUndefined();
    }
  });
});
