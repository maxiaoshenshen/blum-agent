/**
 * Client-side streaming chat using rsxermu666.cn directly.
 * Handles SSE parsing, RAG, grounding, and confidence scoring.
 */

import { retrieveKnowledge, classifyRisk } from "@/src/domain/retrieval";
import { buildSystemPrompt } from "@/src/agent/prompt";
import { groundModelAnswer } from "@/src/agent/grounding";
import { getRole } from "@/src/domain/roles";
import type { RoleId, ConfidenceLevel, OfficialSource } from "@/src/domain/types";

export interface StreamSource {
  id: string;
  title: string;
  url: string;
  summary: string;
  official: true;
}

export interface StreamDone {
  answer: string;
  confidence: ConfidenceLevel;
  followUps: string[];
  sources: StreamSource[];
}

interface EnvConfig {
  apiBaseUrl: string;
  apiKey: string;
  apiModel: string;
}

declare global {
  interface Window {
    __ENV__?: EnvConfig;
  }
}

function getEnv(): EnvConfig {
  if (typeof window !== "undefined" && window.__ENV__) {
    return window.__ENV__;
  }
  return {
    apiBaseUrl: "https://rsxermu666.cn",
    apiKey: "",
    apiModel: "claude-opus-5",
  };
}

export function hasLiveConfig(): boolean {
  const env = getEnv();
  return Boolean(env.apiKey && env.apiBaseUrl);
}

