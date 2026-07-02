import { describe, test, expect } from "vitest";
import { randomRanker, popularGlobalRanker, popularCohortRanker, cosineSingleVectorRanker } from "@/thesis/eval/baselines";
import type { RankItem, UserContext } from "@/thesis/types";

describe("baseline rankers", () => {
  const items: RankItem[] = [
    { id: "a", popularity: 5, vector: [1, 0], cohort: "x" },
    { id: "b", popularity: 9, vector: [0, 1], cohort: "y" },
    { id: "c", popularity: 1, vector: [0.9, 0.1], cohort: "x" },
  ];

  test("popular-global ranks by descending popularity", () => {
    const ctx: UserContext = { userVector: [1, 0], cohort: null };
    expect(popularGlobalRanker().rank(ctx, items)).toEqual(["b", "a", "c"]);
  });

  test("cosine-single-vector ranks by similarity to the user vector", () => {
    const ctx: UserContext = { userVector: [1, 0], cohort: null };
    // a (1,0) sim 1.0; c (0.9,0.1) sim ~0.994; b (0,1) sim 0
    expect(cosineSingleVectorRanker().rank(ctx, items)).toEqual(["a", "c", "b"]);
  });

  test("popular-cohort puts in-cohort items first, each block by popularity", () => {
    const ctx: UserContext = { userVector: [0, 0], cohort: "x" };
    // in-cohort {a(5), c(1)} by pop → a, c ; then out {b(9)} → b
    expect(popularCohortRanker().rank(ctx, items)).toEqual(["a", "c", "b"]);
  });

  test("popular-cohort with null cohort degrades to global popularity order", () => {
    const ctx: UserContext = { userVector: [0, 0], cohort: null };
    expect(popularCohortRanker().rank(ctx, items)).toEqual(["b", "a", "c"]);
  });

  test("random ranker is a deterministic permutation for a fixed seed", () => {
    const ctx: UserContext = { userVector: [0, 0], cohort: null };
    const r = randomRanker(123);
    const out1 = r.rank(ctx, items);
    const out2 = randomRanker(123).rank(ctx, items);
    expect(out1).toEqual(out2);
    expect([...out1].sort()).toEqual(["a", "b", "c"]);
  });

  test("every ranker returns each candidate id exactly once", () => {
    const ctx: UserContext = { userVector: [1, 0], cohort: "x" };
    for (const rk of [randomRanker(1), popularGlobalRanker(), popularCohortRanker(), cosineSingleVectorRanker()]) {
      const out = rk.rank(ctx, items);
      expect([...out].sort()).toEqual(["a", "b", "c"]);
    }
  });
});
