/**
 * RAG retrieval engine for Blum knowledge.
 *
 * All static indexes (PreparedSources, SourcesById) are built lazily on first
 * knowledge access. This allows the knowledge base to be loaded at runtime from
 * public/data/knowledge.json without requiring a rebuild.
 */
import { getAllSources, getFallbackSources as getFallbackFromService } from "./knowledge-service";
import type { KnowledgeMatch, OfficialSource, RiskLevel } from "./types";

const precisionPatterns = [
  /精确|准确|最终/,
  /开孔|孔位|钻孔|加工尺寸|安装尺寸/,
  /料号|产品编号|订货号|兼容|替代/,
  /承重|负载|公斤|kg\b/i,
  /接线|电源|电气|电压/,
  /\bbom\b|下单|订购清单/i,
  /安全|防脱|防坠|儿童/,
];

// ─── Lazy static indexes ───────────────────────────────────────────────────────

interface PreparedSource {
  readonly source: OfficialSource;
  readonly index: number;
  readonly category: "drawer" | "hinge" | "lift" | "other";
  readonly normalizedKeywords: readonly { readonly raw: string; readonly normalized: string }[];
}

let _preparedSources: readonly PreparedSource[] | null = null;
let _sourcesById: Map<string, OfficialSource> | null = null;

function ensureIndexes(): void {
  if (_preparedSources !== null) return;
  const sources = getAllSources();
  _sourcesById = new Map(sources.map((s) => [s.id, s]));

  const prepared: PreparedSource[] = [];
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    prepared.push({
      source,
      index: i,
      category: categoryFor(source),
      normalizedKeywords: source.keywords.map((raw) => ({
        raw,
        normalized: normalize(raw),
      })),
    });
  }
  _preparedSources = Object.freeze(prepared);
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


function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[®™]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  return normalizeBrandTypo(
    normalize(value)
      .replace(brandAliasPattern, "百隆")
      .replace(compactBrandAliasPattern, "$1 blum"),
  );
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

type MatchStrength = 0 | 1 | 2 | 3 | 4;

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

function scoreKeyword(keyword: string): number {
  const compactLength = keyword.replace(/[\s-]/g, "").length;
  return Math.max(2, Math.min(12, compactLength));
}

function isContextualFollowUp(question: string): boolean {
  return /(?:这个|这款|它|上一款|该款|this|it|previous)/iu.test(question);
}

function semanticSimilarityScore(
  sourceCategory: ReturnType<typeof categoryFor>,
  requested: ReturnType<typeof categoryFor> | undefined,
): number {
  if (!requested || sourceCategory === requested || sourceCategory === "other") return 0;
  return 0.1;
}

function optimalF1Threshold(matches: readonly ScoredMatch[]): number {
  const scored = matches.filter((m) => m.score > 0);
  if (scored.length === 0) return Number.POSITIVE_INFINITY;
  const relevant = new Set(scored.map((m) => m.source.id));
  const thresholds = [...new Set(scored.map((m) => m.score))].sort((a, b) => a - b);
  let bestThreshold = thresholds[0];
  let bestF1 = -1;
  for (const threshold of thresholds) {
    const retrieved = scored.filter((m) => m.score >= threshold);
    const tp = retrieved.filter((m) => relevant.has(m.source.id)).length;
    const precision = retrieved.length === 0 ? 0 : tp / retrieved.length;
    const recall = relevant.size === 0 ? 0 : tp / relevant.size;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    if (f1 > bestF1) { bestF1 = f1; bestThreshold = threshold; }
  }
  return bestThreshold;
}

type ScoredMatch = KnowledgeMatch & { semanticScore: number };

// ─── Retrieval cache ───────────────────────────────────────────────────────────

const RETRIEVAL_CACHE_LIMIT = 100;
const retrievalCache = new Map<string, readonly KnowledgeMatch[]>();
let retrievalCacheHits = 0;
let retrievalCacheMisses = 0;

export interface RetrievalHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

function cacheKey(
  normalizedQuestion: string,
  safeLimit: number,
  history: readonly RetrievalHistoryMessage[],
): string {
  const brief = history
    .slice(-6)
    .map(({ content }) => normalizeQuestion(content).slice(0, 240))
    .join("\u0001");
  return `${safeLimit}\u0000${normalizedQuestion}\u0000${brief}`;
}

function productIdsMentionedInHistory(history: readonly RetrievalHistoryMessage[]): ReadonlySet<string> {
  const recentHistory = history
    .slice(-6)
    .map(({ content }) => normalizeQuestion(content))
    .join(" ");
  return new Set(
    (_preparedSources ?? [])
      .filter(({ source, category }) => isProductFamilySource(source, category))
      .filter(({ source }) => recentHistory.includes(normalize(source.id)))
      .map(({ source }) => source.id),
  );
}

