import { describe, test, expect } from "vitest";
import { OBJECTIVE_NAMES, extractObjectiveFeatures, type ObjCtx, type ObjCandidate } from "@/thesis/objectives/objective-features";

describe("extractObjectiveFeatures", () => {
  const ctx: ObjCtx = { modeMedoids: [[1, 0, 0]], budgetBand: 2, maxPopularity: 100 };
  const cand: ObjCandidate = {
    id: "x", vector: [1, 0, 0], priceBand: 2, margin_pct: 0.4, popularity: 1, seller_age_days: 10,
  };

  test("returns one value per OBJECTIVE_NAMES entry, all in [0,1]", () => {
    const f = extractObjectiveFeatures(ctx, cand);
    expect(OBJECTIVE_NAMES.every((n) => typeof f[n] === "number" && f[n] >= 0 && f[n] <= 1)).toBe(true);
    expect(Object.keys(f).sort()).toEqual([...OBJECTIVE_NAMES].sort());
  });
  test("relevance is max cosine to mode medoids", () => {
    expect(extractObjectiveFeatures(ctx, cand).relevance).toBeCloseTo(1, 6);
  });
  test("margin is the margin_pct", () => {
    expect(extractObjectiveFeatures(ctx, cand).margin).toBeCloseTo(0.4, 9);
  });
  test("novelty is high for a low-popularity item", () => {
    const f = extractObjectiveFeatures(ctx, cand);
    const popular = extractObjectiveFeatures(ctx, { ...cand, popularity: 100 });
    expect(f.novelty).toBeGreaterThan(popular.novelty);
  });
  test("sellerFairness is higher for a newer seller", () => {
    const newSeller = extractObjectiveFeatures(ctx, { ...cand, seller_age_days: 5 });
    const oldSeller = extractObjectiveFeatures(ctx, { ...cand, seller_age_days: 1000 });
    expect(newSeller.sellerFairness).toBeGreaterThan(oldSeller.sellerFairness);
  });
  test("convProb increases with relevance (price band == budget → priceFit 1)", () => {
    const aligned = extractObjectiveFeatures(ctx, cand);
    const off = extractObjectiveFeatures(ctx, { ...cand, vector: [0, 1, 0] });
    expect(aligned.convProb).toBeGreaterThan(off.convProb);
  });
});
