import { describe, test, expect } from "vitest";
import { npmiFromCounts } from "@/sectors/d-personalization/co-occurrence/npmi-recompute";

describe("npmiFromCounts", () => {
  test("independent pair (P(ab) = P(a)*P(b)) → NPMI = 0", () => {
    // n=100, count_ab=25, count_a=50, count_b=50
    // P(ab)=0.25, P(a)*P(b)=0.25 → ratio=1 → ln(1)=0
    const npmi = npmiFromCounts({
      countAB: 25,
      countA: 50,
      countB: 50,
      nTotal: 100,
    });
    expect(npmi).toBeCloseTo(0, 6);
  });

  test("perfect positive association (P(ab) = P(a) = P(b)) → NPMI = 1", () => {
    // P(ab)=P(a)=P(b)=0.1
    // ln(0.1/0.01)=ln(10); -ln(0.1)=ln(10) → NPMI=1
    const npmi = npmiFromCounts({
      countAB: 10,
      countA: 10,
      countB: 10,
      nTotal: 100,
    });
    expect(npmi).toBeCloseTo(1, 6);
  });

  test("anti-correlation case → NPMI negative", () => {
    const npmi = npmiFromCounts({
      countAB: 1,
      countA: 50,
      countB: 50,
      nTotal: 100,
    });
    expect(npmi).toBeLessThan(0);
    expect(npmi).toBeGreaterThan(-1);
  });

  test("zero counts → 0", () => {
    expect(npmiFromCounts({ countAB: 0, countA: 10, countB: 10, nTotal: 100 })).toBe(0);
    expect(npmiFromCounts({ countAB: 5, countA: 0, countB: 10, nTotal: 100 })).toBe(0);
    expect(npmiFromCounts({ countAB: 5, countA: 10, countB: 0, nTotal: 100 })).toBe(0);
  });

  test("P(ab) == 1 → 0 (denominator degenerate)", () => {
    const npmi = npmiFromCounts({
      countAB: 100,
      countA: 100,
      countB: 100,
      nTotal: 100,
    });
    expect(npmi).toBe(0);
  });
});
