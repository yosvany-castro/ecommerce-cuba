import { describe, test, expect } from "vitest";
import { extractFeatures, FEATURE_NAMES, type FeatureContext, type FeatureCandidate } from "@/thesis/rerank/features";

describe("extractFeatures", () => {
  const ctx: FeatureContext = {
    modeMedoids: [[1, 0, 0]],
    budgetBand: 2,
    buyerGender: "masculino",
    buyerAgeBand: "adulto",
    isGift: false,
    recipientGender: null,
    recipientAgeBand: null,
    lastViewedId: "anchor",
  };
  const cand: FeatureCandidate = {
    id: "x", vector: [1, 0, 0], priceBand: 2, gender_target: "masculino", ageBand: "adulto",
    npmiToLastViewed: 0.4, popularity: 8, sources: ["retrieval", "npmi"],
  };

  test("FEATURE_NAMES length matches the vector length", () => {
    const f = extractFeatures(ctx, cand);
    expect(f.length).toBe(FEATURE_NAMES.length);
  });

  test("retrievalScore is the max cosine to the user's mode medoids", () => {
    const i = FEATURE_NAMES.indexOf("retrievalScore");
    const f = extractFeatures(ctx, cand);
    expect(f[i]).toBeCloseTo(1, 6); // cand vector == medoid
  });

  test("npmiScore feature carries the co-occurrence signal", () => {
    const i = FEATURE_NAMES.indexOf("npmiScore");
    expect(extractFeatures(ctx, cand)[i]).toBeCloseTo(0.4, 9);
  });

  test("priceFit is 1 when candidate price band == buyer budget band", () => {
    const i = FEATURE_NAMES.indexOf("priceFit");
    expect(extractFeatures(ctx, cand)[i]).toBeCloseTo(1, 9);
  });

  test("demoMatch is 1 when candidate demographics match the buyer (self)", () => {
    const i = FEATURE_NAMES.indexOf("demoMatch");
    expect(extractFeatures(ctx, cand)[i]).toBe(1);
  });

  test("in gift context demoMatch uses the recipient, not the buyer", () => {
    const giftCtx: FeatureContext = { ...ctx, isGift: true, recipientGender: "femenino", recipientAgeBand: "nino" };
    const giftCand: FeatureCandidate = { ...cand, gender_target: "femenino", ageBand: "nino" };
    const i = FEATURE_NAMES.indexOf("demoMatch");
    expect(extractFeatures(giftCtx, giftCand)[i]).toBe(1);
  });

  test("popularity is the log1p of the candidate event count", () => {
    const i = FEATURE_NAMES.indexOf("popularity");
    expect(extractFeatures(ctx, cand)[i]).toBeCloseTo(Math.log1p(8), 9);
  });

  test("candidate source is NOT a feature (pool-membership leak — see FEATURE_NAMES doc)", () => {
    expect(FEATURE_NAMES).not.toContain("src_retrieval");
    expect(FEATURE_NAMES).not.toContain("src_npmi");
    expect(FEATURE_NAMES).not.toContain("src_popular");
    expect(FEATURE_NAMES).not.toContain("src_exploration");
    // sources differing must not change the feature vector.
    const withSources = extractFeatures(ctx, cand);
    const noSources = extractFeatures(ctx, { ...cand, sources: [] });
    expect(noSources).toEqual(withSources);
  });
});
