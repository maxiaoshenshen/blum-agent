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

export function isBlumRelated(question: string): boolean {
  const normalizedQuestion = normalizeQuestion(question);
  if (/blum|百隆/u.test(normalizedQuestion)) return true;
  return OFFICIAL_SOURCES.some((source) =>
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

function semanticSimilarityScore(
  source: OfficialSource,
  requested: ReturnType<typeof categoryFor> | undefined,
): number {
  if (!requested || categoryFor(source) === requested || categoryFor(source) === "other") {
    return 0;
  }
  // 同属柜体功能五金的交叉提示：只作召回兜底，绝不覆盖直接关键词匹配。
  return 0.1;
}

function optimalF1Threshold(matches: ScoredMatch[]): number {
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

export function getFallbackSources(): OfficialSource[] {
  return FALLBACK_SOURCE_IDS.map(
    (id) => OFFICIAL_SOURCES.find((source) => source.id === id)!,
  );
}

export function retrieveKnowledge(
  question: string,
  limit = 4,
): KnowledgeMatch[] {
  const normalizedQuestion = normalizeQuestion(question);
  const category = requestedCategory(normalizedQuestion);
  const safeLimit = Math.max(1, Math.min(6, limit));

  const matches: ScoredMatch[] = OFFICIAL_SOURCES.map((source) => {
    const matchedKeywords = source.keywords.filter((keyword) => {
      const normalizedKeyword = normalize(keyword);
      return normalizedQuestion.includes(normalizedKeyword) || fuzzyKeywordMatch(normalizedQuestion, keyword);
    });
    const semanticScore = semanticSimilarityScore(source, category);
    const score = matchedKeywords.reduce(
      (total, keyword) => total + scoreKeyword(keyword),
      0,
    ) + (category === categoryFor(source) ? 3 : 0) +
      (category !== undefined && isProductFamilySource(source, category) ? 6 : 0) +
      semanticScore;

    return { source, score, matchedKeywords, semanticScore };
  })
    .filter((match) => match.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        OFFICIAL_SOURCES.indexOf(left.source) -
          OFFICIAL_SOURCES.indexOf(right.source),
    );

  const threshold = optimalF1Threshold(matches);
  const selected = matches.filter((match) => match.score >= threshold);
  if (selected.length > 0) {
    return selected.slice(0, safeLimit).map(({ semanticScore: _semanticScore, ...match }) => match);
  }

  return getFallbackSources()
    .slice(0, Math.min(2, safeLimit))
    .map((source) => ({ source, score: 0, matchedKeywords: [] }));
}

export function classifyRisk(question: string): RiskLevel {
  const normalizedQuestion = normalize(question);
  return precisionPatterns.some((pattern) => pattern.test(normalizedQuestion))
    ? "precision"
    : "standard";
}
