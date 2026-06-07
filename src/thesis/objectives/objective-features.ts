import { cosineSim } from "../embedders/space";
import { purchaseProbability } from "./outcome";

/** Pointwise objective features (diversity is marginal → computed in the scorer). */
export const OBJECTIVE_NAMES = ["relevance", "margin", "convProb", "novelty", "sellerFairness"] as const;
export type ObjectiveName = (typeof OBJECTIVE_NAMES)[number];

export interface ObjCtx {
  modeMedoids: number[][];
  budgetBand: number;
  maxPopularity: number; // for novelty normalization
}
export interface ObjCandidate {
  id: string;
  vector: number[];
  priceBand: number;
  margin_pct: number;
  popularity: number;
  seller_age_days: number;
}

const PRICE_BANDS = 4;
const FAIRNESS_HALFLIFE_DAYS = 30;

/** All features normalized to [0,1]. Inference-available only (no labels). */
export function extractObjectiveFeatures(ctx: ObjCtx, cand: ObjCandidate): Record<ObjectiveName, number> {
  const relevance = ctx.modeMedoids.length === 0 ? 0 : Math.max(0, Math.min(1, Math.max(...ctx.modeMedoids.map((m) => cosineSim(m, cand.vector)))));
  const priceFit = 1 - Math.abs(cand.priceBand - ctx.budgetBand) / (PRICE_BANDS - 1);
  const convProb = purchaseProbability({ affinity: relevance, priceFit: Math.max(0, priceFit) });
  const novelty = 1 - Math.log1p(cand.popularity) / Math.log1p(Math.max(1, ctx.maxPopularity));
  const sellerFairness = FAIRNESS_HALFLIFE_DAYS / (FAIRNESS_HALFLIFE_DAYS + cand.seller_age_days);
  return {
    relevance,
    margin: Math.max(0, Math.min(1, cand.margin_pct)),
    convProb,
    novelty: Math.max(0, Math.min(1, novelty)),
    sellerFairness,
  };
}
