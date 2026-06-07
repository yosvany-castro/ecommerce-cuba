import { describe, test, expect } from "vitest";
import { detectGiftIntent, type SessionItem, type UserDemographic } from "@/thesis/multivector/gift-detect";

describe("detectGiftIntent (demographic, per spec §4.2)", () => {
  const buyer: UserDemographic = { gender: "masculino", ageBand: "adulto" }; // adult man

  test("a session targeting a little girl (different gender) → gift", () => {
    const session: SessionItem[] = [
      { product_id: "g1", gender_target: "femenino", age_band: "nino" },
      { product_id: "g2", gender_target: "femenino", age_band: "nino" },
      { product_id: "g3", gender_target: "femenino", age_band: "nino" },
    ];
    const r = detectGiftIntent(session, buyer, { minItems: 2, minDemographicCoherence: 0.6 });
    expect(r.isGift).toBe(true);
    expect(r.targetGender).toBe("femenino");
    expect(r.targetAgeBand).toBe("nino");
  });

  test("same gender but different age (father gift) → gift via cross_cohort_age", () => {
    const session: SessionItem[] = [
      { product_id: "p1", gender_target: "masculino", age_band: "mayor" },
      { product_id: "p2", gender_target: "masculino", age_band: "mayor" },
    ];
    const r = detectGiftIntent(session, buyer, { minItems: 2, minDemographicCoherence: 0.6 });
    expect(r.isGift).toBe(true);
    expect(r.reasons.includes("cross_cohort_age")).toBe(true);
  });

  test("a self session matching the buyer's own demographic → not gift", () => {
    const session: SessionItem[] = [
      { product_id: "s1", gender_target: "masculino", age_band: "adulto" },
      { product_id: "s2", gender_target: "masculino", age_band: "adulto" },
    ];
    const r = detectGiftIntent(session, buyer, { minItems: 2, minDemographicCoherence: 0.6 });
    expect(r.isGift).toBe(false);
  });

  test("demographically incoherent session (mixed genders) → not gift", () => {
    const session: SessionItem[] = [
      { product_id: "i1", gender_target: "femenino", age_band: "nino" },
      { product_id: "i2", gender_target: "masculino", age_band: "mayor" },
      { product_id: "i3", gender_target: null, age_band: null },
    ];
    const r = detectGiftIntent(session, buyer, { minItems: 2, minDemographicCoherence: 0.7 });
    expect(r.isGift).toBe(false);
  });

  test("too few items → not gift", () => {
    const r = detectGiftIntent([{ product_id: "x", gender_target: "femenino", age_band: "nino" }], buyer, { minItems: 2, minDemographicCoherence: 0.6 });
    expect(r.isGift).toBe(false);
    expect(r.reasons.includes("too_few_items")).toBe(true);
  });

  test("deterministic for same input", () => {
    const session: SessionItem[] = [
      { product_id: "g1", gender_target: "femenino", age_band: "nino" },
      { product_id: "g2", gender_target: "femenino", age_band: "joven" },
    ];
    const a = detectGiftIntent(session, buyer, { minItems: 2, minDemographicCoherence: 0.5 });
    const b = detectGiftIntent(session, buyer, { minItems: 2, minDemographicCoherence: 0.5 });
    expect(a).toEqual(b);
  });
});
