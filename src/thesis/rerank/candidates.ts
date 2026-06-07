import { rrfFuse, type RankedList } from "@/sectors/d-personalization/retrieve/rrf";

/** A candidate in the fused pool, with the sources that contributed it. */
export interface PooledCandidate {
  id: string;
  sources: string[];
  rrf_score: number;
}

export interface SourceList {
  source: string;
  ids: string[]; // ranked ids (best first)
}

/**
 * Build the large multi-source candidate pool: fuse per-source ranked lists with
 * Reciprocal Rank Fusion (items appearing in multiple sources rank higher), tag
 * each candidate with its contributing sources, cap at poolSize. Deterministic.
 */
export function buildCandidatePool(sources: SourceList[], poolSize: number): PooledCandidate[] {
  const lists: RankedList[] = sources.map((s) => ({
    source: s.source,
    items: s.ids.map((id, i) => ({ id, rank: i + 1 })),
  }));
  const fused = rrfFuse(lists);
  return fused.slice(0, poolSize).map((f) => ({ id: f.id, sources: f.sources, rrf_score: f.rrf_score }));
}
