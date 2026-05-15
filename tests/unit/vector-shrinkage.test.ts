import { describe, test, expect } from "vitest";
import { buildInitialUnnormalized } from "@/sectors/d-personalization/vector/init";
import {
  KAPPA,
  TAU_PROFILE_DAYS,
} from "@/sectors/d-personalization/vector/constants";
import { applyDecayAndAccumulate } from "@/sectors/d-personalization/vector/update";
import { normalize, cosine } from "@/lib/math";

const PROFILE_TAU_MS = TAU_PROFILE_DAYS * 24 * 3600 * 1000;

describe("Cold-start shrinkage", () => {
  test("KAPPA = 10", () => {
    expect(KAPPA).toBe(10);
  });

  test("init: unnorm = κ * prior, weight = κ", () => {
    const prior = [0.6, 0.8, 0, 0]; // unit norm
    const { unnorm, weight } = buildInitialUnnormalized(prior);
    expect(weight).toBe(KAPPA);
    for (let i = 0; i < prior.length; i++) {
      expect(unnorm[i]).toBeCloseTo(prior[i] * KAPPA, 9);
    }
  });

  test("n=0 events → normalized vector equals prior exactly", () => {
    const prior = normalize([0.6, 0.8, 0, 0]);
    const { unnorm } = buildInitialUnnormalized(prior);
    const u = normalize(unnorm);
    for (let i = 0; i < prior.length; i++) expect(u[i]).toBeCloseTo(prior[i], 9);
  });

  test("after 1 event, prior still dominates: cos(u, prior) > cos(u, event_product)", () => {
    const prior = normalize([1, 0, 0, 0]);
    const p = normalize([0, 1, 0, 0]);
    const { unnorm, weight } = buildInitialUnnormalized(prior);
    const now = new Date("2026-06-01");
    const r = applyDecayAndAccumulate({
      unnorm,
      weight,
      lastUpdatedAt: now,
      product: p,
      eventWeight: 1,
      now,
      tauMs: PROFILE_TAU_MS,
    });
    const u = normalize(r.newUnnorm);
    expect(cosine(u, prior)).toBeGreaterThan(cosine(u, p));
  });

  test("after 100 events of same product, the product dominates", () => {
    const prior = normalize([1, 0, 0, 0]);
    const p = normalize([0, 1, 0, 0]);
    let { unnorm, weight } = buildInitialUnnormalized(prior);
    const now = new Date("2026-06-01");
    for (let i = 0; i < 100; i++) {
      const r = applyDecayAndAccumulate({
        unnorm,
        weight,
        lastUpdatedAt: now,
        product: p,
        eventWeight: 1,
        now,
        tauMs: PROFILE_TAU_MS,
      });
      unnorm = r.newUnnorm;
      weight = r.newWeight;
    }
    const u = normalize(unnorm);
    expect(cosine(u, p)).toBeGreaterThan(0.99);
    expect(cosine(u, prior)).toBeLessThan(0.2);
  });
});
