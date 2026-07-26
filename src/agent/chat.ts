import { retrieveKnowledge, classifyRisk } from "@/src/domain/retrieval";
import { getRole } from "@/src/domain/roles";
import type {
  ConfidenceLevel,
  OfficialSource,
  RiskLevel,
} from "@/src/domain/types";
import { buildSystemPrompt } from "./prompt";
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
  mode: "live" | "demo";
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

function followUpsFor(risk: RiskLevel): string[] {
  return risk === "precision"
    ? [
        "补充完整产品编号与所在市场",
        "提供柜体、面板和应用场景参数",
        "用官方配置器或当前订购手册做最终复核",
      ]
    : ["告诉我你的应用场景和目标体验", "提供现有产品型号或现场照片"];
}

function demoAnswer(source: OfficialSource, risk: RiskLevel): string {
  const reviewNotice =
    risk === "precision"
      ? "\n\n这个问题涉及精确选型或安全信息。请补充完整参数，并在下单或加工前用官方配置器复核。"
      : "";

  return `当前为演示模式，先根据 Blum 官方资料给你一个可靠入口：\n\n${source.summary}${reviewNotice}`;
}

export function providerConfigFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
): ProviderConfig | undefined {
  const apiKey = environment.PROVIDER_API_KEY?.trim();
  const baseUrl = environment.PROVIDER_BASE_URL?.trim();
  const model = environment.PROVIDER_MODEL?.trim();
  if (!apiKey || !baseUrl || !model) return undefined;
  return { apiKey, baseUrl, model };
}

export async function answerChat(
  request: ParsedChatRequest,
  dependencies: ChatDependencies,
): Promise<ChatAnswer> {
  const question = [...request.messages]
    .reverse()
    .find((message) => message.role === "user")!.content;
  const matches = retrieveKnowledge(question);
  const risk = classifyRisk(question);
  const sources = matches.map(({ source }) => toSourceReference(source));
  const confidence: ConfidenceLevel =
    risk === "precision" ? "needs-review" : "guided";

  if (!dependencies.providerConfig) {
    return {
      answer: demoAnswer(matches[0].source, risk),
      confidence,
      followUps: followUpsFor(risk),
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

  return {
    answer,
    confidence,
    followUps: followUpsFor(risk),
    mode: "live",
    sources,
  };
}