export function resolveLocale(question: string): "zh" | "en" {
  const latinCount = (question.match(/[a-zA-Z]{4,}/g) ?? []).length;
  const hanCount = (question.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return latinCount > hanCount * 0.6 ? "en" : "zh";
}

export interface ClientMessage {
  role: "user" | "assistant";
  content: string;
}

const roleFollowUps: Record<RoleId, string[]> = {
  designer: ["提供柜体尺寸、门型和期望开合方式", "说明空间、风格与收纳目标"],
  sales: ["说明客户场景、预算层级与关注点", "告诉我需要对比的产品方案"],
  installer: ["提供产品型号和正面、侧面现场照片", "说明故障现象及已经尝试的调节步骤"],
  production: ["提供柜体结构、板厚和加工设备", "说明当前 CAD/CAM 或 BXF 流程"],
  procurement: ["补充完整产品编号与所在市场", "说明所需数量、应用和交付要求"],
  consumer: ["告诉我家具位置和期望使用体验", "提供现有产品型号或现场照片"],
};

function followUpsFor(role: RoleId, risk: "precision" | "standard", locale: "zh" | "en"): string[] {
  if (risk === "precision") {
    return locale === "en"
      ? ["Provide the complete product number and target market", "Provide cabinet and application parameters", "Confirm in the official configurator"]
      : ["补充完整产品编号与所在市场", "提供柜体、面板和应用场景参数", "用官方配置器或当前订购手册做最终复核"];
  }
  return roleFollowUps[role];
}

function sourceOf(official: OfficialSource): StreamSource {
  return { id: official.id, title: official.title, url: official.url, summary: official.summary, official: true };
}

function fallbackAnswer(sources: StreamSource[], role: RoleId, risk: "precision" | "standard", locale: "zh" | "en"): string {
  const confirmed = sources.slice(0, 2).map((s) => `- ${s.title}：${s.summary}`).join("\n");
  const nextSteps = roleFollowUps[role].map((s, i) => `${i + 1}. ${s}`).join("\n");
  const prefix = locale === "en"
    ? "The model service is temporarily unavailable. Here is the confirmed Blum official material available:\n\n"
    : "模型服务暂时不可用，以下仅提供当前可确认的 Blum 官方资料：\n\n";
  const notice = risk === "precision"
    ? (locale === "en"
      ? "\n\nThis involves precise selection. Confirm in the official configurator before ordering."
      : "\n\n这个问题涉及精确选型或安全信息。请补充完整参数，并在下单或加工前用官方配置器复核。")
    : "";
  return `${prefix}${confirmed}${notice}`;
}

function officialEntry(role: RoleId, locale: "zh" | "en"): string {
  return locale === "en"
    ? `Conclusion: No direct Blum official entry was found for this question.\n\nRecommendation: Verify using the official reference below by market, product range, or complete product number.\n\nStill needed: Product range, complete product number, cabinet application, and site photos.\n\nNext: ${roleFollowUps[role][0]}`
    : `结论：根据现有资料，当前没有找到可直接回答该问题的 Blum 官方条目，因此不补充产品细节或操作结论。\n\n建议：请从下方官方资料入口按所在市场、产品系列或完整产品编号继续核实。\n\n下一步：${roleFollowUps[role][0]}`;
}

function answerQualityFor(matches: ReturnType<typeof retrieveKnowledge>): "high" | "medium" | "low" {
  const hasMeaningfulKeyword = matches.some((m) =>
    m.matchedKeywords.some((kw) => {
      const compact = kw.replace(/[\s-]/g, "").toLowerCase();
      return compact.length > 2 && !["blum", "百隆", "五金", "家具", "柜门"].includes(compact);
    }),
  );
  if (hasMeaningfulKeyword) return "high";
  const hasCategoryOnly = matches.some((m) =>
    m.matchedKeywords.some((kw) => ["抽屉", "导轨", "铰链", "合页", "上翻门", "翻门"].includes(kw)),
  );
  return hasCategoryOnly ? "medium" : "low";
}

const MAX_OUTPUT_CHARS = 12_000;

export interface StreamCallbacks {
  onSources: (sources: StreamSource[]) => void;
  onChunk: (text: string, accumulated: string) => void;
  onDone: (result: StreamDone) => void;
  onError: (message: string) => void;
  signal?: AbortSignal;
}

export async function streamChat(
  roleId: RoleId,
  messages: ClientMessage[],
  image: string | undefined,
  callbacks: StreamCallbacks,
): Promise<void> {
  const env = getEnv();
  const question = [...messages].reverse().find((m) => m.role === "user")!.content;
  const locale = resolveLocale(question);
  const risk = classifyRisk(question);
  const matches = retrieveKnowledge(question, 4, messages);
  const sources = matches.map(({ source }) => sourceOf(source));
  callbacks.onSources(sources);

  const answerQuality = answerQualityFor(matches);
  const confidence: ConfidenceLevel =
    risk === "precision" ? "needs-review"
    : answerQuality === "high" ? "verified"
    : answerQuality === "medium" ? "guided"
    : "needs-review";

  if (risk === "precision" || answerQuality === "low") {
    const fb = sources.length > 0 ? fallbackAnswer(sources, roleId, risk, locale) : officialEntry(roleId, locale);
    callbacks.onChunk(fb, fb);
    callbacks.onDone({ answer: fb, confidence, followUps: followUpsFor(roleId, risk, locale), sources });
    return;
  }

  if (!env.apiKey || !env.apiBaseUrl) {
    const fb = sources.length > 0 ? sources[0].summary : officialEntry(roleId, locale);
    callbacks.onChunk(fb, fb);
    callbacks.onDone({ answer: fb, confidence: "guided", followUps: followUpsFor(roleId, risk, locale), sources });
    return;
  }

  const role = getRole(roleId);
  const systemPrompt = buildSystemPrompt({
    role,
    matches,
    risk,
    conversationHistory: messages,
    knowledgeCoverage: answerQuality === "high" ? "direct" : "none",
    locale,
    answerQuality,
  });

  const lastUserIdx = messages.findLastIndex((m) => m.role === "user");
  const apiMessages = [
    { role: "system" as const, content: systemPrompt },
    ...messages.map((msg, idx) => {
      if (msg.role === "assistant") return msg;
      if (idx !== lastUserIdx) return msg;
      if (!image) return msg;
      return { role: "user" as const, content: [
        { type: "text" as const, text: msg.content },
        { type: "image_url" as const, image_url: { url: image } },
      ]};
    }),
  ];

  const controller = new AbortController();
  if (callbacks.signal) {
    callbacks.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let accumulated = "";

  try {
    const resp = await fetch(`${env.apiBaseUrl.replace(/\/+$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: env.apiModel, temperature: 0.2, max_tokens: 1800, stream: true, messages: apiMessages }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown");
      console.error("Stream API error:", resp.status, errText);
      const fb = sources.length > 0 ? fallbackAnswer(sources, roleId, risk, locale) : officialEntry(roleId, locale);
      callbacks.onChunk(fb, fb);
      callbacks.onDone({ answer: fb, confidence, followUps: followUpsFor(roleId, risk, locale), sources });
      return;
    }

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
          const content = parsed.choices?.[0]?.delta?.content;
          if (typeof content === "string" && content.length > 0) {
            accumulated += content;
            callbacks.onChunk(content, accumulated);
          }
        } catch { /* malformed chunk */ }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;
    console.error("Stream error:", err);
    if (accumulated) {
      const grounded = groundModelAnswer(accumulated, sources);
      callbacks.onDone({ answer: grounded ?? accumulated, confidence, followUps: followUpsFor(roleId, risk, locale), sources });
    } else {
      const fb = sources.length > 0 ? fallbackAnswer(sources, roleId, risk, locale) : officialEntry(roleId, locale);
      callbacks.onChunk(fb, fb);
      callbacks.onDone({ answer: fb, confidence, followUps: followUpsFor(roleId, risk, locale), sources });
    }
    return;
  }

  if (!accumulated.trim()) {
    const fb = sources.length > 0 ? fallbackAnswer(sources, roleId, risk, locale) : officialEntry(roleId, locale);
    callbacks.onChunk(fb, fb);
    callbacks.onDone({ answer: fb, confidence, followUps: followUpsFor(roleId, risk, locale), sources });
    return;
  }

  const finalText = accumulated.length > MAX_OUTPUT_CHARS
    ? `${accumulated.slice(0, MAX_OUTPUT_CHARS).trimEnd()}\n\n（回答过长，已截断）`
    : accumulated;

  const grounded = groundModelAnswer(finalText, sources);
  callbacks.onDone({ answer: grounded ?? finalText, confidence, followUps: followUpsFor(roleId, risk, locale), sources });
}
