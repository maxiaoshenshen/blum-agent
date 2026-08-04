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
import type { SourceReference } from "@/src/agent/chat";
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

const REQUEST_TIMEOUT_MS = 60_000;
const RECONNECT_DELAY_MS = 3_000;
const TIMEOUT_MESSAGE = "这个问题比较复杂，模型正在深入分析，请稍后重试或简化问题";
const IMAGE_READ_ERROR_MESSAGE = "图片无法识别，请尝试重新上传或描述问题文字";
const IMAGE_TOO_SMALL_MESSAGE = "图片分辨率过低，请上传更清晰的现场照片。";
const CONVERSATION_STORAGE_KEY = "blum-agent-conversations-v1";
const MAX_SAVED_CONVERSATIONS = 5;
const MAX_VISIBLE_MESSAGES = 20;
const MAX_RESTORED_MESSAGES = 200;
const MAX_MESSAGE_LENGTH = 4_000;

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
  createdAt?: number;
}

interface StoredConversation {
  id: string;
  roleId: RoleId;
  messages: TimelineMessage[];
  updatedAt: number;
}

interface FeedbackState {
  rating: "helpful" | "inaccurate";
  comment: string;
  status: "editing" | "submitting" | "submitted" | "error";
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

function isSafeImageDataUrl(value: string): boolean {
  return (
    value.length <= 7_000_000 &&
    /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(value)
  );
}

async function validateImagePreview(dataUrl: string): Promise<void> {
  const preview = new window.Image();
  preview.src = dataUrl;

  // `decode` is available in supported production browsers. Older browsers
  // retain the server-side validation path instead of blocking uploads.
  if (typeof preview.decode !== "function") return;
  try {
    await preview.decode();
  } catch {
    throw new Error(IMAGE_READ_ERROR_MESSAGE);
  }
  if (preview.naturalWidth < 16 || preview.naturalHeight < 16) {
    throw new Error(IMAGE_TOO_SMALL_MESSAGE);
  }
}

function readStoredConversations(): StoredConversation[] {
  try {
    const raw = window.localStorage.getItem(CONVERSATION_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): StoredConversation[] => {
      if (!item || typeof item !== "object") return [];
      const id = Reflect.get(item, "id");
      const roleId = Reflect.get(item, "roleId");
      const messages = Reflect.get(item, "messages");
      const updatedAt = Reflect.get(item, "updatedAt");
      if (
        typeof id !== "string" ||
        !ROLES.some((role) => role.id === roleId) ||
        !Array.isArray(messages) ||
        !Number.isFinite(updatedAt)
      ) return [];
      const safeMessages = messages.flatMap((message): TimelineMessage[] => {
        if (!message || typeof message !== "object") return [];
        const messageId = Reflect.get(message, "id");
        const messageRole = Reflect.get(message, "role");
        const content = Reflect.get(message, "content");
        if (
          typeof messageId !== "string" ||
          (messageRole !== "user" && messageRole !== "assistant") ||
          typeof content !== "string" ||
          content.length > 20_000
        ) return [];
        return [{
          id: messageId,
          role: messageRole,
          content,
          ...(typeof Reflect.get(message, "createdAt") === "number" ? { createdAt: Reflect.get(message, "createdAt") as number } : {}),
        }];
      });
      if (!safeMessages.length) return [];
      return [{ id, roleId: roleId as RoleId, messages: safeMessages.slice(-MAX_RESTORED_MESSAGES), updatedAt: updatedAt as number }];
    }).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SAVED_CONVERSATIONS);
  } catch {
    return [];
  }
}

function writeStoredConversation(conversation: StoredConversation) {
  try {
    const otherConversations = readStoredConversations().filter((item) => item.id !== conversation.id);
    window.localStorage.setItem(
      CONVERSATION_STORAGE_KEY,
      JSON.stringify([conversation, ...otherConversations].slice(0, MAX_SAVED_CONVERSATIONS)),
    );
  } catch {
    // Storage can be disabled or full; the in-memory conversation remains usable.
  }
}


