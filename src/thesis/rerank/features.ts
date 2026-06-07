import { cosineSim } from "../embedders/space";

/**
 * Per-request context for feature extraction. Only inference-available signals —
 * NEVER the held-out label or the GT session intent. `isGift` comes from the F2
 * detector; recipient demographics from the detected target.
 */
export interface FeatureContext {
  modeMedoids: number[][];
  budgetBand: number;
  buyerGender: string | null;
  buyerAgeBand: string | null;
  isGift: boolean;
  recipientGender: string | null;
  recipientAgeBand: string | null;
  lastViewedId: string | null;
}

export interface FeatureCandidate {
  id: string;
  vector: number[];
  priceBand: number;
  gender_target: string | null;
  ageBand: string | null;
  npmiToLastViewed: number;
  popularity: number;
  sources: string[];
}

/**
 * Fixed, ordered feature names — keep in lockstep with extractFeatures output.
 * NOTE: candidate `sources` is pool-construction metadata, NOT a user-relevance
 * signal. It was removed as a feature because it leaks pool membership: LTR
 * positives (train purchases) are excluded from the pool so their source one-hots
 * are all 0, while pool negatives carry sources — the model would trivially learn
 * "no source ⇒ positive", a membership artifact rather than relevance.
 */
export const FEATURE_NAMES = [
  "retrievalScore",
  "npmiScore",
  "priceFit",
  "demoMatch",
  "isGift",
  "popularity",
] as const;

const PRICE_BANDS = 4;

function demoFit(candGender: string | null, candAge: string | null, gender: string | null, ageBand: string | null): number {
  const genderOk = candGender === null || candGender === "unisex" || gender === null || candGender === gender;
  const ageOk = candAge === null || ageBand === null || candAge === ageBand;
  return genderOk && ageOk ? 1 : 0;
}

/**
 * Build the numeric feature vector for a (user, candidate) pair. These are the
 * signals the pure retrieval ranking does NOT see (co-purchase, price-fit, gift/
 * demographic match, popularity), which is what lets a reranker move the set.
 */
export function extractFeatures(ctx: FeatureContext, cand: FeatureCandidate): number[] {
  const retrievalScore = ctx.modeMedoids.length === 0 ? 0 : Math.max(...ctx.modeMedoids.map((m) => cosineSim(m, cand.vector)));
  const priceFit = 1 - Math.abs(cand.priceBand - ctx.budgetBand) / (PRICE_BANDS - 1);
  const demoMatch = ctx.isGift
    ? demoFit(cand.gender_target, cand.ageBand, ctx.recipientGender, ctx.recipientAgeBand)
    : demoFit(cand.gender_target, cand.ageBand, ctx.buyerGender, ctx.buyerAgeBand);
  return [
    retrievalScore,
    cand.npmiToLastViewed,
    priceFit,
    demoMatch,
    ctx.isGift ? 1 : 0,
    Math.log1p(cand.popularity),
  ];
}
