import { describe, test, expect } from "vitest";
import { multiObjectiveRanker, type ScorerItem } from "@/thesis/objectives/scorer";
import type { RankItem } from "@/thesis/types";

describe("multiObjectiveRanker", () => {
  const items: ScorerItem[] = [
    { id: "A", vector: [1, 0], features: { relevance: 1.0, margin: 0.1, convProb: 0.9, novelty: 0.2, sellerFairness: 0.1, revenue: 0.3 } },
    { id: "B", vector: [0, 1], features: { relevance: 0.1, margin: 1.0, convProb: 0.2, novelty: 0.9, sellerFairness: 0.9, revenue: 0.2 } },
    { id: "C", vector: [0.7, 0.7], features: { relevance: 0.5, margin: 0.5, convProb: 0.5, novelty: 0.5, sellerFairness: 0.5, revenue: 0.9 } },
  ];
  const cands: RankItem[] = items.map((i) => ({ id: i.id, popularity: 0, vector: i.vector }));

  test("λ relevance-only ranks A first", () => {
    const r = multiObjectiveRanker({ relevance: 1, margin: 0, convProb: 0, novelty: 0, sellerFairness: 0, revenue: 0, diversity: 0 }, items);
    expect(r.rank({ userVector: [], cohort: null }, cands)[0]).toBe("A");
  });
  test("λ margin-only ranks B first", () => {
    const r = multiObjectiveRanker({ relevance: 0, margin: 1, convProb: 0, novelty: 0, sellerFairness: 0, revenue: 0, diversity: 0 }, items);
    expect(r.rank({ userVector: [], cohort: null }, cands)[0]).toBe("B");
  });
  test("λ revenue-only ranks the highest-revenue item first", () => {
    const r = multiObjectiveRanker({ relevance: 0, margin: 0, convProb: 0, novelty: 0, sellerFairness: 0, revenue: 1, diversity: 0 }, items);
    expect(r.rank({ userVector: [], cohort: null }, cands)[0]).toBe("C");
  });
  test("returns a full permutation of candidate ids", () => {
    const r = multiObjectiveRanker({ relevance: 1, margin: 1, convProb: 0, novelty: 0, sellerFairness: 0, revenue: 0, diversity: 0.5 }, items);
    expect([...r.rank({ userVector: [], cohort: null }, cands)].sort()).toEqual(["A", "B", "C"]);
  });
  test("diversity term avoids picking two near-identical vectors back to back", () => {
    const dup: ScorerItem[] = [
      { id: "A", vector: [1, 0], features: { relevance: 1.0, margin: 0, convProb: 0, novelty: 0, sellerFairness: 0, revenue: 0 } },
      { id: "A2", vector: [1, 0], features: { relevance: 0.99, margin: 0, convProb: 0, novelty: 0, sellerFairness: 0, revenue: 0 } },
      { id: "B", vector: [0, 1], features: { relevance: 0.9, margin: 0, convProb: 0, novelty: 0, sellerFairness: 0, revenue: 0 } },
    ];
    const dupCands: RankItem[] = dup.map((i) => ({ id: i.id, popularity: 0, vector: i.vector }));
    const r = multiObjectiveRanker({ relevance: 0.5, margin: 0, convProb: 0, novelty: 0, sellerFairness: 0, revenue: 0, diversity: 0.8 }, dup);
    const out = r.rank({ userVector: [], cohort: null }, dupCands);
    expect(out[0]).toBe("A");
    expect(out[1]).toBe("B");
  });
  test("deterministic", () => {
    const w = { relevance: 1, margin: 0.5, convProb: 0.2, novelty: 0.1, sellerFairness: 0.1, revenue: 0.2, diversity: 0.3 };
    const r = multiObjectiveRanker(w, items);
    expect(r.rank({ userVector: [], cohort: null }, cands)).toEqual(r.rank({ userVector: [], cohort: null }, cands));
  });
  test("does not mutate the input candidates array", () => {
    const w = { relevance: 1, margin: 0, convProb: 0, novelty: 0, sellerFairness: 0, revenue: 0, diversity: 0 };
    const before = cands.map((c) => c.id);
    multiObjectiveRanker(w, items).rank({ userVector: [], cohort: null }, cands);
    expect(cands.map((c) => c.id)).toEqual(before);
  });
});
