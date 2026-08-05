import { retrieveKnowledge, classifyRisk, isBlumRelated } from "@/src/domain/retrieval";
import { getRole } from "@/src/domain/roles";
import type {
  ConfidenceLevel,
  OfficialSource,
  RiskLevel,
  RoleId,
} from "@/src/domain/types";
import { buildSystemPrompt } from "./prompt";
import { groundModelAnswer } from "./grounding";
import {
  ProviderError,
  requestChatCompletion,
  type ProviderConfig,
} from "./provider";
import type { ParsedChatRequest } from "./schema";
import { resolveLocale, type AppLocale } from "@/src/i18n/messages";

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

type RequestCompletion = typeof requestChatCompletion;

interface ChatDependencies {
  providerConfig?: ProviderConfig;
  requestCompletion?: RequestCompletion;
  locale?: AppLocale;
  onModelRequest?: () => void;
  onGroundingIntercept?: () => void;
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
  installer: [
    "提供产品型号和正面、侧面现场照片",
    "说明故障现象及已经尝试的调节步骤",
  ],
  production: ["提供柜体结构、板厚和加工设备", "说明当前 CAD/CAM 或 BXF 流程"],
  procurement: ["补充完整产品编号与所在市场", "说明所需数量、应用和交付要求"],
  consumer: ["告诉我家具位置和期望使用体验", "提供现有产品型号或现场照片"],
};

const roleFollowUpsEnglish: Record<RoleId, string[]> = {
  designer: ["Share cabinet dimensions, door type, and desired opening motion", "Describe the space, style, and storage goal"],
  sales: ["Describe the customer scenario, budget range, and decision criteria", "Tell me which product options you need to compare"],
  installer: ["Share the product number and clear front and side site photos", "Describe the fault and adjustment steps already tried"],
  production: ["Share cabinet construction, board thickness, and production equipment", "Describe the current CAD/CAM or BXF workflow"],
  procurement: ["Provide the complete product number and target market", "State quantity, application, and delivery requirements"],
  consumer: ["Tell me where the furniture is used and the desired experience", "Share an existing product number or site photo"],
};

function followUpsFor(role: RoleId, risk: RiskLevel, locale: AppLocale): string[] {
  const roleFollowUpsForLocale = locale === "en" ? roleFollowUpsEnglish : roleFollowUps;
  return risk === "precision"
    ? locale === "en" ? [
        "Provide the complete product number and target market",
        "Provide cabinet, front, and application parameters",
        "Confirm the final choice in the official configurator or current ordering manual",
      ] : [
        "补充完整产品编号与所在市场",
        "提供柜体、面板和应用场景参数",
        "用官方配置器或当前订购手册做最终复核",
      ]
    : roleFollowUpsForLocale[role];
}

function demoAnswer(source: OfficialSource, risk: RiskLevel, locale: AppLocale): string {
  if (locale === "en") {
    const reviewNotice = risk === "precision"
      ? "\n\nThis question involves precise selection or safety information. Provide complete parameters and confirm them in the official configurator before ordering or machining."
      : "";
    return `Demo mode is active. Here is a reliable entry point from Blum official material:\n\n${source.summary}${reviewNotice}`;
  }
  const reviewNotice =
    risk === "precision"
      ? "\n\n这个问题涉及精确选型或安全信息。请补充完整参数，并在下单或加工前用官方配置器复核。"
      : "";

  return `当前为演示模式，先根据 Blum 官方资料给你一个可靠入口：\n\n${source.summary}${reviewNotice}`;
}

function providerUnavailableAnswer(source: OfficialSource, risk: RiskLevel, locale: AppLocale): string {
  if (locale === "en") {
    const reviewNotice = risk === "precision"
      ? "\n\nThis request needs exact selection or safety verification. Confirm complete parameters in the official configurator before ordering or machining."
      : "";
    return `The model service is temporarily unavailable. Here is the confirmed Blum official material available for this question:\n\n${source.summary}${reviewNotice}`;
  }
  const reviewNotice = risk === "precision"
    ? "\n\n这个问题涉及精确选型或安全信息。请补充完整参数，并在下单或加工前用官方配置器复核。"
    : "";
  return `模型服务暂时不可用，以下仅提供当前可确认的 Blum 官方资料：\n\n${source.summary}${reviewNotice}`;
}

