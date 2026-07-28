import type { OfficialSource } from "@/src/domain/types";

const measurementPattern =
  /[<>≤≥±]?\s*\d+(?:\.\d+)?\s*(?:mm|cm|kg|公斤|毫米|厘米|v|w|n)\b/gi;
const latinTermPattern = /[a-z][a-z0-9-]{2,}/gi;
const sectionPrefixPattern =
  /^(?:结论|判断依据|操作步骤|下一步|还需确认|待确认问题|建议核实方式|实际体验改善(?:（[^）]*）)?|摘录原文|补充说明)\s*[：:]\s*/;
const verificationGuidancePattern =
  /(?:需|需要|应|请|建议).*(?:官方|配置器|目录|资料|手册).*(?:确认|核实|复核|参考|查询)|(?:可以|建议|请|需|需要|应).*(?:查看|查阅|查询|参考|使用).*(?:官方|配置器|目录|资料|手册)|(?:具体|完整).*需要.*(?:官方|配置器|目录|资料|手册)/u;

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[®™]/g, "")
    .replace(/\s+/g, "");
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

function claimIsCovered(claim: string, context: string): boolean {
  const normalizedClaim = normalize(claim);

  for (const measurement of claim.match(measurementPattern) ?? []) {
    if (!context.includes(normalize(measurement))) return false;
  }

  for (const term of claim.match(latinTermPattern) ?? []) {
    if (!context.includes(normalize(term))) return false;
  }

  if (verificationGuidancePattern.test(claim)) return true;

  const bigrams = hanBigrams(normalizedClaim);
  if (bigrams.length === 0) {
    return (claim.match(latinTermPattern) ?? []).length > 0;
  }

  const covered = bigrams.filter((bigram) => context.includes(bigram)).length;
  return covered / bigrams.length >= 0.58;
}

export function isGroundedModelAnswer(
  answer: string,
  sources: readonly Pick<OfficialSource, "title" | "summary" | "url">[],
): boolean {
  const context = normalize(
    sources
      .map((source) => `${source.title}\n${source.summary}\n${source.url}`)
      .join("\n"),
  );
  const claims = claimChunks(answer);
  return (
    claims.length > 0 &&
    claims.every((claim) => claimIsCovered(claim, context))
  );
}

export function groundModelAnswer(
  answer: string,
  sources: readonly Pick<OfficialSource, "title" | "summary" | "url">[],
): string | undefined {
  const context = normalize(
    sources
      .map((source) => `${source.title}\n${source.summary}\n${source.url}`)
      .join("\n"),
  );
  const claims = claimChunks(answer);
  if (claims.length === 0) return undefined;

  const groundedClaims = claims.filter((claim) =>
    claimIsCovered(claim, context),
  );
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
