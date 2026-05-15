import { describe, test, expect } from "vitest";
import { applyDecayAndAccumulate } from "@/sectors/d-personalization/vector/update";
import {
  TAU_PROFILE_DAYS,
  TAU_SESSION_MINUTES,
} from "@/sectors/d-personalization/vector/constants";
import { normalize, cosine } from "@/lib/math";

const PROFILE_TAU_MS = TAU_PROFILE_DAYS * 24 * 3600 * 1000;

describe("applyDecayAndAccumulate", () => {
  test("constants are 60 days / 30 minutes", () => {
    expect(TAU_PROFILE_DAYS).toBe(60);
    expect(TAU_SESSION_MINUTES).toBe(30);
  });

  test("zero state + 1 event → vector = w * product, weight = w", () => {
    const now = new Date();
    const r = applyDecayAndAccumulate({
      unnorm: [0, 0, 0, 0],
      weight: 0,
      lastUpdatedAt: now,
      product: [1, 0, 0, 0],
      eventWeight: 5,
      now,
      tauMs: PROFILE_TAU_MS,
    });
    expect(r.newUnnorm).toEqual([5, 0, 0, 0]);
    expect(r.newWeight).toBe(5);
  });

  test("decay: 60 days old with τ=60d → weight multiplied by 1/e", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const past = new Date("2026-04-02T00:00:00Z"); // 60 days earlier
    const r = applyDecayAndAccumulate({
      unnorm: [10, 0, 0, 0],
      weight: 10,
      lastUpdatedAt: past,
      product: [0, 0, 0, 0],
      eventWeight: 0,
      now,
      tauMs: PROFILE_TAU_MS,
    });
    expect(r.newWeight).toBeCloseTo(10 / Math.E, 2);
    expect(r.newUnnorm[0]).toBeCloseTo(10 / Math.E, 2);
  });

  test("convergence: repeated updates with same product → cos(normalized, product) → 1", () => {
    let unnorm = [0, 0, 0, 0];
    let weight = 0;
    const product = normalize([1, 1, 0, 0]);
    const now = new Date("2026-06-01T00:00:00Z");
    let last = new Date(now.getTime());
    for (let i = 0; i < 30; i++) {
      const r = applyDecayAndAccumulate({
        unnorm,
        weight,
        lastUpdatedAt: last,
        product,
        eventWeight: 1,
        now,
        tauMs: PROFILE_TAU_MS,
      });
      unnorm = r.newUnnorm;
      weight = r.newWeight;
      last = now;
    }
    const u = normalize(unnorm);
    expect(cosine(u, product)).toBeGreaterThan(0.99);
  });

  test("dim mismatch throws", () => {
    const now = new Date();
    expect(() =>
      applyDecayAndAccumulate({
        unnorm: [0, 0, 0, 0],
        weight: 0,
        lastUpdatedAt: now,
        product: [1, 0, 0],
        eventWeight: 1,
        now,
        tauMs: PROFILE_TAU_MS,
      }),
    ).toThrow(/dim mismatch/);
  });
});
