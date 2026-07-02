import { describe, test, expect } from "vitest";
import { recallAtK, ndcgAtK, mrr, mapAtK, hitRateAtK, complementRecallAtK, intraListDiversity, novelty } from "@/thesis/eval/metrics";

describe("metrics (known-answer)", () => {
  test("recall@3 = 1 when the single target is in top-3", () => {
    expect(recallAtK(["a", "b", "c", "d"], new Set(["c"]), 3)).toBe(1);
  });
  test("recall@2 = 0 when target is below k", () => {
    expect(recallAtK(["a", "b", "c"], new Set(["c"]), 2)).toBe(0);
  });
  test("recall with 2 relevant, 1 found in top-2 = 0.5", () => {
    expect(recallAtK(["a", "x", "b"], new Set(["a", "b"]), 2)).toBe(0.5);
  });
  test("recall with empty relevant set = 0", () => {
    expect(recallAtK(["a"], new Set<string>(), 3)).toBe(0);
  });
  test("ndcg@1: hit at rank 1 = 1", () => {
    expect(ndcgAtK(["a", "b"], new Set(["a"]), 1)).toBeCloseTo(1, 9);
  });
  test("ndcg@3: single hit at rank 3 = 1/log2(4)", () => {
    expect(ndcgAtK(["x", "y", "a"], new Set(["a"]), 3)).toBeCloseTo(1 / Math.log2(4), 9);
  });
  test("ndcg with no hit = 0", () => {
    expect(ndcgAtK(["x", "y"], new Set(["a"]), 2)).toBe(0);
  });
  test("mrr: first hit at rank 2 = 0.5", () => {
    expect(mrr(["x", "a", "b"], new Set(["a"]))).toBe(0.5);
  });
  test("mrr: no hit = 0", () => {
    expect(mrr(["x", "y"], new Set(["a"]))).toBe(0);
  });
  test("mapAtK: hits at ranks 1 and 3 of 2 relevant = (1/1 + 2/3)/2", () => {
    expect(mapAtK(["a", "x", "b"], new Set(["a", "b"]), 3)).toBeCloseTo((1 + 2 / 3) / 2, 9);
  });
  test("hitRate@2 = 1 if any relevant in top-2", () => {
    expect(hitRateAtK(["x", "a", "b"], new Set(["a"]), 2)).toBe(1);
  });
  test("hitRate@2 = 0 if no relevant in top-2", () => {
    expect(hitRateAtK(["x", "y", "a"], new Set(["a"]), 2)).toBe(0);
  });
  test("complementRecall@2: 1 of 2 complements present = 0.5", () => {
    expect(complementRecallAtK(["c1", "z"], new Set(["c1", "c2"]), 2)).toBe(0.5);
  });
  test("intraListDiversity: two orthogonal unit vectors = 1", () => {
    expect(intraListDiversity([[1, 0], [0, 1]])).toBeCloseTo(1, 9);
  });
  test("intraListDiversity: identical vectors = 0", () => {
    expect(intraListDiversity([[1, 0], [1, 0]])).toBeCloseTo(0, 9);
  });
  test("intraListDiversity: fewer than 2 vectors = 0", () => {
    expect(intraListDiversity([[1, 0]])).toBe(0);
  });
  test("novelty: rarer items score higher than popular ones", () => {
    const pop = new Map([["rare", 0.01], ["common", 0.5]]);
    expect(novelty(["rare"], pop, 1)).toBeGreaterThan(novelty(["common"], pop, 1));
  });
});
