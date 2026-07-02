import { describe, test, expect } from "vitest";
import { applyEpsilonExploration, type SlateItem } from "@/sectors/d-personalization/explore/epsilon";

/** Deterministic LCG for reproducible draws. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const slate: SlateItem[] = Array.from({ length: 10 }, (_, i) => ({
  product_id: `served-${i}`,
  rank: i + 1,
  reason: `r${i}`,
}));
const pool = Array.from({ length: 20 }, (_, i) => `pool-${i}`);

describe("applyEpsilonExploration", () => {
  test("epsilon=0 returns the slate unchanged with propensity 1", () => {
    const out = applyEpsilonExploration(slate, pool, { epsilon: 0, rng: lcg(1) });
    expect(out.map((x) => x.product_id)).toEqual(slate.map((x) => x.product_id));
    for (const x of out) {
      expect(x.source).toBe("exploit");
      expect(x.propensity).toBe(1);
    }
  });

  test("empty pool returns the slate unchanged with propensity 1", () => {
    const out = applyEpsilonExploration(slate, [], { epsilon: 0.5, rng: lcg(1) });
    expect(out.map((x) => x.product_id)).toEqual(slate.map((x) => x.product_id));
    for (const x of out) expect(x.propensity).toBe(1);
  });

  test("epsilon=1 explores every slot from the pool with propensity ε/|pool at draw|", () => {
    const out = applyEpsilonExploration(slate, pool, { epsilon: 1, rng: lcg(7) });
    expect(out).toHaveLength(10);
    for (let i = 0; i < out.length; i++) {
      expect(out[i].source).toBe("explore");
      expect(out[i].product_id.startsWith("pool-")).toBe(true);
      // pool shrinks by one per explored slot: 20, 19, 18, …
      expect(out[i].propensity).toBeCloseTo(1 / (20 - i), 10);
      expect(out[i].rank).toBe(i + 1); // ranks preserved
    }
  });

  test("no duplicates in the final slate; exploit slots keep item and get 1−ε", () => {
    const out = applyEpsilonExploration(slate, pool, { epsilon: 0.3, rng: lcg(42) });
    const ids = out.map((x) => x.product_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const x of out) {
      if (x.source === "exploit") {
        expect(x.product_id.startsWith("served-")).toBe(true);
        expect(x.propensity).toBeCloseTo(0.7, 10);
      } else {
        expect(x.product_id.startsWith("pool-")).toBe(true);
        expect(x.propensity).toBeGreaterThan(0);
        expect(x.propensity).toBeLessThanOrEqual(0.3 / 1);
      }
    }
  });

  test("pool entries already in the slate are never explored into it", () => {
    const dirtyPool = ["served-0", "served-1", ...pool];
    const out = applyEpsilonExploration(slate, dirtyPool, { epsilon: 1, rng: lcg(3) });
    const served = new Set(out.map((x) => x.product_id));
    // all explored; none of the original served items can re-enter via the pool
    for (const id of served) expect(id.startsWith("pool-")).toBe(true);
  });

  test("deterministic given the same rng seed", () => {
    const a = applyEpsilonExploration(slate, pool, { epsilon: 0.4, rng: lcg(99) });
    const b = applyEpsilonExploration(slate, pool, { epsilon: 0.4, rng: lcg(99) });
    expect(a).toEqual(b);
  });
});
