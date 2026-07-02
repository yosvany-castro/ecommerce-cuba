/**
 * F6 W1 — The assembled end-to-end pipeline as ONE Ranker (spec §5 W1, step 3 of
 * `assembledPipelineRanker`).
 *
 * This composes the four thesis stages F1→F2→F3→F4 into a single `Ranker` that
 * the head-to-head harness drives over the SAME `UnifiedCase`s as every other
 * ranker (random, popular-cohort, cosine-e2hybrid, f2-multimode, f3-rrf, f3-ltr,
 * f4-knee, f4-revenue). It returns a FULL permutation over `case.candidates`
 * (catalog \ train) so positional metrics are apples-to-apples in both the `full`
 * and `pool` frames.
 *
 * Pipeline (spec §5 W1):
 *   F2 — interest modes / ephemeral recipient vector are already baked into the
 *        case: pool retrieval used the modes (or, when `giftSignal.isGift`, the
 *        recipient vector), so the "working set" of this stage IS `case.pool`.
 *   F3 — order the pool by either RRF (the pool's own fused order) or pointwise
 *        LTR (`ltrModel` over per-candidate F3 features). Candidates NOT in the
 *        pool form a deterministic TAIL ranked by popular-cohort fallback.
 *   F4 — when `cfg.f4Weights` is set, apply `multiObjectiveRanker` over the pooled
 *        items (scorer items from `case.objById`, limit=10 to bound the greedy),
 *        then concatenate the same non-pool tail. When `cfg.f4Weights` is null the
 *        pipeline stops at F3.
 *
 * Embedding-space discipline (spec hazard #5 — cosineSim THROWS on mismatch):
 *   every stage operates in E1 (prod2vec, 64d), the canonical `RankItem.vector`
 *   space. The scorer's diversity term reads `ScorerItem.vector` (E1), and LTR
 *   features reuse `extractFeatures` (E1 medoids vs E1 candidate vectors). No
 *   1024d text vectors ever enter the assembled path.
 *
 * No leakage (spec hazard #6):
 *   - LTR is trained TRAIN-SPLIT-ONLY (positives = the user's train purchases,
 *     negatives = sampled pool ids), exactly mirroring f3-study.ts. The held-out
 *     test purchase is never a training sample.
 *   - Gift intent / recipient demographics come from the F2 detector
 *     (`case.giftSignal`), never from `sim_sessions` GT.
 *
 * Determinism (spec §6): the LTR trainer uses the seeded RNG `makeRng(SEED=42)`;
 * negative sampling, epoch shuffles, and all tie-breaks are seed-determined. No
 * Math.random / Date.now. Pure module: no DB / network.
 */
import type { Ranker, RankItem, UserContext } from "../types";
import type { UnifiedCase } from "./unified-cases";
import {
  multiObjectiveRanker,
  type ObjectiveWeights,
  type ScorerItem,
} from "../objectives/scorer";
import { popularCohortRanker } from "./baselines";
import {
  extractFeatures,
  type FeatureContext,
  type FeatureCandidate,
} from "../rerank/features";
import { buildRecipientVector } from "../multivector/gift-vector";
import {
  trainLTR,
  type LtrModel,
  type LtrSample,
} from "../rerank/ltr";
import { makeRng } from "../data/rng";

// ── Constants (verbatim from f3-study.ts / f4-study.ts) ──────────────────────
/** Seed for the per-case LTR trainer (negatives + epoch shuffle). f3-study. */
const SEED = 42;
/** Greedy-loop bound for the F4 scorer — top-10 prefix only (f4-study K=10). */
const F4_LIMIT = 10;
/** LTR hyper-params, verbatim from f3-study.ts. */
const LTR_EPOCHS = 300;
const LTR_LR = 0.3;
/** Negatives sampled per case for LTR training, verbatim from f3-study.ts. */
const LTR_NEG_PER_CASE = 5;

/**
 * Balanced "knee" F4 weights (cfg8) committed by the F4 study — the min-max
 * normalized operating point that maximizes min(relN, revN). Verbatim from
 * docs/superpowers/reports/2026-06-07-thesis-f4-study.json `knee_pick.weights`.
 */
export const F4_KNEE_WEIGHTS: ObjectiveWeights = {
  relevance: 1,
  revenue: 0.5,
  margin: 0,
  diversity: 0,
  sellerFairness: 0,
  convProb: 0,
  novelty: 0,
};

