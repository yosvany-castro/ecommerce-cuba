export const RRF_K0 = 60;

export interface RankedProduct {
  id: string;
  rank: number;        // 1-based
  score: number;       // BM25 or cosine raw score
}

export interface FusedProduct {
  id: string;
  rrf_score: number;
  ranks: { bm25?: number; cosine?: number };
}

export function rrfFuse(
  rankings: RankedProduct[][],
  k0: number = RRF_K0,
  listLabels: string[] = ["bm25", "cosine"],
): FusedProduct[] {
  const acc = new Map<string, FusedProduct>();
  rankings.forEach((ranking, listIdx) => {
    const label = listLabels[listIdx] ?? `list${listIdx}`;
    for (const item of ranking) {
      const reciprocal = 1 / (k0 + item.rank);
      const existing = acc.get(item.id);
      if (existing) {
        existing.rrf_score += reciprocal;
        (existing.ranks as Record<string, number>)[label] = item.rank;
      } else {
        acc.set(item.id, {
          id: item.id,
          rrf_score: reciprocal,
          ranks: { [label]: item.rank } as { bm25?: number; cosine?: number },
        });
      }
    }
  });
  return Array.from(acc.values()).sort((a, b) => b.rrf_score - a.rrf_score);
}
