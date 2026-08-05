/**
 * Client-side Blum Agent engine.
 * All RAG, grounding, and model calls run in the browser,
 * calling rsxermu666.cn directly via the OpenAI-compatible API.
 */

import { KNOWLEDGE_BASE } from "@/src/domain/knowledge";
import { buildSystemPrompt } from "@/src/agent/prompt";
import { groundModelAnswer } from "@/src/agent/grounding";
import { isGroundedModelAnswer } from "@/src/agent/grounding";
import { getRole } from "@/src/domain/roles";
import { classifyRisk, retrieveKnowledge } from "@/src/domain/retrieval";
import type { RoleId, ConfidenceLevel, OfficialSource } from "@/src/domain/types";

export interface SourceReference {
  id: string;
  title: string;
  url: string;
  summary: string;
  official: true;
}

export interface ChatAnswer {
  answer: string;
  confidence: ConfidenceLevel;
  followUps: string[];
  mode: "live" | "demo" | "guarded";
  sources: SourceReference[];
}

interface EnvConfig {
  apiBaseUrl: string;
  apiKey: string;
  apiModel: string;
}

function getEnv(): EnvConfig {
  if (typeof window !== "undefined" && (window as Window & { __ENV__?: EnvConfig }).__ENV__) {
    return (window as Window & { __ENV__?: EnvConfig }).__ENV__!;
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

export interface ClientChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ClientParsedRequest {
  role: RoleId;
  messages: ClientChatMessage[];
  image?: string;
}

function toSourceReference(source: OfficialSource): SourceReference {
  return {
    id: source.id,
    title: source.title,
    url: source.url,
    summary: source.summary,
    official: true,
  };
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
      ? ["Provide the complete product number and target market", "Provide cabinet and application parameters", "Confirm in the official configurator or current ordering manual"]
      : ["补充完整产品编号与所在市场", "提供柜体、面板和应用场景参数", "用官方配置器或当前订购手册做最终复核"];
  }
  return roleFollowUps[role];
}

function guardedAnswer(sources: SourceReference[], role: RoleId, question: string, locale: "zh" | "en"): string {
  const confirmed = sources.slice(0, 2).map((s) => `- ${s.title}：${s.summary}`).join("\n");
  const nextSteps = roleFollowUps[role].map((step, i) => `${i + 1}. ${step}`).join("\n");
  const focus = /料号|编号|bom|下单|订购/iu.test(question)
    ? "产品编号、兼容关系或订购清单"
    : /尺寸|开孔|孔位|加工/iu.test(question)
      ? "尺寸、孔位或加工参数"
      : /承重|负载|安全|电气|电源|接线/iu.test(question)
        ? "负载、电气或安全要求"
        : "精确尺寸、产品编号、兼容性、负载、电气、安全或最终下单";
  return `结论：这个问题重点涉及${focus}。现有官方资料摘要不足，当前不能安全确认具体结论，因此不直接生成未经核实的参数或零件关系。\n\n已确认的官方资料范围：\n${confirmed}\n\n下一步：\n${nextSteps}\n3. 打开下方官方资料，按当前市场与完整型号完成最终复核。\n\n还需确认：完整产品编号、所在国家或市场、柜体与面板参数，以及能清楚看到五金标识和安装状态的照片。`;
}

function demoAnswer(source: OfficialSource, risk: "precision" | "standard", locale: "zh" | "en"): string {
  const reviewNotice = risk === "precision"
    ? (locale === "en"
      ? "\n\nThis question involves precise selection or safety info. Provide complete parameters and confirm in the official configurator before ordering."
      : "\n\n这个问题涉及精确选型或安全信息。请补充完整参数，并在下单或加工前用官方配置器复核。")
    : "";
  const prefix = locale === "en"
    ? "Demo mode active. Reliable entry point from Blum official material:\n\n"
    : "当前为演示模式，先根据 Blum 官方资料给你一个可靠入口：\n\n";
  return `${prefix}${source.summary}${reviewNotice}`;
}

function providerUnavailableAnswer(source: OfficialSource, risk: "precision" | "standard", locale: "zh" | "en"): string {
  const reviewNotice = risk === "precision"
    ? (locale === "en"
      ? "\n\nThis involves precise selection. Confirm parameters in the official configurator before ordering."
      : "\n\n这个问题涉及精确选型或安全信息。请补充完整参数，并在下单或加工前用官方配置器复核。")
    : "";
  const prefix = locale === "en"
    ? "Model service temporarily unavailable. Confirmed Blum official material:\n\n"
    : "模型服务暂时不可用，以下仅提供当前可确认的 Blum 官方资料：\n\n";
  return `${prefix}${source.summary}${reviewNotice}`;
}

function groundedFallbackAnswer(sources: SourceReference[], role: RoleId, locale: "zh" | "en"): string {
  const officialFacts = sources.slice(0, 2).map((s) => `- ${s.title}：${s.summary}`).join("\n");
  const nextSteps = roleFollowUps[role].map((step, i) => `${i + 1}. ${step}`).join("\n");
  return `结论：模型草稿包含无法由当前官方摘要直接核实的扩展内容，因此这里只展示确定的资料范围。\n\n已确认的官方资料范围：\n${officialFacts}\n\n下一步：\n${nextSteps}\n3. 如需精确参数，请打开下方官方资料并按当前市场复核。`;
}

function officialEntryAnswer(role: RoleId, locale: "zh" | "en"): string {
  if (locale === "en") {
    return `结论：根据现有资料，当前没有找到可直接回答该问题的 Blum 官方条目，因此不补充产品细节或操作结论。\n\n建议：请从下方官方资料入口按所在市场、产品系列或完整产品编号继续核实。\n\n下一步：${roleFollowUps[role][0]}`;
  }
  return `结论：根据现有资料，当前没有找到可直接回答该问题的 Blum 官方条目，因此不补充产品细节或操作结论。\n\n建议：请从下方官方资料入口按所在市场、产品系列或完整产品编号继续核实。\n\n待确认：具体产品系列、完整产品编号、柜体应用和现场照片。\n\n下一步：${roleFollowUps[role][0]}`;
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
    m.matchedKeywords.some((kw) =>
      ["抽屉", "导轨", "铰链", "合页", "上翻门", "翻门"].includes(kw),
    ),
  );
  return hasCategoryOnly ? "medium" : "low";
}

