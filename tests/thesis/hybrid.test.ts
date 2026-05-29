import { describe, test, expect } from "vitest";
import { hybridVector, hybridAlpha, hybridScoreFusionRanker } from "@/thesis/embedders/hybrid";
import type { RankItem } from "@/thesis/types";

describe("hybrid gate", () => {
  test("cold-start (0 interactions) → alpha≈1 → text dominates", () => {
    expect(hybridAlpha(0, 10)).toBeCloseTo(1, 9);
  });
  test("alpha decreases as interactions grow", () => {
    expect(hybridAlpha(50, 10)).toBeLessThan(hybridAlpha(5, 10));
  });
  test("with no behavioral vector, returns the (normalized) text vector", () => {
    const v = hybridVector([1, 0], null, 5, 10);
    expect(v).toEqual([1, 0]);
  });
  test("blends and re-normalizes to unit length", () => {
    const v = hybridVector([1, 0], [0, 1], 10, 10); // alpha = 10/20 = 0.5
    expect(Math.hypot(v[0], v[1])).toBeCloseTo(1, 9);
    expect(v[0]).toBeCloseTo(v[1], 9); // equal blend → 45°
  });
});

describe("hybridScoreFusionRanker", () => {
  const cands: RankItem[] = [
    { id: "a", popularity: 0, vector: [] },
    { id: "b", popularity: 0, vector: [] },
    { id: "c", popularity: 0, vector: [] },
  ];
  test("never mixes dimensions: text 3-d and behaviour 2-d coexist; pop0 → text wins", () => {
    const r = hybridScoreFusionRanker({
      textUser: [1, 0, 0], behavUser: [1, 0],
      textItem: new Map([["a", [1, 0, 0]], ["b", [0, 1, 0]], ["c", [0, 0, 1]]]),
      behavItem: new Map([["a", [1, 0]], ["b", [1, 0]], ["c", [0, 1]]]),
      popOf: () => 0, kappa: 5,
    });
    expect(r.rank({ userVector: [], cohort: null }, cands)[0]).toBe("a");
  });
  test("high popularity shifts weight to behaviour", () => {
    const r = hybridScoreFusionRanker({
      textUser: [1, 0, 0], behavUser: [0, 1],
      textItem: new Map([["a", [1, 0, 0]], ["b", [0, 1, 0]], ["c", [0, 0, 1]]]),
      behavItem: new Map([["a", [1, 0]], ["b", [0, 1]], ["c", [1, 0]]]),
      popOf: () => 1000, kappa: 5,
    });
    expect(r.rank({ userVector: [], cohort: null }, cands)[0]).toBe("b");
  });
  test("candidate lacking a behavioral vector falls back to text cosine (no NaN)", () => {
    const r = hybridScoreFusionRanker({
      textUser: [1, 0, 0], behavUser: [1, 0],
      textItem: new Map([["a", [1, 0, 0]], ["b", [0, 1, 0]]]),
      behavItem: new Map([["b", [1, 0]]]),
      popOf: () => 0, kappa: 5,
    });
    expect(r.rank({ userVector: [], cohort: null }, cands.slice(0, 2))).toEqual(["a", "b"]);
  });
});
