import { makeRng } from "../data/rng";
import type { Ranker, RankItem, UserContext } from "../types";

/**
 * Pointwise learning-to-rank via logistic regression with mini-batch SGD. Pure TS,
 * CPU, deterministic given `seed`. Trains on (features, label) samples drawn ONLY
 * from the train split (positives = purchased items, negatives = sampled pool).
 * The learned weights are interpretable (one per FEATURE_NAMES entry).
 */
export interface LtrSample {
  features: number[];
  label: number; // 1 positive, 0 negative
}
export interface LtrOpts {
  epochs: number;
  lr: number;
  seed: number;
  l2?: number; // L2 regularization (default 0.001)
}
export interface LtrModel {
  weights: number[];
  bias: number;
  score(features: number[]): number;
}

function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

export function trainLTR(samples: LtrSample[], opts: LtrOpts): LtrModel {
  const rng = makeRng(opts.seed);
  const l2 = opts.l2 ?? 0.001;
  const dim = samples[0]?.features.length ?? 0;
  const w = new Array<number>(dim).fill(0);
  let b = 0;

  const order = samples.map((_, i) => i);
  for (let e = 0; e < opts.epochs; e++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const idx of order) {
      const s = samples[idx];
      let z = b;
      for (let k = 0; k < dim; k++) z += w[k] * s.features[k];
      const err = sigmoid(z) - s.label; // dL/dz
      for (let k = 0; k < dim; k++) w[k] -= opts.lr * (err * s.features[k] + l2 * w[k]);
      b -= opts.lr * err;
    }
  }

  const score = (features: number[]): number => {
    let z = b;
    for (let k = 0; k < Math.min(dim, features.length); k++) z += w[k] * features[k];
    return z;
  };
  return { weights: w, bias: b, score };
}

/** A Ranker that orders candidates by LTR score using a precomputed feature map. */
export function ltrRanker(model: LtrModel, featuresById: Map<string, number[]>): Ranker {
  return {
    name: "ltr",
    rank(_ctx: UserContext, candidates: RankItem[]): string[] {
      return candidates
        .map((c) => ({ id: c.id, s: model.score(featuresById.get(c.id) ?? []) }))
        .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
        .map((x) => x.id);
    },
  };
}
