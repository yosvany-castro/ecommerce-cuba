import { describe, test, expect } from "vitest";
import { l2normalize, meanPool, cosineSim } from "@/thesis/embedders/space";

describe("space utils", () => {
  test("l2normalize makes unit norm", () => {
    const v = l2normalize([3, 4]);
    expect(Math.hypot(v[0], v[1])).toBeCloseTo(1, 9);
    expect(v[0]).toBeCloseTo(0.6, 9);
  });
  test("l2normalize of zero vector returns zeros (no NaN)", () => {
    expect(l2normalize([0, 0])).toEqual([0, 0]);
  });
  test("meanPool averages componentwise", () => {
    expect(meanPool([[1, 1], [3, 3]])).toEqual([2, 2]);
  });
  test("meanPool of empty returns empty", () => {
    expect(meanPool([])).toEqual([]);
  });
  test("meanPool throws on ragged input (guards silent NaN)", () => {
    expect(() => meanPool([[1, 2], [1, 2, 3]])).toThrow();
  });
  test("cosineSim of identical unit vectors = 1", () => {
    expect(cosineSim([1, 0], [1, 0])).toBeCloseTo(1, 9);
  });
  test("cosineSim of orthogonal = 0", () => {
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 9);
  });
});
