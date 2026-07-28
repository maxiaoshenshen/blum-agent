import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlumAgent } from "./blum-agent";

const liveResponse = {
  answer: "先检查抽屉是否完全挂入导轨，再观察左右间隙。",
  confidence: "guided",
  followUps: ["提供现有产品型号或现场照片"],
  mode: "live",
  sources: [
    {
      id: "easy-assembly",
      title: "Blum EASY ASSEMBLY",
      url: "https://www.blum.com/us/en/services/e-services/easyassemblyapp/",
      summary: "官方安装与调节资料。",
      official: true,
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Blum Agent workspace", () => {
  it("switches roles and loads a role-specific starter question", async () => {
    const user = userEvent.setup();
    render(<BlumAgent />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Blum Agent 百隆五金智能工作台",
      }),
    ).toBeInTheDocument();
    const installer = screen.getByRole("button", { name: /安装工/ });
    await user.click(installer);

    expect(installer).toHaveAttribute("aria-pressed", "true");
    await user.click(
      screen.getByRole("button", { name: "抽屉运行不顺时如何分步排查？" }),
    );
    expect(screen.getByLabelText("向 Blum Agent 提问")).toHaveValue(
      "抽屉运行不顺时如何分步排查？",
    );
  });

  it("submits a question and renders grounded answer metadata", async () => {
    const fetchMock = vi.fn(async () => Response.json(liveResponse));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<BlumAgent />);

    await user.type(
      screen.getByLabelText("向 Blum Agent 提问"),
      "抽屉关闭时有摩擦声怎么办？",
    );
    await user.click(screen.getByRole("button", { name: "发送问题" }));

    expect(
      await screen.findByText("先检查抽屉是否完全挂入导轨，再观察左右间隙。"),
    ).toBeInTheDocument();
    expect(screen.getByText("官方资料引导")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Blum EASY ASSEMBLY/ }),
    ).toHaveAttribute(
      "href",
      "https://www.blum.com/us/en/services/e-services/easyassemblyapp/",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("validates attachments and allows a supported image to be removed", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<BlumAgent />);
    const input = screen.getByLabelText("添加现场图片");

    await user.upload(
      input,
      new File(["manual"], "manual.pdf", { type: "application/pdf" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "仅支持 JPG、PNG 或 WebP",
    );

    await user.upload(
      input,
      new File(["image"], "hinge.png", { type: "image/png" }),
    );
    expect(
      await screen.findByRole("img", { name: "待发送图片：hinge.png" }),
    ).toBeInTheDocument();
    const remove = await screen.findByRole("button", {
      name: "移除图片 hinge.png",
    });
    await user.click(remove);
    expect(
      screen.queryByRole("button", { name: "移除图片 hinge.png" }),
    ).not.toBeInTheDocument();
  });

  it("shows a recoverable API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "upstream_error", message: "模型服务暂时不可用。" } },
          { status: 502 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<BlumAgent />);

    await user.type(screen.getByLabelText("向 Blum Agent 提问"), "测试问题");
    await user.click(screen.getByRole("button", { name: "发送问题" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "模型服务暂时不可用。",
      );
    });
    expect(screen.getByRole("button", { name: "发送问题" })).toBeEnabled();
  });

  it("retries a failed question without duplicating the user turn", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: "upstream_error", message: "模型服务暂时不可用。" } },
          { status: 502 },
        ),
      )
      .mockResolvedValueOnce(Response.json(liveResponse));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<BlumAgent />);

    await user.type(screen.getByLabelText("向 Blum Agent 提问"), "重试这个问题");
    await user.click(screen.getByRole("button", { name: "发送问题" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "发送问题" }));
    expect(await screen.findByText(liveResponse.answer)).toBeInTheDocument();

    const secondBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as { messages: Array<{ role: string; content: string }> };
    expect(secondBody.messages).toEqual([
      { role: "user", content: "重试这个问题" },
    ]);
  });

  it("starts a clean conversation after an answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(liveResponse)));
    const user = userEvent.setup();
    render(<BlumAgent />);

    await user.type(screen.getByLabelText("向 Blum Agent 提问"), "什么是百隆？");
    await user.click(screen.getByRole("button", { name: "发送问题" }));
    expect(await screen.findByText(liveResponse.answer)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "开始新对话" }));

    expect(screen.queryByText(liveResponse.answer)).not.toBeInTheDocument();
    expect(screen.getByText(/从一个问题开始/)).toBeInTheDocument();
    expect(screen.getByLabelText("向 Blum Agent 提问")).toHaveFocus();
  });

  it("submits with Enter, preserves Shift+Enter and exposes the input limit", async () => {
    const fetchMock = vi.fn(async () => Response.json(liveResponse));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<BlumAgent />);
    const input = screen.getByLabelText("向 Blum Agent 提问");

    expect(input).toHaveAttribute("maxlength", "4000");
    await user.type(input, "第一行{shift>}{enter}{/shift}第二行");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(input).toHaveValue("第一行\n第二行");
    expect(screen.getByText("7 / 4000")).toBeInTheDocument();

    await user.keyboard("{Enter}");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  });

  it("explains when a precise question uses the guarded review path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ...liveResponse,
          mode: "guarded",
          confidence: "needs-review",
        }),
      ),
    );
    const user = userEvent.setup();
    render(<BlumAgent />);

    await user.type(
      screen.getByLabelText("向 Blum Agent 提问"),
      "给我精确开孔尺寸",
    );
    await user.click(screen.getByRole("button", { name: "发送问题" }));

    expect(
      await screen.findByText(/已进入安全复核模式/),
    ).toBeInTheDocument();
  });
});
