import { describe, test, expect } from "vitest";
import {
  suggestGiftMode,
  GIFT_SUGGEST_THRESHOLDS,
} from "@/sectors/d-personalization/gift/suggest";
import type { SessionItem, UserDemographic } from "@/thesis/multivector/gift-detect";

function item(gender: string | null, age: string | null, i: number): SessionItem {
  return { product_id: `p${i}`, gender_target: gender, age_band: age };
}

const maleAdult: UserDemographic = { gender: "masculino", ageBand: "adulto" };

describe("suggestGiftMode", () => {
  test("thresholds are the conservative W8 cell (Bayes at ~8% prevalence)", () => {
    // Audit S3·H8: at {2, 0.6} precision ≈13% at real prevalence — this
    // module must never relax below the strictest grid cell.
    expect(GIFT_SUGGEST_THRESHOLDS.minItems).toBe(3);
    expect(GIFT_SUGGEST_THRESHOLDS.minDemographicCoherence).toBe(0.7);
  });

  test("coherent cross-cohort session with >=3 items suggests with recipient and confidence", () => {
    const session = [
      item("femenino", "adulto", 1),
      item("femenino", "adulto", 2),
      item("femenino", "adulto", 3),
    ];
    const out = suggestGiftMode(session, maleAdult);
    expect(out.suggest).toBe(true);
    expect(out.recipient).toEqual({ gender: "femenino", ageBand: "adulto" });
    expect(out.confidence).toBeGreaterThanOrEqual(0.7);
    expect(out.confidence).toBeLessThanOrEqual(1);
  });

  test("coherent but NOT cross-cohort (own demographic) does not suggest", () => {
    // Perfectly coherent session matching the buyer's own gender+age band:
    // this is normal self-shopping, not a gift — the detector requires
    // cross-cohort, and the suggestion must inherit that.
    const session = [
      item("masculino", "adulto", 1),
      item("masculino", "adulto", 2),
      item("masculino", "adulto", 3),
      item("masculino", "adulto", 4),
    ];
    const out = suggestGiftMode(session, maleAdult);
    expect(out).toEqual({ suggest: false, recipient: null, confidence: 0 });
  });

  test("2 items never suggest, even if the old production threshold (minItems=2) would fire", () => {
    const session = [item("femenino", "adulto", 1), item("femenino", "adulto", 2)];
    const out = suggestGiftMode(session, maleAdult);
    expect(out).toEqual({ suggest: false, recipient: null, confidence: 0 });
  });

  test("coherence 2/3 ≈ 0.67 < 0.7 does not suggest, even if the old 0.6 threshold would fire", () => {
    const session = [
      item("femenino", "adulto", 1),
      item("femenino", "adulto", 2),
      item("masculino", "adulto", 3),
    ];
    const out = suggestGiftMode(session, maleAdult);
    expect(out).toEqual({ suggest: false, recipient: null, confidence: 0 });
  });

  test("cross-age (same gender) coherent session suggests with null-safe age band", () => {
    const session = [
      item("masculino", "nino", 1),
      item("masculino", "nino", 2),
      item("masculino", "nino", 3),
    ];
    const out = suggestGiftMode(session, maleAdult);
    expect(out.suggest).toBe(true);
    expect(out.recipient).toEqual({ gender: "masculino", ageBand: "nino" });
  });

  test("all-null gender metadata never suggests (no modal gender to confirm)", () => {
    const session = [item(null, null, 1), item(null, null, 2), item(null, null, 3)];
    const out = suggestGiftMode(session, maleAdult);
    expect(out).toEqual({ suggest: false, recipient: null, confidence: 0 });
  });

  test("is pure: does not mutate the session array", () => {
    const session = [
      item("femenino", "adulto", 1),
      item("femenino", "adulto", 2),
      item("femenino", "adulto", 3),
    ];
    const snapshot = JSON.parse(JSON.stringify(session));
    suggestGiftMode(session, maleAdult);
    expect(session).toEqual(snapshot);
  });
});
