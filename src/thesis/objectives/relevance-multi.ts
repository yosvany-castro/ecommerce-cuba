/**
 * F6 W4 — Multi-signal relevance feature (spec §5 W4, §8-C).
 *
 * Closes the F4 attribution caveat. The F4 study's relevance FEATURE is a SINGLE
 * signal — max cosine of the candidate to the user's interest-mode medoids (≈ the
 * "retrieval" pool source alone). But the F3-RRF baseline that F4 measures itself
 * against fuses FOUR sources (retrieval + NPMI + popularity + exploration). So the
 * headline "−relevance%" of every reranked F4 config conflates TWO different
 * effects (f4-study.ts "Attribution caveat"):
 *
 *   (a) the single-signal-vs-fusion GAP — the relevance feature sees only the
 *       retrieval source, so a relevance-only multi-objective config is handicapped
 *       vs the 4-source fused baseline. This is a CONFOUND, not a trade-off cost.
 *   (b) the TRUE relevance↔revenue trade-off — what you actually pay in relevance
 *       to tilt the scorer toward revenue.
 *
 * This module supplies a relevance feature that FUSES the same family of signals
 * the baseline pool uses — retrieval-cosine + NPMI-to-last-viewed + cohort-
 * popularity — so a relevance-only multi-objective config can stand on equal
 * footing with the fused baseline. Swapping it in lets `f6-attribution.ts` separate
 * (a) from (b): measure the single→multi relevance gap at IDENTICAL weights (the
 * confound), then measure the relevance↔revenue trade-off WITH the multi-signal
 * relevance (the genuine cost).
 *
 * Fusion (two modes, both deterministic, both → [0,1]):
 *   - "rrf"  : Reciprocal Rank Fusion of the three per-candidate signal RANKINGS,
 *              mirroring the F3 pool fusion exactly (rrfFuse, k0=60). RRF is
 *              score-free (robust to the wildly different scales of cosine vs NPMI
 *              vs popularity), which is precisely why the pool uses it. The fused
 *              rrf_score is then min-max normalized across the candidate set to land
 *              in [0,1] (a feature must be a magnitude, not a rank).
 *   - "sum"  : Normalized weighted sum — each signal min-max normalized to [0,1]
 *              over the candidate set, then a convex-weighted combination. Mirrors a
 *              "normalized weighted sum" baseline signal.
 *
 * Embedding-space discipline (spec hazard #5 — cosineSim THROWS on dim mismatch):
 *   retrieval-cosine compares E1 (64d) medoids to E1 (64d) candidate vectors only.
 *   No 1024d text vectors ever enter this path.
 *
 * No leakage (spec hazard #6): every signal is inference-available — mode medoids
 * (built from train history), NPMI edges of the user's last-viewed product, and
 * catalog popularity. The held-out test purchase is never consulted. Deterministic:
 * pure functions, no Math.random / Date.now (tie-breaks by id).
 */
import { cosineSim } from "../embedders/space";
import { rrfFuse, type RankedList } from "@/sectors/d-personalization/retrieve/rrf";
import {
  extractObjectiveFeatures,
  type ObjCtx,
  type ObjCandidate,
  type ObjectiveName,
} from "./objective-features";

/** Fusion strategy for the three relevance signals. */
export type RelevanceFusion = "rrf" | "sum";

/**
 * Per-candidate inputs to the multi-signal relevance. `vector` is E1 (64d); the
 * NPMI and cohort-popularity signals are looked up by id from the maps in
 * `MultiRelevanceCtx`. Compatible with `ObjCandidate` (a superset of these fields)
 * so a caller can pass the same candidate object to both `extractObjectiveFeatures`
 * and this function.
 */
export interface MultiRelevanceCandidate {
  id: string;
  vector: number[];
}

/**
 * Context for the multi-signal relevance over a FIXED candidate set (a user's pool).
 * The maps are read-only; the function does not mutate them.
 */
export interface MultiRelevanceCtx {
  /** E1 (64d) interest-mode medoids — the retrieval-cosine signal source. */
  modeMedoids: number[][];
  /** id → NPMI score to the user's last-viewed product (0 / absent = no edge). */
  npmiByLastViewed: Map<string, number>;
  /** id → cohort-popularity (event count within the candidate's cohort). */
  cohortPopularity: Map<string, number>;
  /** Fusion strategy (default "rrf", mirroring the F3 pool). */
  fusion?: RelevanceFusion;
  /**
   * Convex weights for the "sum" fusion (ignored by "rrf"). Default equal thirds.
   * Need not sum to 1 — they are renormalized internally.
   */
  weights?: { retrieval: number; npmi: number; cohortPop: number };
}

/** Raw retrieval-cosine signal: max cosine to mode medoids, clamped to [0,1]. */
function retrievalSignal(modeMedoids: number[][], vector: number[]): number {
  if (modeMedoids.length === 0) return 0;
  return Math.max(0, Math.min(1, Math.max(...modeMedoids.map((m) => cosineSim(m, vector)))));
}

/** Min-max normalize a value within [lo, hi]; 0 when the range is degenerate. */
function minMax(x: number, lo: number, hi: number): number {
  const range = hi - lo;
  return range <= 0 ? 0 : Math.max(0, Math.min(1, (x - lo) / range));
}

