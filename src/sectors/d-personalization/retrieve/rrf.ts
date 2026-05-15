export const RRF_K0 = 60;

export interface RankedItem {
  id: string;
  rank: number;
}

export interface RankedList {
  source: string;
  items: RankedItem[];
}

export interface FusedItem {
  id: string;
  rrf_score: number;
  sources: string[];
}

/**
 * Reciprocal Rank Fusion (Cormack et al. 2009).
 * Score-free fusion of N ranked lists. Items appearing high in multiple lists
 * rank above items appearing high in only one list.
 *
 * score(item) = sum over lists L of 1 / (k0 + rank_L(item))
 */
export function rrfFuse(lists: RankedList[], k0 = RRF_K0): FusedItem[] {
  const acc = new Map<string, FusedItem>();
  for (const list of lists) {
    for (const item of list.items) {
      const reciprocal = 1 / (k0 + item.rank);
      const cur = acc.get(item.id);
      if (cur) {
        cur.rrf_score += reciprocal;
        if (!cur.sources.includes(list.source)) cur.sources.push(list.source);
      } else {
        acc.set(item.id, {
          id: item.id,
          rrf_score: reciprocal,
          sources: [list.source],
        });
      }
    }
  }
  return [...acc.values()].sort((a, b) => b.rrf_score - a.rrf_score);
}
