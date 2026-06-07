import { cosineSim } from "../embedders/space";
import type { Ranker, RankItem, UserContext } from "../types";
import { OBJECTIVE_NAMES, type ObjectiveName } from "./objective-features";

/** A candidate with its precomputed pointwise objective features + vector (for diversity). */
export interface ScorerItem {
  id: string;
  vector: number[];
  features: Record<ObjectiveName, number>;
}

/** Weights for the pointwise objectives plus the marginal `diversity` term. */
export type ObjectiveWeights = Record<ObjectiveName, number> & { diversity: number };

/**
 * Multi-objective scorer s(p|u) = Σ_k λ_k·f_k(p) + λ_diversity·diversityMarginal(p,S).
 * Greedy selection (MMR-style): at each step pick the unselected candidate with the
 * highest score, where diversityMarginal = 1 − max cosine to already-selected items.
 * Pure, deterministic (tie-break by id). Returns a full permutation; never mutates input.
 *
 * `limit` bounds the expensive greedy loop: only the top-`limit` prefix is computed via
 * the O(pool²·dim) diversity-marginal greedy; the remaining scorable candidates are
 * appended by POINTWISE score descending (tie-break by id), which is irrelevant to any
 * metric@k with k ≤ limit. When `limit` is undefined the full greedy runs as before, so
 * existing callers are unaffected. The result is always a full permutation.
 */
export function multiObjectiveRanker(weights: ObjectiveWeights, items: ScorerItem[], limit?: number): Ranker {
  const byId = new Map(items.map((it) => [it.id, it]));
  const pointwise = (it: ScorerItem): number => {
    let s = 0;
    for (const k of OBJECTIVE_NAMES) s += weights[k] * it.features[k];
    return s;
  };
  return {
    name: "multi-objective",
    rank(_ctx: UserContext, candidates: RankItem[]): string[] {
      const remaining = candidates.map((c) => c.id).filter((id) => byId.has(id));
      const greedyTarget = Math.min(limit ?? Infinity, remaining.length);
      const selected: string[] = [];
      const selVecs: number[][] = [];
      while (remaining.length > 0 && selected.length < greedyTarget) {
        let bestIdx = 0;
        let bestScore = -Infinity;
        for (let i = 0; i < remaining.length; i++) {
          const it = byId.get(remaining[i])!;
          const div = selVecs.length === 0 ? 1 : 1 - Math.max(...selVecs.map((v) => cosineSim(v, it.vector)));
          const score = pointwise(it) + weights.diversity * div;
          if (score > bestScore + 1e-12 || (Math.abs(score - bestScore) <= 1e-12 && remaining[i] < remaining[bestIdx])) {
            bestScore = score;
            bestIdx = i;
          }
        }
        const chosen = remaining.splice(bestIdx, 1)[0];
        selected.push(chosen);
        selVecs.push(byId.get(chosen)!.vector);
      }
      // Remaining scorable candidates: pointwise score desc, tie-break by id (deterministic).
      const tail = remaining
        .map((id) => ({ id, s: pointwise(byId.get(id)!) }))
        .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
        .map((x) => x.id);
      for (const id of tail) selected.push(id);
      // Candidates with no features (not in `items`): input order, as today.
      const known = new Set(selected);
      for (const c of candidates) if (!known.has(c.id)) selected.push(c.id);
      return selected;
    },
  };
}
