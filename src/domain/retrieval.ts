import { FALLBACK_SOURCE_IDS } from "./knowledge";
import { knowledgeRepository } from "./knowledge-repository";
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

const KNOWLEDGE_SOURCES = knowledgeRepository.getAll();

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[®™]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const brandAliasPattern = /百龙|百龍|白龙|白龍|白隆|布鲁姆|布魯姆/gu;
const compactBrandAliasPattern = /(^|[^a-z0-9])bl(?=$|[^a-z0-9])/giu;

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function normalizeBrandTypo(value: string): string {
  return value.replace(/[a-z]{3,8}/giu, (token) => {
    const normalizedToken = token.toLowerCase();
    return normalizedToken.startsWith("b") && normalizedToken.includes("l") &&
      levenshteinDistance(normalizedToken, "blum") <= 2
      ? "blum"
      : token;
  });
}

function normalizeQuestion(value: string): string {
  return normalizeBrandTypo(normalize(value)
    .replace(brandAliasPattern, "百隆")
    .replace(compactBrandAliasPattern, "$1 blum"));
}

function categoryFor(source: OfficialSource): "drawer" | "hinge" | "lift" | "other" {
  const haystack = `${source.id} ${source.title} ${source.keywords.join(" ")}`.toLowerCase();
  if (/merivobox|legrabox|tandembox|movento|tandem|抽屉|导轨|drawer|runner/.test(haystack)) return "drawer";
  if (/hinge|铰链|合页|clip top|modul/.test(haystack)) return "hinge";
  if (/aventos|上翻|翻门|lift/.test(haystack)) return "lift";
  return "other";
}

function requestedCategory(question: string): ReturnType<typeof categoryFor> | undefined {
  if (/抽屉|导轨|drawer|runner/iu.test(question)) return "drawer";
  if (/铰链|合页|hinge|clip top|modul/iu.test(question)) return "hinge";
  if (/上翻|翻门|aventos|lift/iu.test(question)) return "lift";
  return undefined;
}

function isProductFamilySource(source: OfficialSource, category: ReturnType<typeof categoryFor>): boolean {
  const id = source.id;
  return (
    (category === "drawer" && /^(?:merivobox|legrabox|tandembox|movento|tandem)$/.test(id)) ||
    (category === "hinge" && /^(?:cliptop|modul)/.test(id)) ||
    (category === "lift" && /^aventos-/.test(id))
  );
}

function fuzzyKeywordMatch(question: string, keyword: string): boolean {
  const normalizedKeyword = normalize(keyword);
  if (normalizedKeyword.length < 4 || /[\p{Script=Han}]/u.test(normalizedKeyword)) return false;
  const words = question.split(/[^a-z0-9-]+/u).filter(Boolean);
  return words.some((word) => {
    if (Math.abs(word.length - normalizedKeyword.length) > 2) return false;
    return levenshteinDistance(word, normalizedKeyword) <= 2;
  });
}

function keywordMatchStrength(question: string, keyword: string): MatchStrength {
  const normalizedKeyword = normalize(keyword);
  if (!normalizedKeyword) return 0;
  if (question.includes(normalizedKeyword)) return 4;

  const words = question.split(/[^a-z0-9-]+/u).filter(Boolean);
  if (normalizedKeyword.length >= 3 && words.some((word) => word.startsWith(normalizedKeyword) || normalizedKeyword.startsWith(word))) return 3;
  if (normalizedKeyword.length >= 4 && question.includes(normalizedKeyword.slice(0, -1))) return 2;
  return fuzzyKeywordMatch(question, keyword) ? 1 : 0;
}

function isContextualFollowUp(question: string): boolean {
  return /(?:这个|这款|它|上一款|该款|this|it|previous)/iu.test(question);
}

export function isBlumRelated(question: string): boolean {
  const normalizedQuestion = normalizeQuestion(question);
  if (/blum|百隆/u.test(normalizedQuestion)) return true;
  return KNOWLEDGE_SOURCES.some((source) =>
    source.keywords.some((keyword) => {
      const normalizedKeyword = normalize(keyword);
      return normalizedKeyword.length >= 3 && normalizedQuestion.includes(normalizedKeyword);
    }),
  );
}

