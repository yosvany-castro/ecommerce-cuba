import { describe, test, expect } from "vitest";
import { evaluateRanker, type EvalCase } from "@/thesis/eval/harness";
import { cosineSingleVectorRanker, popularGlobalRanker } from "@/thesis/eval/baselines";
import type { RankItem } from "@/thesis/types";

describe("evaluateRanker", () => {
  const items: RankItem[] = [
    { id: "a", popularity: 1, vector: [1, 0] },
    { id: "b", popularity: 9, vector: [0, 1] },
    { id: "c", popularity: 1, vector: [0.8, 0.2] },
  ];
  // user likes direction (1,0); the held-out target is "c"
  const cases: EvalCase[] = [
    { ctx: { userVector: [1, 0], cohort: null }, candidates: items, relevant: new Set(["c"]) },
  ];

  test("cosine ranker beats popular ranker on nDCG@3 for this aligned case", () => {
    const cos = evaluateRanker(cosineSingleVectorRanker(), cases, [3]);
    const pop = evaluateRanker(popularGlobalRanker(), cases, [3]);
    expect(cos.ndcg[3]).toBeGreaterThan(pop.ndcg[3]);
  });

  test("returns averaged metrics at each requested k plus mrr", () => {
    const r = evaluateRanker(cosineSingleVectorRanker(), cases, [1, 3]);
    expect(typeof r.recall[1]).toBe("number");
    expect(typeof r.recall[3]).toBe("number");
    expect(typeof r.ndcg[3]).toBe("number");
    expect(typeof r.map[3]).toBe("number");
    expect(typeof r.hit[3]).toBe("number");
    expect(typeof r.mrr).toBe("number");
    expect(r.n).toBe(1);
    expect(r.ranker).toBe("cosine-single-vector");
  });

  test("averages across multiple cases", () => {
    const two: EvalCase[] = [
      { ctx: { userVector: [1, 0], cohort: null }, candidates: items, relevant: new Set(["a"]) },
      { ctx: { userVector: [0, 1], cohort: null }, candidates: items, relevant: new Set(["b"]) },
    ];
    const r = evaluateRanker(cosineSingleVectorRanker(), two, [1]);
    // both targets are the top cosine hit → recall@1 = 1 for both → average 1
    expect(r.recall[1]).toBeCloseTo(1, 9);
    expect(r.n).toBe(2);
  });

  test("complement-recall is averaged only over cases that define complements", () => {
    const withComp: EvalCase[] = [
      { ctx: { userVector: [1, 0], cohort: null }, candidates: items, relevant: new Set(["a"]), complements: new Set(["c"]) },
      { ctx: { userVector: [1, 0], cohort: null }, candidates: items, relevant: new Set(["a"]) },
    ];
    const r = evaluateRanker(cosineSingleVectorRanker(), withComp, [3]);
    // only the first case has complements; c is in top-3 → complementRecall@3 = 1
    expect(r.complementRecall[3]).toBeCloseTo(1, 9);
  });

  test("empty cases → zeroed metrics, n=0", () => {
    const r = evaluateRanker(popularGlobalRanker(), [], [5]);
    expect(r.n).toBe(0);
    expect(r.recall[5]).toBe(0);
    expect(r.mrr).toBe(0);
  });
});
