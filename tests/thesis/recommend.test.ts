import { describe, test, expect } from "vitest";
import { recommendProductionSpace, type SpaceScore } from "@/thesis/embedders/recommend";

describe("recommendProductionSpace", () => {
  const scores: SpaceScore[] = [
    { space: "e0_text", ndcg10: 0.30, complementRecall10: 0.10, servingCost: 1 },
    { space: "e1_prod2vec", ndcg10: 0.35, complementRecall10: 0.40, servingCost: 1 },
    { space: "e4_late", ndcg10: 0.42, complementRecall10: 0.45, servingCost: 5 },
    { space: "e5_context3", ndcg10: 0.40, complementRecall10: 0.30, servingCost: 2 },
  ];
  test("picks the best quality-per-cost when cost matters", () => {
    const rec = recommendProductionSpace(scores, { costWeight: 0.5 });
    expect(rec.winner).toBe("e1_prod2vec"); // strong quality at lowest cost
  });
  test("picks raw best quality when cost is ignored", () => {
    const rec = recommendProductionSpace(scores, { costWeight: 0 });
    expect(rec.winner).toBe("e4_late");
  });
  test("returns a ranked rationale list, winner first", () => {
    const rec = recommendProductionSpace(scores, { costWeight: 0.5 });
    expect(rec.ranked.length).toBe(4);
    expect(rec.ranked[0].space).toBe(rec.winner);
  });
});