function scoreKeyword(keyword: string): number {
  const compactLength = keyword.replace(/[\s-]/g, "").length;
  return Math.max(2, Math.min(12, compactLength));
}

type ScoredMatch = KnowledgeMatch & { semanticScore: number };
type MatchStrength = 0 | 1 | 2 | 3 | 4;
type RankedMatch = ScoredMatch & {
  index: number;
  matchStrength: MatchStrength;
  historyBoost: number;
};

export interface RetrievalHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

function semanticSimilarityScore(
  sourceCategory: ReturnType<typeof categoryFor>,
  requested: ReturnType<typeof categoryFor> | undefined,
): number {
  if (!requested || sourceCategory === requested || sourceCategory === "other") {
    return 0;
  }
  // 同属柜体功能五金的交叉提示：只作召回兜底，绝不覆盖直接关键词匹配。
  return 0.1;
}

function optimalF1Threshold(matches: readonly ScoredMatch[]): number {
  const scored = matches.filter((match) => match.score > 0);
  if (scored.length === 0) return Number.POSITIVE_INFINITY;

  // 直接命中与由产品类别推断出的交叉五金条目都标为可召回候选，
  // 在各个候选阈值上计算 precision / recall，并以 F1 选取最保守的同分阈值。
  // 已获得正分的条目都属于候选相关集：关键词、类别和跨类别五金关系
  // 分别代表直接、同类和召回兜底三种证据。
  const relevant = new Set(scored.map((match) => match.source.id));
  const thresholds = [...new Set(scored.map((match) => match.score))].sort((left, right) => left - right);
  let bestThreshold = thresholds[0];
  let bestF1 = -1;

  for (const threshold of thresholds) {
    const retrieved = scored.filter((match) => match.score >= threshold);
    const truePositives = retrieved.filter((match) => relevant.has(match.source.id)).length;
    const precision = retrieved.length === 0 ? 0 : truePositives / retrieved.length;
    const recall = relevant.size === 0 ? 0 : truePositives / relevant.size;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    if (f1 > bestF1) {
      bestF1 = f1;
      bestThreshold = threshold;
    }
  }
  return bestThreshold;
}

interface PreparedSource {
  readonly source: OfficialSource;
  readonly index: number;
  readonly category: ReturnType<typeof categoryFor>;
  readonly normalizedKeywords: readonly { readonly raw: string; readonly normalized: string }[];
}

// 将不随用户问题变化的标准化、分类和索引工作移至模块初始化。
// Worker 的同一 isolate 后续请求可直接复用此不可变索引。
const PREPARED_SOURCES: readonly PreparedSource[] = Object.freeze(
  KNOWLEDGE_SOURCES.map((source, index) => Object.freeze({
    source,
    index,
    category: categoryFor(source),
    normalizedKeywords: Object.freeze(source.keywords.map((raw) => Object.freeze({ raw, normalized: normalize(raw) }))),
  })),
);

const SOURCES_BY_ID = new Map(KNOWLEDGE_SOURCES.map((source) => [source.id, source]));
const RETRIEVAL_CACHE_LIMIT = 100;
const retrievalCache = new Map<string, readonly KnowledgeMatch[]>();
let retrievalCacheHits = 0;
let retrievalCacheMisses = 0;

function cacheKey(
  normalizedQuestion: string,
  safeLimit: number,
  history: readonly RetrievalHistoryMessage[],
): string {
  const brief = history.slice(-6).map(({ content }) => normalizeQuestion(content).slice(0, 240)).join("\u0001");
  return `${safeLimit}\u0000${normalizedQuestion}\u0000${brief}`;
}

function productIdsMentionedInHistory(history: readonly RetrievalHistoryMessage[]): ReadonlySet<string> {
  const recentHistory = history.slice(-6).map(({ content }) => normalizeQuestion(content)).join(" ");
  return new Set(PREPARED_SOURCES
    .filter(({ source, category }) => isProductFamilySource(source, category))
    .filter(({ source }) => recentHistory.includes(normalize(source.id)))
    .map(({ source }) => source.id));
}

