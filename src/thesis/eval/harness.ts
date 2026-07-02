/**
 * Eval harness aggregator for the thesis personalization program.
 *
 * `evaluateRanker` drives a `Ranker` over a set of `EvalCase` instances and
 * returns a fully-averaged `EvalResult` covering the standard IR metric suite
 * (Recall, nDCG, MAP, Hit-Rate, MRR) at one or more cutoffs k, plus an
 * optional complement-recall dimension averaged only over cases that supply a
 * `complements` set.
 *
 * Design constraints:
 *   - Pure module: no DB, network, Date.now, or Math.random calls.
 *   - TypeScript strict-mode compatible; all record keys are initialised up-front.
 *   - The complement-recall denominator tracks only cases that define complements,
 *     so the metric is not diluted by cases that do not model cross-category recall.
 */

import type { Ranker, UserContext, RankItem } from "../types";
import {
  recallAtK,
  ndcgAtK,
  mrr,
  mapAtK,
  hitRateAtK,
} from "./metrics";

// ─── Public types ─────────────────────────────────────────────────────────────

/** A single evaluation case: the ranking context, candidate pool, and ground truth. */
export interface EvalCase {
  /** The user context passed to the ranker. */
  ctx: UserContext;
  /** Full candidate pool that the ranker must sort. */
  candidates: RankItem[];
  /** Ground-truth set of relevant item IDs for primary metric computation. */
  relevant: Set<string>;
  /**
   * Optional ground-truth complement item IDs.
   * When provided, `complementRecall@k` is computed and accumulated into the
   * per-k complement averages. Cases without this field are excluded from the
   * complement denominator.
   */
  complements?: Set<string>;
}

/** Averaged metric suite returned by `evaluateRanker`. */
export interface EvalResult {
  /** Name of the evaluated ranker (taken from `ranker.name`). */
  ranker: string;
  /** Number of eval cases processed. */
  n: number;
  /** Recall@k averaged over all cases, keyed by k. */
  recall: Record<number, number>;
  /** nDCG@k averaged over all cases, keyed by k. */
  ndcg: Record<number, number>;
  /** MAP@k averaged over all cases, keyed by k. */
  map: Record<number, number>;
  /** Hit-Rate@k averaged over all cases, keyed by k. */
  hit: Record<number, number>;
  /** MRR averaged over all cases (no cutoff). */
  mrr: number;
  /**
   * Complement Recall@k averaged only over cases that define `complements`,
   * keyed by k. Equals 0 at each k when no case defines complements.
   */
  complementRecall: Record<number, number>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run `ranker` on every eval case and return averaged metrics at each of the
 * requested cutoffs `ks`.
 *
 * @param ranker  The `Ranker` implementation under evaluation.
 * @param cases   Array of `EvalCase` instances (may be empty).
 * @param ks      Cutoff values at which to compute k-dependent metrics (e.g. [1, 3, 5]).
 * @returns       Fully-averaged `EvalResult`; all metrics are 0 for empty `cases`.
 */
export function evaluateRanker(
  ranker: Ranker,
  cases: EvalCase[],
  ks: number[],
): EvalResult {
  // Initialise per-k accumulators at 0.
  const recallSum: Record<number, number> = {};
  const ndcgSum: Record<number, number> = {};
  const mapSum: Record<number, number> = {};
  const hitSum: Record<number, number> = {};
  const complementSum: Record<number, number> = {};

  for (const k of ks) {
    recallSum[k] = 0;
    ndcgSum[k] = 0;
    mapSum[k] = 0;
    hitSum[k] = 0;
    complementSum[k] = 0;
  }

  let mrrSum = 0;
  // Track the number of cases that supply complements per k (same for all k, but
  // stored per-k to keep the shape consistent with the output record).
  let complementCaseCount = 0;

  for (const ec of cases) {
    const ranked = ranker.rank(ec.ctx, ec.candidates);

    // Accumulate k-dependent primary metrics.
    for (const k of ks) {
      recallSum[k] += recallAtK(ranked, ec.relevant, k);
      ndcgSum[k] += ndcgAtK(ranked, ec.relevant, k);
      mapSum[k] += mapAtK(ranked, ec.relevant, k);
      hitSum[k] += hitRateAtK(ranked, ec.relevant, k);
    }

    // MRR has no cutoff.
    mrrSum += mrr(ranked, ec.relevant);

    // Complement recall — only when the case provides a complements set.
    if (ec.complements !== undefined) {
      complementCaseCount++;
      for (const k of ks) {
        complementSum[k] += recallAtK(ranked, ec.complements, k);
      }
    }
  }

  const n = cases.length;
  // Use max(1, n) for the primary-metric denominator so division is safe; the
  // actual count is preserved in `result.n` and callers can gate on `n === 0`.
  const primaryDenom = Math.max(1, n);

  const recall: Record<number, number> = {};
  const ndcg: Record<number, number> = {};
  const map: Record<number, number> = {};
  const hit: Record<number, number> = {};
  const complementRecall: Record<number, number> = {};

  for (const k of ks) {
    recall[k] = recallSum[k] / primaryDenom;
    ndcg[k] = ndcgSum[k] / primaryDenom;
    map[k] = mapSum[k] / primaryDenom;
    hit[k] = hitSum[k] / primaryDenom;
    // Average complement recall ONLY over cases that define complements.
    complementRecall[k] =
      complementCaseCount > 0 ? complementSum[k] / complementCaseCount : 0;
  }

  return {
    ranker: ranker.name,
    n,
    recall,
    ndcg,
    map,
    hit,
    mrr: mrrSum / primaryDenom,
    complementRecall,
  };
}
