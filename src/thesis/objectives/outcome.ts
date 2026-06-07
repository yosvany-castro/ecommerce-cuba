/**
 * Outcome model for F4. Mirrors the generator's click model SHAPE (affinity ×
 * price-fit) to produce a purchase probability, then expected revenue. Pure.
 *
 * `affinity` is the inference-time relevance proxy (cosine of candidate to the
 * user's modes, in [0,1]); `priceFit` ∈ [0,1]. affinity·priceFit is squashed
 * through a logistic to a probability. Ground-truth for MEASUREMENT (revenue@k)
 * and the convProb feature; the ranker never sees the realized purchase.
 */
export interface OutcomeInput {
  affinity: number; // relevance proxy in [0,1]
  priceFit: number; // [0,1]
}

const PURCHASE_SLOPE = 4; // steepness of the logistic on affinity·priceFit
const PURCHASE_MID = 0.5; // midpoint

export function purchaseProbability(o: OutcomeInput): number {
  const x = o.affinity * o.priceFit;
  return 1 / (1 + Math.exp(-PURCHASE_SLOPE * (x - PURCHASE_MID)));
}

export interface RevenueInput extends OutcomeInput {
  price_cents: number;
  margin_pct: number;
}

export function expectedRevenue(r: RevenueInput): number {
  return purchaseProbability(r) * r.price_cents * r.margin_pct;
}
