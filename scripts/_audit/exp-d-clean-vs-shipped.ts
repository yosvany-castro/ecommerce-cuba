#!/usr/bin/env tsx
/**
 * AUDIT EXP D — Clean-vs-shipped head-to-head on the n=5000/seed=123 dataset.
 *
 * Replicates the F6 full-frame comparison (popular-cohort vs f3-rrf) with every
 * leak knob isolated, then all together:
 *   V0  shipped            (GATE: must reproduce the committed report numbers)
 *   V1  npmi-clean          co-occurrence graph from train sessions only
 *   V2  pop-clean           popularity from train sessions only
 *   V3  e1-clean            prod2vec retrained on train sessions only
 *   V4  serve-clean         anchor + gift context from the pre-purchase prefix
 *   V5  all-clean           V1+V2+V3+V4 (the honest number)
 *   V0∩ shipped on V3's universe (fair comparison frame for V3/V5)
 *
 * Extras (V0 frame): cynical price×margin ranker (revenue@10 gameability),
 * item-kNN co-occurrence (the 2003 "normal ecommerce" rival), realistic
 * popular-cohort (cohort = modal TRAIN subcategory instead of the test item's),
 * paired bootstrap CIs for the f3-rrf − popular-cohort delta (V0 and V5).
 */
import { writeFileSync } from "fs";
import { resolve } from "path";
import {
  loadData,
  buildPairCounts,
  buildNpmiTop,
  buildCases,
  rankPC,
  rankF3Rrf,
  rankPriceCynic,
  rankItemKnn,
  revenue10,
  pairedBootstrap,
  mean,
  type VariantKnobs,
} from "./lib";
import { ndcgAtK, recallAtK, mrr } from "@/thesis/eval/metrics";
import { toSessionSequences, type EventRow } from "@/thesis/embedders/sessions";
import { trainProd2Vec } from "@/thesis/embedders/prod2vec";

const OUT: string[] = [];
const log = (s: string) => {
  console.log(s);
  OUT.push(s);
};

const t0 = Date.now();
const d = loadData();
log(`[d] loaded: events=${d.events.length} testRows=${d.testRows.length} e1=${d.e1Shipped.size}`);

// ── Clean artifacts ───────────────────────────────────────────────────────────
const pairsTrain = buildPairCounts(d.events, d.testSessionIds);
const npmiTrain = buildNpmiTop(pairsTrain);
log(`[d] train-only NPMI built (${npmiTrain.size} productos con vecinos) t=${((Date.now() - t0) / 1000).toFixed(0)}s`);

const trainRows: EventRow[] = d.events
  .filter((ev) => !d.testSessionIds.has(ev.sid))
  .map((ev) => ({ session_id: ev.sid, product_id: ev.pid, occurred_at: ev.ts }));
const seqs = toSessionSequences(trainRows, 2);
log(`[d] retraining prod2vec on ${seqs.length} train-only sessions (dim=64 epochs=30 w=3 neg=5 seed=42) …`);
const e1Clean = trainProd2Vec(seqs, { dim: 64, epochs: 30, window: 3, negatives: 5, seed: 42 });
log(`[d] e1-clean: ${e1Clean.size} items (shipped: ${d.e1Shipped.size}) t=${((Date.now() - t0) / 1000).toFixed(0)}s`);

// intersection universe for fair V3/V5 comparison
const e1ShippedInter = new Map<string, number[]>();
for (const [id, v] of d.e1Shipped) if (e1Clean.has(id)) e1ShippedInter.set(id, v);
log(`[d] universo intersección: ${e1ShippedInter.size}`);

// ── Variant runner ────────────────────────────────────────────────────────────
interface VariantResult {
  name: string;
  n: number;
  pcNdcg: number[];
  f3Ndcg: number[];
  pcRecall: number;
  f3Recall: number;
  pcMrr: number;
  f3Mrr: number;
  nGift: number;
}

