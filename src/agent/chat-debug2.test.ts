import { describe, expect, it, vi } from "vitest";
import { retrieveKnowledge, classifyRisk, isBlumRelated } from "@/src/domain/retrieval";
import { getKnowledge } from "@/src/domain/knowledge-service";

describe("debug chat2", () => {
  it("checks retrieval directly", () => {
    const question = "MERIVOBOX 是什么产品？";
    const risk = classifyRisk(question);
    const inScope = isBlumRelated(question);
    const matches = retrieveKnowledge(question, 4);
    const snapshot = getKnowledge();
    
    console.log("risk:", risk);
    console.log("inScope:", inScope);
    console.log("matches:", matches.length);
    console.log("snapshot sources:", snapshot.officialSources.length);
    if (matches.length > 0) {
      console.log("first match:", matches[0]?.source?.id);
    }
    
    expect(matches.length).toBeGreaterThan(0);
  });
});
