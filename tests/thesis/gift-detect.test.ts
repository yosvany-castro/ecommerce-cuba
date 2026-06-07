import { describe, test, expect } from "vitest";
import { detectGiftIntent, type SessionItem } from "@/thesis/multivector/gift-detect";
import type { UserMode } from "@/thesis/multivector/modes";

describe("detectGiftIntent", () => {
  const userModes: UserMode[] = [{ medoid: [1, 0, 0], weight: 1, size: 10 }];

  const giftSession: SessionItem[] = [
    { product_id: "g1", vector: [0, 1, 0], gender_target: "femenino", age_band: "nino" },
    { product_id: "g2", vector: [0, 0.98, 0.02], gender_target: "femenino", age_band: "nino" },
    { product_id: "g3", vector: [0.02, 0.97, 0], gender_target: "femenino", age_band: "nino" },
  ];
  const selfSession: SessionItem[] = [
    { product_id: "s1", vector: [1, 0, 0], gender_target: "masculino", age_band: "adulto" },
    { product_id: "s2", vector: [0.97, 0.03, 0], gender_target: "masculino", age_band: "adulto" },
  ];

  test("flags a coherent cross-profile session as gift", () => {
    const r = detectGiftIntent(giftSession, userModes, { minItems: 2, maxSimToModes: 0.5, minInternalCoherence: 0.6 });
    expect(r.isGift).toBe(true);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  test("does not flag a self session that matches the user's modes", () => {
    const r = detectGiftIntent(selfSession, userModes, { minItems: 2, maxSimToModes: 0.5, minInternalCoherence: 0.6 });
    expect(r.isGift).toBe(false);
  });

  test("too few items → not gift (insufficient evidence)", () => {
    const r = detectGiftIntent(giftSession.slice(0, 1), userModes, { minItems: 2, maxSimToModes: 0.5, minInternalCoherence: 0.6 });
    expect(r.isGift).toBe(false);
  });

  test("incoherent session (random directions) → not gift even if far from user", () => {
    const incoherent: SessionItem[] = [
      { product_id: "i1", vector: [0, 1, 0], gender_target: "femenino", age_band: "nino" },
      { product_id: "i2", vector: [0, 0, 1], gender_target: "masculino", age_band: "mayor" },
    ];
    const r = detectGiftIntent(incoherent, userModes, { minItems: 2, maxSimToModes: 0.5, minInternalCoherence: 0.6 });
    expect(r.isGift).toBe(false);
  });
});
