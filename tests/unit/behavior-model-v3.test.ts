import { describe, test, expect } from "vitest";
import { createHash } from "node:crypto";
import { sampleCatalog } from "@/thesis/data/catalog-model";
import { sampleBehavior } from "@/thesis/data/behavior-model";

/**
 * behavior-model.ts is the AUDITED thesis generator; the v3 knob
 * (attractivenessById) is its only Fase-2 modification and this test is the
 * only net. The hashes below were computed by running the PRE-KNOB code
 * (git HEAD 1c22d5b) with these exact opts — any rng draw or stream shift
 * introduced into the no-knob path invalidates every audited seed and breaks
 * this test.
 */

const sha = (x: unknown): string =>
  createHash("sha256").update(JSON.stringify(x), "utf8").digest("hex");

describe("sampleBehavior v3 knob (attractivenessById)", () => {
  test("opts WITHOUT the knob ⇒ output bit-identical to v2 (frozen hashes)", () => {
    const cat = sampleCatalog(300, 1);
    const v1Style = sampleBehavior(cat, { users: 25, days: 45, seed: 77 });
    expect(sha(v1Style)).toBe("ca6b4b203347481e31146f833f2fabc67c8b7fbce659093fe9393845e254f469");
    const v2Knobs = sampleBehavior(cat, {
      users: 25, days: 45, seed: 77, zipfS: 0.8, priceGamma: 0.8, stochasticChoice: true,
    });
    expect(sha(v2Knobs)).toBe("9cf830e300c6163ac4801e5e7d086714b40ef39ee38888690eb20624e199ad82");
  });

  test("knob steers demand deterministically (values used verbatim, no rng)", () => {
    const cat = sampleCatalog(300, 1);
    // All attractiveness mass on one product ⇒ it must dominate views.
    const star = cat[0].source_product_id;
    const att = new Map(cat.map((p) => [p.source_product_id, p.source_product_id === star ? 50 : 0.01]));
    const opts = { users: 50, days: 45, seed: 77, attractivenessById: att };
    const a = sampleBehavior(cat, opts);
    const b = sampleBehavior(cat, opts);
    expect(sha(a)).toBe(sha(b));
    const views = a.events.filter((e) => e.event_type === "product_view");
    const starViews = views.filter((e) => e.product_id === star).length;
    expect(starViews / views.length).toBeGreaterThan(0.1); // ≫ 1/300 uniform share
  });
});
