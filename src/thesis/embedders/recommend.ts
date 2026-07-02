/**
 * Turns the academic score table into a PRODUCTION recommendation: which
 * embedder to deploy, trading retrieval quality against serving cost/latency.
 * Pure. The thesis reports the full table; the product ships the winner.
 *
 * score = quality − costWeight · normalizedCost, where quality blends nDCG@10
 * (relevance) and complement-recall@10 (cross-sell, a revenue lever).
 */
export interface SpaceScore {
  space: string;
  ndcg10: number;
  complementRecall10: number;
  servingCost: number; // relative units (1 = cheapest single dense vector)
}
export interface Recommendation {
  winner: string;
  ranked: { space: string; quality: number; utility: number }[];
}

export function recommendProductionSpace(
  scores: SpaceScore[],
  opts: { costWeight: number; qualityRelevanceWeight?: number },
): Recommendation {
  const wRel = opts.qualityRelevanceWeight ?? 0.6;
  const maxCost = Math.max(...scores.map((s) => s.servingCost), 1);
  const ranked = scores
    .map((s) => {
      const quality = wRel * s.ndcg10 + (1 - wRel) * s.complementRecall10;
      const utility = quality - opts.costWeight * (s.servingCost / maxCost);
      return { space: s.space, quality, utility };
    })
    .sort((a, b) => b.utility - a.utility || a.space.localeCompare(b.space));
  return { winner: ranked[0].space, ranked };
}