function runVariant(name: string, knobs: VariantKnobs): VariantResult {
  const cases = buildCases(d, knobs);
  const pcNdcg: number[] = [];
  const f3Ndcg: number[] = [];
  let pcR = 0,
    f3R = 0,
    pcM = 0,
    f3M = 0,
    nGift = 0;
  for (const c of cases) {
    const rel = new Set([c.pid]);
    const pc = rankPC(c);
    const f3 = rankF3Rrf(c);
    pcNdcg.push(ndcgAtK(pc, rel, 10));
    f3Ndcg.push(ndcgAtK(f3, rel, 10));
    pcR += recallAtK(pc, rel, 10);
    f3R += recallAtK(f3, rel, 10);
    pcM += mrr(pc, rel);
    f3M += mrr(f3, rel);
    if (c.intentGT === "gift") nGift++;
  }
  const n = cases.length;
  const r: VariantResult = {
    name,
    n,
    pcNdcg,
    f3Ndcg,
    pcRecall: pcR / n,
    f3Recall: f3R / n,
    pcMrr: pcM / n,
    f3Mrr: f3M / n,
    nGift,
  };
  const dPct = (mean(f3Ndcg) / mean(pcNdcg) - 1) * 100;
  log(
    `[d] ${name.padEnd(12)} n=${n} gift=${nGift} | PC ndcg10=${mean(pcNdcg).toFixed(3)} recall10=${r.pcRecall.toFixed(3)} | ` +
      `f3-rrf ndcg10=${mean(f3Ndcg).toFixed(3)} recall10=${r.f3Recall.toFixed(3)} | ventaja=${dPct >= 0 ? "+" : ""}${dPct.toFixed(1)}% | t=${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
  return r;
}

const shippedKnobs: VariantKnobs = {
  e1: d.e1Shipped,
  pop: d.popAll,
  npmi: d.npmiShipped,
  serve: "full",
  pcCohort: "oracle",
};

// V0 — gate vs the committed report (pc=0.088/0.179, f3=0.154/0.287)
const v0 = runVariant("V0-shipped", shippedKnobs);

// V1 — npmi-clean
runVariant("V1-npmi", { ...shippedKnobs, npmi: npmiTrain });
// V2 — pop-clean
runVariant("V2-pop", { ...shippedKnobs, pop: d.popTrain });
// V4 — serve-clean
runVariant("V4-serve", { ...shippedKnobs, serve: "prefix" });
// V0∩ — shipped restricted to the clean universe (fair frame for V3/V5)
const v0i = runVariant("V0∩-shipped", { ...shippedKnobs, e1: e1ShippedInter });
// V3 — e1-clean
runVariant("V3-e1", { ...shippedKnobs, e1: e1Clean });
// V5 — all clean
const v5 = runVariant("V5-ALL-clean", {
  e1: e1Clean,
  pop: d.popTrain,
  npmi: npmiTrain,
  serve: "prefix",
  pcCohort: "oracle",
});

// ── Bootstrap CIs ─────────────────────────────────────────────────────────────
for (const [label, v] of [
  ["V0-shipped", v0],
  ["V0∩-shipped", v0i],
  ["V5-ALL-clean", v5],
] as const) {
  const bs = pairedBootstrap(v.f3Ndcg, v.pcNdcg, 10000, 7);
  log(
    `[d] bootstrap ${label}: Δndcg10(f3−pc)=${bs.deltaMean.toFixed(4)} CI95=[${bs.ci95[0].toFixed(4)},${bs.ci95[1].toFixed(4)}] ` +
      `rel=${(100 * bs.relDelta).toFixed(1)}% relCI95=[${(100 * bs.relCi95[0]).toFixed(1)}%,${(100 * bs.relCi95[1]).toFixed(1)}%] pFlip=${bs.pSignFlip.toFixed(4)}`,
  );
}

// ── Rivals on the SHIPPED frame ───────────────────────────────────────────────
{
  const cases = buildCases(d, shippedKnobs);
  let priceN = 0,
    priceRev = 0,
    pcRev = 0,
    f3Rev = 0,
    knnR = 0,
    knnM = 0,
    pcRealN = 0;
  const knnNdcg: number[] = [];
  const f3NdcgAgain: number[] = [];
  for (const c of cases) {
    const rel = new Set([c.pid]);
    const price = rankPriceCynic(c, d.meta);
    priceN += ndcgAtK(price, rel, 10);
    priceRev += revenue10(c, price, d.meta, d.e1Shipped);
    pcRev += revenue10(c, rankPC(c), d.meta, d.e1Shipped);
    const f3 = rankF3Rrf(c);
    f3Rev += revenue10(c, f3, d.meta, d.e1Shipped);
    f3NdcgAgain.push(ndcgAtK(f3, rel, 10));
    const knn = rankItemKnn(c, d.npmiShipped);
    knnNdcg.push(ndcgAtK(knn, rel, 10));
    knnR += recallAtK(knn, rel, 10);
    knnM += mrr(knn, rel);
  }
  const n = cases.length;
  log(`[d] RIVALES (frame shipped, n=${n}):`);
  log(
    `[d]   price-cynic (precio×margen, 0 personalización): ndcg10=${(priceN / n).toFixed(3)} revenue10=${(priceRev / n).toFixed(0)} ` +
      `(vs PC rev=${(pcRev / n).toFixed(0)}, f3-rrf rev=${(f3Rev / n).toFixed(0)}; reporte f4-revenue rev=59955 ndcg=0.039)`,
  );
  const bsKnn = pairedBootstrap(knnNdcg, f3NdcgAgain, 10000, 7);
  log(
    `[d]   item-kNN co-ocurrencia (CF 2003): ndcg10=${mean(knnNdcg).toFixed(3)} recall10=${(knnR / n).toFixed(3)} mrr=${(knnM / n).toFixed(3)} ` +
      `vs f3-rrf ndcg10=${mean(f3NdcgAgain).toFixed(3)} | Δ(knn−f3)=${bsKnn.deltaMean.toFixed(4)} CI95=[${bsKnn.ci95[0].toFixed(4)},${bsKnn.ci95[1].toFixed(4)}]`,
  );

  // realistic PC (no oracle cohort) on shipped frame
  const casesReal = buildCases(d, { ...shippedKnobs, pcCohort: "train" });
  let pcRealNdcg = 0,
    pcRealRecall = 0;
  for (const c of casesReal) {
    const rel = new Set([c.pid]);
    const pc = rankPC(c);
    pcRealNdcg += ndcgAtK(pc, rel, 10);
    pcRealRecall += recallAtK(pc, rel, 10);
    pcRealN++;
  }
  log(
    `[d]   popular-cohort REALISTA (cohorte del TRAIN, sin oráculo): ndcg10=${(pcRealNdcg / pcRealN).toFixed(3)} recall10=${(pcRealRecall / pcRealN).toFixed(3)} (n=${pcRealN})`,
  );
}

// ── item-kNN on the ALL-CLEAN frame (fair world) ─────────────────────────────
{
  const cases = buildCases(d, {
    e1: e1Clean,
    pop: d.popTrain,
    npmi: npmiTrain,
    serve: "prefix",
    pcCohort: "oracle",
  });
  const knnNdcg: number[] = [];
  const f3Ndcg: number[] = [];
  for (const c of cases) {
    const rel = new Set([c.pid]);
    knnNdcg.push(ndcgAtK(rankItemKnn(c, npmiTrain), rel, 10));
    f3Ndcg.push(ndcgAtK(rankF3Rrf(c), rel, 10));
  }
  log(
    `[d]   item-kNN LIMPIO vs f3-rrf LIMPIO (n=${cases.length}): knn=${mean(knnNdcg).toFixed(3)} f3=${mean(f3Ndcg).toFixed(3)}`,
  );
}

writeFileSync(resolve(process.cwd(), "scripts/_audit/exp-d-results.txt"), OUT.join("\n") + "\n");
log(`[d] DONE t=${((Date.now() - t0) / 1000).toFixed(0)}s`);
