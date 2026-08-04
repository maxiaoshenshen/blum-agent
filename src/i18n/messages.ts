export type AppLocale = "zh" | "en";

/**
 * Shared UI copy. Keep dynamic values as `{name}` placeholders so the same
 * message can be rendered by both the server and the client safely.
 */
export const messages = {
  zh: {
    placeholder: "以{role}身份提问：产品、选型、安装、采购…",
    appName: "Blum Agent",
    workspaceName: "百隆五金智能工作台",
    newConversation: "开始新对话",
    exportConversation: "导出对话",
    help: "使用帮助",
    send: "发送问题",
    sending: "正在发送问题",
    attachImage: "添加现场图片",
    askAgent: "向 Blum Agent 提问",
    officialFirst: "官方资料优先",
    reconnecting: "正在重新连接",
    online: "系统在线",
    retry: "重试",
    language: "语言",
    chinese: "中文",
    english: "English",
    chooseRole: "选择你的角色",
    productMap: "产品知识地图",
    question: "你的问题",
    sources: "参考的官方资料",
    followUps: "继续把问题说清楚",
    helpful: "有帮助",
    inaccurate: "不准确",
    loading: "正在检索 Blum 资料并组织答案",
  },
  en: {
    placeholder: "Ask as {role}: products, selection, installation, procurement…",
    appName: "Blum Agent",
    workspaceName: "Blum hardware workspace",
    newConversation: "New chat",
    exportConversation: "Export chat",
    help: "Help",
    send: "Send",
    sending: "Sending question",
    attachImage: "Add site photo",
    askAgent: "Ask Blum Agent",
    officialFirst: "Official sources first",
    reconnecting: "Reconnecting",
    online: "System online",
    retry: "Retry",
    language: "Language",
    chinese: "中文",
    english: "English",
    chooseRole: "Choose your role",
    productMap: "Product knowledge map",
    question: "Your question",
    sources: "Official references",
    followUps: "Help me narrow this down",
    helpful: "Helpful",
    inaccurate: "Not accurate",
    loading: "Retrieving Blum sources and preparing an answer",
  },
} as const;

export type MessageKey = keyof typeof messages.zh;

export function getMessages(locale: AppLocale) {
  return messages[locale];
}

export function formatMessage(
  value: string,
  variables: Record<string, string | number> = {},
): string {
  return value.replace(/\{(\w+)\}/g, (_, key: string) => String(variables[key] ?? `{${key}}`));
}

/** Prefer the language used in the question; fall back to browser preference. */
export function detectLocaleFromText(value: string): AppLocale | undefined {
  const text = value.trim();
  if (!text || /[\p{Script=Han}]/u.test(text)) return undefined;
  const englishSignals = /\b(what|which|when|where|why|who|how|can|could|would|should|is|are|do|does|install|installation|hinge|drawer|cabinet|blum|help|please|need|want)\b/iu;
  const latinWords = text.match(/[a-z]+(?:['-][a-z]+)*/giu) ?? [];
  return englishSignals.test(text) || latinWords.length >= 3 ? "en" : undefined;
}

export function detectLocaleFromAcceptLanguage(header: string | null | undefined): AppLocale {
  const preferred = (header ?? "").toLowerCase().split(",").map((item) => item.trim());
  return preferred.some((item) => item.startsWith("en")) ? "en" : "zh";
}

export function resolveLocale(question: string, acceptLanguage?: string | null): AppLocale {
  return detectLocaleFromText(question) ?? detectLocaleFromAcceptLanguage(acceptLanguage);
}