function HelpOverlay({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeButton = panelRef.current?.querySelector<HTMLButtonElement>("button");
    closeButton?.focus();

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function trapFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="help-overlay-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        aria-labelledby="help-dialog-title"
        aria-modal="true"
        className="help-overlay-panel"
        id="help-dialog"
        onKeyDown={trapFocus}
        ref={panelRef}
        role="dialog"
      >
        <div className="help-overlay-header">
          <h2 id="help-dialog-title">使用帮助</h2>
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
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [copiedSourceId, setCopiedSourceId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<"online" | "reconnecting">("online");
  const [feedbackByAnswerId, setFeedbackByAnswerId] = useState<Record<string, FeedbackState>>({});
  const [showOlderHistory, setShowOlderHistory] = useState(false);
  const [hasRestoredConversation, setHasRestoredConversation] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const helpTriggerRef = useRef<HTMLButtonElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);
  const streamingMessageIdRef = useRef<string | null>(null);
  const isStreamingRef = useRef(false);
  const conversationIdRef = useRef(createId());

  const selectedRole = useMemo(
    () => ROLES.find((role) => role.id === roleId)!,
    [roleId],
  );

  useEffect(() => {
    const container = conversationRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, isLoading]);

  useEffect(() => {
    // Defer restoration until after the initial render. This preserves hydration
    // consistency and avoids a synchronous state update from an effect body.
    const timer = window.setTimeout(() => {
      const latest = readStoredConversations()[0];
      if (latest) {
        conversationIdRef.current = latest.id;
        setRoleId(latest.roleId);
        setMessages(latest.messages);
      }
      setHasRestoredConversation(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hasRestoredConversation || messages.length === 0) return;
    writeStoredConversation({
      id: conversationIdRef.current,
      roleId,
      messages: messages.slice(-MAX_RESTORED_MESSAGES),
      updatedAt: Date.now(),
    });
  }, [hasRestoredConversation, messages, roleId]);

  useEffect(() => {
    const cancelActiveRequest = () => {
      requestVersionRef.current += 1;
      activeRequestRef.current?.abort();
      activeRequestRef.current = null;
      isStreamingRef.current = false;
    };

    window.addEventListener("beforeunload", cancelActiveRequest);
    return () => {
      window.removeEventListener("beforeunload", cancelActiveRequest);
      cancelActiveRequest();
    };
  }, []);

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
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key === "Backspace" &&
        isInputFocused
      ) {
        e.preventDefault();
        setDraft("");
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

  function formatMessageTime(timestamp?: number): string {
    if (!timestamp) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(timestamp);
  }

  async function copySourceLink(source: SourceReference) {
    try {
      await navigator.clipboard?.writeText(source.url);
    } catch {
      const field = document.createElement("textarea");
      field.value = source.url;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setCopiedSourceId(source.id);
    window.setTimeout(() => setCopiedSourceId(null), 1800);
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
        setError(IMAGE_READ_ERROR_MESSAGE);
        return;
      }
      if (!isSafeImageDataUrl(reader.result)) {
        setIsUploading(false);
        setAttachment(null);
        setError(IMAGE_READ_ERROR_MESSAGE);
        return;
      }
      void validateImagePreview(reader.result)
        .then(() => {
          setIsUploading(false);
          setAttachment({ dataUrl: reader.result as string, name: file.name });
          setError("");
        })
        .catch((reason: unknown) => {
          setIsUploading(false);
          setAttachment(null);
          setError(
            reason instanceof Error && reason.message === IMAGE_TOO_SMALL_MESSAGE
              ? IMAGE_TOO_SMALL_MESSAGE
              : IMAGE_READ_ERROR_MESSAGE,
          );
        });
    });
    reader.addEventListener("error", () => {
      setIsUploading(false);
      setError(IMAGE_READ_ERROR_MESSAGE);
    });
    reader.readAsDataURL(file);
  }

  async function submitQuestion(event?: FormEvent) {
    event?.preventDefault();
    const question = draft.trim();
    if (!question || isLoading || activeRequestRef.current) return;
    if (question.length > MAX_MESSAGE_LENGTH) {
      setError(`单条问题不能超过 ${MAX_MESSAGE_LENGTH} 个字符。`);
      return;
    }

    const userMessage: TimelineMessage = {
      id: createId(),
      role: "user",
      content: question,
      createdAt: Date.now(),
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setError("");
    setConnectionState("online");
    setIsLoading(true);
    isStreamingRef.current = true;
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    const controller = new AbortController();
    activeRequestRef.current = controller;

    const streamingMsgId = createId();
    streamingMessageIdRef.current = streamingMsgId;
    const placeholderMessage: TimelineMessage = {
      id: streamingMsgId,
      role: "assistant",
      content: "",
    };
    setMessages((current) => [...current, placeholderMessage]);

    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    const restoreQuestion = (message: string, reconnecting = false) => {
      if (requestVersion !== requestVersionRef.current) return;
      setMessages((current) =>
        current.filter((m) => m.id !== userMessage.id && m.id !== streamingMsgId),
      );
      setDraft(question);
      setError(message);
      setConnectionState(reconnecting ? "reconnecting" : "online");
    };

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch("/api/chat/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: roleId, messages: apiMessages(nextMessages), image: attachment?.dataUrl }),
            signal: controller.signal,
          });
          if (!response.ok || !response.body) throw new Error("Stream unavailable");

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let completed = false;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (requestVersion !== requestVersionRef.current) { await reader.cancel(); return; }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (let i = 0; i < lines.length; i += 1) {
              const trimmed = lines[i].trim();
              if (!trimmed || !trimmed.startsWith("event: ")) continue;
              const nextLine = lines[i + 1];
              if (!nextLine?.startsWith("data: ")) continue;
              i += 1;
              let data: Record<string, unknown>;
              try { data = JSON.parse(nextLine.slice(6).trim()) as Record<string, unknown>; } catch { continue; }
              const eventName = trimmed.slice(7).trim();
              if (requestVersion !== requestVersionRef.current) {
                await reader.cancel();
                return;
              }
              if (eventName === "start") {
                setMessages((current) => current.map((m) => m.id === streamingMsgId ? { ...m, sources: data.sources as SourceReference[] } : m));
              } else if (eventName === "chunk") {
                setMessages((current) => current.map((m) => m.id === streamingMsgId ? { ...m, content: m.content + String(data.text ?? "") } : m));
              } else if (eventName === "done") {
                completed = true;
                setMessages((current) => current.map((m) => m.id === streamingMsgId ? { ...m, content: String(data.answer ?? ""), confidence: data.confidence as ConfidenceLevel, followUps: data.followUps as string[], mode: "live", sources: data.sources as SourceReference[] } : m));
              } else if (eventName === "error") {
                throw new Error(String(data.message ?? "Blum Agent 暂时无法处理这个问题，请稍后重试。"));
              }
            }
          }
          if (!completed) throw new Error("Stream ended without completion event");
          if (requestVersion !== requestVersionRef.current) return;
          setAttachment(null);
          setConnectionState("online");
          return;
        } catch (streamError) {
          if (requestVersion !== requestVersionRef.current) return;
          if (timedOut) { restoreQuestion(TIMEOUT_MESSAGE); return; }
          if (streamError instanceof DOMException && streamError.name === "AbortError") return;

          try {
            const fallbackResponse = await fetch("/api/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ role: roleId, messages: apiMessages(nextMessages), image: attachment?.dataUrl }),
              signal: controller.signal,
            });
            const body = (await fallbackResponse.json()) as { answer?: string; error?: { message?: string }; sources?: SourceReference[]; confidence?: ConfidenceLevel; followUps?: string[]; mode?: "live" | "demo" | "guarded" };
            if (!fallbackResponse.ok || !("answer" in body)) {
              restoreQuestion(body.error?.message ?? "暂时无法获得回答，请稍后重试。", true);
              return;
            }
            if (requestVersion !== requestVersionRef.current) return;
            setMessages((current) => current.map((m) => m.id === streamingMsgId ? { ...m, content: body.answer as string, confidence: body.confidence ?? "guided", followUps: body.followUps ?? [], mode: body.mode ?? "live", sources: body.sources ?? [] } : m));
            setAttachment(null);
            setConnectionState("online");
            return;
          } catch (fallbackError) {
            if (requestVersion !== requestVersionRef.current) return;
            if (timedOut) { restoreQuestion(TIMEOUT_MESSAGE); return; }
            if (fallbackError instanceof DOMException && fallbackError.name === "AbortError") return;
            if (attempt === 0) {
              setConnectionState("reconnecting");
              await new Promise<void>((resolve) => window.setTimeout(resolve, RECONNECT_DELAY_MS));
              continue;
            }
            restoreQuestion("暂时无法连接服务，请检查网络后重试。", true);
            return;
          }
        }
      }
    } finally {
      window.clearTimeout(timeout);
      isStreamingRef.current = false;
      if (requestVersion === requestVersionRef.current) {
        setIsLoading(false);
        activeRequestRef.current = null;
        streamingMessageIdRef.current = null;
      }
    }
  }
  function startNewConversation() {
    if (messages.length > 0) {
      writeStoredConversation({
        id: conversationIdRef.current,
        roleId,
        messages: messages.slice(-MAX_RESTORED_MESSAGES),
        updatedAt: Date.now(),
      });
    }
    requestVersionRef.current += 1;
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setMessages([]);
    setDraft("");
    setAttachment(null);
    setError("");
    setConnectionState("online");
    setIsLoading(false);
    isStreamingRef.current = false;
    conversationIdRef.current = createId();
    setFeedbackByAnswerId({});
    setShowOlderHistory(false);
    setExportStatus("");
    inputRef.current?.focus();
  }

  function chooseFeedback(answerId: string, rating: FeedbackState["rating"]) {
    setFeedbackByAnswerId((current) => ({
      ...current,
      [answerId]: { rating, comment: current[answerId]?.comment ?? "", status: "editing" },
    }));
  }

  async function submitFeedback(answerId: string) {
    const feedback = feedbackByAnswerId[answerId];
    if (!feedback || feedback.status === "submitting") return;
    setFeedbackByAnswerId((current) => ({
      ...current,
      [answerId]: { ...feedback, status: "submitting" },
    }));
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answerId,
          rating: feedback.rating,
          ...(feedback.comment.trim() ? { comment: feedback.comment.trim() } : {}),
          timestamp: Date.now(),
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("feedback request failed");
      setFeedbackByAnswerId((current) => ({
        ...current,
        [answerId]: { ...feedback, status: "submitted" },
      }));
    } catch {
      setFeedbackByAnswerId((current) => ({
        ...current,
        [answerId]: { ...feedback, status: "error" },
      }));
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function exportConversation() {
    if (!messages.length) {
      setExportStatus("当前没有可导出的对话");
      return;
    }
    const exported = [
      "Blum Agent 对话导出",
      `角色：${selectedRole.label}`,
      "",
      ...messages.map((message) => `${message.role === "user" ? "用户" : "Blum Agent"}：${message.content}`),
    ].join("\n");
    try {
      await navigator.clipboard?.writeText(exported);
      setExportStatus("对话已复制到剪贴板");
    } catch {
      setExportStatus("复制失败，请检查浏览器剪贴板权限");
    }
  }

  function closeHelp() {
    setShowHelp(false);
    helpTriggerRef.current?.focus();
  }

  return (
    <main className="agent-shell" id="workspace">
      {showHelp && <HelpOverlay onClose={closeHelp} />}
      <p aria-live="polite" className="sr-only" role="status">
        {copiedSourceId ? "资料链接已复制到剪贴板" : ""}
      </p>
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
            aria-controls="help-dialog"
            aria-expanded={showHelp}
            aria-label="打开使用帮助"
            onClick={() => setShowHelp(true)}
            ref={helpTriggerRef}
            type="button"
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
          <button
            className="export-chat-button"
            disabled={messages.length === 0}
            onClick={() => void exportConversation()}
            type="button"
          >
            导出对话
          </button>
          <div className="system-status" aria-label={connectionState === "online" ? "系统在线" : "正在重新连接"}>
            <span className="status-dot" aria-hidden="true" />
            {connectionState === "online" ? "官方资料优先" : "正在重新连接"}
          </div>
        </div>
      </header>

      <div className="workspace">
        <aside className="role-panel" aria-label="角色与产品导航">
          <section>
            <div className="section-label">
              <span>01</span>
              选择你的角色
            </div>
            <div aria-label="选择你的角色" className="role-list" role="group">
              {ROLES.map((role) => {
                const Icon = roleIcons[role.id];
                const selected = role.id === roleId;
                return (
                  <button
                    aria-label={`切换至${role.label}角色`}
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
            aria-busy={isLoading}
            className="conversation-scroll"
            aria-live="polite"
            aria-label="与 Blum Agent 的对话记录"
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
                <button
                  className="quick-question"
                  onClick={() => inputRef.current?.focus()}
                  type="button"
                >
                  <Sparkles aria-hidden="true" size={16} />
                  <span>随便问问</span>
                  <small>把现场情况、型号或需求告诉我</small>
                </button>
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
                {messages.length > MAX_VISIBLE_MESSAGES ? (
                  <button
                    aria-expanded={showOlderHistory}
                    className="history-toggle"
                    onClick={() => setShowOlderHistory((current) => !current)}
                    type="button"
                  >
                    {showOlderHistory
                      ? "收起早期历史"
                      : `查看更多历史（${messages.length - MAX_VISIBLE_MESSAGES} 条）`}
                  </button>
                ) : null}
                {(showOlderHistory ? messages : messages.slice(-MAX_VISIBLE_MESSAGES)).map((message) =>
                  message.role === "user" ? (
                    <article className="message message-user" key={message.id}>
                      <div className="message-author">
                        <CircleUserRound aria-hidden="true" size={17} />
                        你的问题
                        <time dateTime={new Date(message.createdAt ?? Date.now()).toISOString()}>
                          {formatMessageTime(message.createdAt)}
                        </time>
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
                      <p className="answer-text" id={`answer-content-${message.id}`}>
                        {message.content.length > 500 && !expandedMessageIds.has(message.id)
                          ? `${message.content.slice(0, 500)}…`
                          : message.content}
                        {isStreamingRef.current && message.id === streamingMessageIdRef.current ? (
                          <span className="streaming-cursor" aria-hidden="true">_</span>
                        ) : null}
                      </p>
                      {message.content.length > 500 ? (
                        <button
                          aria-controls={`answer-content-${message.id}`}
                          aria-expanded={expandedMessageIds.has(message.id)}
                          className="answer-toggle"
                          onClick={() => setExpandedMessageIds((current) => {
                            const next = new Set(current);
                            if (next.has(message.id)) next.delete(message.id);
                            else next.add(message.id);
                            return next;
                          })}
                          type="button"
                        >
                          {expandedMessageIds.has(message.id) ? "收起回答" : "展开完整回答"}
                        </button>
                      ) : null}
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
                      {message.content ? (() => {
                        const feedback = feedbackByAnswerId[message.id];
                        return (
                          <div className="answer-feedback" aria-label="回答反馈">
                            {feedback?.status === "submitted" ? (
                              <p role="status">感谢反馈，我们会持续改进</p>
                            ) : (
                              <>
                                <span>这条回答有帮助吗？</span>
                                <div className="feedback-actions">
                                  <button
                                    aria-pressed={feedback?.rating === "helpful"}
                                    onClick={() => chooseFeedback(message.id, "helpful")}
                                    type="button"
                                  >
                                    👍 有帮助
                                  </button>
                                  <button
                                    aria-pressed={feedback?.rating === "inaccurate"}
                                    onClick={() => chooseFeedback(message.id, "inaccurate")}
                                    type="button"
                                  >
                                    👎 不准确
                                  </button>
                                </div>
                                {feedback ? (
                                  <div className="feedback-form">
                                    <label htmlFor={`feedback-comment-${message.id}`}>哪里不准确？</label>
                                    <textarea
                                      id={`feedback-comment-${message.id}`}
                                      maxLength={1000}
                                      onChange={(event) => setFeedbackByAnswerId((current) => ({
                                        ...current,
                                        [message.id]: { ...feedback, comment: event.target.value, status: "editing" },
                                      }))}
                                      placeholder="可选填写，帮助我们持续改进"
                                      value={feedback.comment}
                                    />
                                    <button
                                      disabled={feedback.status === "submitting"}
                                      onClick={() => void submitFeedback(message.id)}
                                      type="button"
                                    >
                                      {feedback.status === "submitting" ? "正在提交…" : "提交反馈"}
                                    </button>
                                    {feedback.status === "error" ? <p className="feedback-error" role="alert">反馈暂未提交，请稍后重试</p> : null}
                                  </div>
                                ) : null}
                              </>
                            )}
                          </div>
                        );
                      })() : null}
                      {message.sources?.length ? (
                        <div className="source-section">
                          <h2>参考的官方资料</h2>
                          <div className="source-grid">
                            {message.sources.map((source) => (
                              <div className="source-card" key={source.id}>
                                <a href={source.url} rel="noopener noreferrer" target="_blank">
                                <span>OFFICIAL</span>
                                <strong>{source.title}</strong>
                                <small>{source.summary}</small>
                                <ArrowUpRight
                                  aria-hidden="true"
                                  size={16}
                                />
                              </a>
                                <button
                                  aria-label={`复制 ${source.title} 链接`}
                                  className="copy-source-button"
                                  onClick={() => void copySourceLink(source)}
                                  type="button"
                                >
                                  {copiedSourceId === source.id ? "已复制" : "复制链接"}
                                </button>
                              </div>
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
                  <div aria-live="polite" className="thinking" role="status">
                    <LoaderCircle aria-hidden="true" size={17} />
                    <span className="thinking-text">
                      {connectionState === "reconnecting"
                        ? "正在重新连接..."
                        : "正在检索 Blum 资料并组织答案"}
                    </span>
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
                <span>{error}</span>
                <button
                  className="retry-button"
                  onClick={() => {
                    if (!draft.trim() || isLoading) return;
                    setConnectionState("reconnecting");
                    void submitQuestion();
                  }}
                  type="button"
                >
                  <RefreshCcw aria-hidden="true" size={14} />
                  重试
                </button>
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
                maxLength={MAX_MESSAGE_LENGTH}
                onChange={(event) => {
                  const nextDraft = event.target.value;
                  if (nextDraft.length > MAX_MESSAGE_LENGTH) {
                    setError(`单条问题不能超过 ${MAX_MESSAGE_LENGTH} 个字符。`);
                    return;
                  }
                  setDraft(nextDraft);
                  if (error) setError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
                    event.preventDefault();
                    if (draft.trim()) void submitQuestion();
                  }
                }}
                placeholder={`以${selectedRole.label}身份提问：产品、选型、安装、采购…`}
                ref={inputRef}
                rows={2}
                value={draft}
              />
              <div className="composer-actions">
                <label
                  className={`attach-button${isUploading ? " uploading" : ""}`}
                >
                  <ImagePlus aria-hidden="true" size={18} />
                  <span>添加现场图片</span>
                  <input
                    accept="image/jpeg,image/png,image/webp"
                    disabled={isUploading || isLoading}
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
                  aria-label={isLoading ? "正在发送问题" : "发送问题"}
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
              <span aria-live="polite" className="export-status">{exportStatus}</span>
              <span aria-live="polite" className="character-count">
                {draft.length} / {MAX_MESSAGE_LENGTH}
              </span>
              <p className="composer-note">
                型号、尺寸、承重、孔位与最终下单信息，请以当前市场官方资料复核。
              </p>
              <span aria-hidden="true">Enter 发送 · Ctrl+Backspace 清空</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
