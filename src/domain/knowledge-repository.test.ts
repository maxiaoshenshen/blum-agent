import { describe, expect, it } from "vitest";
import { knowledgeRepository } from "./knowledge-repository";

describe("static knowledge repository", () => {
  it("returns immutable official sources and resolves ids without a database query", () => {
    const sources = knowledgeRepository.getAll();
    const selected = knowledgeRepository.findByIds(["merivobox", "missing", "aventos-hf"]);

    expect(Object.isFrozen(sources)).toBe(true);
    expect(selected.map((source) => source.id)).toEqual(["merivobox", "aventos-hf"]);
  });
});
