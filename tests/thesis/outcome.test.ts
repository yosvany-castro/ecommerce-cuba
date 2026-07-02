import { describe, test, expect } from "vitest";
import { purchaseProbability, expectedRevenue } from "@/thesis/objectives/outcome";

describe("purchaseProbability", () => {
  test("monotonic increasing in affinity", () => {
    const lo = purchaseProbability({ affinity: 0.1, priceFit: 1 });
    const hi = purchaseProbability({ affinity: 0.9, priceFit: 1 });
    expect(hi).toBeGreaterThan(lo);
  });
  test("in [0,1]", () => {
    for (const a of [0, 0.3, 0.7, 1]) {
      const p = purchaseProbability({ affinity: a, priceFit: 0.6 });
      expect(p >= 0 && p <= 1).toBe(true);
    }
  });
  test("worse price fit lowers probability", () => {
    expect(purchaseProbability({ affinity: 0.8, priceFit: 0.2 })).toBeLessThan(purchaseProbability({ affinity: 0.8, priceFit: 1 }));
  });
});

describe("expectedRevenue", () => {
  test("= P(buy) · price · margin", () => {
    const p = purchaseProbability({ affinity: 0.8, priceFit: 1 });
    expect(expectedRevenue({ affinity: 0.8, priceFit: 1, price_cents: 10000, margin_pct: 0.3 })).toBeCloseTo(p * 10000 * 0.3, 6);
  });
  test("zero margin → zero revenue", () => {
    expect(expectedRevenue({ affinity: 0.9, priceFit: 1, price_cents: 5000, margin_pct: 0 })).toBe(0);
  });
});
