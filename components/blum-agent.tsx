"use client";

import Image from "next/image";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ROLES } from "@/src/domain/roles";
import type { ChatAnswer, SourceReference } from "@/src/agent/chat";
import type { ChatMessage } from "@/src/agent/schema";
import type { ConfidenceLevel, RoleId } from "@/src/domain/types";
import {
  AlertTriangle,
  ArrowUpRight,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  CircleUserRound,
  DraftingCompass,
  Factory,
  House,
  ImagePlus,
  LoaderCircle,
  RefreshCcw,
  Send,
  ShoppingCart,
  Sparkles,
  Wrench,
  X,
} from "./icons";

const roleIcons = {
  designer: DraftingCompass,
  sales: BriefcaseBusiness,
  installer: Wrench,
  production: Factory,
  procurement: ShoppingCart,
  consumer: House,
} as const;

const productGroups = [
  { code: "01", name: "上翻门", detail: "AVENTOS" },
  { code: "02", name: "铰链", detail: "CLIP top" },
  { code: "03", name: "抽屉", detail: "MERIVOBOX · LEGRABOX" },
  { code: "04", name: "导轨", detail: "MOVENTO · TANDEM" },
  { code: "05", name: "口袋门", detail: "REVEGO" },
  { code: "06", name: "动感开合", detail: "BLUMOTION · TIP-ON" },
] as const;

const confidenceLabels: Record<ConfidenceLevel, string> = {
  verified: "官方资料核实",
  guided: "官方资料引导",
  "needs-review": "下单 / 加工前复核",
};

interface Attachment {
  dataUrl: string;
  name: string;
}

interface TimelineMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  confidence?: ConfidenceLevel;
  followUps?: string[];
  mode?: "live" | "demo" | "guarded";
  sources?: SourceReference[];
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function apiMessages(messages: TimelineMessage[]): ChatMessage[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map(({ role, content }) => ({ role, content }))
    .slice(-11);
}


