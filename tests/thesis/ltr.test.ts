import { describe, test, expect } from "vitest";
import { trainLTR, ltrRanker } from "@/thesis/rerank/ltr";
import type { RankItem } from "@/thesis/types";

describe("trainLTR", () => {
  // Feature 0 is perfectly predictive: label 1 ⇔ feature0 high.
  const samples = [
    { features: [1, 0.1], label: 1 }, { features: [0.9, 0.5], label: 1 },
    { features: [0.95, 0.9], label: 1 }, { features: [0.0, 0.2], label: 0 },
    { features: [0.1, 0.8], label: 0 }, { features: [0.05, 0.4], label: 0 },
  ];

  test("deterministic by seed", () => {
    const a = trainLTR(samples, { epochs: 200, lr: 0.5, seed: 1 });
    const b = trainLTR(samples, { epochs: 200, lr: 0.5, seed: 1 });
    expect(a.weights).toEqual(b.weights);
  });

  test("learns a larger weight on the predictive feature 0 than feature 1", () => {
    const m = trainLTR(samples, { epochs: 500, lr: 0.5, seed: 2 });
    expect(Math.abs(m.weights[0])).toBeGreaterThan(Math.abs(m.weights[1]));
  });

  test("score ranks a high-feature0 item above a low-feature0 item", () => {
    const m = trainLTR(samples, { epochs: 500, lr: 0.5, seed: 3 });
    expect(m.score([1, 0.5])).toBeGreaterThan(m.score([0, 0.5]));
  });
});

describe("ltrRanker", () => {
  test("orders candidates by model score using their feature vectors", () => {
    const m = trainLTR(
      [{ features: [1], label: 1 }, { features: [0], label: 0 }],
      { epochs: 300, lr: 0.5, seed: 1 },
    );
    const featById = new Map<string, number[]>([["hi", [1]], ["lo", [0]]]);
    const r = ltrRanker(m, featById);
    const cands: RankItem[] = [
      { id: "lo", popularity: 0, vector: [] },
      { id: "hi", popularity: 0, vector: [] },
    ];
    expect(r.rank({ userVector: [], cohort: null }, cands)).toEqual(["hi", "lo"]);
  });
});
