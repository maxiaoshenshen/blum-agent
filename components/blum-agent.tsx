"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
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
  CircleUserRound,
  DraftingCompass,
  Factory,
  House,
  ImagePlus,
  LoaderCircle,
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
  mode?: "live" | "demo";
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

export function BlumAgent() {
  const [roleId, setRoleId] = useState<RoleId>("consumer");
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [messages, setMessages] = useState<TimelineMessage[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const selectedRole = useMemo(
    () => ROLES.find((role) => role.id === roleId)!,
    [roleId],
  );

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

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        setError("无法读取这张图片，请换一张重试。");
        return;
      }
      setAttachment({ dataUrl: reader.result, name: file.name });
      setError("");
    });
    reader.addEventListener("error", () => {
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

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: roleId,
          messages: apiMessages(nextMessages),
          image: attachment?.dataUrl,
        }),
      });
      const body = (await response.json()) as
        | ChatAnswer
        | { error?: { message?: string } };

      if (!response.ok || !("answer" in body)) {
        throw new Error(
          "error" in body && body.error?.message
            ? body.error.message
            : "暂时无法获得回答，请稍后重试。",
        );
      }

      setMessages((current) => [
        ...current,
        {
          id: createId(),
          role: "assistant",
          content: body.answer,
          confidence: body.confidence,
          followUps: body.followUps,
          mode: body.mode,
          sources: body.sources,
        },
      ]);
      setAttachment(null);
    } catch (caught) {
      setDraft(question);
      setError(
        caught instanceof Error
          ? caught.message
          : "暂时无法获得回答，请稍后重试。",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="agent-shell">
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
        <div className="system-status" aria-label="系统状态">
          <span className="status-dot" aria-hidden="true" />
          官方资料优先
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
          <div className="conversation-scroll" aria-live="polite">
            {messages.length === 0 ? (
              <div className="welcome">
                <div className="welcome-kicker">
                  <span>BLUM / KNOWLEDGE SYSTEM</span>
                  <span>角色：{selectedRole.label}</span>
                </div>
                <h1>
                  从一个问题开始，
                  <br />
                  把五金方案做到<span>有据可查。</span>
                </h1>
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
                      <p className="answer-text">{message.content}</p>
                      {message.mode === "demo" ? (
                        <p className="demo-note">
                          当前未连接模型服务，以上为官方资料导航回答。
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
                    正在检索 Blum 资料并组织答案…
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
                <ImagePlus aria-hidden="true" size={16} />
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
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
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
                <label className="attach-button">
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
            <p className="composer-note">
              型号、尺寸、承重、孔位与最终下单信息，请以当前市场官方资料复核。
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
