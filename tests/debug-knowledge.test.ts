import { describe, expect, it } from "vitest";
import { retrieveKnowledge } from "../src/domain/retrieval";
import { getKnowledge } from "../src/domain/knowledge-service";

describe("debug knowledge", () => {
  it("has knowledge loaded", () => {
    const snapshot = getKnowledge();
    console.log("snapshot version:", snapshot.version);
    console.log("sources count:", snapshot.officialSources.length);
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
