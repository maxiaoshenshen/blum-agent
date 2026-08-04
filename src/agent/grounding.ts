import type { OfficialSource } from "@/src/domain/types";

const measurementPattern =
  /[<>≤≥±]?\s*\d+(?:\.\d+)?\s*(?:mm|cm|kg|公斤|毫米|厘米|v|w|n)\b/gi;
const latinTermPattern = /[a-z][a-z0-9-]{2,}/gi;
const sectionPrefixPattern =
  /^(?:结论|判断依据|操作步骤|下一步|还需确认|待确认问题|建议核实方式|实际体验改善(?:（[^）]*）)?|摘录原文|补充说明)\s*[：:]\s*/;
const verificationGuidancePattern =
  /^(?:(?:如|若)?(?:需|需要|想)?了解(?:具体|完整)?(?:参数|详情|信息)?[，,、]?\s*)?(?:(?:请|建议|可|可以|应|需|需要)\s*)?(?:通过|使用|查阅|查看|查询|参考|核对|复核).*(?:官方|配置器|目录|资料|手册).*$|^(?:具体|完整).{0,20}(?:需|需要).*(?:官方|配置器|目录|资料|手册).*$|^请查看官方资料$|^建议用配置器核实$/u;
const professionalTermPattern = /(?:磁悬浮|气压|激光|液压|无线|智能|电动)[\p{Script=Han}]{0,4}(?:导轨|铰链|阻尼|弹簧|杯孔|安装板|连接件|锁定装置|抽屉系统|上翻门|电机)/gu;
const dependentClaimPattern = /^(?:因此|所以|故|由此|这意味着|从而|进而)[，,、]?/u;
const semanticSimilarityThreshold = 0.58;

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[®™]/g, "")
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/\s+/g, "");
}

function sourceTerms(
  sources: readonly Pick<OfficialSource, "title" | "summary" | "url">[],
): string[] {
  return sources
    .flatMap((source) => [source.title, ...source.title.match(/[A-Za-z][A-Za-z0-9-]{2,}/g) ?? []])
    .map(normalize)
    .filter((term) => term.length >= 3);
}

function hanBigrams(value: string): string[] {
  return [...value.matchAll(/[\p{Script=Han}]+/gu)].flatMap(([run]) => {
    if (run.length < 2) return [];
    return Array.from(
      { length: run.length - 1 },
      (_, index) => run.slice(index, index + 2),
    );
  });
}

function semanticSimilarity(claim: string, context: string): number {
  const bigrams = hanBigrams(normalize(claim));
  if (bigrams.length === 0) return 1;
  return bigrams.filter((bigram) => context.includes(bigram)).length / bigrams.length;
}

function hasUnsupportedProfessionalTerm(claim: string, context: string): boolean {
  return [...claim.matchAll(professionalTermPattern)].some(([term]) =>
    !context.includes(normalize(term)),
  );
}

function claimChunks(answer: string): string[] {
  return answer
    .replace(/```[\s\S]*?```/g, "")
    .split(/\n|(?<=[。；])/u)
    .filter((line) => !line.trim().startsWith(">"))
    .map((line) =>
      line
        .replace(/^\s*(?:[-*]|\d+[.)、]|[①-⑳])\s*/, "")
        .replace(/\*\*/g, "")
        .replace(sectionPrefixPattern, "")
        .trim(),
    )
    .filter(
      (line) =>
        line.length > 0 &&
        !/^-{3,}$/.test(line) &&
        !/[？?]\s*$/.test(line),
    );
}

function claimIsCovered(
  claim: string,
  context: string,
  terms: readonly string[],
): boolean {
  const normalizedClaim = normalize(claim);

  // A complete sentence from an official title or summary remains grounded even
  // if its punctuation/spacing differs from the stored source.
  if (context.includes(normalizedClaim)) return true;

  if (hasUnsupportedProfessionalTerm(claim, context)) return false;

  for (const measurement of claim.match(measurementPattern) ?? []) {
    if (!context.includes(normalize(measurement))) return false;
  }

  for (const term of claim.match(latinTermPattern) ?? []) {
    if (!context.includes(normalize(term))) return false;
  }

  if (verificationGuidancePattern.test(claim)) return true;

  // Very short, clearly product-labelled status answers do not carry enough
  // Han bigrams for a meaningful coverage ratio. They still need to name an
  // official product/brand term, so generic assertions are not exempt.
  if (normalizedClaim.length < 20 && terms.some((term) => normalizedClaim.includes(term))) {
    return true;
  }

  const bigrams = hanBigrams(normalizedClaim);
  if (bigrams.length === 0) {
    return (claim.match(latinTermPattern) ?? []).length > 0;
  }

  return semanticSimilarity(claim, context) >= semanticSimilarityThreshold;
}

export function isGroundedModelAnswer(
  answer: string,
  sources: readonly Pick<OfficialSource, "title" | "summary" | "url">[],
): boolean {
  if (sources.length === 0) return false;

  const context = normalize(
    sources
      .map((source) => `${source.title}\n${source.summary}\n${source.url}`)
      .join("\n"),
  );
  const claims = claimChunks(answer);
  const terms = sourceTerms(sources);
  return (
    claims.length > 0 &&
    claims.every((claim) => claimIsCovered(claim, context, terms))
  );
}

export function groundModelAnswer(
  answer: string,
  sources: readonly Pick<OfficialSource, "title" | "summary" | "url">[],
): string | undefined {
  if (sources.length === 0) return undefined;

  const context = normalize(
    sources
      .map((source) => `${source.title}\n${source.summary}\n${source.url}`)
      .join("\n"),
  );
  const claims = claimChunks(answer);
  const terms = sourceTerms(sources);
  if (claims.length === 0) return undefined;

  let hasUngroundedPremise = false;
  const groundedClaims = claims.filter((claim) => {
    const dependsOnUngroundedPremise =
      hasUngroundedPremise && dependentClaimPattern.test(claim);
    const isGrounded =
      !dependsOnUngroundedPremise && claimIsCovered(claim, context, terms);
    if (!isGrounded) hasUngroundedPremise = true;
    return isGrounded;
  });
  if (groundedClaims.length === 0) return undefined;

  if (groundedClaims.length === claims.length) return answer.trim();

  const uniqueClaims = groundedClaims.filter(
    (claim, index) =>
      groundedClaims.findIndex(
        (candidate) => normalize(candidate) === normalize(claim),
      ) === index,
  );
  const officialLead = sources[0]?.summary;
  if (!officialLead) return undefined;

  return `结论：
${officialLead}

核验后的补充：
${uniqueClaims.join("\n")}

说明：
已省略当前官方摘要无法直接支持的扩展内容。`;
}
