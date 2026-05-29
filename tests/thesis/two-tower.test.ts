import { describe, test, expect } from "vitest";
import { trainTwoTower } from "@/thesis/embedders/two-tower";
import { cosineSim } from "@/thesis/embedders/space";

describe("trainTwoTower", () => {
  // (user, positive-item) pairs: users u1/u2 like cluster A {a,b}; u3/u4 like B {x,y}.
  const pairs = [
    { user: "u1", item: "a" }, { user: "u1", item: "b" }, { user: "u2", item: "a" }, { user: "u2", item: "b" },
    { user: "u3", item: "x" }, { user: "u3", item: "y" }, { user: "u4", item: "x" }, { user: "u4", item: "y" },
  ];
  const itemFeatures = new Map<string, number[]>([
    ["a", [1, 0, 0, 0]], ["b", [0.9, 0.1, 0, 0]], ["x", [0, 0, 1, 0]], ["y", [0, 0, 0.9, 0.1]],
  ]);

  test("deterministic by seed", () => {
    const o = { dim: 8, epochs: 30, negatives: 2, seed: 5 };
    const m1 = trainTwoTower(pairs, itemFeatures, o);
    const m2 = trainTwoTower(pairs, itemFeatures, o);
    expect(m1.itemVectors.get("a")).toEqual(m2.itemVectors.get("a"));
  });

  test("learned user vectors are deterministic by seed", () => {
    const o = { dim: 8, epochs: 30, negatives: 2, seed: 5 };
    const m1 = trainTwoTower(pairs, itemFeatures, o);
    const m2 = trainTwoTower(pairs, itemFeatures, o);
    expect(m1.userVector("u1")).toEqual(m2.userVector("u1"));
  });

  test("a user's vector is closer to their liked items than to the other cluster", () => {
    const m = trainTwoTower(pairs, itemFeatures, { dim: 16, epochs: 200, negatives: 3, seed: 2 });
    const u1 = m.userVector("u1")!;
    const simA = cosineSim(u1, m.itemVectors.get("a")!);
    const simX = cosineSim(u1, m.itemVectors.get("x")!);
    expect(simA).toBeGreaterThan(simX);
  });

  test("user is closer to liked cluster than other across seeds (robust margin)", () => {
    for (const seed of [1, 2, 3]) {
      const m = trainTwoTower(pairs, itemFeatures, { dim: 16, epochs: 200, negatives: 3, seed });
      const u1 = m.userVector("u1")!;
      const simA = cosineSim(u1, m.itemVectors.get("a")!);
      const simX = cosineSim(u1, m.itemVectors.get("x")!);
      expect(simA - simX).toBeGreaterThan(0.05);
    }
  });

  test("userVectorFromItems pools the given item vectors for an unknown user", () => {
    const m = trainTwoTower(pairs, itemFeatures, { dim: 8, epochs: 10, negatives: 2, seed: 1 });
    const v = m.userVectorFromItems(["a", "b"]);
    expect(v?.length).toBe(8);
  });
});
