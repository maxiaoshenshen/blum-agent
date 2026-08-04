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
  requestChatCompletion,
  type ProviderConfig,
} from "./provider";
import type { ParsedChatRequest } from "./schema";

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

function followUpsFor(role: RoleId, risk: RiskLevel): string[] {
  return risk === "precision"
    ? [
        "补充完整产品编号与所在市场",
        "提供柜体、面板和应用场景参数",
        "用官方配置器或当前订购手册做最终复核",
      ]
    : roleFollowUps[role];
}

function demoAnswer(source: OfficialSource, risk: RiskLevel): string {
  const reviewNotice =
    risk === "precision"
      ? "\n\n这个问题涉及精确选型或安全信息。请补充完整参数，并在下单或加工前用官方配置器复核。"
      : "";

  return `当前为演示模式，先根据 Blum 官方资料给你一个可靠入口：\n\n${source.summary}${reviewNotice}`;
}

function guardedAnswer(
  sources: SourceReference[],
  role: RoleId,
  question = "",
): string {
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

function outOfScopeAnswer(): string {
  return "这个问题不在 Blum Agent 的服务范围内。我专注于 Blum 百隆五金的产品选型、设计、销售、安装、生产、采购与使用问题。你可以告诉我具体的 Blum 产品、柜体应用或五金现象，我会基于官方资料协助你。";
}

function nonChineseHint(question: string): string {
  return /[\p{Script=Han}]/u.test(question) ? "" : "\n\n提示：建议用中文提问以获得最佳体验；也可以附上产品型号、应用场景或照片。";
}

function groundedFallbackAnswer(
  sources: SourceReference[],
  role: RoleId,
): string {
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
  const risk = classifyRisk(question);
  const isInServiceScope = isBlumRelated(question) || risk === "precision";
  if (!isInServiceScope && dependencies.providerConfig) {
    return {
      answer: outOfScopeAnswer(),
      confidence: "guided",
      followUps: roleFollowUps[request.role],
      mode: "guarded",
      sources: [],
    };
  }
  const matches = retrieveKnowledge(question);
  const sources = matches.map(({ source }) => toSourceReference(source));
  const confidence: ConfidenceLevel =
    risk === "precision" ? "needs-review" : "guided";

  if (risk === "precision") {
    return {
      answer: guardedAnswer(sources, request.role, question) + nonChineseHint(question),
      confidence,
      followUps: followUpsFor(request.role, risk),
      mode: "guarded",
      sources,
    };
  }

  if (!dependencies.providerConfig) {
    return {
      answer: demoAnswer(matches[0].source, risk) + nonChineseHint(question),
      confidence,
      followUps: followUpsFor(request.role, risk),
      mode: "demo",
      sources,
    };
  }

  const completion = dependencies.requestCompletion ?? requestChatCompletion;
  const answer = await completion({
    config: dependencies.providerConfig,
    systemPrompt: buildSystemPrompt({
      role: getRole(request.role),
      matches,
      risk,
    }),
    messages: request.messages,
    image: request.image,
  });

  const groundedAnswer = groundModelAnswer(
    answer,
    matches.map(({ source }) => source),
  );
  if (!groundedAnswer) {
    return {
      answer: groundedFallbackAnswer(sources, request.role) + nonChineseHint(question),
      confidence,
      followUps: followUpsFor(request.role, risk),
      mode: "guarded",
      sources,
    };
  }

  return {
    answer: groundedAnswer + nonChineseHint(question),
    confidence,
    followUps: followUpsFor(request.role, risk),
    mode: "live",
    sources,
  };
}
