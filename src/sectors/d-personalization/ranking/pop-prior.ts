/**
 * Multiplicative popularity prior over a similarity-scored candidate list.
 *
 * Why this exists (auditoría destructiva 2026-06-09 + exp-I): pure cosine
 * retrieval is structurally popularity-blind — skip-gram pushes ultra-frequent
 * items toward the centroid, so cosine-to-modes ranks best-sellers LOW, exactly
 * the items people buy most. In the realistic (Zipf) simulated world this
 * collapses the vector path to nDCG@10 ≈ 0. Re-weighting each candidate by a
 * log popularity prior revived the vector path ×11 in exp-I
 * (scripts/_audit/exp-i-eta-sweep.ts, e1-views-pop).
 *
 *   score' = max(0, score) · ln(2 + pop)^strength
 *
 * - max(0, ·): a candidate with no positive similarity signal must stay at
 *   zero — popularity alone never manufactures personal relevance here (that
 *   is the popularity SOURCE's job, not the prior's).
 * - ln(2 + pop): dampened popularity; pop=0 keeps a neutral ln(2) factor so
 *   cold items are discounted, not erased.
 * - strength: 0 disables the prior (pure cosine ordering, modulo the max(0,·)
 *   clamp); 1 is the exp-I validated default; >1 leans further to popularity.
 *
 * Pure and deterministic: ties break by ascending id so the same inputs always
 * produce the same permutation (harness reproducibility requirement).
 */

export interface ScoredCandidate {
  id: string;
  /** Raw similarity score (e.g. cosine to the best user mode). */
  score: number;
}

export function applyPopularityPrior(
  candidates: readonly ScoredCandidate[],
  popOf: (id: string) => number,
  strength = 1,
): ScoredCandidate[] {
  return candidates
    .map(({ id, score }) => ({
      id,
      score:
        strength === 0
          ? Math.max(0, score)
          : Math.max(0, score) * Math.pow(Math.log(2 + Math.max(0, popOf(id))), strength),
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