function guardedAnswer(
  sources: SourceReference[],
  role: RoleId,
  question = "",
  locale: AppLocale = "zh",
): string {
  if (locale === "en") {
    const confirmed = sources.slice(0, 2).map((source) => `- ${source.title}: ${source.summary}`).join("\n");
    const nextSteps = roleFollowUpsEnglish[role].map((step, index) => `${index + 1}. ${step}`).join("\n");
    return `Conclusion:\nThis request involves exact product selection, compatibility, dimensions, load, safety, or ordering information. The available official summaries do not support a safe specific conclusion, so no unverified parameter or part relationship is provided.\n\nConfirmed official material:\n${confirmed}\n\nNext steps:\n${nextSteps}\n3. Open the official reference below and verify against the current market and complete product number.\n\nStill needed:\nThe complete product number, country or market, cabinet and front parameters, plus clear photos of the hardware marking and installation state.`;
  }
  const confirmed = sources
    .slice(0, 2)
    .map((source) => `- ${source.title}：${source.summary}`)
    .join("\n");
  const nextSteps = roleFollowUps[role]
    .map((step, index) => `${index + 1}. ${step}`)
    .join("\n");

  const focus = /料号|编号|bom|下单|订购/iu.test(question)
    ? "产品编号、兼容关系或订购清单"
    : /尺寸|开孔|孔位|加工/iu.test(question)
      ? "尺寸、孔位或加工参数"
      : /承重|负载|安全|电气|电源|接线/iu.test(question)
        ? "负载、电气或安全要求"
        : "精确尺寸、产品编号、兼容性、负载、电气、安全或最终下单";

  return `结论：
这个问题重点涉及${focus}。现有官方资料摘要不足，当前不能安全确认具体结论，因此不直接生成未经核实的参数或零件关系。

已确认的官方资料范围：
${confirmed}

下一步：
${nextSteps}
3. 打开下方官方资料，按当前市场与完整型号完成最终复核。

还需确认：
完整产品编号、所在国家或市场、柜体与面板参数，以及能清楚看到五金标识和安装状态的照片。`;
}

function outOfScopeAnswer(locale: AppLocale): string {
  if (locale === "en") return "This question is outside Blum Agent’s service scope. I focus on Blum hardware selection, design, sales, installation, production, procurement, and use. Share a specific Blum product, cabinet application, or hardware symptom and I will help using official material.";
  return "这个问题不在 Blum Agent 的服务范围内。我专注于 Blum 百隆五金的产品选型、设计、销售、安装、生产、采购与使用问题。你可以告诉我具体的 Blum 产品、柜体应用或五金现象，我会基于官方资料协助你。";
}

function groundedFallbackAnswer(
  sources: SourceReference[],
  role: RoleId,
  locale: AppLocale = "zh",
): string {
  if (locale === "en") {
    const officialFacts = sources.slice(0, 2).map((source) => `- ${source.title}: ${source.summary}`).join("\n");
    const nextSteps = roleFollowUpsEnglish[role].map((step, index) => `${index + 1}. ${step}`).join("\n");
    return `Conclusion:\nThe model draft included claims not directly verifiable from the current official summaries, so only the confirmed material is shown.\n\nConfirmed official material:\n${officialFacts}\n\nNext steps:\n${nextSteps}\n3. For exact parameters, open the official reference below and confirm it for the current market.`;
  }
  const officialFacts = sources
    .slice(0, 2)
    .map((source) => `- ${source.title}：${source.summary}`)
    .join("\n");
  const nextSteps = roleFollowUps[role]
    .map((step, index) => `${index + 1}. ${step}`)
    .join("\n");

  return `结论：
模型草稿包含无法由当前官方摘要直接核实的扩展内容，因此这里只展示确定的资料范围。

已确认的官方资料范围：
${officialFacts}

下一步：
${nextSteps}
3. 如需精确参数，请打开下方官方资料并按当前市场复核。`;
}

function officialEntryAnswer(role: RoleId, locale: AppLocale = "zh"): string {
  if (locale === "en") return `Conclusion:\nThe current material does not contain a Blum official entry that can directly answer this question, so no product detail or operating instruction is added.\n\nRecommended:\nUse the official references below to verify by market, product range, or complete product number.\n\nStill needed:\nThe product range, complete product number, cabinet application, and site photos.\n\nNext step:\n${roleFollowUpsEnglish[role][0]}`;
  return `结论：
根据现有资料，当前没有找到可直接回答该问题的 Blum 官方条目，因此不补充产品细节或操作结论。

建议：
请从下方官方资料入口按所在市场、产品系列或完整产品编号继续核实。

待确认：
以下信息待确认：具体产品系列、完整产品编号、柜体应用和现场照片。

下一步：
${roleFollowUps[role][0]}`;
}