function cacheResult(key: string, result: KnowledgeMatch[]): KnowledgeMatch[] {
  const immutable = Object.freeze(
    result.map((match) =>
      Object.freeze({ ...match, matchedKeywords: Object.freeze([...match.matchedKeywords]) }),
    ),
  ) as unknown as readonly KnowledgeMatch[];
  retrievalCache.set(key, immutable);
  if (retrievalCache.size > RETRIEVAL_CACHE_LIMIT) {
    const oldestKey = retrievalCache.keys().next().value;
    if (oldestKey) retrievalCache.delete(oldestKey);
  }
  return immutable as KnowledgeMatch[];
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function isBlumRelated(question: string): boolean {
  const normalizedQuestion = normalizeQuestion(question);
  if (/blum|百隆/u.test(normalizedQuestion)) return true;
  return getAllSources().some((source) =>
    source.keywords.some((keyword) => {
      const nk = normalize(keyword);
      return nk.length >= 3 && normalizedQuestion.includes(nk);
    }),
  );
}

export function getRetrievalCacheStats(): Readonly<{ size: number; hits: number; misses: number }> {
  return Object.freeze({ size: retrievalCache.size, hits: retrievalCacheHits, misses: retrievalCacheMisses });
}

export function resetRetrievalCache(): void {
  retrievalCache.clear();
  retrievalCacheHits = 0;
  retrievalCacheMisses = 0;
}

export function retrieveKnowledge(
  question: string,
  limit = 4,
  conversationHistory: readonly RetrievalHistoryMessage[] = [],
): KnowledgeMatch[] {
  ensureIndexes();
  const normalizedQuestion = normalizeQuestion(question);
  const category = requestedCategory(normalizedQuestion);
  const safeLimit = Math.max(1, Math.min(6, limit));
  const key = cacheKey(normalizedQuestion, safeLimit, conversationHistory);

  const cached = retrievalCache.get(key);
  if (cached) {
    retrievalCacheHits += 1;
    retrievalCache.delete(key);
    retrievalCache.set(key, cached);
    return cached as KnowledgeMatch[];
  }
  retrievalCacheMisses += 1;

  const historyProductIds = productIdsMentionedInHistory(conversationHistory);
  const followUp = isContextualFollowUp(normalizedQuestion);

  type RankedMatch = ScoredMatch & { index: number; matchStrength: MatchStrength; historyBoost: number };

  const matches: RankedMatch[] = (_preparedSources ?? []).map(({ source, index, category: sourceCategory, normalizedKeywords }) => {
    const keywordStrengths = normalizedKeywords.map(({ raw }) => ({
      raw,
      strength: keywordMatchStrength(normalizedQuestion, raw),
    }));
    const matchedKeywords = keywordStrengths.filter(({ strength }) => strength > 0).map(({ raw }) => raw);
    const matchStrength = keywordStrengths.reduce<MatchStrength>(
      (max, { strength }) => Math.max(max, strength) as MatchStrength, 0,
    );
    const historyBoost = followUp && historyProductIds.has(source.id) ? 100 : 0;
    const semanticScore = semanticSimilarityScore(sourceCategory, category);
    const score =
      matchedKeywords.reduce((total, kw) => total + scoreKeyword(kw), 0) +
      (category === sourceCategory ? 3 : 0) +
      (category !== undefined && isProductFamilySource(source, category) ? 6 : 0) +
      semanticScore;
    return { source, score, matchedKeywords, semanticScore, index, matchStrength, historyBoost };
  })
    .filter((m) => m.score > 0 || m.historyBoost > 0)
    .sort(
      (a, b) =>
        b.historyBoost - a.historyBoost ||
        b.matchStrength - a.matchStrength ||
        b.score - a.score ||
        a.index - b.index,
    );

  const threshold = optimalF1Threshold(matches);
  const selected = matches.filter((m) => m.score >= threshold);
  if (selected.length > 0) {
    return cacheResult(
      key,
      selected.slice(0, safeLimit).map(({ semanticScore: _, index: __, matchStrength: ___, historyBoost: ____, ...m }) => m),
    );
  }

  // Fallback: use knowledge-service fallback IDs
  const fbSources = getFallbackFromService();
  return cacheResult(
    key,
    fbSources.slice(0, Math.min(2, safeLimit)).map((source) => ({
      source,
      score: 0,
      matchedKeywords: [],
    })),
  );
}

export function classifyRisk(question: string): RiskLevel {
  const normalized = normalize(question);
  return precisionPatterns.some((p) => p.test(normalized)) ? "precision" : "standard";
}
