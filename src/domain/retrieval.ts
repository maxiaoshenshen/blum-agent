import { FALLBACK_SOURCE_IDS, OFFICIAL_SOURCES } from "./knowledge";
import type {
  KnowledgeMatch,
  OfficialSource,
  RiskLevel,
} from "./types";

const precisionPatterns = [
  /精确|准确|最终/,
  /开孔|孔位|钻孔|加工尺寸|安装尺寸/,
  /料号|产品编号|订货号|兼容|替代/,
  /承重|负载|公斤|kg\b/i,
  /接线|电源|电气|电压/,
  /\bbom\b|下单|订购清单/i,
  /安全|防脱|防坠|儿童/,
];

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[®™]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreKeyword(keyword: string): number {
  const compactLength = keyword.replace(/[\s-]/g, "").length;
  return Math.max(2, Math.min(12, compactLength));
}

export function getFallbackSources(): OfficialSource[] {
  return FALLBACK_SOURCE_IDS.map(
    (id) => OFFICIAL_SOURCES.find((source) => source.id === id)!,
  );
}

export function retrieveKnowledge(
  question: string,
  limit = 4,
): KnowledgeMatch[] {
  const normalizedQuestion = normalize(question);
  const safeLimit = Math.max(1, Math.min(6, limit));

  const matches = OFFICIAL_SOURCES.map((source) => {
    const matchedKeywords = source.keywords.filter((keyword) =>
      normalizedQuestion.includes(normalize(keyword)),
    );
    const score = matchedKeywords.reduce(
      (total, keyword) => total + scoreKeyword(keyword),
      0,
    );

    return { source, score, matchedKeywords };
  })
    .filter((match) => match.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        OFFICIAL_SOURCES.indexOf(left.source) -
          OFFICIAL_SOURCES.indexOf(right.source),
    );

  if (matches.length > 0) {
    return matches.slice(0, safeLimit);
  }

  return getFallbackSources()
    .slice(0, safeLimit)
    .map((source) => ({ source, score: 0, matchedKeywords: [] }));
}

export function classifyRisk(question: string): RiskLevel {
  const normalizedQuestion = normalize(question);
  return precisionPatterns.some((pattern) => pattern.test(normalizedQuestion))
    ? "precision"
    : "standard";
}
