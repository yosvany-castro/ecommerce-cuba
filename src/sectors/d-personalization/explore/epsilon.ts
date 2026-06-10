/**
 * ε-greedy slot exploration for the personalized feed, with per-slot serving
 * propensities — the minimal machinery that makes off-policy evaluation
 * (src/thesis/eval/ope.ts: IPS/SNIPS/DR) possible on real logs and protects the
 * retrain-on-own-recommendations loop from silent degeneration (Jiang et al.,
 * Degenerate Feedback Loops in Recommender Systems, AIES 2019).
 *
 * Semantics (per slot, independent Bernoulli(ε)):
 *   - with probability 1−ε the slot keeps the pipeline's item
 *     → source "exploit", propensity 1−ε (exact: the pipeline is deterministic
 *       given its inputs, so the only randomness is the exploration coin);
 *   - with probability ε the slot serves a UNIFORM draw from the remaining
 *     explore pool (candidates the pipeline retrieved but did not serve —
 *     plausible items, so exploration never shows nonsense)
 *     → source "explore", propensity ε / |pool at draw time|.
 *
 * Draws are without replacement (the pool shrinks as slots explore) and the
 * final slate never contains duplicates. With an empty pool or ε=0 the slate is
 * returned unchanged with propensity 1 (no randomness happened).
 *
 * Pure: all randomness comes from the injected `rng` (defaults to Math.random
 * in production; tests inject a seeded generator).
 */

export interface SlateItem {
  product_id: string;
  rank: number;
  reason: string;
}

export interface ExploredSlateItem extends SlateItem {
  source: "exploit" | "explore";
  /** Probability that THIS item was served in THIS slot under the policy. */
  propensity: number;
}

export interface EpsilonOpts {
  /** Per-slot exploration probability, in [0, 1]. */
  epsilon: number;
  /** Uniform RNG in [0, 1). Injectable for deterministic tests. */
  rng?: () => number;
}

export function applyEpsilonExploration(
  slate: SlateItem[],
  explorePool: readonly string[],
  opts: EpsilonOpts,
): ExploredSlateItem[] {
  const epsilon = Math.min(1, Math.max(0, opts.epsilon));
  const rng = opts.rng ?? Math.random;

  const inSlate = new Set(slate.map((s) => s.product_id));
  // Pool = retrieved-but-not-served candidates, deduped, minus the slate.
  const pool: string[] = [];
  const seen = new Set<string>();
  for (const id of explorePool) {
    if (inSlate.has(id) || seen.has(id)) continue;
    seen.add(id);
    pool.push(id);
  }

  if (epsilon === 0 || pool.length === 0) {
    // No randomness happened: the slate is the deterministic pipeline output.
    return slate.map((s) => ({ ...s, source: "exploit" as const, propensity: 1 }));
  }

  const out: ExploredSlateItem[] = [];
  for (const s of slate) {
    if (pool.length > 0 && rng() < epsilon) {
      const poolSize = pool.length;
      const idx = Math.min(poolSize - 1, Math.floor(rng() * poolSize));
      const [picked] = pool.splice(idx, 1);
      out.push({
        product_id: picked,
        rank: s.rank,
        reason: "",
        source: "explore",
        propensity: epsilon / poolSize,
      });
    } else {
      out.push({ ...s, source: "exploit", propensity: 1 - epsilon });
    }
  }
  return out;
}