function cacheResult(key: string, result: KnowledgeMatch[]): KnowledgeMatch[] {
  const immutableResult = Object.freeze(result.map((match) => Object.freeze({
    ...match,
    matchedKeywords: Object.freeze([...match.matchedKeywords]),
  }))) as unknown as readonly KnowledgeMatch[];
  retrievalCache.set(key, immutableResult);
  if (retrievalCache.size > RETRIEVAL_CACHE_LIMIT) {
    const oldestKey = retrievalCache.keys().next().value;
    if (oldestKey) retrievalCache.delete(oldestKey);
  }
  return immutableResult as KnowledgeMatch[];
}

/** 供健康检查和自动化测试读取；不记录用户问题内容。 */
export function getRetrievalCacheStats(): Readonly<{ size: number; hits: number; misses: number }> {
  return Object.freeze({ size: retrievalCache.size, hits: retrievalCacheHits, misses: retrievalCacheMisses });
}

/** 清空进程内 LRU 缓存，主要用于测试与受控运维。 */
export function resetRetrievalCache(): void {
  retrievalCache.clear();
  retrievalCacheHits = 0;
  retrievalCacheMisses = 0;
}

export function getFallbackSources(): OfficialSource[] {
  return FALLBACK_SOURCE_IDS.map(
    (id) => SOURCES_BY_ID.get(id)!,
  );
}

export function retrieveKnowledge(
  question: string,
  limit = 4,
  conversationHistory: readonly RetrievalHistoryMessage[] = [],
): KnowledgeMatch[] {
  const normalizedQuestion = normalizeQuestion(question);
  const category = requestedCategory(normalizedQuestion);
  const safeLimit = Math.max(1, Math.min(6, limit));
  const key = cacheKey(normalizedQuestion, safeLimit, conversationHistory);
  const cached = retrievalCache.get(key);
  if (cached) {
    retrievalCacheHits += 1;
    // Map 的删除再插入维持最少使用项位于开头。
    retrievalCache.delete(key);
    retrievalCache.set(key, cached);
    return cached as KnowledgeMatch[];
  }
  retrievalCacheMisses += 1;

  const historyProductIds = productIdsMentionedInHistory(conversationHistory);
  const followUp = isContextualFollowUp(normalizedQuestion);
  const matches: RankedMatch[] = PREPARED_SOURCES.map(({ source, index, category: sourceCategory, normalizedKeywords }) => {
    const keywordStrengths = normalizedKeywords.map(({ raw }) => ({ raw, strength: keywordMatchStrength(normalizedQuestion, raw) }));
    const matchedKeywords = keywordStrengths.filter(({ strength }) => strength > 0).map(({ raw }) => raw);
    const matchStrength = keywordStrengths.reduce<MatchStrength>((strongest, { strength }) => Math.max(strongest, strength) as MatchStrength, 0);
    const historyBoost = followUp && historyProductIds.has(source.id) ? 100 : 0;
    const semanticScore = semanticSimilarityScore(sourceCategory, category);
    const score = matchedKeywords.reduce(
      (total, keyword) => total + scoreKeyword(keyword),
      0,
    ) + (category === sourceCategory ? 3 : 0) +
      (category !== undefined && isProductFamilySource(source, category) ? 6 : 0) +
      semanticScore;

    return { source, score, matchedKeywords, semanticScore, index, matchStrength, historyBoost };
  })
    .filter((match) => match.score > 0 || match.historyBoost > 0)
    .sort(
      (left, right) =>
        right.historyBoost - left.historyBoost ||
        right.matchStrength - left.matchStrength ||
        right.score - left.score ||
        left.index - right.index,
    );

  const threshold = optimalF1Threshold(matches);
  const selected = matches.filter((match) => match.score >= threshold);
  if (selected.length > 0) {
    return cacheResult(key, selected.slice(0, safeLimit).map(({
      semanticScore: _semanticScore,
      index: _index,
      matchStrength: _matchStrength,
      historyBoost: _historyBoost,
      ...match
    }) => match));
  }

  return cacheResult(key, getFallbackSources()
    .slice(0, Math.min(2, safeLimit))
    .map((source) => ({ source, score: 0, matchedKeywords: [] })));
}

export function classifyRisk(question: string): RiskLevel {
  const normalizedQuestion = normalize(question);
  return precisionPatterns.some((pattern) => pattern.test(normalizedQuestion))
    ? "precision"
    : "standard";
}
