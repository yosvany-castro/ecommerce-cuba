import { cosineSim } from "../embedders/space";
import { rrfFuse, type RankedList } from "@/sectors/d-personalization/retrieve/rrf";
import type { RankItem } from "../types";
import type { UserMode } from "./modes";

export interface MultiModeOpts {
  /** Active user modes (self session). For a gift session, pass one mode with the recipient vector, weight 1. */
  modes: UserMode[];
  candidates: RankItem[];
  /** Base candidates pulled per mode before fusion; the actual quota is round(perModeK * weight), min 1. */
  perModeK: number;
}

/**
 * Multi-mode retrieval (PinnerSage serving): rank candidates by cosine to EACH
 * active mode, take a per-mode quota proportional to the mode's weight, fuse the
 * per-mode lists with Reciprocal Rank Fusion. Any candidate not pulled into a
 * quota is appended in deterministic id order so the result is a full permutation.
 * Diversity across modes is preserved instead of being averaged into a single
 * compromise vector. Does not mutate `candidates`.
 */
export function multiModeRank(opts: MultiModeOpts): string[] {
  if (opts.modes.length === 0) return [];
  const lists: RankedList[] = [];
  const seen = new Set<string>();

  opts.modes.forEach((mode, mi) => {
    const ranked = opts.candidates
      .map((c) => ({ id: c.id, s: cosineSim(mode.medoid, c.vector) }))
      .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id));
    const quota = Math.max(1, Math.round(opts.perModeK * mode.weight));
    const slice = ranked.slice(0, quota);
    for (const r of slice) seen.add(r.id);
    lists.push({ source: `mode_${mi}`, items: slice.map((r, idx) => ({ id: r.id, rank: idx + 1 })) });
  });

  const fused = rrfFuse(lists).map((f) => f.id);

  const tail = opts.candidates
    .map((c) => c.id)
    .filter((id) => !seen.has(id))
    .sort((a, b) => a.localeCompare(b));
  return [...fused, ...tail];
}
