import { describe, test, expect } from "vitest";
import { trainProd2Vec } from "@/thesis/embedders/prod2vec";
import { cosineSim } from "@/thesis/embedders/space";

describe("trainProd2Vec", () => {
  // Two tight co-occurrence clusters: {a,b,c} always co-occur; {x,y,z} always co-occur.
  const sequences = [
    ["a", "b", "c"], ["b", "c", "a"], ["c", "a", "b"], ["a", "c", "b"],
    ["x", "y", "z"], ["y", "z", "x"], ["z", "x", "y"], ["x", "z", "y"],
  ];

  test("deterministic by seed", () => {
    const m1 = trainProd2Vec(sequences, { dim: 16, epochs: 20, window: 2, negatives: 3, seed: 7 });
    const m2 = trainProd2Vec(sequences, { dim: 16, epochs: 20, window: 2, negatives: 3, seed: 7 });
    expect(m1.get("a")).toEqual(m2.get("a"));
  });

  test("within-cluster similarity exceeds cross-cluster similarity", () => {
    const m = trainProd2Vec(sequences, { dim: 24, epochs: 60, window: 2, negatives: 4, seed: 1 });
    const ab = cosineSim(m.get("a")!, m.get("b")!);
    const ax = cosineSim(m.get("a")!, m.get("x")!);
    expect(ab).toBeGreaterThan(ax);
  });

  test("every item in the corpus gets a vector of the requested dim", () => {
    const m = trainProd2Vec(sequences, { dim: 8, epochs: 5, window: 2, negatives: 2, seed: 3 });
    for (const id of ["a", "b", "c", "x", "y", "z"]) {
      expect(m.get(id)?.length).toBe(8);
    }
  });
});
