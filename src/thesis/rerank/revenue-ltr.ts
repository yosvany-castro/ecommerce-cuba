/**
 * F6 W5 — Learning-to-rank trained on the BUSINESS OUTCOME (revenue), not the
 * binary purchase label (spec §5 W5).
 *
 * The F3 LTR (`trainLTR` in ./ltr.ts) is a pointwise *logistic* model whose target
 * is the binary purchase label (1 = the user's train purchase, 0 = a sampled pool
 * negative). It optimizes relevance: "is this the item the user bought?".
 *
 * `trainRevenueLTR` keeps the SAME LtrModel shape (a linear scorer `w·x + b`,
 * one weight per FEATURE_NAMES entry, fully interpretable) but changes the TARGET
 * to item REVENUE — what the business actually earns. Two estimators (spec §5 W5
 * offers both; selectable via `opts.variant`):
 *
 *   - "regression" (DEFAULT): linear regression with squared-error loss whose
 *     target is each sample's NORMALIZED expectedRevenue ∈ [0,1] (P(buy)·price·
 *     margin / maxRevenue-in-case). Train purchases carry their realized revenue;
 *     sampled negatives carry their (typically low) revenue. The scorer ranks by
 *     predicted revenue. This is the literal "target = revenue" model.
 *
 *   - "weighted-logistic": the F3 logistic objective, but each POSITIVE's gradient
 *     is WEIGHTED by its normalized revenue (negatives keep weight 1). A high-
 *     revenue purchase pulls the boundary harder than a low-revenue one, so the
 *     model learns "predict the purchases that are worth the most". Same logistic
 *     squashing as `trainLTR`, so it stays directly comparable to the F3 LTR.
 *
 * Determinism (spec §6, hazard #2): the only stochasticity is the epoch shuffle,
 * driven by `makeRng(opts.seed)` — same seed → identical weights. No Math.random,
 * no Date.now. Pure module: no DB / network. The trainer NEVER sees the held-out
 * test purchase (the caller samples negatives from pool\{test pid} and positives
 * from the train split only — same no-leakage contract as f3-study / assembled).
 *
 * Embedding-space note (hazard #5): this module does NO vector math — features are
 * pre-extracted numbers — so there is no dimension to mismatch here. Feature
 * vectors must be built in the canonical E1 (64d) space by the caller, exactly as
 * the relevance LTR's are, so the two models are apples-to-apples.
 */
import { makeRng } from "../data/rng";
import type { LtrModel } from "./ltr";
import type { Ranker, RankItem, UserContext } from "../types";

/**
 * One revenue-LTR training sample.
 *   - `features`: the SAME feature vector layout as the relevance LTR
 *     (FEATURE_NAMES order), built in E1 by the caller.
 *   - `revenue`: NORMALIZED expected revenue of this (user, item) pair in [0,1].
 *     For "regression" this is the regression target directly. For
 *     "weighted-logistic" it is the per-positive gradient weight.
 *   - `label`: binary purchase label (1 positive / 0 negative). Used ONLY by the
 *     "weighted-logistic" variant (logistic target); ignored by "regression".
 */
export interface RevenueLtrSample {
  features: number[];
  revenue: number;
  label: number;
}

export type RevenueLtrVariant = "regression" | "weighted-logistic";

export interface RevenueLtrOpts {
  epochs: number;
  lr: number;
  seed: number;
  /** L2 regularization (default 0.001 — matches trainLTR). */
  l2?: number;
  /** Estimator (default "regression"). */
  variant?: RevenueLtrVariant;
}

function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

/**
 * Per-feature mean/std over the training samples (population std). Used ONLY by the
 * "regression" variant: squared-error SGD is NOT scale-invariant — a single feature
 * with magnitude m makes the effective step `lr·m²`, so the same lr that is stable
 * for the bounded logistic gradient (|σ−y|≤1) DIVERGES to NaN for linear regression
 * when any feature is O(few) (e.g. log1p(popularity) ≈ 4). Standardizing features to
 * mean 0 / std 1 makes the regression scale-free and stable at the shared lr, and we
 * fold the standardization back into the returned raw-space weights so `score`
 * consumes the SAME raw feature vectors the logistic model does (caller unchanged).
 * std is floored at 1 for constant features (e.g. isGift all-0) → weight stays 0.
 */
function standardizeStats(samples: RevenueLtrSample[], dim: number): { mean: number[]; std: number[] } {
  const mean = new Array<number>(dim).fill(0);
  const std = new Array<number>(dim).fill(0);
  if (samples.length === 0) return { mean, std: std.map(() => 1) };
  for (const s of samples) for (let k = 0; k < dim; k++) mean[k] += s.features[k];
  for (let k = 0; k < dim; k++) mean[k] /= samples.length;
  for (const s of samples) for (let k = 0; k < dim; k++) std[k] += (s.features[k] - mean[k]) ** 2;
  for (let k = 0; k < dim; k++) {
    std[k] = Math.sqrt(std[k] / samples.length);
    if (std[k] < 1e-9) std[k] = 1; // constant feature → no scaling, weight learns 0.
  }
  return { mean, std };
}

