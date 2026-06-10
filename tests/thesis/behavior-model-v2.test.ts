import { describe, test, expect } from "vitest";
import { sampleCatalog } from "@/thesis/data/catalog-model";
import { sampleBehavior, type ExposureContext } from "@/thesis/data/behavior-model";

/** Gini coefficient over non-negative counts. */
function gini(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  const sum = v.reduce((s, x) => s + x, 0);
  if (n === 0 || sum === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * v[i];
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

function purchaseCounts(catalogSize: number, out: ReturnType<typeof sampleBehavior>, cat: ReturnType<typeof sampleCatalog>): number[] {
  const byId = new Map<string, number>();
  for (const e of out.events) {
    if (e.event_type !== "purchase") continue;
    byId.set(e.product_id, (byId.get(e.product_id) ?? 0) + 1);
  }
  return cat.map((p) => byId.get(p.source_product_id) ?? 0);
}

describe("sampleBehavior v2 knobs", () => {
  test("default opts are BIT-IDENTICAL to v1 (no v2 draws touch the main rng)", () => {
    const cat = sampleCatalog(300, 1);
    const plain = sampleBehavior(cat, { users: 25, days: 45, seed: 77 });
    // explicit no-op knobs must not alter the stream either
    const noop = sampleBehavior(cat, { users: 25, days: 45, seed: 77, priceGamma: 0, stochasticChoice: false });
    expect(noop.events).toEqual(plain.events);
    expect(noop.holdout).toEqual(plain.holdout);
    expect(noop.users).toEqual(plain.users);
  });

  test("v2 output is deterministic by seed", () => {
    const cat = sampleCatalog(300, 1);
    const opts = { users: 25, days: 45, seed: 77, zipfS: 0.8, priceGamma: 0.8, pGiftMax: 0.16, stochasticChoice: true };
    const a = sampleBehavior(cat, opts);
    const b = sampleBehavior(cat, opts);
    expect(a.events).toEqual(b.events);
    expect(a.holdout).toEqual(b.holdout);
  });

  test("zipfS concentrates purchases (heavy tail) vs flat v1", () => {
    const cat = sampleCatalog(500, 4);
    const v1 = sampleBehavior(cat, { users: 150, days: 60, seed: 5 });
    const v2 = sampleBehavior(cat, { users: 150, days: 60, seed: 5, zipfS: 0.8, stochasticChoice: true });
    const gV1 = gini(purchaseCounts(500, v1, cat));
    const gV2 = gini(purchaseCounts(500, v2, cat));
    expect(gV2).toBeGreaterThan(gV1 + 0.1); // materially more concentrated
  });

  test("priceGamma suppresses purchases of high price bands", () => {
    const cat = sampleCatalog(500, 4);
    const off = sampleBehavior(cat, { users: 150, days: 60, seed: 5 });
    const on = sampleBehavior(cat, { users: 150, days: 60, seed: 5, priceGamma: 1.5 });
    const bandOf = new Map(cat.map((p) => [p.source_product_id, p.attrs.priceBand]));
    const highShare = (out: ReturnType<typeof sampleBehavior>): number => {
      const buys = out.events.filter((e) => e.event_type === "purchase");
      if (buys.length === 0) return 0;
      const high = buys.filter((e) => (bandOf.get(e.product_id) ?? 0) >= 2).length;
      return high / buys.length;
    };
    expect(highShare(on)).toBeLessThan(highShare(off));
  });

  test("pGiftMax lowers gift-session prevalence to a realistic rate", () => {
    const cat = sampleCatalog(300, 1);
    const out = sampleBehavior(cat, { users: 200, days: 45, seed: 9, pGiftMax: 0.16 });
    const giftShare = out.sessions.filter((s) => s.intent === "gift").length / out.sessions.length;
    expect(giftShare).toBeLessThan(0.15); // mean ≈ 8 %
    expect(giftShare).toBeGreaterThan(0.0);
  });

  test("cascadeLambda without exposurePolicy is a no-op (BIT-IDENTICAL output)", () => {
    // Guarantee from the knob spec (roadmap #6): the exposure knobs draw only
    // from rngV2, and cascadeLambda is consulted ONLY when a policy is present.
    const cat = sampleCatalog(300, 1);
    const plain = sampleBehavior(cat, { users: 25, days: 45, seed: 77 });
    const noop = sampleBehavior(cat, { users: 25, days: 45, seed: 77, cascadeLambda: 0.85 });
    expect(noop.events).toEqual(plain.events);
    expect(noop.holdout).toEqual(plain.holdout);
    expect(noop.users).toEqual(plain.users);
    expect(noop.sessions).toEqual(plain.sessions);
  });

  test("holdout invariants hold under v2 (test strictly after train, session-disjoint)", () => {
    const cat = sampleCatalog(300, 1);
    const out = sampleBehavior(cat, { users: 60, days: 45, seed: 11, zipfS: 0.8, priceGamma: 0.8, stochasticChoice: true });
    const byUser = new Map<string, { train: string[]; test: string[] }>();
    for (const h of out.holdout) {
      const b = byUser.get(h.user_id) ?? { train: [], test: [] };
      b[h.split].push(h.occurred_at);
      byUser.set(h.user_id, b);
    }
    for (const [, b] of byUser) {
      if (b.test.length === 0) continue;
      const maxTrain = b.train.reduce((m, t) => (t > m ? t : m), "");
      const minTest = b.test.reduce((m, t) => (t < m ? t : m), "9999");
      expect(minTest > maxTrain).toBe(true);
    }
  });
});

describe("recommender-mediated exposure (roadmap #6)", () => {
  test("with a fixed slate, each session's views are an ordered PREFIX of the slate (cascade)", () => {
    const cat = sampleCatalog(300, 1);
    // Fixed 12-item slate; no complements map ⇒ no §4.4 seeding, so the views
    // of every session must be exactly slate[0..k) for some k ≥ 1.
    const slate = cat.slice(0, 12).map((p) => p.source_product_id);
    const out = sampleBehavior(cat, { users: 30, days: 45, seed: 7, exposurePolicy: () => slate });

    const viewsBySession = new Map<string, string[]>();
    for (const e of out.events) {
      if (e.event_type !== "product_view") continue;
      const a = viewsBySession.get(e.session_id) ?? [];
      a.push(e.product_id);
      viewsBySession.set(e.session_id, a);
    }
    expect(viewsBySession.size).toBe(out.sessions.length);
    const depths: number[] = [];
    for (const [, vs] of viewsBySession) {
      expect(vs.length).toBeGreaterThanOrEqual(1); // slot 0 always examined
      expect(vs).toEqual(slate.slice(0, vs.length)); // prefix, in slate order
      depths.push(vs.length);
    }
    // The cascade is stochastic: examination depth must actually vary.
    expect(new Set(depths).size).toBeGreaterThan(1);
  });

  test("exposure run is deterministic given the same policy and seed", () => {
    const cat = sampleCatalog(300, 1);
    const ids = cat.map((p) => p.source_product_id);
    // Policy that exercises ctx.rng (the rngV2 stream): a rotating slate.
    const policy = (ctx: ExposureContext): string[] => {
      const start = ctx.rng.int(ids.length);
      return Array.from({ length: 10 }, (_, i) => ids[(start + i) % ids.length]);
    };
    const opts = { users: 25, days: 45, seed: 13, exposurePolicy: policy };
    const a = sampleBehavior(cat, opts);
    const b = sampleBehavior(cat, opts);
    expect(a.events).toEqual(b.events);
    expect(a.sessions).toEqual(b.sessions);
    expect(a.holdout).toEqual(b.holdout);
  });

  test("an off-taste / wrong-price slate converts FAR less than an oracle slate (feedback sanity)", () => {
    const cat = sampleCatalog(500, 4);
    // Both policies read latent_state — allowed ONLY for the simulator side
    // (they play "the store with a crystal ball" / "the worst possible store"),
    // never for a ranker under evaluation. pGiftOverride: 0 keeps every
    // session in the self regime so taste is always the relevant utility.
    const oraclePolicy = (ctx: ExposureContext): string[] => {
      const taste = new Set(ctx.user.latent_state.tasteSubcategories);
      const budget = ctx.user.latent_state.budgetBand;
      return cat
        .filter((p) => taste.has(p.attrs.subcategory))
        .sort(
          (a, b) =>
            Math.abs(a.attrs.priceBand - budget) - Math.abs(b.attrs.priceBand - budget) ||
            a.source_product_id.localeCompare(b.source_product_id),
        )
        .slice(0, 12)
        .map((p) => p.source_product_id);
    };
    const badPolicy = (ctx: ExposureContext): string[] => {
      const taste = new Set(ctx.user.latent_state.tasteSubcategories);
      const budget = ctx.user.latent_state.budgetBand;
      return cat
        .filter((p) => !taste.has(p.attrs.subcategory))
        .sort(
          (a, b) =>
            Math.abs(b.attrs.priceBand - budget) - Math.abs(a.attrs.priceBand - budget) ||
            a.source_product_id.localeCompare(b.source_product_id),
        )
        .slice(0, 12)
        .map((p) => p.source_product_id);
    };
    const base = { users: 80, days: 60, seed: 5, pGiftOverride: 0 };
    const buysOf = (out: ReturnType<typeof sampleBehavior>): number =>
      out.events.filter((e) => e.event_type === "purchase").length;
    const oracleBuys = buysOf(sampleBehavior(cat, { ...base, exposurePolicy: oraclePolicy }));
    const badBuys = buysOf(sampleBehavior(cat, { ...base, exposurePolicy: badPolicy }));
    expect(oracleBuys).toBeGreaterThan(0);
    // Satisfaction gating must make the bad slate convert at a small fraction
    // of the oracle slate — this conversion gap is the closed-loop feedback.
    expect(badBuys).toBeLessThan(oracleBuys * 0.5);
  });
});
