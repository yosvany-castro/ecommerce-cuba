import type { Ranker } from "../types";
import type { EvalCase, EvalResult } from "./harness";
import { recallAtK, ndcgAtK, mrr, mapAtK, hitRateAtK } from "./metrics";

/**
 * Like evaluateRanker, but the ranker may DEPEND on the case (needed for E4,
 * whose query is a per-user chunk set). Averages the same metric suite with the
 * same semantics (complement-recall averaged only over cases with complements).
 */
export function aggregateCases<C extends EvalCase>(cases: C[], rankerFor: (c: C) => Ranker, ks: number[], name: string): EvalResult {
  const recall: Record<number, number> = {}, ndcg: Record<number, number> = {}, map: Record<number, number> = {}, hit: Record<number, number> = {}, comp: Record<number, number> = {};
  for (const k of ks) { recall[k] = 0; ndcg[k] = 0; map[k] = 0; hit[k] = 0; comp[k] = 0; }
  let mrrSum = 0, compCases = 0;
  for (const c of cases) {
    const ranked = rankerFor(c).rank(c.ctx, c.candidates);
    for (const k of ks) {
      recall[k] += recallAtK(ranked, c.relevant, k);
      ndcg[k] += ndcgAtK(ranked, c.relevant, k);
      map[k] += mapAtK(ranked, c.relevant, k);
      hit[k] += hitRateAtK(ranked, c.relevant, k);
      if (c.complements) comp[k] += recallAtK(ranked, c.complements, k);
    }
    mrrSum += mrr(ranked, c.relevant);
    if (c.complements) compCases++;
  }
  const n = Math.max(1, cases.length);
  for (const k of ks) { recall[k] /= n; ndcg[k] /= n; map[k] /= n; hit[k] /= n; comp[k] = compCases > 0 ? comp[k] / compCases : 0; }
  return { ranker: name, n: cases.length, recall, ndcg, map, hit, mrr: mrrSum / n, complementRecall: comp };
}