function HelpOverlay({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="help-overlay-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="help-overlay-panel" ref={panelRef} role="dialog" aria-label="使用帮助">
        <div className="help-overlay-header">
          <h2>使用帮助</h2>
          <button className="help-close-btn" onClick={onClose} type="button" aria-label="关闭帮助">
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        <div className="help-overlay-body">
          <section>
            <h3>键盘快捷键</h3>
            <div className="shortcut-list">
              <div className="shortcut-row"><kbd>Enter</kbd><span>发送问题</span></div>
              <div className="shortcut-row"><kbd>Shift+Enter</kbd><span>换行</span></div>
              <div className="shortcut-row"><kbd>Ctrl+Enter</kbd><span>发送（额外快捷方式）</span></div>
              <div className="shortcut-row"><kbd>Esc</kbd><span>清空输入框并聚焦</span></div>
              <div className="shortcut-row"><kbd>1</kbd><span>–</span><kbd>6</kbd><span>快速切换角色</span></div>
              <div className="shortcut-row"><kbd>?</kbd><span>打开帮助面板</span></div>
            </div>
          </section>
          <section>
            <h3>使用提示</h3>
            <div className="help-tip"><h4>角色切换</h4><p>选择不同角色，Blum Agent 会以对应视角回答问题。设计师关注尺寸与配合；销售关注卖点与对比；安装人员关注安装步骤与工具。</p></div>
            <div className="help-tip"><h4>上传图片辅助分析</h4><p>点击左下角的图片按钮上传现场照片，Blum Agent 会结合图片内容给出更准确的建议。支持 JPG、PNG、WebP，单张不超过 5 MB。</p></div>
            <div className="help-tip"><h4>精确选型模式</h4><p>当需要具体型号、承重参数、孔位规格时，Blum Agent 会主动进入安全复核模式（guarded），确保答案来自官方资料。下单前请以最新官方资料复核。</p></div>
          </section>
          <section>
            <h3>信息来源说明</h3>
            <div className="help-tip help-sources-note">
              <p>Blum Agent 基于 Blum 官方资料（产品目录、技术文档、安装指南等）回答问题。每个回答底部会列出参考的官方资料链接，供你直接查阅。</p>
              <p>当系统显示「下单 / 加工前复核」时，表示当前信息可能因产品批次、地区差异或标准更新而存在不确定性，请务必以官方最新资料确认后再行动。</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function BlumAgent() {
  const [roleId, setRoleId] = useState<RoleId>("consumer");
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [messages, setMessages] = useState<TimelineMessage[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);
  const streamingMessageIdRef = useRef<string | null>(null);
  const isStreamingRef = useRef(false);

  const selectedRole = useMemo(
    () => ROLES.find((role) => role.id === roleId)!,
    [roleId],
  );

  useEffect(() => {
    const container = conversationRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, isLoading, isStreamingRef.current]);

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInputFocused = target.tagName === "TEXTAREA" || target.tagName === "INPUT";

      if (e.key === "Escape") {
        if (showHelp) { setShowHelp(false); return; }
        if (draft || attachment) { setDraft(""); setAttachment(null); setError(""); inputRef.current?.focus(); }
        return;
      }
      if (e.key === "?" && !isInputFocused) { setShowHelp(true); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        if (!isLoading && draft.trim()) void submitQuestion();
        return;
      }
      if (!isInputFocused && !isLoading) {
        const keyNum = parseInt(e.key, 10);
        if (keyNum >= 1 && keyNum <= 6) {
          const role = ROLES[keyNum - 1];
          if (role) { setRoleId(role.id); setError(""); }
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [draft, attachment, isLoading, showHelp, roleId]);

  function chooseStarter(prompt: string) {
    setDraft(prompt);
    setError("");
    inputRef.current?.focus();
  }

  function handleAttachment(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setAttachment(null);
      setError("仅支持 JPG、PNG 或 WebP 图片。");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAttachment(null);
      setError("图片不能超过 5 MB。");
      return;
    }

    setIsUploading(true);
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        setIsUploading(false);
        setError("无法读取这张图片，请换一张重试。");
        return;
      }
      setIsUploading(false);
      setAttachment({ dataUrl: reader.result, name: file.name });
      setError("");
    });
    reader.addEventListener("error", () => {
      setIsUploading(false);
      setError("无法读取这张图片，请换一张重试。");
    });
    reader.readAsDataURL(file);
  }

  async function submitQuestion(event?: FormEvent) {
    event?.preventDefault();
    const question = draft.trim();
    if (!question || isLoading) return;

    const userMessage: TimelineMessage = {
      id: createId(),
      role: "user",
      content: question,
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setError("");
    setIsLoading(true);
    isStreamingRef.current = true;
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    const controller = new AbortController();
    activeRequestRef.current?.abort();
    activeRequestRef.current = controller;

    const streamingMsgId = createId();
    streamingMessageIdRef.current = streamingMsgId;
    const placeholderMessage: TimelineMessage = {
      id: streamingMsgId,
      role: "assistant",
      content: "",
    };
    setMessages((current) => [...current, placeholderMessage]);

    try {
      // Try SSE streaming first
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: roleId,
          messages: apiMessages(nextMessages),
          image: attachment?.dataUrl,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error("Stream unavailable");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const scrollToBottom = () => {
        const container = conversationRef.current;
        if (container) container.scrollTop = container.scrollHeight;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (requestVersion !== requestVersionRef.current) { reader.cancel(); return; }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (!trimmed || !trimmed.startsWith("event: ")) continue;
          const eventName = trimmed.slice(7).trim();
          const nextLine = lines[i + 1];
          if (!nextLine?.startsWith("data: ")) continue;
          i++;
          let data;
          try { data = JSON.parse(nextLine.slice(6).trim()); }
          catch { continue; }
          if (eventName === "start") {
            setMessages((current) =>
              current.map((m) => m.id === streamingMsgId ? { ...m, sources: data.sources as SourceReference[] } : m),
            );
          } else if (eventName === "chunk") {
            setMessages((current) =>
              current.map((m) => m.id === streamingMsgId ? { ...m, content: m.content + (data.text as string) } : m),
            );
            scrollToBottom();
          } else if (eventName === "done") {
            setMessages((current) =>
              current.map((m) => m.id === streamingMsgId ? {
                ...m,
                content: data.answer as string,
                confidence: data.confidence as ConfidenceLevel,
                followUps: data.followUps as string[],
                mode: "live" as const,
                sources: data.sources as SourceReference[],
              } : m),
            );
          } else if (eventName === "error") {
            throw new Error((data.message as string) ?? "Blum Agent 暂时无法处理这个问题，请稍后重试。");
          }
        }
      }

      if (requestVersion !== requestVersionRef.current) return;
      setAttachment(null);
      isStreamingRef.current = false;
    } catch (caught) {
      // Don't handle abort or stale requests
      if (requestVersion !== requestVersionRef.current || (caught instanceof DOMException && caught.name === "AbortError")) return;
      isStreamingRef.current = false;

      // Fall back to non-streaming JSON endpoint
      const fallbackResponse = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: roleId,
          messages: apiMessages(nextMessages),
          image: attachment?.dataUrl,
        }),
        signal: controller.signal,
      });

      const body = (await fallbackResponse.json()) as {
        answer?: string;
        error?: { message?: string };
        sources?: SourceReference[];
        confidence?: ConfidenceLevel;
        followUps?: string[];
        mode?: "live" | "demo" | "guarded";
      };

      if (!fallbackResponse.ok || !("answer" in body)) {
        setMessages((current) =>
          current.filter((m) => m.id !== userMessage.id && m.id !== streamingMsgId),
        );
        setDraft(question);
        setError(
          "error" in body && body.error?.message
            ? body.error.message
            : "暂时无法获得回答，请稍后重试。",
        );
        return;
      }

      setMessages((current) =>
        current.map((m) =>
          m.id === streamingMsgId
            ? {
                ...m,
                content: body.answer as string,
                confidence: (body.confidence ?? "guided") as ConfidenceLevel,
                followUps: (body.followUps ?? []) as string[],
                mode: (body.mode ?? "live") as "live" | "demo" | "guarded",
                sources: (body.sources ?? []) as SourceReference[],
              }
            : m,
        ),
      );
      setAttachment(null);
    } finally {
      if (requestVersion === requestVersionRef.current) {
        setIsLoading(false);
        activeRequestRef.current = null;
        streamingMessageIdRef.current = null;
      }
    }
  }