/**
 * Train a revenue-target LTR. Returns the SAME `LtrModel` shape as `trainLTR`
 * (weights + bias + `score(features)`), so it drops into `ltrRanker` / the head-
 * to-head harness unchanged. The learned `score` is the predicted (relative)
 * revenue of a candidate — rank descending to maximize expected revenue@k.
 *
 * Both variants use mini-batch SGD with a seeded epoch shuffle (deterministic).
 *
 * @param samples  train-split-only samples (positives = train purchases with their
 *                 revenue; negatives = sampled pool ids, test pid excluded).
 * @param opts     epochs / lr / seed / l2 / variant.
 */
export function trainRevenueLTR(samples: RevenueLtrSample[], opts: RevenueLtrOpts): LtrModel {
  const rng = makeRng(opts.seed);
  const l2 = opts.l2 ?? 0.001;
  const variant: RevenueLtrVariant = opts.variant ?? "regression";
  const dim = samples[0]?.features.length ?? 0;
  const w = new Array<number>(dim).fill(0);
  let b = 0;

  // Regression is NOT scale-invariant → standardize features (see standardizeStats).
  // The logistic variant keeps raw features (its gradient is already bounded), so it
  // stays bit-for-bit identical to the F3 logistic LTR's training dynamics.
  const useStd = variant === "regression";
  const { mean, std } = useStd
    ? standardizeStats(samples, dim)
    : { mean: new Array<number>(dim).fill(0), std: new Array<number>(dim).fill(1) };
  const feat = (s: RevenueLtrSample, k: number): number =>
    useStd ? (s.features[k] - mean[k]) / std[k] : s.features[k];

  // Adaptive learning-rate cap for the regression variant. Pointwise least-squares
  // SGD on a sample with feature norm² = ‖x‖² contracts iff lr·‖x‖² < 2; standardizing
  // bounds individual scales but NOT ‖x‖² (a 6-feature row can reach ~26 here), so the
  // shared lr=0.3 still diverges to NaN. Cap lr at 1/maxNormSq (guaranteeing lr·‖x‖²≤1
  // for every sample → monotone contraction) but never RAISE the caller's lr. Pure &
  // deterministic: depends only on the training features. The logistic variant keeps
  // opts.lr unchanged (its |σ−y|≤1 gradient is already bounded).
  let lr = opts.lr;
  if (useStd) {
    let maxNormSq = 0;
    for (const s of samples) {
      let ns = 0;
      for (let k = 0; k < dim; k++) {
        const x = feat(s, k);
        ns += x * x;
      }
      if (ns > maxNormSq) maxNormSq = ns;
    }
    if (maxNormSq > 0) lr = Math.min(opts.lr, 1 / maxNormSq);
  }

  const order = samples.map((_, i) => i);
  for (let e = 0; e < opts.epochs; e++) {
    // Seeded Fisher-Yates shuffle of the sample order (deterministic).
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const idx of order) {
      const s = samples[idx];
      let z = b;
      for (let k = 0; k < dim; k++) z += w[k] * feat(s, k);

      // dL/dz for the chosen objective.
      let err: number;
      if (variant === "regression") {
        // Squared error on the continuous revenue target: L = ½(z − rev)². The
        // scorer's `score` is the linear prediction z, so ranking by it ranks by
        // predicted revenue.
        err = z - s.revenue;
      } else {
        // Revenue-weighted logistic: positives weighted by their revenue, so a
        // high-revenue purchase contributes a larger gradient than a low-revenue
        // one; negatives keep weight 1. weight ≥ 0 (revenue is a P·price·margin
        // product) so the boundary is never pushed the wrong way.
        const weight = s.label === 1 ? s.revenue : 1;
        err = (sigmoid(z) - s.label) * weight;
      }

      for (let k = 0; k < dim; k++) w[k] -= lr * (err * feat(s, k) + l2 * w[k]);
      b -= lr * err;
    }
  }

  // Fold the standardization back into RAW-space weights so the returned model
  // consumes the SAME raw feature vectors the logistic LTR does. For a standardized
  // model z = Σ w_k·(x_k − mean_k)/std_k + b, the equivalent raw-space form is
  //   z = Σ (w_k/std_k)·x_k + (b − Σ w_k·mean_k/std_k).
  const rawW = new Array<number>(dim).fill(0);
  let rawB = b;
  for (let k = 0; k < dim; k++) {
    rawW[k] = useStd ? w[k] / std[k] : w[k];
    if (useStd) rawB -= (w[k] * mean[k]) / std[k];
  }

  const score = (features: number[]): number => {
    let z = rawB;
    for (let k = 0; k < Math.min(dim, features.length); k++) z += rawW[k] * features[k];
    return z;
  };
  return { weights: rawW, bias: rawB, score };
}

/**
 * A Ranker that orders candidates by revenue-LTR score using a precomputed feature
 * map. Identical contract to `ltrRanker` (./ltr.ts) but named so reports can tell
 * the two models apart. Ties broken by id for determinism.
 */
export function revenueLtrRanker(model: LtrModel, featuresById: Map<string, number[]>): Ranker {
  return {
    name: "ltr-revenue",
    rank(_ctx: UserContext, candidates: RankItem[]): string[] {
      return candidates
        .map((c) => ({ id: c.id, s: model.score(featuresById.get(c.id) ?? []) }))
        .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
        .map((x) => x.id);
    },
  };
}
