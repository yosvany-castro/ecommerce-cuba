import type { Ranker, RankItem, UserContext } from "../types";
import { cosineSim } from "./space";

/**
 * ColBERT-style late interaction at the CHUNK level. Each item is a small set of
 * chunk vectors (title / description / attributes); the query is a set of chunk
 * vectors too. MaxSim = sum over query chunks of the best matching doc chunk.
 * This approximates token-level ColBERT without a GPU/transformer — we use chunk
 * granularity instead of token granularity (a documented simplification).
 */
export function maxSim(query: number[][], doc: number[][]): number {
  if (query.length === 0 || doc.length === 0) return 0;
  let total = 0;
  for (const q of query) {
    let best = -Infinity;
    for (const d of doc) {
      const s = cosineSim(q, d);
      if (s > best) best = s;
    }
    total += best;
  }
  return total;
}

/**
 * A Ranker that scores candidates by MaxSim between the user's query chunks and
 * each item's chunks. queryChunksFor maps the user context → query chunk set.
 */
export function maxSimRanker(
  itemChunks: Map<string, number[][]>,
  queryChunksFor: (ctx: UserContext) => number[][] | null,
): Ranker {
  return {
    name: "e4-late-interaction",
    rank(ctx: UserContext, candidates: RankItem[]): string[] {
      const q = queryChunksFor(ctx) ?? [];
      return candidates
        .map((c) => ({ id: c.id, s: maxSim(q, itemChunks.get(c.id) ?? []) }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.id);
    },
  };
}
