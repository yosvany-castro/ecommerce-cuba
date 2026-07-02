import { describe, test, expect } from "vitest";
import { trainProd2Vec } from "@/thesis/embedders/prod2vec";
import { cosineSim } from "@/thesis/embedders/space";

describe("trainProd2Vec", () => {
  // Two tight co-occurrence clusters: {a,b,c} always co-occur; {x,y,z} always co-occur.
  const sequences = [
    ["a", "b", "c"], ["b", "c", "a"], ["c", "a", "b"], ["a", "c", "b"],
    ["x", "y", "z"], ["y", "z", "x"], ["z", "x", "y"], ["x", "z", "y"],
  ];

  test("full vocabulary is deterministic by seed", () => {
    const o = { dim: 16, epochs: 20, window: 2, negatives: 3, seed: 7 } as const;
    const m1 = trainProd2Vec(sequences, o);
    const m2 = trainProd2Vec(sequences, o);
    for (const id of ["a", "b", "c", "x", "y", "z"]) expect(m1.get(id)).toEqual(m2.get(id));
  });

  test("within-cluster similarity exceeds cross-cluster across seeds (robust margin)", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const m = trainProd2Vec(sequences, { dim: 24, epochs: 60, window: 2, negatives: 4, seed });
      const ab = cosineSim(m.get("a")!, m.get("b")!);
      const ax = cosineSim(m.get("a")!, m.get("x")!);
      expect(ab - ax).toBeGreaterThan(0.1);
    }
  });

  test("every item in the corpus gets a vector of the requested dim", () => {
    const m = trainProd2Vec(sequences, { dim: 8, epochs: 5, window: 2, negatives: 2, seed: 3 });
    for (const id of ["a", "b", "c", "x", "y", "z"]) {
      expect(m.get(id)?.length).toBe(8);
    }
  });
});