function buildMessages(messages: ClientChatMessage[], systemPrompt: string) {
  const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
  return [
    { role: "system", content: systemPrompt },
    ...messages.map((msg, idx) => {
      if (msg.role === "assistant") return msg;
      if (idx !== lastUserIndex) return msg;
      return msg;
    }),
  ];
}

export async function answerChat(
  request: ClientParsedRequest,
): Promise<ChatAnswer> {
  const question = [...request.messages]
    .reverse()
    .find((m) => m.role === "user")!.content;
  const locale = resolveLocale(question);
  const risk = classifyRisk(question);
  const matches = retrieveKnowledge(question, 4, request.messages);
  const answerQuality = answerQualityFor(matches);
  const sources = matches.map(({ source }) => toSourceReference(source));
  const confidence: ConfidenceLevel =
    risk === "precision"
      ? "needs-review"
      : answerQuality === "high"
        ? "verified"
        : answerQuality === "medium"
          ? "guided"
          : "needs-review";

  if (risk === "precision") {
    return {
      answer: guardedAnswer(sources, request.role, question, locale),
      confidence,
      followUps: followUpsFor(request.role, risk, locale),
      mode: "guarded",
      sources,
    };
  }

  const env = getEnv();
  if (!env.apiKey || !env.apiBaseUrl) {
    const fallback = matches[0]?.source;
    if (!fallback) {
      return {
        answer: officialEntryAnswer(request.role, locale),
        confidence,
        followUps: followUpsFor(request.role, risk, locale),
        mode: "guarded",
        sources: [],
      };
    }
    return {
      answer: demoAnswer(fallback, risk, locale),
      confidence,
      followUps: followUpsFor(request.role, risk, locale),
      mode: "demo",
      sources,
    };
  }

  if (answerQuality === "low") {
    return {
      answer: officialEntryAnswer(request.role, locale),
      confidence,
      followUps: followUpsFor(request.role, risk, locale),
      mode: "guarded",
      sources,
    };
  }

  const role = getRole(request.role);
  const systemPrompt = buildSystemPrompt({
    role,
    matches,
    risk,
    conversationHistory: request.messages,
    knowledgeCoverage: answerQuality === "high" ? "direct" : "none",
    locale,
    answerQuality,
  });

  const apiMessages = buildMessages(request.messages, systemPrompt);
  const lastUserIdx = request.messages.findLastIndex((m) => m.role === "user");

  const apiPayload: Record<string, unknown> = {
    model: env.apiModel,
    temperature: 0.2,
    max_tokens: 1800,
    stream: false,
    messages: apiMessages.map((msg, idx) => {
      if (msg.role !== "user") return msg;
      if (idx !== lastUserIdx) return msg;
      if (!request.image) return msg;
      return {
        role: "user",
        content: [
          { type: "text", text: msg.content },
          { type: "image_url", image_url: { url: request.image } },
        ],
      };
    }),
  };

  let rawAnswer: string;
  try {
    const resp = await fetch(`${env.apiBaseUrl.replace(/\/+$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(apiPayload),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown error");
      console.error("API error:", resp.status, errText);
      const fallback = matches[0]?.source;
      if (fallback) {
        return {
          answer: providerUnavailableAnswer(fallback, risk, locale),
          confidence,
          followUps: followUpsFor(request.role, risk, locale),
          mode: "demo",
          sources,
        };
      }
      return {
        answer: officialEntryAnswer(request.role, locale),
        confidence,
        followUps: followUpsFor(request.role, risk, locale),
        mode: "guarded",
        sources,
      };
    }

    const data = await resp.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    rawAnswer = data.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    console.error("Network error:", err);
    const fallback = matches[0]?.source;
    if (fallback) {
      return {
        answer: providerUnavailableAnswer(fallback, risk, locale),
        confidence,
        followUps: followUpsFor(request.role, risk, locale),
        mode: "demo",
        sources,
      };
    }
    return {
      answer: officialEntryAnswer(request.role, locale),
      confidence,
      followUps: followUpsFor(request.role, risk, locale),
      mode: "guarded",
      sources,
    };
  }

  const grounded = groundModelAnswer(
    rawAnswer,
    matches.map(({ source }) => source),
  );

  if (!grounded) {
    return {
      answer: groundedFallbackAnswer(sources, request.role, locale),
      confidence,
      followUps: followUpsFor(request.role, risk, locale),
      mode: "guarded",
      sources,
    };
  }

  return {
    answer: grounded,
    confidence,
    followUps: followUpsFor(request.role, risk, locale),
    mode: "live",
    sources,
  };
}

export type { ClientParsedRequest };
