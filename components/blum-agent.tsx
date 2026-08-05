"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type ReactNode,
  type CSSProperties,
  type FormEvent,
} from "react";
import { ROLES } from "@/src/domain/roles";
import { preloadKnowledge } from "@/src/domain/knowledge-service";
import type { SourceReference } from "@/src/agent/chat";
import { streamChat } from "@/src/agent/client-stream";
import type { ChatMessage } from "@/src/agent/schema";
import type { ConfidenceLevel, RoleId } from "@/src/domain/types";
import {
  detectLocaleFromText,
  formatMessage,
  getMessages,
  type AppLocale,
} from "@/src/i18n/messages";
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
  MoreHorizontal,
  ShoppingCart,
  Sparkles,
  Wrench,
  X,
} from "./icons";
import { ErrorBoundary } from "./error-boundary";

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

const englishRoleLabels: Record<RoleId, string> = {
  designer: "Designer",
  sales: "Sales",
  installer: "Installer",
  production: "Production",
  procurement: "Procurement",
  consumer: "Homeowner",
};

const REQUEST_TIMEOUT_MS = 60_000;
const RECONNECT_DELAY_MS = 3_000;
const IMAGE_READ_ERROR_MESSAGE = "无法读取这张图片，请尝试重新上传或换个格式";
const IMAGE_TOO_SMALL_MESSAGE = "图片分辨率过低，请上传更清晰的现场照片。";
const CONVERSATION_STORAGE_KEY = "blum-agent-conversations-v1";
const MAX_SAVED_CONVERSATIONS = 5;
const MAX_VISIBLE_MESSAGES = 20;
const MAX_RESTORED_MESSAGES = 200;
const MAX_MESSAGE_LENGTH = 4_000;
const REQUEST_STAGE_DELAYS = [1_200, 2_800] as const;
const LONG_WAIT_DELAY_MS = 10_000;

type RequestStage = "retrieving" | "analyzing" | "composing";

const LONG_DRAFT_CONFIRMATION_LENGTH = 80;

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

interface LongPressMenuState {
  messageId: string;
  x: number;
  y: number;
}

class RequestError extends Error {
  constructor(
    readonly code?: string,
    readonly status?: number,
    readonly safeMessage?: string,
  ) {
    super(safeMessage ?? code);
  }
}

function messageForRequestError(error: unknown, copy: ReturnType<typeof getMessages>): string {
  if (error instanceof RequestError) {
    if (error.status === 429 || error.code === "rate_limited") return copy.rateLimitedError;
    if (error.status === 504 || error.code === "timeout") return copy.timeoutError;
    if (error.status === 503 || error.code === "no_config" || error.code === "service_unavailable" || error.code === "upstream_error") return copy.serviceUnavailableError;
    if (error.status && error.status >= 400 && error.status < 500 && error.safeMessage) return error.safeMessage;
  }
  if (error instanceof TypeError || (error instanceof Error && /network|fetch failed|failed to fetch/i.test(error.message))) {
    return copy.networkError;
  }
  return "暂时无法获得回答，请稍后重试。";
}

