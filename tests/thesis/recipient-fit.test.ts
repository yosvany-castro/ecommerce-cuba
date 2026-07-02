import { describe, test, expect } from "vitest";
import { recipientFitAtK, type ItemDemographics, type RecipientProfile } from "@/thesis/eval/metrics";

describe("recipientFitAtK", () => {
  const demo: Record<string, ItemDemographics> = {
    a: { gender_target: "femenino", age_min: 4, age_max: 11 }, // girl
    b: { gender_target: "masculino", age_min: 26, age_max: 59 }, // adult man
    c: { gender_target: "femenino", age_min: 4, age_max: 11 }, // girl
    d: { gender_target: null, age_min: 0, age_max: 130 }, // unisex any-age
  };
  const recipient: RecipientProfile = { gender: "femenino", age_min: 6, age_max: 9 }; // a young girl

  test("fraction of top-k matching the recipient's gender AND age band", () => {
    // top-3 = [a (fit), b (no gender), c (fit)] → 2/3
    expect(recipientFitAtK(["a", "b", "c"], recipient, demo, 3)).toBeCloseTo(2 / 3, 9);
  });
  test("unisex/any-age item counts as a fit (gender null matches anyone)", () => {
    // top-2 = [d (unisex, age covers 6-9 → fit), b (man, no)] → 1/2
    expect(recipientFitAtK(["d", "b"], recipient, demo, 2)).toBeCloseTo(0.5, 9);
  });
  test("empty ranked → 0", () => {
    expect(recipientFitAtK([], recipient, demo, 5)).toBe(0);
  });
  test("k larger than list uses the whole list as denominator", () => {
    // top-10 over [a,c] both fit → 2/2 = 1
    expect(recipientFitAtK(["a", "c"], recipient, demo, 10)).toBe(1);
  });
});
