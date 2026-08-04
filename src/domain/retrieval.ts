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

const brandAliasPattern = /百龙|百龍|布鲁姆|布魯姆/gu;
const compactBrandAliasPattern = /(^|[^a-z0-9])bl(?=$|[^a-z0-9])/giu;

function normalizeQuestion(value: string): string {
  return normalize(value)
    .replace(brandAliasPattern, "百隆")
    .replace(compactBrandAliasPattern, "$1 blum");
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
    if (Math.abs(word.length - normalizedKeyword.length) > 1) return false;
    let changes = 0;
    for (let index = 0; index < Math.max(word.length, normalizedKeyword.length); index += 1) {
      if (word[index] !== normalizedKeyword[index]) changes += 1;
    }
    return changes <= 1;
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

  const matches = OFFICIAL_SOURCES.map((source) => {
    const matchedKeywords = source.keywords.filter((keyword) => {
      const normalizedKeyword = normalize(keyword);
      return normalizedQuestion.includes(normalizedKeyword) || fuzzyKeywordMatch(normalizedQuestion, keyword);
    });
    const score = matchedKeywords.reduce(
      (total, keyword) => total + scoreKeyword(keyword),
      0,
    ) + (category === categoryFor(source) ? 3 : 0) +
      (category !== undefined && isProductFamilySource(source, category) ? 6 : 0);

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