function startNewConversation() {
    requestVersionRef.current += 1;
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setMessages([]);
    setDraft("");
    setAttachment(null);
    setError("");
    setIsLoading(false);
    isStreamingRef.current = false;
    inputRef.current?.focus();
  }

  return (
    <main className="agent-shell">
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
      <h1 className="sr-only">Blum Agent 百隆五金智能工作台</h1>
      <header className="topbar">
        <a className="brand" href="#workspace" aria-label="Blum Agent 首页">
          <span className="brand-mark" aria-hidden="true">
            B
          </span>
          <span>
            <strong>Blum Agent</strong>
            <small>百隆五金智能工作台</small>
          </span>
        </a>
        <div className="topbar-actions">
          <button
            className="help-button"
            onClick={() => setShowHelp(true)}
            type="button"
            aria-label="帮助"
          >
            <CircleHelp aria-hidden="true" size={17} />
          </button>
          <button
            className="new-chat-button"
            onClick={startNewConversation}
            type="button"
          >
            <RefreshCcw aria-hidden="true" size={15} />
            开始新对话
          </button>
          <div className="system-status" aria-label="系统状态">
            <span className="status-dot" aria-hidden="true" />
            官方资料优先
          </div>
        </div>
      </header>

      <div className="workspace" id="workspace">
        <aside className="role-panel" aria-label="角色与产品导航">
          <section>
            <div className="section-label">
              <span>01</span>
              选择你的角色
            </div>
            <div className="role-list">
              {ROLES.map((role) => {
                const Icon = roleIcons[role.id];
                const selected = role.id === roleId;
                return (
                  <button
                    aria-pressed={selected}
                    className="role-button"
                    key={role.id}
                    onClick={() => {
                      setRoleId(role.id);
                      setError("");
                    }}
                    type="button"
                  >
                    <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                    <span>
                      <strong>{role.label}</strong>
                      <small>{role.eyebrow}</small>
                    </span>
                    <ChevronRight aria-hidden="true" size={16} />
                  </button>
                );
              })}
            </div>
          </section>

          <section className="product-index">
            <div className="section-label">
              <span>02</span>
              产品知识地图
            </div>
            <div className="product-list">
              {productGroups.map((product) => (
                <div className="product-row" key={product.code}>
                  <span>{product.code}</span>
                  <p>
                    <strong>{product.name}</strong>
                    <small>{product.detail}</small>
                  </p>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <section className="conversation-panel" aria-label="Blum Agent 对话">
          <div
            className="conversation-scroll"
            aria-live="polite"
            ref={conversationRef}
          >
            {messages.length === 0 ? (
              <div className="welcome">
                <div className="welcome-kicker">
                  <span>BLUM / KNOWLEDGE SYSTEM</span>
                  <span>角色：{selectedRole.label}</span>
                </div>
                <h2>
                  从一个问题开始，
                  <br />
                  把五金方案做到<span>有据可查。</span>
                </h2>
                <p>{selectedRole.description}</p>
                <div className="starter-grid">
                  {selectedRole.starterPrompts.map((prompt, index) => (
                    <button
                      aria-label={prompt}
                      key={prompt}
                      onClick={() => chooseStarter(prompt)}
                      type="button"
                    >
                      <span>0{index + 1}</span>
                      {prompt}
                      <ArrowUpRight aria-hidden="true" size={17} />
                    </button>
                  ))}
                </div>
                <div className="answer-contract">
                  <div>
                    <CheckCircle2 aria-hidden="true" size={18} />
                    <span>
                      <strong>官方来源</strong>
                      每个结论带资料入口
                    </span>
                  </div>
                  <div>
                    <AlertTriangle aria-hidden="true" size={18} />
                    <span>
                      <strong>风险分级</strong>
                      精确选型主动要求复核
                    </span>
                  </div>
                  <div>
                    <Sparkles aria-hidden="true" size={18} />
                    <span>
                      <strong>角色适配</strong>
                      用你的工作语言回答
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="timeline">
                {messages.map((message) =>
                  message.role === "user" ? (
                    <article className="message message-user" key={message.id}>
                      <div className="message-author">
                        <CircleUserRound aria-hidden="true" size={17} />
                        你的问题
                      </div>
                      <p>{message.content}</p>
                    </article>
                  ) : (
                    <article
                      className="message message-assistant"
                      key={message.id}
                    >
                      <div className="answer-heading">
                        <div className="message-author">
                          <span className="mini-mark" aria-hidden="true">
                            B
                          </span>
                          Blum Agent
                        </div>
                        {message.confidence ? (
                          <span
                            className={`confidence confidence-${message.confidence}`}
                          >
                            {confidenceLabels[message.confidence]}
                          </span>
                        ) : null}
                      </div>
                      <p className="answer-text">
                        {message.content}
                        {isStreamingRef.current && message.id === streamingMessageIdRef.current ? (
                          <span className="streaming-cursor" aria-hidden="true">_</span>
                        ) : null}
                      </p>
                      {message.mode === "demo" ? (
                        <p className="demo-note">
                          当前未连接模型服务，以上为官方资料导航回答。
                        </p>
                      ) : null}
                      {message.mode === "guarded" ? (
                        <p className="guarded-note">
                          已进入安全复核模式：只展示官方资料明确支持的内容，未展示无法验证的模型扩展。
                        </p>
                      ) : null}
                      {message.sources?.length ? (
                        <div className="source-section">
                          <h2>参考的官方资料</h2>
                          <div className="source-grid">
                            {message.sources.map((source) => (
                              <a
                                href={source.url}
                                key={source.id}
                                rel="noopener noreferrer"
                                target="_blank"
                              >
                                <span>OFFICIAL</span>
                                <strong>{source.title}</strong>
                                <small>{source.summary}</small>
                                <ArrowUpRight
                                  aria-hidden="true"
                                  size={16}
                                />
                              </a>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {message.followUps?.length ? (
                        <div className="follow-ups">
                          <h2>继续把问题说清楚</h2>
                          {message.followUps.map((followUp) => (
                            <button
                              key={followUp}
                              onClick={() => chooseStarter(followUp)}
                              type="button"
                            >
                              {followUp}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ),
                )}
                {isLoading ? (
                  <div className="thinking" role="status">
                    <LoaderCircle aria-hidden="true" size={17} />
                    <span className="thinking-text">正在检索 Blum 资料并组织答案</span>
                    <span className="thinking-dots" aria-hidden="true" />
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="composer-wrap">
            {error ? (
              <div className="error-banner" role="alert">
                <AlertTriangle aria-hidden="true" size={17} />
                {error}
              </div>
            ) : null}
            {attachment ? (
              <div className="attachment-chip">
                <Image
                  alt={`待发送图片：${attachment.name}`}
                  height={30}
                  src={attachment.dataUrl}
                  unoptimized
                  width={30}
                />
                <span>{attachment.name}</span>
                <button
                  aria-label={`移除图片 ${attachment.name}`}
                  onClick={() => setAttachment(null)}
                  type="button"
                >
                  <X aria-hidden="true" size={15} />
                </button>
              </div>
            ) : null}
            <form className="composer" onSubmit={submitQuestion}>
              <label className="sr-only" htmlFor="agent-question">
                向 Blum Agent 提问
              </label>
              <textarea
                disabled={isLoading}
                id="agent-question"
                maxLength={4000}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
                    event.preventDefault();
                    void submitQuestion();
                  }
                }}
                placeholder={`以${selectedRole.label}身份提问：产品、选型、安装、采购…`}
                ref={inputRef}
                rows={2}
                value={draft}
              />
              <div className="composer-actions">
                <label className={`attach-button${isUploading ? " uploading" : ""}`}>
                  <ImagePlus aria-hidden="true" size={18} />
                  <span>添加现场图片</span>
                  <input
                    accept="image/jpeg,image/png,image/webp"
                    aria-label="添加现场图片"
                    onChange={(event) => {
                      handleAttachment(event.target.files?.[0]);
                      event.currentTarget.value = "";
                    }}
                    type="file"
                  />
                </label>
                <button
                  className="send-button"
                  disabled={isLoading || !draft.trim()}
                  type="submit"
                >
                  <span>发送问题</span>
                  {isLoading ? (
                    <LoaderCircle aria-hidden="true" size={17} />
                  ) : (
                    <Send aria-hidden="true" size={17} />
                  )}
                </button>
              </div>
            </form>
            <div className="composer-meta">
              <span aria-live="polite" className="character-count">
                {draft.length} / 4000
              </span>
              <p className="composer-note">
                型号、尺寸、承重、孔位与最终下单信息，请以当前市场官方资料复核。
              </p>
              <span aria-hidden="true">Enter 发送 · Shift+Enter 换行</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