async function readApiError(response: Response): Promise<RequestError> {
  const raw = await response.text();
  let code: string | undefined;
  let safeMessage: string | undefined;
  try {
    const payload: unknown = JSON.parse(raw);
    if (isRecord(payload) && isRecord(payload.error)) {
      if (typeof payload.error.code === "string") code = payload.error.code;
      if (typeof payload.error.message === "string") safeMessage = payload.error.message;
    }
  } catch {
    const match = raw.match(/data:\s*(\{[^\n]+\})/);
    if (match) {
      try {
        const payload: unknown = JSON.parse(match[1]);
        if (isRecord(payload)) {
          if (typeof payload.code === "string") code = payload.code;
          if (typeof payload.message === "string") safeMessage = payload.message;
        }
      } catch {
        // A malformed response is handled as an unavailable request below.
      }
    }
  }
  return new RequestError(code, response.status, safeMessage);
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asSourceReferences(value: unknown): SourceReference[] {
  if (!Array.isArray(value)) return [];
  return value.filter((source): source is SourceReference =>
    isRecord(source) &&
    typeof source.id === "string" &&
    typeof source.title === "string" &&
    typeof source.url === "string" &&
    typeof source.summary === "string" &&
    typeof source.official === "boolean",
  );
}

function asFollowUps(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asConfidence(value: unknown): ConfidenceLevel {
  return value === "verified" || value === "needs-review" || value === "guided" ? value : "guided";
}

function asMode(value: unknown): NonNullable<TimelineMessage["mode"]> {
  return value === "demo" || value === "guarded" || value === "live" ? value : "live";
}

function RegionBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary fallback={<div className="section-error" role="alert">此区域暂时无法显示，请刷新页面重试。</div>}>{children}</ErrorBoundary>;
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
  const closeTimerRef = useRef<number | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const requestClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, 200);
  }, [isClosing, onClose]);

  useEffect(() => {
    const closeButton = panelRef.current?.querySelector<HTMLButtonElement>("button");
    closeButton?.focus();

    function handleKey(e: KeyboardEvent) {
      // Escape is intentionally immediate: keyboard users expect the dialog
      // to be gone (and focus restored) as soon as the key is released.
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, [requestClose]);

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
    <div className={`help-overlay-backdrop${isClosing ? " is-closing" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
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
          <button className="help-close-btn" onClick={requestClose} type="button" aria-label="关闭帮助">
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


function OnboardingModal({ onDismiss }: { onDismiss: () => void }) {
  const [isClosing, setIsClosing] = useState(false);
  const dismiss = () => {
    setIsClosing(true);
    window.setTimeout(onDismiss, 280);
  };

  return (
    <div
      aria-modal="true"
      className={`onboarding-backdrop${isClosing ? " is-closing" : ""}`}
      role="dialog"
    >
      <div className="onboarding-panel">
        <div className="onboarding-hero">🤖</div>
        <h2 className="onboarding-title">欢迎使用 Blum Agent！</h2>
        <p className="onboarding-subtitle">
          专为百隆五金相关人士设计的 AI 助手
        </p>
        <div className="onboarding-tips">
          <div className="onboarding-tip-item">
            <span className="onboarding-tip-icon">👤</span>
            <span>选择角色（设计师 / 销售 / 安装 / 生产 / 采购 / 消费者）以获得更精准的回答</span>
          </div>
          <div className="onboarding-tip-item">
            <span className="onboarding-tip-icon">📷</span>
            <span>可以上传图片提问，例如铰链标签、钻孔图</span>
          </div>
          <div className="onboarding-tip-item">
            <span className="onboarding-tip-icon">📋</span>
            <span>可以随时导出对话记录</span>
          </div>
          <div className="onboarding-tip-item">
            <span className="onboarding-tip-icon">⚠️</span>
            <span>精确选型（型号 / 尺寸 / 承重）请以官方资料复核为准</span>
          </div>
        </div>
        <div className="onboarding-actions">
          <button
            className="onboarding-btn-primary"
            onClick={dismiss}
            type="button"
          >
            开始使用
          </button>
          <button
            className="onboarding-btn-secondary"
            onClick={dismiss}
            type="button"
          >
            跳过
          </button>
        </div>
      </div>
    </div>
  );
}

export function BlumAgent() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [exportMenuId, setExportMenuId] = useState<string | null>(null);
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
  const [notice, setNotice] = useState("");
  const [locale, setLocale] = useState<AppLocale>("zh");
  const [isRolePanelCollapsed, setIsRolePanelCollapsed] = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [longPressMenu, setLongPressMenu] = useState<LongPressMenuState | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const helpTriggerRef = useRef<HTMLButtonElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);
  const streamingMessageIdRef = useRef<string | null>(null);
  const isStreamingRef = useRef(false);
  const conversationIdRef = useRef(createId());
  const requestStageTimersRef = useRef<number[]>([]);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const shouldFollowConversationRef = useRef(true);
  const previousMessageCountRef = useRef(0);
  const [requestStage, setRequestStage] = useState<RequestStage>("retrieving");
  const [hasLongWait, setHasLongWait] = useState(false);

  const clearRequestStageTimers = useCallback(() => {
    requestStageTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    requestStageTimersRef.current = [];
  }, []);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  const selectedRole = useMemo(
    () => ROLES.find((role) => role.id === roleId)!,
    [roleId],
  );
  const copy = getMessages(locale);
  const selectedRoleLabel = locale === "en" ? englishRoleLabels[selectedRole.id] : selectedRole.label;
  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    if (typeof window !== "undefined") localStorage.setItem("blum_has_visited", "true");
  }, []);

  const announce = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => current === message ? "" : current), 3_500);
  }, []);

  useEffect(() => {
    const container = conversationRef.current;
    if (!container || !shouldFollowConversationRef.current) return;

    // Streaming can update several times per second. Keep those updates
    // instant so browsers do not queue a stack of expensive smooth-scroll
    // animations; reserve smooth scrolling for an actual new turn.
    const hasNewMessage = messages.length > previousMessageCountRef.current;
    const behavior = hasNewMessage && !isLoading ? "smooth" : "auto";
    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: container.scrollHeight, behavior });
    } else {
      container.scrollTop = container.scrollHeight;
    }
    previousMessageCountRef.current = messages.length;
  }, [messages, isLoading]);

  useEffect(() => {
    const container = conversationRef.current;
    if (!container) return;
    const trackScrollPosition = () => {
      shouldFollowConversationRef.current =
        container.scrollHeight - container.scrollTop - container.clientHeight < 96;
    };
    trackScrollPosition();
    container.addEventListener("scroll", trackScrollPosition, { passive: true });
    return () => container.removeEventListener("scroll", trackScrollPosition);
  }, []);

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

  // Preload knowledge base from /data/knowledge.json (cached in localStorage).
  useEffect(() => {
    preloadKnowledge().catch((err) => console.error("[BlumAgent] Knowledge preload failed:", err));
  }, []);

  useEffect(() => {
    // Show onboarding if user hasn't visited before
    if (localStorage.getItem("blum_has_visited") !== "true") {
      setShowOnboarding(true);
    }
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const updateViewport = () => {
      const keyboardHeight = window.innerHeight - viewport.height;
      setIsKeyboardOpen(window.innerWidth < 768 && keyboardHeight > 150);
      document.documentElement.style.setProperty("--agent-visual-height", `${Math.round(viewport.height)}px`);
    };
    updateViewport();
    viewport.addEventListener("resize", updateViewport);
    window.addEventListener("resize", updateViewport);
    return () => {
      viewport.removeEventListener("resize", updateViewport);
      window.removeEventListener("resize", updateViewport);
      document.documentElement.style.removeProperty("--agent-visual-height");
    };
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
      clearRequestStageTimers();
    };

    window.addEventListener("beforeunload", cancelActiveRequest);
    return () => {
      window.removeEventListener("beforeunload", cancelActiveRequest);
      cancelActiveRequest();
    };
  }, [clearRequestStageTimers]);

  useEffect(() => clearLongPressTimer, [clearLongPressTimer]);

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInputFocused = target.tagName === "TEXTAREA" || target.tagName === "INPUT";

      if (e.key === "Escape") {
        if (showHelp) { setShowHelp(false); return; }
        if (draft || attachment) clearDraft();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key === "Backspace" &&
        isInputFocused
      ) {
        e.preventDefault();
        clearDraft();
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
          if (role) {
            setRoleId(role.id);
            setError("");
            announce(formatMessage(copy.roleChanged, { role: locale === "en" ? englishRoleLabels[role.id] : role.label }));
          }
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [draft, attachment, isLoading, showHelp, roleId]);

  function chooseStarter(prompt: string) {
    setDraft(prompt);
    const promptLocale = detectLocaleFromText(prompt);
    if (promptLocale) setLocale(promptLocale);
    setError("");
    inputRef.current?.focus();
  }

  function clearDraft() {
    if (draft.length >= LONG_DRAFT_CONFIRMATION_LENGTH && !window.confirm(copy.confirmClearDraft)) return;
    setDraft("");
    setAttachment(null);
    setError("");
    inputRef.current?.focus();
  }

  function formatMessageTime(timestamp?: number): string {
    if (!timestamp) return "";
    return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(timestamp);
  }

  function handleExport(messageId: string, format: "text" | "markdown" | "json") {
    const message = messages.find((m) => m.id === messageId);
    if (!message) return;
    const userMsg = messages[messages.indexOf(message) - 1];
    const exportTime = new Date().toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
    if (format === "text") {
      const text = [
        `Blum Agent | ${selectedRole.label}`,
        `时间：${exportTime}`,
        "",
        `【用户】`,
        userMsg?.content ?? "",
        "",
        `【Blum Agent】`,
        message.content,
        message.confidence ? `\n[置信度] ${confidenceLabels[message.confidence]}` : "",
        "",
        message.sources?.length
          ? `【来源】\n${message.sources.map((s) => `• ${s.title}: ${s.url}`).join("\n")}`
          : "",
      ].filter(Boolean).join("\n");
      void navigator.clipboard?.writeText(text).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta);
        ta.select(); document.execCommand("copy"); ta.remove();
      });
    } else if (format === "markdown") {
      const md = [
        `# Blum Agent 对话导出`,
        ``,
        `**角色**：${selectedRole.label}`,
        `**时间**：${exportTime}`,
        ``,
        `## 用户`,
        ``,
        userMsg?.content ?? "",
        ``,
        `## Blum Agent`,
        ``,
        message.content,
        message.confidence ? `\n> **置信度**：${confidenceLabels[message.confidence]}` : "",
        ``,
        message.sources?.length
          ? `## 来源\n\n${message.sources.map((s) => `- [${s.title}](${s.url})`).join("\n")}`
          : "",
      ].filter(Boolean).join("\n");
      void navigator.clipboard?.writeText(md).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = md; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta);
        ta.select(); document.execCommand("copy"); ta.remove();
      });
    } else {
      const data = {
        exportedAt: exportTime,
        role: selectedRole.id,
        roleLabel: selectedRole.label,
        userMessage: userMsg?.content ?? "",
        assistantMessage: message.content,
        confidence: message.confidence ?? null,
        sources: message.sources?.map((s) => ({ title: s.title, url: s.url, summary: s.summary })) ?? [],
        followUps: message.followUps ?? [],
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `blum-agent-${messageId.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    setExportMenuId(null);
    announce(locale === "en" ? "Exported" : "已导出");
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

  async function copyMessageText(message: TimelineMessage) {
    try {
      await navigator.clipboard?.writeText(message.content);
    } catch {
      const field = document.createElement("textarea");
      field.value = message.content;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setLongPressMenu(null);
    announce(locale === "en" ? "Message copied" : "消息已复制");
  }

  function beginMessageLongPress(messageId: string, clientX: number, clientY: number) {
    clearLongPressTimer();
    longPressStartRef.current = { x: clientX, y: clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      setLongPressMenu({ messageId, x: clientX, y: clientY });
    }, 550);
  }

  function moveMessageLongPress(clientX: number, clientY: number) {
    const start = longPressStartRef.current;
    if (!start || Math.hypot(clientX - start.x, clientY - start.y) < 10) return;
    clearLongPressTimer();
  }

  function keepComposerVisible() {
    // Let iOS/Android finish resizing visualViewport before aligning the
    // input. This avoids the familiar keyboard-open layout jump.
    window.setTimeout(() => {
      inputRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const container = conversationRef.current;
      if (container && shouldFollowConversationRef.current) {
        container.scrollTop = container.scrollHeight;
      }
    }, 80);
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
          announce(copy.imageAdded);
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
    const requestLocale = detectLocaleFromText(question) ?? locale;
    if (requestLocale !== locale) setLocale(requestLocale);

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
    clearRequestStageTimers();
    setRequestStage("retrieving");
    setHasLongWait(false);
    requestStageTimersRef.current = [
      window.setTimeout(() => setRequestStage("analyzing"), REQUEST_STAGE_DELAYS[0]),
      window.setTimeout(() => setRequestStage("composing"), REQUEST_STAGE_DELAYS[1]),
      window.setTimeout(() => setHasLongWait(true), LONG_WAIT_DELAY_MS),
    ];

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
      let streamingFinished = false;
      let streamingErrorMsg = "";
      await streamChat(
        roleId,
        apiMessages(nextMessages) as Array<{ role: "user" | "assistant"; content: string }>,
        attachment?.dataUrl,
        {
          signal: controller.signal,
          onSources: (sources) => {
            if (requestVersion !== requestVersionRef.current) return;
            setMessages((current) => current.map((m) => m.id === streamingMsgId ? { ...m, sources } : m));
          },
          onChunk: (_chunk, accumulated) => {
            if (requestVersion !== requestVersionRef.current) return;
            setMessages((current) => current.map((m) => m.id === streamingMsgId ? { ...m, content: accumulated } : m));
          },
          onDone: (result) => {
            if (requestVersion !== requestVersionRef.current) return;
            streamingFinished = true;
            setMessages((current) => current.map((m) =>
              m.id === streamingMsgId
                ? { ...m, content: result.answer, confidence: result.confidence, followUps: result.followUps, mode: "live", sources: result.sources }
                : m,
            ));
            setAttachment(null);
            setConnectionState("online");
          },
          onError: (msg) => {
            if (requestVersion !== requestVersionRef.current) return;
            streamingErrorMsg = msg;
          },
        },
      );
      if (requestVersion !== requestVersionRef.current) return;
      if (!streamingFinished && streamingErrorMsg) {
        restoreQuestion(streamingErrorMsg);
        return;
      }
    } finally {
      window.clearTimeout(timeout);
      clearRequestStageTimers();
      setHasLongWait(false);
      isStreamingRef.current = false;
      if (requestVersion === requestVersionRef.current) {
        setIsLoading(false);
        activeRequestRef.current = null;
        streamingMessageIdRef.current = null;
      }
    }
  }
  function startNewConversation() {
    if ((draft.trim() || attachment) && !window.confirm(copy.confirmNewConversation)) return;
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
    clearRequestStageTimers();
    setHasLongWait(false);
    conversationIdRef.current = createId();
    setFeedbackByAnswerId({});
    setShowOlderHistory(false);
    setExportStatus("");
    setNotice("");
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
      // A feedback click should feel immediate. If delivery fails, the catch
      // branch below restores the editable form together with a retry hint.
      [answerId]: { ...feedback, status: "submitted" },
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
      setExportStatus(copy.conversationCopied);
      announce(copy.conversationCopied);
    } catch {
      setExportStatus("复制失败，请检查浏览器剪贴板权限");
    }
  }

  function closeHelp() {
    setShowHelp(false);
    helpTriggerRef.current?.focus();
  }

  return (
    <main className={`agent-shell${isKeyboardOpen ? " keyboard-open" : ""}`} data-locale={locale} id="workspace">
      {showHelp && <HelpOverlay onClose={closeHelp} />}
      {showOnboarding && <OnboardingModal onDismiss={dismissOnboarding} />}
      {exportMenuId ? (
        <div aria-label="Export menu backdrop" className="export-menu-backdrop" onClick={() => setExportMenuId(null)} role="presentation">
          <div
            aria-label="导出选项"
            className="export-menu"
            role="menu"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="export-menu-item"
              onClick={() => handleExport(exportMenuId, "text")}
              role="menuitem"
              type="button"
            >
              📄 复制为纯文本
            </button>
            <button
              className="export-menu-item"
              onClick={() => handleExport(exportMenuId, "markdown")}
              role="menuitem"
              type="button"
            >
              📝 复制为 Markdown
            </button>
            <button
              className="export-menu-item"
              onClick={() => handleExport(exportMenuId, "json")}
              role="menuitem"
              type="button"
            >
              💾 下载 JSON
            </button>
          </div>
        </div>
      ) : null}
      <p aria-live="polite" className="sr-only" role="status">
        {notice || (copiedSourceId ? "资料链接已复制到剪贴板" : "")}
      </p>
      {notice ? <div className="action-notice" role="status">{notice}</div> : null}
      {longPressMenu ? (() => {
        const message = messages.find((item) => item.id === longPressMenu.messageId);
        if (!message) return null;
        const menuWidth = 142;
        const left = Math.max(8, Math.min(longPressMenu.x, window.innerWidth - menuWidth - 8));
        const top = Math.max(8, Math.min(longPressMenu.y - 48, window.innerHeight - 52));
        return (
          <div
            aria-label={locale === "en" ? "Message actions" : "消息操作"}
            className="message-context-menu"
            role="menu"
            style={{ left, top }}
          >
            <button onClick={() => void copyMessageText(message)} role="menuitem" type="button">
              {locale === "en" ? "Copy message" : "复制消息"}
            </button>
          </div>
        );
      })() : null}
      <h1 className="sr-only">{`${copy.appName} ${copy.workspaceName}`}</h1>
      <header className="topbar">
        <a className="brand" href="#workspace" aria-label="Blum Agent 首页">
          <span className="brand-mark" aria-hidden="true">
            B
          </span>
          <span>
            <strong>Blum Agent</strong>
            <small>{copy.workspaceName}</small>
          </span>
        </a>
        <div className="topbar-actions">
          <button
            className="help-button"
            aria-controls="help-dialog"
            aria-expanded={showHelp}
            aria-label={locale === "zh" ? "打开使用帮助" : copy.help}
            onClick={() => setShowHelp(true)}
            ref={helpTriggerRef}
            type="button"
          >
            <CircleHelp aria-hidden="true" size={17} />
          </button>
          <button
            aria-label={`${copy.language}: ${locale === "zh" ? copy.english : copy.chinese}`}
            className="language-button"
            onClick={() => setLocale((current) => current === "zh" ? "en" : "zh")}
            type="button"
          >
            {locale === "zh" ? "EN" : "中"}
          </button>
          <button
            aria-expanded={!isRolePanelCollapsed}
            aria-label={isRolePanelCollapsed ? "Show role panel" : "Hide role panel"}
            className="role-panel-toggle"
            onClick={() => setIsRolePanelCollapsed((current) => !current)}
            type="button"
          >
            {isRolePanelCollapsed ? "☰" : "×"}
          </button>
          <button
            className="new-chat-button"
            onClick={startNewConversation}
            type="button"
          >
            <RefreshCcw aria-hidden="true" size={15} />
            {copy.newConversation}
          </button>
          <button
            className="export-chat-button"
            disabled={messages.length === 0}
            onClick={() => void exportConversation()}
            type="button"
          >
            {copy.exportConversation}
          </button>
          <div className="system-status" aria-label={connectionState === "online" ? copy.online : copy.reconnecting}>
            <span className="status-dot" aria-hidden="true" />
            {connectionState === "online" ? copy.officialFirst : copy.reconnecting}
          </div>
        </div>
      </header>

      <div className={`workspace${isRolePanelCollapsed ? " role-panel-collapsed" : ""}`}>
        <RegionBoundary>
        <aside className="role-panel" aria-label={`${copy.chooseRole} & ${copy.productMap}`}>
          <section>
            <div className="section-label">
              <span>01</span>
              {copy.chooseRole}
            </div>
            <div
              aria-label={copy.chooseRole}
              className="role-list"
              role="group"
              style={{ "--role-index": String(ROLES.findIndex((role) => role.id === roleId)) } as CSSProperties}
            >
              {ROLES.map((role) => {
                const Icon = roleIcons[role.id];
                const selected = role.id === roleId;
                return (
                  <button
                    aria-label={locale === "en" ? `Switch to ${englishRoleLabels[role.id]}` : `切换至${role.label}角色`}
                    aria-pressed={selected}
                    className={`role-button${selected ? " is-selected" : ""}`}
                    key={role.id}
                    onClick={() => {
                      setRoleId(role.id);
                      setError("");
                      announce(formatMessage(copy.roleChanged, { role: locale === "en" ? englishRoleLabels[role.id] : role.label }));
                    }}
                    type="button"
                  >
                    <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                    <span>
                      <strong>{locale === "en" ? englishRoleLabels[role.id] : role.label}</strong>
                      <small>{role.eyebrow}</small>
                    </span>
                    <ChevronRight aria-hidden="true" size={16} />
                    <span className="role-tooltip" aria-hidden="true">
                      {role.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="product-index">
            <div className="section-label">
              <span>02</span>
              {copy.productMap}
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
        </RegionBoundary>

        <RegionBoundary>
        <section className="conversation-panel" aria-label={`${copy.appName} ${locale === "en" ? "conversation" : "对话"}`}>
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
                        {copy.question}
                        <time dateTime={new Date(message.createdAt ?? Date.now()).toISOString()}>
                          {formatMessageTime(message.createdAt)}
                        </time>
                      </div>
                      <p
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setLongPressMenu({ messageId: message.id, x: event.clientX, y: event.clientY });
                        }}
                        onPointerDown={(event) => {
                          if (event.pointerType === "touch") beginMessageLongPress(message.id, event.clientX, event.clientY);
                        }}
                        onPointerMove={(event) => moveMessageLongPress(event.clientX, event.clientY)}
                        onPointerUp={clearLongPressTimer}
                        onPointerCancel={clearLongPressTimer}
                      >
                        {message.content}
                      </p>
                    </article>
                  ) : (
                    <article
                      className={`message message-assistant${isStreamingRef.current && message.id === streamingMessageIdRef.current ? " message-streaming" : ""}`}
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
                            {locale === "en" ? ({ verified: "Verified source", guided: "Source guided", "needs-review": "Review before ordering / machining" } as Record<ConfidenceLevel, string>)[message.confidence] : confidenceLabels[message.confidence]}
                          </span>
                        ) : null}
                      </div>
                      <div className={`answer-content-wrap${expandedMessageIds.has(message.id) ? " is-expanded" : ""}`}>
                        <p
                          className={`answer-text${isStreamingRef.current && message.id === streamingMessageIdRef.current ? " answer-text-streaming" : ""}`}
                          id={`answer-content-${message.id}`}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setLongPressMenu({ messageId: message.id, x: event.clientX, y: event.clientY });
                          }}
                          onPointerDown={(event) => {
                            if (event.pointerType === "touch") beginMessageLongPress(message.id, event.clientX, event.clientY);
                          }}
                          onPointerMove={(event) => moveMessageLongPress(event.clientX, event.clientY)}
                          onPointerUp={clearLongPressTimer}
                          onPointerCancel={clearLongPressTimer}
                        >
                          {message.content.length > 500 && !expandedMessageIds.has(message.id)
                            ? `${message.content.slice(0, 500)}…`
                            : message.content}
                          {isStreamingRef.current && message.id === streamingMessageIdRef.current ? (
                            message.content.length < 30 ? (
                              <span className="answer-skeleton-lines" aria-label="正在生成答案…" role="status">
                                <span className="skeleton-line medium" />
                                <span className="skeleton-line short" />
                                <span className="skeleton-line full" />
                                <span className="skeleton-line medium" />
                              </span>
                            ) : (
                            <span className="streaming-cursor" aria-hidden="true">_</span>
                            )
                          ) : null}
                        </p>
                      </div>
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
                              <p className="feedback-success" role="status">
                                <CheckCircle2 aria-hidden="true" size={15} />
                                {copy.feedbackSubmitted}
                              </p>
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
                      {isStreamingRef.current && message.id === streamingMessageIdRef.current && !message.sources?.length ? (
                        <div className="sources-skeleton" aria-label="正在加载来源…" role="status">
                          <div className="sources-skeleton-label">来源</div>
                          <div className="sources-skeleton-items">
                            {[0, 1].map((i) => (
                              <div key={i} className="sources-skeleton-card">
                                <div className="sources-skeleton-line short" />
                                <div className="sources-skeleton-line medium" />
                                <div className="sources-skeleton-line full" />
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {message.sources?.length ? (
                        <div className="source-section">
                          <h2>{copy.sources}</h2>
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
                          <h2>{copy.followUps}</h2>
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
                    <div className="thinking-steps" style={{ marginLeft: 4 }}>
                      {(["retrieving", "analyzing", "composing"] as const).map((stage, idx) => {
                        const stageOrder = (["retrieving", "analyzing", "composing"] as const).indexOf(requestStage);
                        const isDone = idx < stageOrder;
                        const isActive = idx === stageOrder;
                        const stageLabels = {
                          retrieving: locale === "en" ? "检索" : "检索",
                          analyzing: locale === "en" ? "分析" : "分析",
                          composing: locale === "en" ? "生成" : "生成",
                        } as const;
                        return (
                          <span key={stage} className="thinking-step">
                            <span
                              className={`thinking-step-dot${isDone ? " done" : isActive ? " active" : ""}`}
                            />
                            <span style={{ fontSize: 10, color: isActive ? "var(--ink)" : "var(--muted)" }}>
                              {stageLabels[stage]}
                            </span>
                            {idx < 2 ? (
                              <ChevronRight aria-hidden="true" size={10} style={{ color: "var(--line-strong)" }} />
                            ) : null}
                          </span>
                        );
                      })}
                    </div>
                    {hasLongWait ? <small className="thinking-estimate" style={{ marginLeft: 8 }}>预计还需片刻…</small> : null}
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
                {/* 本地 Data URL 预览不需要 Next 图片优化服务，原生 img 可减少客户端运行时代码。 */}
                <img
                  alt={`待发送图片：${attachment.name}`}
                  height={30}
                  onError={() => {
                    setAttachment(null);
                    setError(IMAGE_READ_ERROR_MESSAGE);
                  }}
                  src={attachment.dataUrl}
                  loading="lazy"
                  decoding="async"
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
                onFocus={keepComposerVisible}
                placeholder={formatMessage(copy.placeholder, { role: selectedRoleLabel })}
                ref={inputRef}
                rows={2}
                value={draft}
              />
              <div className="composer-actions">
                <label
                  className={`attach-button${isUploading ? " uploading" : ""}`}
                >
                  <ImagePlus aria-hidden="true" size={18} />
                  <span>{copy.attachImage}</span>
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
                  aria-label={isLoading ? copy.sending : copy.send}
                  type="submit"
                >
                  <span>{copy.send}</span>
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
        </RegionBoundary>
      </div>
    </main>
  );
}