/**
 * Revenue-max F4 weights (cfg18) — the KPI-selected (revenue-maximizing) operating
 * point of the F4 study. Verbatim from
 * docs/superpowers/reports/2026-06-07-thesis-f4-study.json `kpi_pick.weights`.
 */
export const F4_REVENUE_WEIGHTS: ObjectiveWeights = {
  relevance: 1,
  revenue: 1,
  margin: 0,
  diversity: 0.5,
  sellerFairness: 0,
  convProb: 0,
  novelty: 0,
};

// ── Public config ─────────────────────────────────────────────────────────────

export interface AssembledConfig {
  /** F3 stage: "rrf" keeps the pool's fused order; "ltr" reorders by the LTR model. */
  rerank: "rrf" | "ltr";
  /** F4 stage weights; null = skip F4 and stop the pipeline at F3. */
  f4Weights: ObjectiveWeights | null;
}

/**
 * Per-candidate catalog meta needed to build the F3 LTR feature vector
 * (`extractFeatures`), which `UnifiedCase` does not expose per-id. Supplied by the
 * runner from the SAME product-meta read the unified loader used, so the assembled
 * LTR features are identical to f3-study's. `vector` is the E1 (64d) vector.
 */
export interface FeatureMeta {
  vector: number[];
  priceBand: number;
  gender_target: string | null;
  ageBand: string | null;
}

/** id → FeatureMeta lookup over the full E1 universe (catalog representable in E1). */
export type FeatureMetaById = Map<string, FeatureMeta>;

/** Stable per-case key (matches f3-study's `${uid}|${testPid}`). */
function caseKey(c: UnifiedCase): string {
  return `${c.userId}|${[...c.relevant][0] ?? ""}`;
}

// ── F3 LTR feature construction (verbatim semantics from f3-study.ts) ─────────

/**
 * The F2-detector-routed FeatureContext for a case: when the detector flags a gift
 * AND the user has E1 history, the relevance medoid is the EPHEMERAL recipient
 * vector (mean of session/train items); otherwise the user's interest-mode
 * medoids. demoMatch routes through the detected recipient demographics on gift,
 * else the buyer's. Mirrors f3-study.ts feature ctx exactly.
 */
function featureCtxFor(
  c: UnifiedCase,
  lastViewedId: string | null,
  metaById: FeatureMetaById,
): FeatureContext {
  const isGift = c.giftSignal.isGift;
  const trainVecs = c.trainIds
    .map((id) => metaById.get(id)?.vector)
    .filter((v): v is number[] => v !== undefined && v.length > 0);
  // recipient vector when gift & history present; else the mode medoids.
  const modeMedoids =
    isGift && trainVecs.length > 0
      ? [buildRecipientVector(trainVecs)]
      : c.modes.map((m) => m.medoid);
  return {
    modeMedoids,
    budgetBand: c.budgetBandMode,
    buyerGender: c.buyerGender,
    buyerAgeBand: c.buyerAgeBand,
    isGift,
    recipientGender: c.recipientGender,
    recipientAgeBand: c.recipientAgeBand,
    lastViewedId,
  };
}

/**
 * Build the F3 LTR feature vector for one candidate id, using the case's detector-
 * routed feature ctx and the shared per-id catalog meta. `npmiToLastViewed` reads
 * the FULL last-viewed→npmi map (`case.lvNpmi`) — the same superset f3-study uses
 * for both pool candidates and train positives, so positives are not forced to 0
 * (which would re-introduce a pool-membership leak).
 */
function featuresForId(
  c: UnifiedCase,
  fCtx: FeatureContext,
  id: string,
  metaById: FeatureMetaById,
): number[] {
  const m = metaById.get(id);
  if (m === undefined) return [];
  const fc: FeatureCandidate = {
    id,
    vector: m.vector,
    priceBand: m.priceBand,
    gender_target: m.gender_target,
    ageBand: m.ageBand,
    npmiToLastViewed: c.lvNpmi.get(id) ?? 0,
    popularity: c.popById.get(id) ?? 0,
    // `sources` is not a feature (FEATURE_NAMES drops it); pass empty.
    sources: [],
  };
  return extractFeatures(fCtx, fc);
}

/**
 * Per-case POOL feature map (id → F3 feature vector), built exactly as f3-study
 * builds `featuresById` for the pool. The relevance medoid uses the case's
 * pool-time ctx (last-viewed populated), matching f3-study's pool feature pass.
 */
