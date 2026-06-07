import { describe, test, expect } from "vitest";
import { setChangeAtK } from "@/thesis/eval/metrics";

describe("setChangeAtK", () => {
  test("identical top-k → 0 change", () => {
    expect(setChangeAtK(["a", "b", "c"], ["a", "b", "c"], 3)).toBe(0);
  });
  test("fully disjoint top-k → 1.0 change", () => {
    expect(setChangeAtK(["a", "b"], ["x", "y"], 2)).toBe(1);
  });
  test("half the top-k replaced → 0.5", () => {
    // base top-2 {a,b}; reranked top-2 {a,c} → 1 of 2 new = 0.5
    expect(setChangeAtK(["a", "c", "d"], ["a", "b"], 2)).toBe(0.5);
  });
  test("reorder without membership change → 0 (set, not order)", () => {
    expect(setChangeAtK(["b", "a"], ["a", "b"], 2)).toBe(0);
  });
  test("empty reranked → 0", () => {
    expect(setChangeAtK([], ["a", "b"], 2)).toBe(0);
  });
});
