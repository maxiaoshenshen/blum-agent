import type { OfficialSource } from "@/src/domain/types";

const measurementPattern =
  /[<>≤≥±]?\s*\d+(?:\.\d+)?\s*(?:mm|cm|kg|公斤|毫米|厘米|v|w|n)\b/gi;
const latinTermPattern = /[a-z][a-z0-9-]{2,}/gi;
const headingPattern =
  /^(?:结论|判断依据|操作步骤|下一步|还需确认|待确认问题|建议核实方式)\s*[：:]?\s*$/;

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
    .map((line) =>
      line
        .replace(/^\s*(?:[-*]|\d+[.)、]|[①-⑳])\s*/, "")
        .replace(/\*\*/g, "")
        .trim(),
    )
    .filter(
      (line) =>
        line.length > 0 &&
        !headingPattern.test(line) &&
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