/**
 * Build a `relevanceMultiSignal` lookup over a FIXED candidate set. Returns a
 * function id → [0,1] relevance. Pre-computing over the whole set is required: both
 * fusion modes need set-level statistics (RRF needs the per-signal rankings;
 * "sum" needs per-signal min/max for normalization). Pure & deterministic.
 *
 * @param ctx         medoids + NPMI + cohort-popularity maps + fusion config.
 * @param candidates  the candidate set the relevance is defined over (a user's pool).
 */
export function relevanceMultiSignal(
  ctx: MultiRelevanceCtx,
  candidates: MultiRelevanceCandidate[],
): (id: string) => number {
  const fusion = ctx.fusion ?? "rrf";

  // ── Per-signal raw values per candidate (deterministic id order). ───────────
  const ordered = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  const retr = new Map<string, number>();
  const npmi = new Map<string, number>();
  const pop = new Map<string, number>();
  for (const c of ordered) {
    retr.set(c.id, retrievalSignal(ctx.modeMedoids, c.vector));
    npmi.set(c.id, Math.max(0, ctx.npmiByLastViewed.get(c.id) ?? 0));
    pop.set(c.id, Math.max(0, ctx.cohortPopularity.get(c.id) ?? 0));
  }

  const out = new Map<string, number>();

  if (fusion === "rrf") {
    // ── RRF of the three per-signal RANKINGS (score-free; mirrors pool fusion). ─
    // Build each signal's ranked id list (desc by signal, id tie-break), feed to
    // rrfFuse exactly as buildCandidatePool does, then min-max the fused score so
    // the feature is a [0,1] magnitude rather than a raw RRF score.
    const rankList = (signal: Map<string, number>, source: string): RankedList => {
      const ids = [...ordered]
        .map((c) => c.id)
        .sort((a, b) => (signal.get(b)! - signal.get(a)!) || a.localeCompare(b));
      return { source, items: ids.map((id, i) => ({ id, rank: i + 1 })) };
    };
    const fused = rrfFuse([
      rankList(retr, "retrieval"),
      rankList(npmi, "npmi"),
      rankList(pop, "cohortPop"),
    ]);
    const scores = fused.map((f) => f.rrf_score);
    const lo = Math.min(...scores);
    const hi = Math.max(...scores);
    for (const f of fused) out.set(f.id, minMax(f.rrf_score, lo, hi));
    // Any candidate missing from the fused list (none in practice) → 0.
    for (const c of ordered) if (!out.has(c.id)) out.set(c.id, 0);
  } else {
    // ── Normalized weighted sum: min-max each signal, convex-combine. ──────────
    const w = ctx.weights ?? { retrieval: 1, npmi: 1, cohortPop: 1 };
    const wSum = w.retrieval + w.npmi + w.cohortPop;
    const wr = wSum > 0 ? w.retrieval / wSum : 0;
    const wn = wSum > 0 ? w.npmi / wSum : 0;
    const wp = wSum > 0 ? w.cohortPop / wSum : 0;
    const rangeOf = (m: Map<string, number>): [number, number] => {
      const vals = [...m.values()];
      return [Math.min(...vals), Math.max(...vals)];
    };
    const [rLo, rHi] = rangeOf(retr);
    const [nLo, nHi] = rangeOf(npmi);
    const [pLo, pHi] = rangeOf(pop);
    for (const c of ordered) {
      const v =
        wr * minMax(retr.get(c.id)!, rLo, rHi) +
        wn * minMax(npmi.get(c.id)!, nLo, nHi) +
        wp * minMax(pop.get(c.id)!, pLo, pHi);
      out.set(c.id, Math.max(0, Math.min(1, v)));
    }
  }

  return (id: string) => out.get(id) ?? 0;
}

/**
 * Like `extractObjectiveFeatures`, but with the `relevance` feature REPLACED by the
 * pre-computed multi-signal relevance (`relById`). Every other feature (margin,
 * convProb, novelty, sellerFairness, revenue) keeps its EXACT F4 definition.
 *
 * Note on coupling: in `extractObjectiveFeatures`, `convProb` and `revenue` are
 * functions of the relevance proxy (`affinity = relevance`). To keep this variant a
 * faithful "relevance feature swap" — i.e. ONLY the relevance feature changes — we
 * recompute `convProb` and `revenue` with the SAME `affinity` the F4 study used
 * (single-signal cosine-to-modes), NOT the fused relevance. This isolates the
 * confound to the `relevance` feature alone, so `f6-attribution.ts` measures the
 * single→multi gap on the relevance objective without silently perturbing the
 * outcome model. (The outcome model's affinity is the generator's click signal,
 * which is cosine-based; substituting a fused affinity there would change the
 * ground-truth-shaped revenue, not the feature.)
 *
 * @param ctx      the SAME ObjCtx fed to `extractObjectiveFeatures`.
 * @param cand     the candidate (E1 vector + catalog fields).
 * @param relById  id → multi-signal relevance from `relevanceMultiSignal(...)`.
 */
export function extractObjectiveFeaturesMulti(
  ctx: ObjCtx,
  cand: ObjCandidate,
  relById: (id: string) => number,
): Record<ObjectiveName, number> {
  const base = extractObjectiveFeatures(ctx, cand);
  const relMulti = Math.max(0, Math.min(1, relById(cand.id)));
  return { ...base, relevance: relMulti };
}
