import { maxSimRanker } from "../embedders/maxsim";
import type { Ranker, UserContext } from "../types";

/**
 * Cross-encoder-style late-interaction reranker without a GPU/transformer: reuse
 * the F1 chunk-level MaxSim scorer as a query↔document interaction reranker over
 * the candidate pool. Thin wrapper that fixes the study-facing name.
 */
export function crossEncoderRanker(
  itemChunks: Map<string, number[][]>,
  queryChunksFor: (ctx: UserContext) => number[][] | null,
): Ranker {
  const inner = maxSimRanker(itemChunks, queryChunksFor);
  return { name: "cross-encoder-maxsim", rank: inner.rank };
}