export function buildPoolFeatures(
  c: UnifiedCase,
  metaById: FeatureMetaById,
): Map<string, number[]> {
  const fCtx = featureCtxFor(c, c.lastViewedId, metaById);
  const out = new Map<string, number[]>();
  for (const p of c.pool) out.set(p.id, featuresForId(c, fCtx, p.id, metaById));
  return out;
}

/**
 * Per-case TRAIN-POSITIVE feature map (train id → F3 feature vector), built EXACTLY
 * as `trainAssembledLtr` builds positive samples: the detector-routed ctx with
 * `lastViewedId=null` (mirroring f3-study's positive pass), `npmiToLastViewed` via
 * the FULL last-viewed map (`case.lvNpmi`, NOT poolNpmi — positives are absent from
 * the pool, so poolNpmi would force them to 0 and re-introduce a membership leak).
 *
 * Exported so the W5 revenue-LTR trainer builds positives with the IDENTICAL
 * feature semantics as the relevance LTR — the two models differ ONLY in target,
 * never in features (apples-to-apples). Train-split-only: only `c.trainIds` are
 * featurized; the held-out test purchase is never included.
 */
export function buildPositiveFeatures(
  c: UnifiedCase,
  metaById: FeatureMetaById,
): Map<string, number[]> {
  const posCtx = featureCtxFor(c, null, metaById);
  const out = new Map<string, number[]>();
  for (const id of c.trainIds) {
    const f = featuresForId(c, posCtx, id, metaById);
    if (f.length === 0) continue;
    out.set(id, f);
  }
  return out;
}

// ── Per-case LTR training (TRAIN-SPLIT-ONLY, verbatim from f3-study.ts) ───────

export interface AssembledLtr {
  /** The trained pointwise LTR model (shared across all cases, like f3-study). */
  model: LtrModel;
  /** caseKey → per-pool feature map, for the assembled-ltr F3 reorder. */
  featuresByCaseKey: Map<string, Map<string, number[]>>;
}

/**
 * Train the assembled-pipeline LTR exactly as scripts/thesis/f3-study.ts does:
 *   - ONE shared model trained over ALL cases (no per-case model).
 *   - positives = each user's train purchases (features via the case's detector-
 *     routed ctx with lastViewedId=null, mirroring f3-study's positive pass).
 *   - negatives = 5 seeded-sampled POOL ids per case, excluding the test pid.
 *   - hyper-params epochs=300, lr=0.3, seed=42 (no leakage; test pid never sampled).
 *
 * Returns the model AND the per-case pool feature maps so the runner can build the
 * `assembled-ltr` ranker variant without recomputing features.
 */
export function trainAssembledLtr(
  cases: UnifiedCase[],
  metaById: FeatureMetaById,
): AssembledLtr {
  const featuresByCaseKey = new Map<string, Map<string, number[]>>();
  for (const c of cases) featuresByCaseKey.set(caseKey(c), buildPoolFeatures(c, metaById));

  const samples: LtrSample[] = [];
  const negRng = makeRng(SEED);
  for (const c of cases) {
    const poolFeatures = featuresByCaseKey.get(caseKey(c))!;
    // positives: train purchases — f3-study builds them with lastViewedId=null.
    const posCtx = featureCtxFor(c, null, metaById);
    for (const id of c.trainIds) {
      const f = featuresForId(c, posCtx, id, metaById);
      if (f.length === 0) continue;
      samples.push({ features: f, label: 1 });
    }
    // negatives: LTR_NEG_PER_CASE seeded pool ids, excluding the held-out test pid.
    const negPool = c.pool.map((p) => p.id).filter((id) => !c.relevant.has(id));
    for (let n = 0; n < LTR_NEG_PER_CASE && negPool.length > 0; n++) {
      const id = negPool[negRng.int(negPool.length)];
      samples.push({ features: poolFeatures.get(id) ?? [], label: 0 });
    }
  }

  const model = trainLTR(samples, { epochs: LTR_EPOCHS, lr: LTR_LR, seed: SEED });
  return { model, featuresByCaseKey };
}

// ── Assembled ranker ──────────────────────────────────────────────────────────

/**
 * Scorer items for the F4 stage, built from the case's pool objective features.
 * The E1 vector (for the scorer's diversity term) comes from `vecById`, which the
 * caller builds from the candidates passed to `rank()` — pool ids are a subset of
 * `candidates` (catalog \ train) so every pooled, feature-bearing id has a vector.
 */
