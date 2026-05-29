import { describe, test, expect } from "vitest";
import { aggregateCases } from "@/thesis/eval/aggregate";
import { cosineSingleVectorRanker } from "@/thesis/eval/baselines";
import type { EvalCase } from "@/thesis/eval/harness";
import type { RankItem } from "@/thesis/types";

describe("aggregateCases parity", () => {
  test("matches evaluateRanker semantics for a constant ranker", () => {
    const items: RankItem[] = [
      { id: "a", popularity: 1, vector: [1, 0] },
      { id: "b", popularity: 9, vector: [0, 1] },
      { id: "c", popularity: 1, vector: [0.8, 0.2] },
    ];
    const cases: EvalCase[] = [{ ctx: { userVector: [1, 0], cohort: null }, candidates: items, relevant: new Set(["c"]) }];
    const r = aggregateCases(cases, () => cosineSingleVectorRanker(), [3], "x");
    expect(r.recall[3]).toBeCloseTo(1, 9);
    expect(r.n).toBe(1);
    expect(r.ranker).toBe("x");
  });
  test("complement-recall averaged only over cases that define complements", () => {
    const items: RankItem[] = [
      { id: "a", popularity: 1, vector: [1, 0] },
      { id: "c", popularity: 1, vector: [0.9, 0.1] },
    ];
    const cases: EvalCase[] = [
      { ctx: { userVector: [1, 0], cohort: null }, candidates: items, relevant: new Set(["a"]), complements: new Set(["c"]) },
      { ctx: { userVector: [1, 0], cohort: null }, candidates: items, relevant: new Set(["a"]) },
    ];
    const r = aggregateCases(cases, () => cosineSingleVectorRanker(), [2], "y");
    expect(r.complementRecall[2]).toBeCloseTo(1, 9);
  });
});
