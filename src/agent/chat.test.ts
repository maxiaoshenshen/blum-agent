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
