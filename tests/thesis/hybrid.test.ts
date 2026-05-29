import { describe, test, expect } from "vitest";
import { hybridVector, hybridAlpha } from "@/thesis/embedders/hybrid";

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
