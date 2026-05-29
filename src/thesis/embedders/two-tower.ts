import { makeRng } from "../data/rng";
import { l2normalize, meanPool } from "./space";

/**
 * Two-tower retrieval model (Yi et al., RecSys'19 style) trained with sampled
 * softmax over (positive + sampled negatives) and logQ popularity correction.
 * Pure TS, CPU — no GPU/torch.
 *  - item tower = linear projection W (dim x featDim) of the item's input
 *    features (here the E0 text vector) into the shared space;
 *  - user tower = a learned embedding per training user.
 * Trained users get a learned vector; unknown users (eval time) are pooled from
 * their item vectors via userVectorFromItems. Deterministic given `seed`.
 */
export interface TwoTowerOpts {
  dim: number;
  epochs: number;
  negatives: number;
  seed: number;
  lr?: number;
}
export interface TwoTowerModel {
  itemVectors: Map<string, number[]>;
  userVector(userId: string): number[] | null;
  userVectorFromItems(itemIds: string[]): number[] | null;
}

export function trainTwoTower(
  pairs: { user: string; item: string }[],
  itemFeatures: Map<string, number[]>,
  opts: TwoTowerOpts,
): TwoTowerModel {
  const rng = makeRng(opts.seed);
  const lr0 = opts.lr ?? 0.05;

  const items = [...itemFeatures.keys()].sort();
  const featDim = itemFeatures.get(items[0])!.length;
  const users = [...new Set(pairs.map((p) => p.user))].sort();
  const userIdx = new Map(users.map((u, i) => [u, i]));

  // item popularity for logQ correction (sampling bias).
  const pop = new Map<string, number>();
  for (const p of pairs) pop.set(p.item, (pop.get(p.item) ?? 0) + 1);
  const totalPairs = pairs.length;
  const logQ = (id: string) => Math.log((pop.get(id) ?? 1) / totalPairs);

  // Parameters: item projection W (dim x featDim), user embeddings U (users x dim).
  const W = Array.from({ length: opts.dim }, () => Array.from({ length: featDim }, () => (rng.next() - 0.5) / featDim));
  const U = Array.from({ length: users.length }, () => Array.from({ length: opts.dim }, () => (rng.next() - 0.5) / opts.dim));

  const itemVec = (id: string): number[] => {
    const f = itemFeatures.get(id)!;
    const out = new Array<number>(opts.dim).fill(0);
    for (let r = 0; r < opts.dim; r++) {
      let s = 0;
      for (let c = 0; c < featDim; c++) s += W[r][c] * f[c];
      out[r] = s;
    }
    return out;
  };

  const order = pairs.map((_, i) => i);
  for (let e = 0; e < opts.epochs; e++) {
    // deterministic Fisher–Yates shuffle each epoch
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    const lr = Math.max(lr0 * 0.001, lr0 * (1 - e / opts.epochs));
    for (const oi of order) {
      const p = pairs[oi];
      const u = U[userIdx.get(p.user)!];
      // candidate set = positive (index 0) + sampled negatives, scored with logQ correction
      const cand: string[] = [p.item];
      for (let n = 0; n < opts.negatives; n++) {
        const neg = items[rng.int(items.length)];
        // a negative equal to the positive is skipped (not resampled), so the effective negative count can be < opts.negatives — acceptable for sampled softmax
        if (neg !== p.item) cand.push(neg);
      }
      const vecs = cand.map(itemVec);
      const logits = vecs.map((v, k) => {
        let s = 0;
        for (let d = 0; d < opts.dim; d++) s += u[d] * v[d];
        return s - logQ(cand[k]); // logQ correction
      });
      const maxL = Math.max(...logits);
      const exps = logits.map((l) => Math.exp(l - maxL));
      const Z = exps.reduce((a, b) => a + b, 0);
      const probs = exps.map((x) => x / Z);
      // Gradient choice: compute the W-gradient from the PRE-UPDATE user vector
      // (snapshot below) so the user- and item-tower gradients are both taken at
      // the same point — a clean joint SGD step, not staggered/stale.
      const uPrev = u.slice();
      // cross-entropy gradient (target = index 0): dL/dlogit_k = (target_k - prob_k)
      for (let k = 0; k < cand.length; k++) {
        const err = (k === 0 ? 1 : 0) - probs[k];
        const g = err * lr;
        const v = vecs[k];
        const f = itemFeatures.get(cand[k])!;
        for (let d = 0; d < opts.dim; d++) u[d] += g * v[d];
        for (let r = 0; r < opts.dim; r++) {
          const gr = g * uPrev[r];
          for (let c = 0; c < featDim; c++) W[r][c] += gr * f[c];
        }
      }
    }
  }

  const itemVectors = new Map<string, number[]>();
  for (const id of items) itemVectors.set(id, l2normalize(itemVec(id)));
  const userVectors = new Map<string, number[]>();
  users.forEach((uId, i) => userVectors.set(uId, l2normalize(U[i])));

  return {
    itemVectors,
    userVector: (uId) => userVectors.get(uId) ?? null,
    userVectorFromItems: (ids) => {
      const vs = ids.map((id) => itemVectors.get(id)).filter((v): v is number[] => !!v);
      return vs.length ? l2normalize(meanPool(vs)) : null;
    },
  };
}
