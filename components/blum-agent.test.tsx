import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function makeFetchMock(fallbackBehavior: "success" | "error") {
  return vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/chat/stream")) {
      return Promise.reject(
        new TypeError("Response body is null"),
      );
    }
    if (fallbackBehavior === "success") {
      return Promise.resolve(Response.json(liveResponse));
    }
    return Promise.resolve(
      Response.json(
        { error: { code: "upstream_error", message: "模型服务暂时不可用。" } },
        { status: 502 },
      ),
    );
  });
}

function makeGuardedFetchMock() {
  return vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/chat/stream")) {
      return Promise.reject(new TypeError("Response body is null"));
    }
    return Promise.resolve(
      Response.json({ ...liveResponse, mode: "guarded", confidence: "needs-review" }),
    );
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("Blum Agent workspace", () => {
  it("provides descriptive labels and relationships for interactive controls", () => {
    render(<BlumAgent />);

    expect(screen.getByRole("button", { name: "切换至设计师角色" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "发送问题" })).toHaveAttribute(
      "aria-label",
      "发送问题",
    );
    expect(screen.getByRole("button", { name: "打开使用帮助" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("traps focus in the help dialog and returns focus to its trigger", async () => {
    const user = userEvent.setup();
    render(<BlumAgent />);
    const trigger = screen.getByRole("button", { name: "打开使用帮助" });

    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "使用帮助" });
    const closeButton = screen.getByRole("button", { name: "关闭帮助" });

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(closeButton).toHaveFocus();
    await user.tab();
    expect(closeButton).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

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
    const fetchMock = makeFetchMock("success");
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
    ).toBeInTheDocument();
  });

  it("collects answer feedback and confirms a successful submission", async () => {
    const fetchMock = makeFetchMock("success");
    fetchMock.mockImplementation((input: string | URL | Request) => {
      if (String(input).includes("/api/feedback")) return Promise.resolve(Response.json({ success: true }));
      return makeFetchMock("success")(input);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<BlumAgent />);

    await user.type(screen.getByLabelText("向 Blum Agent 提问"), "抽屉怎么调？");
    await user.click(screen.getByRole("button", { name: "发送问题" }));
    await screen.findByText(liveResponse.answer);
    await user.click(screen.getByRole("button", { name: "👍 有帮助" }));
    await user.type(screen.getByLabelText("哪里不准确？"), "说明很实用");
    await user.click(screen.getByRole("button", { name: "提交反馈" }));

    expect(await screen.findByText("感谢反馈，我们会持续改进")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/feedback"))).toBe(true);
  });

  it("restores the newest saved conversation and exports it as text", async () => {
    localStorage.setItem("blum-agent-conversations-v1", JSON.stringify([{
      id: "saved-conversation",
      roleId: "consumer",
      updatedAt: Date.now(),
      messages: [{ id: "assistant-1", role: "assistant", content: "已恢复的回答", createdAt: Date.now() }],
    }]));
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const user = userEvent.setup();
    render(<BlumAgent />);

    expect(await screen.findByText("已恢复的回答")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "导出对话" }));
    expect(copy).toHaveBeenCalledWith(expect.stringContaining("Blum Agent 对话导出"));
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
    vi.stubGlobal("fetch", makeFetchMock("error"));
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
    let fallbackCalls = 0;
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      // Keep the request init in the mock signature so assertions can inspect
      // the fallback request payload below.
      void init;
      const url = String(input);
      if (url.includes("/chat/stream")) {
        return Promise.reject(new TypeError("Response body is null"));
      }
      fallbackCalls++;
      if (fallbackCalls === 1) {
        return Promise.resolve(
          Response.json(
            { error: { code: "upstream_error", message: "模型服务暂时不可用。" } },
            { status: 502 },
          ),
        );
      }
      return Promise.resolve(Response.json(liveResponse));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<BlumAgent />);

    await user.type(screen.getByLabelText("向 Blum Agent 提问"), "重试这个问题");
    await user.click(screen.getByRole("button", { name: "发送问题" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "发送问题" }));
    expect(await screen.findByText(liveResponse.answer)).toBeInTheDocument();

    const lastFallback = fetchMock.mock.calls
      .filter((c) => String(c[0]).includes("/api/chat"))
      .at(-1);
    const body = JSON.parse(String(lastFallback?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages).toEqual([
      { role: "user", content: "重试这个问题" },
    ]);
  });

  it("starts a clean conversation after an answer", async () => {
    vi.stubGlobal("fetch", makeFetchMock("success"));
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

  it("validates input maxLength attribute", () => {
    render(<BlumAgent />);
    expect(screen.getByLabelText("向 Blum Agent 提问")).toHaveAttribute(
      "maxlength",
      "4000",
    );
  });

  it("does not submit an empty message", async () => {
    const fetchMock = makeFetchMock("success");
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<BlumAgent />);

    await user.click(screen.getByRole("button", { name: "发送问题" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not submit a whitespace-only message", async () => {
    const fetchMock = makeFetchMock("success");
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<BlumAgent />);

    await user.type(screen.getByLabelText("向 Blum Agent 提问"), "   \n  ");
    await user.keyboard("{Enter}");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a friendly error instead of submitting a message over 4000 characters", () => {
    const fetchMock = makeFetchMock("success");
    vi.stubGlobal("fetch", fetchMock);
    render(<BlumAgent />);

    fireEvent.change(screen.getByLabelText("向 Blum Agent 提问"), {
      target: { value: "问".repeat(4_001) },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("单条问题不能超过 4000 个字符");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores rapid repeat submissions while the latest request is in progress", async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      if (String(input).includes("/chat/stream")) {
        return Promise.reject(new TypeError("Response body is null"));
      }
      return Promise.resolve(Response.json(liveResponse));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<BlumAgent />);

    await user.type(screen.getByLabelText("向 Blum Agent 提问"), "连续发送的问题");
    await user.dblClick(screen.getByRole("button", { name: "发送问题" }));

    expect(await screen.findByText(liveResponse.answer)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/chat/stream"))).toHaveLength(1);
    expect(screen.getAllByText("连续发送的问题")).toHaveLength(1);
  });

  it("renders newlines from pasted or set content", async () => {
    render(<BlumAgent />);
    const input = screen.getByLabelText("向 Blum Agent 提问");
    fireEvent.change(input, { target: { value: "第一行\n第二行" } });
    expect(input).toHaveValue("第一行\n第二行");
    expect(screen.getByText("7 / 4000")).toBeInTheDocument();
  });

  it("explains when a precise question uses the guarded review path", async () => {
    vi.stubGlobal("fetch", makeGuardedFetchMock());
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