function scorerItemsFor(c: UnifiedCase, vecById: Map<string, number[]>): ScorerItem[] {
  const items: ScorerItem[] = [];
  for (const p of c.pool) {
    const features = c.objById.get(p.id);
    const vec = vecById.get(p.id);
    if (features === undefined || vec === undefined) continue;
    items.push({ id: p.id, vector: vec, features });
  }
  return items;
}

/**
 * Build the assembled F1→F2→F3→F4 ranker for ONE case.
 *
 * @param c          the unified case (pool, modes, gift signal, objective features).
 * @param cfg        F3 rerank mode + F4 weights (null F4 = stop at F3).
 * @param ltrModel   the shared LTR model (REQUIRED when `cfg.rerank === "ltr"`).
 * @param featuresById  the case's pool feature map (REQUIRED when `cfg.rerank ===
 *                   "ltr"`) — from `trainAssembledLtr(...).featuresByCaseKey`. Kept
 *                   as a 4th param so the spec's 3-arg signature still type-checks
 *                   for the RRF variant.
 *
 * The returned `rank(ctx, candidates)` always emits EVERY candidate id exactly once:
 *   1. F3 orders the pool (RRF = pool order; LTR = LTR score desc, id tie-break).
 *   2. F4 (optional) re-orders the pooled prefix via `multiObjectiveRanker`.
 *   3. The non-pool tail (candidates \ pool) is appended in popular-cohort order.
 *   4. Any candidate missing from both (defensive) is appended in input order.
 */
export function assembledRankerFor(
  c: UnifiedCase,
  cfg: AssembledConfig,
  ltrModel?: LtrModel,
  featuresById?: Map<string, number[]>,
): Ranker {
  const name = `assembled-${cfg.rerank}${cfg.f4Weights ? "-f4" : ""}`;
  const poolIds = c.pool.map((p) => p.id);
  const poolSet = new Set(poolIds);

  return {
    name,
    rank(ctx: UserContext, candidates: RankItem[]): string[] {
      // ── F3: order the pool. ──────────────────────────────────────────────
      let pooled: string[];
      if (cfg.rerank === "ltr") {
        if (ltrModel === undefined || featuresById === undefined) {
          throw new Error(
            `[assembled] rerank='ltr' requires ltrModel + featuresById (case ${caseKey(c)})`,
          );
        }
        const model = ltrModel;
        const feats = featuresById;
        pooled = [...poolIds].sort(
          (a, b) =>
            model.score(feats.get(b) ?? []) - model.score(feats.get(a) ?? []) ||
            a.localeCompare(b),
        );
      } else {
        // RRF: the pool is ALREADY fused; its order is the F3-RRF ranking.
        pooled = [...poolIds];
      }

      // ── F4 (optional): multi-objective re-rank of the pooled prefix. ──────
      if (cfg.f4Weights) {
        // id → E1 vector from THIS call's candidate set (pool ⊆ candidates).
        const candById = new Map(candidates.map((x) => [x.id, x] as const));
        const vecById = new Map<string, number[]>();
        for (const x of candidates) vecById.set(x.id, x.vector);
        const items = scorerItemsFor(c, vecById);
        // Feed only pooled candidates, in F3 order, so the scorer's deterministic
        // tie-breaks and pointwise tail stay consistent with the F3 ranking.
        const scorerCands: RankItem[] = pooled
          .filter((id) => poolSet.has(id) && candById.has(id))
          .map((id) => candById.get(id)!);
        const ranker = multiObjectiveRanker(cfg.f4Weights, items, F4_LIMIT);
        // multiObjectiveRanker appends feature-less candidates in input order, so
        // its output already covers every fed pooled id; keep it as the prefix.
        pooled = ranker.rank(ctx, scorerCands);
      }

      // ── Tail: candidates NOT in the pool, in popular-cohort fallback order. ─
      const tailCands = candidates.filter((x) => !poolSet.has(x.id));
      const tail = popularCohortRanker().rank(ctx, tailCands);

      // ── Assemble full permutation (dedupe defensively). ──────────────────
      const out: string[] = [];
      const seen = new Set<string>();
      for (const id of pooled) {
        if (!seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
      for (const id of tail) {
        if (!seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
      // Defensive: any candidate not yet emitted (e.g. a pool id absent from the
      // candidate set in the pool-only frame) — append in input order.
      for (const cand of candidates) {
        if (!seen.has(cand.id)) {
          seen.add(cand.id);
          out.push(cand.id);
        }
      }
      return out;
    },
  };
}
