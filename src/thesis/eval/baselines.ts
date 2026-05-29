import { makeRng } from "../data/rng";
import type { Ranker, RankItem, UserContext } from "../types";

/** Cosine similarity between two equal-length vectors. Returns 0 if either vector has zero norm. */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Random baseline: deterministic Fisher-Yates shuffle driven by `makeRng(seed)`.
 * Assigns each item a key from `rng.next()` then sorts — same seed always
 * yields the same permutation regardless of JS engine sort stability.
 * Does NOT mutate the input array.
 */
export function randomRanker(seed = 1): Ranker {
  return {
    name: "random",
    rank(_ctx: UserContext, candidates: RankItem[]): string[] {
      const rng = makeRng(seed);
      return candidates
        .slice()
        .map((item) => ({ id: item.id, key: rng.next() }))
        .sort((a, b) => a.key - b.key)
        .map((x) => x.id);
    },
  };
}

/**
 * Popular-global baseline: ranks all candidates by `popularity` descending.
 * Stable sort — equal-popularity items retain their original relative order.
 * Does NOT mutate the input array.
 */
export function popularGlobalRanker(): Ranker {
  return {
    name: "popular-global",
    rank(_ctx: UserContext, candidates: RankItem[]): string[] {
      return candidates
        .slice()
        .sort((a, b) => b.popularity - a.popularity)
        .map((item) => item.id);
    },
  };
}

/**
 * Popular-cohort baseline: items whose `cohort` matches `ctx.cohort` (non-null)
 * appear first (sorted by popularity desc), followed by all other items (sorted
 * by popularity desc). With a null `ctx.cohort` degrades to global popularity order.
 * Does NOT mutate the input array.
 */
export function popularCohortRanker(): Ranker {
  return {
    name: "popular-cohort",
    rank(ctx: UserContext, candidates: RankItem[]): string[] {
      if (ctx.cohort === null) {
        return candidates
          .slice()
          .sort((a, b) => b.popularity - a.popularity)
          .map((item) => item.id);
      }
      const inCohort = candidates
        .filter((item) => item.cohort === ctx.cohort)
        .sort((a, b) => b.popularity - a.popularity);
      const outCohort = candidates
        .filter((item) => item.cohort !== ctx.cohort)
        .sort((a, b) => b.popularity - a.popularity);
      return [...inCohort, ...outCohort].map((item) => item.id);
    },
  };
}

/**
 * Cosine-single-vector baseline: ranks candidates by cosine similarity between
 * `ctx.userVector` and `item.vector`, descending. Zero-norm vectors score 0.
 * Does NOT mutate the input array.
 */
export function cosineSingleVectorRanker(): Ranker {
  return {
    name: "cosine-single-vector",
    rank(ctx: UserContext, candidates: RankItem[]): string[] {
      return candidates
        .slice()
        .map((item) => ({ id: item.id, sim: cosine(ctx.userVector, item.vector) }))
        .sort((a, b) => b.sim - a.sim)
        .map((x) => x.id);
    },
  };
}
