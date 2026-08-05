import { describe, expect, it } from "vitest";
import { retrieveKnowledge } from "./domain/retrieval";
import { getKnowledge } from "./domain/knowledge-service";

describe("debug knowledge", () => {
  it("has knowledge loaded", () => {
    const snapshot = getKnowledge();
    console.log("snapshot version:", snapshot.version);
    console.log("sources count:", snapshot.officialSources.length);
    expect(snapshot.officialSources.length).toBeGreaterThan(0);
  });

  it("retrieves merivobox", () => {
    const results = retrieveKnowledge("MERIVOBOX 是什么产品？", 4);
    console.log("results length:", results.length);
    if (results.length > 0) {
      console.log("first id:", results[0].source.id);
    }
    expect(results.length).toBeGreaterThan(0);
  });
});
