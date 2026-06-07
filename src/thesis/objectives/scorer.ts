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
 */
export function multiObjectiveRanker(weights: ObjectiveWeights, items: ScorerItem[]): Ranker {
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
      const selected: string[] = [];
      const selVecs: number[][] = [];
      while (remaining.length > 0) {
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
      const known = new Set(selected);
      for (const c of candidates) if (!known.has(c.id)) selected.push(c.id);
      return selected;
    },
  };
}
