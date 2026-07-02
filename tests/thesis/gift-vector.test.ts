import { describe, test, expect } from "vitest";
import { buildRecipientVector } from "@/thesis/multivector/gift-vector";

describe("buildRecipientVector", () => {
  test("L2-normalized mean of the gift-session item vectors", () => {
    const v = buildRecipientVector([[1, 0], [1, 0], [0, 1]]); // mean (2/3,1/3) → normalized
    const norm = Math.hypot(v[0], v[1]);
    expect(norm).toBeCloseTo(1, 9);
    expect(v[0]).toBeGreaterThan(v[1]); // x-direction dominates
  });
  test("single item → that item's unit vector", () => {
    const v = buildRecipientVector([[3, 4]]);
    expect(v[0]).toBeCloseTo(0.6, 9);
    expect(v[1]).toBeCloseTo(0.8, 9);
  });
  test("empty → []", () => {
    expect(buildRecipientVector([])).toEqual([]);
  });
});
