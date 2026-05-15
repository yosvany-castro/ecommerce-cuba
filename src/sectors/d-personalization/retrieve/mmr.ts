import { normalize, cosine } from "@/lib/math";

export const MMR_LAMBDA = 0.7;

export interface MMRInput {
  candidates: { id: string; rrf_score: number }[];
  embeddings: Map<string, number[]>;
  k: number;
  lambda?: number;
}

export interface MMRItem {
  id: string;
  rrf_score: number;
  mmr_score: number;
}

/**
 * Maximal Marginal Relevance (Carbonell & Goldstein 1998).
 * mmr(item) = λ·rrf_score - (1-λ)·max_sim_to_selected
 *
 * Iterative greedy selection: first pick by max RRF, then for each next pick
 * find the candidate maximizing the MMR objective.
 */
export function mmrSelect(input: MMRInput): MMRItem[] {
  const lambda = input.lambda ?? MMR_LAMBDA;
  const selected: MMRItem[] = [];
  const remaining = [...input.candidates];

  const normCache = new Map<string, number[]>();
  function normFor(id: string): number[] | null {
    let v = normCache.get(id);
    if (v) return v;
    const raw = input.embeddings.get(id);
    if (!raw) return null;
    v = normalize(raw);
    normCache.set(id, v);
    return v;
  }

  if (remaining.length > 0) {
    remaining.sort((a, b) => b.rrf_score - a.rrf_score);
    const first = remaining.shift()!;
    selected.push({
      id: first.id,
      rrf_score: first.rrf_score,
      mmr_score: first.rrf_score,
    });
  }

  while (selected.length < input.k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const candN = normFor(cand.id);
      let maxSim = 0;
      if (candN) {
        for (const sel of selected) {
          const selN = normFor(sel.id);
          if (!selN) continue;
          const sim = cosine(candN, selN);
          if (sim > maxSim) maxSim = sim;
        }
      }
      const score = lambda * cand.rrf_score - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const picked = remaining.splice(bestIdx, 1)[0];
    selected.push({
      id: picked.id,
      rrf_score: picked.rrf_score,
      mmr_score: bestScore,
    });
  }

  return selected;
}
