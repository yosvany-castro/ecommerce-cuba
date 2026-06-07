import { describe, test, expect } from "vitest";
import { revenueAtK, sellerExposureGini } from "@/thesis/eval/metrics";

describe("revenueAtK", () => {
  const rev = new Map<string, number>([["a", 10], ["b", 4], ["c", 1], ["d", 100]]);
  test("sums expected revenue over the top-k", () => {
    expect(revenueAtK(["a", "b", "c"], rev, 2)).toBeCloseTo(14, 9); // 10+4
  });
  test("missing id contributes 0", () => {
    expect(revenueAtK(["a", "zzz"], rev, 2)).toBeCloseTo(10, 9);
  });
  test("empty → 0", () => {
    expect(revenueAtK([], rev, 5)).toBe(0);
  });
});

describe("sellerExposureGini", () => {
  const seller = new Map<string, string>([["a", "s1"], ["b", "s1"], ["c", "s2"], ["d", "s3"]]);
  test("perfectly even exposure across sellers → ~0", () => {
    expect(sellerExposureGini(["a", "c", "d"], seller, 3)).toBeCloseTo(0, 6);
  });
  test("all top-k from one seller → high concentration (>0.5)", () => {
    const s = new Map<string, string>([["a", "s1"], ["b", "s1"], ["c", "s1"]]);
    expect(sellerExposureGini(["a", "b", "c"], s, 3)).toBeGreaterThan(0.5);
  });
  test("known value for n>1: counts [s1=2, s2=1] → Gini ≈ 0.1667", () => {
    // values sorted ascending [1,2], n=2, sum=3:
    // Gini = (2·(1·1 + 2·2))/(2·3) − (2+1)/2 = 10/6 − 1.5 = 0.16667
    const s = new Map<string, string>([["a", "s1"], ["b", "s1"], ["c", "s2"]]);
    expect(sellerExposureGini(["a", "b", "c"], s, 3)).toBeCloseTo(0.1667, 4);
  });
  test("empty → 0", () => {
    expect(sellerExposureGini([], seller, 3)).toBe(0);
  });
});