type AnswerQuality = "high" | "medium" | "low";

function answerQualityFor(matches: ReturnType<typeof retrieveKnowledge>): AnswerQuality {
  const hasMeaningfulKeyword = matches.some((match) =>
    match.matchedKeywords.some((keyword) => {
      const compact = keyword.replace(/[\s-]/g, "").toLowerCase();
      return compact.length > 2 && !["blum", "百隆", "五金", "家具", "柜门"].includes(compact);
    }),
  );
  if (hasMeaningfulKeyword) return "high";
  const hasCategoryOnlyMatch = matches.some((match) =>
    match.matchedKeywords.some((keyword) =>
      ["抽屉", "导轨", "铰链", "合页", "上翻门", "翻门"].includes(keyword),
    ),
  );
  return hasCategoryOnlyMatch ? "medium" : "low";
}

export function providerConfigFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
): ProviderConfig | undefined {
  const apiKey = environment.PROVIDER_API_KEY?.trim();
  const baseUrl = environment.PROVIDER_BASE_URL?.trim();
  const model = environment.PROVIDER_MODEL?.trim();
  if (!apiKey || !baseUrl || !model) return undefined;

  try {
    const url = new URL(baseUrl);
    const isLocalDevelopment =
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !isLocalDevelopment) ||
      url.username ||
      url.password
    ) {
      return undefined;
    }
    return {
      apiKey,
      baseUrl: baseUrl.replace(/\/+$/, ""),
      model,
    };
  } catch {
    return undefined;
  }
}

export async function answerChat(
  request: ParsedChatRequest,
  dependencies: ChatDependencies,
): Promise<ChatAnswer> {
  const question = [...request.messages]
    .reverse()
    .find((message) => message.role === "user")!.content;
  const locale = dependencies.locale ?? resolveLocale(question);
  const risk = classifyRisk(question);
  const conversationText = request.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n");
  const isInServiceScope =
    isBlumRelated(question) || isBlumRelated(conversationText) || risk === "precision";
  if (!isInServiceScope && dependencies.providerConfig) {
    return {
      answer: outOfScopeAnswer(locale),
      confidence: "guided",
      followUps: followUpsFor(request.role, risk, locale),
      mode: "guarded",
      sources: [],
    };
  }
  const matches = retrieveKnowledge(question, 4, request.messages);
(globalThis as Record<string, unknown>).__debug_matches = matches.length;
(globalThis as Record<string, unknown>).__debug_risk = risk;
(globalThis as Record<string, unknown>).__debug_hasConfig = Boolean(dependencies.providerConfig);
  console.log("[DEBUG chat.ts] matches.length:", matches.length, "risk:", risk, "providerConfig:", Boolean(dependencies.providerConfig));
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

  if (!dependencies.providerConfig) {
    return {
      answer: demoAnswer(matches[0].source, risk, locale),
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

  const completion = dependencies.requestCompletion ?? requestChatCompletion;
  dependencies.onModelRequest?.();
  let answer: string;
  try {
    answer = await completion({
      config: dependencies.providerConfig,
      systemPrompt: buildSystemPrompt({
        role: getRole(request.role),
        matches,
        risk,
        conversationHistory: request.messages,
        knowledgeCoverage: answerQuality === "high" ? "direct" : "none",
        locale,
        answerQuality,
      }),
      messages: request.messages,
      image: request.image,
    });
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    return {
      answer: providerUnavailableAnswer(matches[0].source, risk, locale),
      confidence,
      followUps: followUpsFor(request.role, risk, locale),
      mode: "demo",
      sources,
    };
  }

  const groundedAnswer = groundModelAnswer(
    answer,
    matches.map(({ source }) => source),
  );
  if (!groundedAnswer) {
    dependencies.onGroundingIntercept?.();
    return {
      answer: groundedFallbackAnswer(sources, request.role, locale),
      confidence,
      followUps: followUpsFor(request.role, risk, locale),
      mode: "guarded",
      sources,
    };
  }

  return {
    answer: groundedAnswer,
    confidence,
    followUps: followUpsFor(request.role, risk, locale),
    mode: "live",
    sources,
  };
}
