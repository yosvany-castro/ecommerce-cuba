import { describe, test, expect } from "vitest";
import {
  effectiveUserVector,
  alphaFor,
} from "@/sectors/d-personalization/vector/effective";
import {
  ALPHA_BASE,
  ALPHA_PER_EVENT,
  ALPHA_MAX,
} from "@/sectors/d-personalization/vector/constants";
import { cosine, normalize } from "@/lib/math";

describe("α dinámico", () => {
  test("constants 0.1 / 0.05 / 0.7", () => {
    expect(ALPHA_BASE).toBe(0.1);
    expect(ALPHA_PER_EVENT).toBe(0.05);
    expect(ALPHA_MAX).toBe(0.7);
  });

  test("alphaFor(0) = 0.1", () => {
    expect(alphaFor(0)).toBeCloseTo(0.1);
  });

  test("alphaFor(6) = 0.4 (linear region)", () => {
    expect(alphaFor(6)).toBeCloseTo(0.4);
  });

  test("alphaFor(12) = 0.7 (boundary)", () => {
    expect(alphaFor(12)).toBeCloseTo(0.7);
  });

  test("alphaFor(100) = 0.7 (capped at ALPHA_MAX)", () => {
    expect(alphaFor(100)).toBeCloseTo(0.7);
  });

  test("with nEventsSession=0 profile dominates", () => {
    const profile = normalize([1, 0, 0, 0]);
    const session = normalize([0, 1, 0, 0]);
    const eff = effectiveUserVector(profile, session, 0);
    expect(cosine(eff, profile)).toBeGreaterThan(cosine(eff, session));
  });

  test("with nEventsSession≥12 session dominates", () => {
    const profile = normalize([1, 0, 0, 0]);
    const session = normalize([0, 1, 0, 0]);
    const eff = effectiveUserVector(profile, session, 12);
    expect(cosine(eff, session)).toBeGreaterThan(cosine(eff, profile));
  });

  test("session null → fallback to profile", () => {
    const profile = normalize([1, 0, 0, 0]);
    const eff = effectiveUserVector(profile, null, 5);
    for (let i = 0; i < profile.length; i++) expect(eff[i]).toBeCloseTo(profile[i]);
  });
});
