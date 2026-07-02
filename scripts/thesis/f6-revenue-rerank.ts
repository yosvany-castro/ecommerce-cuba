#!/usr/bin/env tsx
/**
 * F6 W5 — Reranker trained on the BUSINESS OUTCOME (revenue) vs. the relevance
 * reranker vs. RRF (spec §5 W5).
 *
 * The thesis F3 LTR optimizes the binary purchase label (relevance). F4 dials
 * revenue via a multi-objective SCORER weight, but never *trains* a learner on
 * revenue. W5 closes that gap: it trains a pointwise LTR whose TARGET is the
 * item's expected revenue (P(buy)·price·margin, normalized), then asks the only
 * question that matters to a reseller whose every mock call costs real money:
 *
 *   Does an LTR trained on the business outcome beat RRF on revenue@10 while
 *   keeping nDCG@10 ≥ 0.7·RRF (relevance guardrail)?
 *
 * Three rerankers over IDENTICAL cases & candidates (the case's 4-source RRF(200)
 * pool — the pool frame isolates the value of the reranker GIVEN the retrieval,
 * which is what W5 is about; revenue@10 is defined over the pool's revenueById):
 *   - f3-rrf       : the pool's fused RRF order (no learner) — the baseline.
 *   - ltr-relevance: the F3 pointwise LTR (binary purchase label) — current.
 *   - ltr-revenue  : the W5 LTR (target = normalized expected revenue) — new.
 *
 * Reported per reranker: nDCG@10, recall@10, revenue@10, seller-gini@10
 * (+ nDCG@5/@20, MRR for context). Honest verdict either way.
 *
 * No leakage (spec hazard #6): BOTH learners are trained TRAIN-SPLIT-ONLY —
 * positives = each user's train purchases, negatives = seeded-sampled pool ids
 * with the held-out test pid EXCLUDED. Features are IDENTICAL across the two
 * learners (FEATURE_NAMES, built in E1 via assembled.ts helpers); the models
 * differ ONLY in their target. `intentGT` is never read here.
 *
 * Determinism (spec §6, hazard #2): seeded RNG only (makeRng); the only Date.now
 * is the report's generated_at stamp. No vector dim mixing (hazard #5): all cosine
 * math is in E1 (64d) via the shared loader.
 *
 * Item space = e1_prod2vec. Writes NOTHING to the DB.
 *
 * Usage:
 *   pnpm tsx scripts/thesis/f6-revenue-rerank.ts [--n 2000] [--seed 42]
 *                                                [--limit 0] [--out path-no-ext]
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { writeFileSync } from "fs";
import { getPgClient } from "@/lib/db/pg";
import { cosineSim } from "@/thesis/embedders/space";
import { loadUnifiedCases, type UnifiedCase } from "@/thesis/eval/unified-cases";
import {
  trainAssembledLtr,
  buildPositiveFeatures,
  type FeatureMetaById,
  type FeatureMeta,
} from "@/thesis/eval/assembled";
import { aggregateCases } from "@/thesis/eval/aggregate";
import type { EvalResult } from "@/thesis/eval/harness";
import { ltrRanker, type LtrModel } from "@/thesis/rerank/ltr";
import {
  trainRevenueLTR,
  revenueLtrRanker,
  type RevenueLtrSample,
} from "@/thesis/rerank/revenue-ltr";
import { FEATURE_NAMES } from "@/thesis/rerank/features";
import { revenueAtK, sellerExposureGini } from "@/thesis/eval/metrics";
import { expectedRevenue } from "@/thesis/objectives/outcome";
import { makeRng } from "@/thesis/data/rng";
import type { Ranker } from "@/thesis/types";

// ── Constants ─────────────────────────────────────────────────────────────────
const KS = [5, 10, 20];
const SEED = 42;
const K_BUS = 10; // revenue / seller-gini cutoff (spec @10).
const PRICE_BANDS = 4; // matches unified-cases.
// LTR hyper-params, verbatim from f3-study.ts / assembled.ts (apples-to-apples).
const LTR_EPOCHS = 300;
const LTR_LR = 0.3;
const LTR_NEG_PER_CASE = 5;
// Relevance guardrail: ltr-revenue must keep nDCG@10 ≥ this fraction of RRF's.
const RELEVANCE_GUARDRAIL = 0.7;

// ── CLI ───────────────────────────────────────────────────────────────────────
interface Cli {
  n: number;
  seed: number;
  limit: number;
  out: string | null;
}

function parseCli(argv: string[]): Cli {
  const cli: Cli = { n: 2000, seed: 42, limit: 0, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`[f6-rev] flag ${a} requires a value`);
      i++;
      return v;
    };
    switch (a) {
      case "--n":
        cli.n = parseInt(next(), 10);
        break;
      case "--seed":
        cli.seed = parseInt(next(), 10);
        break;
      case "--limit":
        cli.limit = parseInt(next(), 10);
        break;
      case "--out":
        cli.out = next();
        break;
      default:
        throw new Error(`[f6-rev] unknown flag: ${a}`);
    }
  }
  if (!Number.isFinite(cli.n) || cli.n <= 0) throw new Error(`[f6-rev] --n must be a positive int`);
  if (!Number.isFinite(cli.limit) || cli.limit < 0) throw new Error(`[f6-rev] --limit must be >= 0`);
  return cli;
}

const caseKeyOf = (c: UnifiedCase): string => `${c.userId}|${[...c.relevant][0] ?? ""}`;

/** Catalog meta needed to compute a train positive's expected revenue (loader formula). */
interface RevMeta {
  priceBand: number;
  priceCents: number;
  marginPct: number;
}

interface RerankerRow {
  name: string;
  res: EvalResult;
  revenue10: number;
  sellerGini10: number;
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  const pg = await getPgClient({ scope: "thesis" });
  try {
    // ── Load canonical cases (E1 64d). Loader reads the holdout intact. ─────────
    const loaded = await loadUnifiedCases(pg, cli.limit > 0 ? { limit: cli.limit } : undefined);
    const cases = loaded.cases;
    const e1Item = loaded.e1Item;

    // ── Product-count sanity check (mirrors f6-headtohead). A mis-set --n or a
    //    silently-regenerated dataset must fail loud, never mislabel the report. ─
    const productCount = parseInt(
      (await pg.query<{ c: string }>(`SELECT count(*)::text c FROM thesis.products`)).rows[0]?.c ??
        "0",
      10,
    );
    if (cli.limit === 0 && productCount !== cli.n) {
      throw new Error(
        `[f6-rev] product-count sanity check FAILED: thesis.products has ${productCount} rows ` +
          `but --n=${cli.n}. Refusing to mislabel the report. Pass the correct --n or inspect the dataset.`,
      );
    }

    // ── Per-id FeatureMeta (for the LTR features) + RevMeta (for positive revenue).
    //    One read, shared across both learners. ───────────────────────────────────
    const metaById: FeatureMetaById = new Map<string, FeatureMeta>();
    const revMetaById = new Map<string, RevMeta>();
    for (const r of (
      await pg.query<{ id: string; metadata: Record<string, unknown>; price_cents: number }>(
        `SELECT id::text id, metadata, price_cents FROM thesis.products`,
      )
    ).rows) {
      const m = r.metadata ?? {};
      const at = m.age_target as { min?: number; max?: number } | null | undefined;
      const priceBand = typeof m.price_band === "number" ? m.price_band : 0;
      const vec = e1Item.get(r.id);
      if (vec !== undefined) {
        metaById.set(r.id, {
          vector: vec,
          priceBand,
          gender_target: (m.gender_target as string | null) ?? null,
          ageBand: ageBandOfRange(at),
        });
      }
      revMetaById.set(r.id, {
        priceBand,
        priceCents: r.price_cents ?? 0,
        marginPct: typeof m.margin_pct === "number" ? m.margin_pct : 0,
      });
    }

    console.log(`[f6-rev] cases=${cases.length} e1-universe=${loaded.meta.n} products=${productCount}`);

    // ── Train the RELEVANCE LTR (binary purchase label), train-split-only. This
    //    gives the shared model AND the per-case POOL feature maps reused below. ─
    const relLtr = trainAssembledLtr(cases, metaById);
    const relModel: LtrModel = relLtr.model;

    // ── Build the REVENUE LTR samples from the IDENTICAL features (target = revenue).
    //    Positives = train purchases (their features via buildPositiveFeatures, their
    //    revenue via the loader's expectedRevenue formula). Negatives = the SAME
    //    seeded-sampled pool ids the relevance LTR uses (test pid excluded), with
    //    their pool revenueById. Revenue is normalized PER CASE by the case's max
    //    revenue (over positives ∪ pool) so the regression target is in [0,1] and
    //    comparable across cases. ────────────────────────────────────────────────
    const revSamples: RevenueLtrSample[] = [];
    const negRng = makeRng(SEED); // SAME seed/order as trainAssembledLtr's negatives.
    for (const c of cases) {
      const poolFeatures = relLtr.featuresByCaseKey.get(caseKeyOf(c))!;
      const posFeatures = buildPositiveFeatures(c, metaById);
      const modeMedoids = c.modes.map((m) => m.medoid);

      // Revenue of a train positive (NOT in the pool, so not in revenueById):
      // recompute via the loader's formula (affinity = clamp max-cos to modes,
      // priceFit from budgetBandMean). Pool ids use the loader's revenueById.
      const positiveRevenue = (id: string): number => {
        const rm = revMetaById.get(id);
        const vec = e1Item.get(id);
        if (rm === undefined || vec === undefined) return 0;
        const affinity = modeMedoids.length
          ? Math.max(0, Math.min(1, Math.max(...modeMedoids.map((md) => cosineSim(md, vec)))))
          : 0;
        const priceFit = Math.max(0, 1 - Math.abs(rm.priceBand - c.budgetBandMean) / (PRICE_BANDS - 1));
        return expectedRevenue({
          affinity,
          priceFit,
          price_cents: rm.priceCents,
          margin_pct: rm.marginPct,
        });
      };

      // Per-case max revenue for normalization (positives ∪ pool), floor 1 to avoid /0.
      let maxRev = 0;
      for (const id of c.trainIds) maxRev = Math.max(maxRev, positiveRevenue(id));
      for (const v of c.revenueById.values()) maxRev = Math.max(maxRev, v);
      const norm = maxRev > 0 ? maxRev : 1;

      // Positives: train purchases (same set the relevance LTR uses).
      for (const id of c.trainIds) {
        const f = posFeatures.get(id);
        if (f === undefined) continue;
        revSamples.push({ features: f, revenue: positiveRevenue(id) / norm, label: 1 });
      }
      // Negatives: LTR_NEG_PER_CASE seeded pool ids, test pid excluded — drawn in
      // the SAME order as trainAssembledLtr so the two learners see the same negs.
      const negPool = c.pool.map((p) => p.id).filter((id) => !c.relevant.has(id));
      for (let nn = 0; nn < LTR_NEG_PER_CASE && negPool.length > 0; nn++) {
        const id = negPool[negRng.int(negPool.length)];
        revSamples.push({
          features: poolFeatures.get(id) ?? [],
          revenue: (c.revenueById.get(id) ?? 0) / norm,
          label: 0,
        });
      }
    }
    const revModel: LtrModel = trainRevenueLTR(revSamples, {
      epochs: LTR_EPOCHS,
      lr: LTR_LR,
      seed: SEED,
      variant: "regression",
    });

    // ── Restrict candidates to the POOL frame (isolates the reranker; revenue@10
    //    is defined over the pool's revenueById). Every reranker sees the same set. ─
    const poolCases: UnifiedCase[] = cases.map((c) => {
      const candById = new Map(c.candidates.map((x) => [x.id, x] as const));
      const candidates = c.pool
        .map((p) => candById.get(p.id))
        .filter((x): x is (typeof c.candidates)[number] => x !== undefined);
      if (candidates.length !== c.pool.length) {
        throw new Error(
          `[f6-rev] pool frame: case ${c.userId} has ${c.pool.length} pool ids but only ` +
            `${candidates.length} resolved in candidates — pool/candidate mismatch.`,
        );
      }
      return { ...c, candidates };
    });

    // ── Reranker factories over the pool frame. ────────────────────────────────
    // f3-rrf: candidates are in pool/RRF order → identity rank (the fused order).
    const rrfFor = (): Ranker => ({
      name: "f3-rrf",
      rank: (_ctx, cands) => cands.map((x) => x.id),
    });
    const relFor = (c: UnifiedCase): Ranker => {
      const feats = relLtr.featuresByCaseKey.get(caseKeyOf(c))!;
      const inner = ltrRanker(relModel, feats);
      return { name: "ltr-relevance", rank: inner.rank };
    };
    const revFor = (c: UnifiedCase): Ranker => {
      const feats = relLtr.featuresByCaseKey.get(caseKeyOf(c))!;
      const inner = revenueLtrRanker(revModel, feats);
      return { name: "ltr-revenue", rank: inner.rank };
    };

    // ── Business metrics (revenue@10, seller-gini@10) for a factory over poolCases.
    const bizFor = (factory: (c: UnifiedCase) => Ranker): { revenue10: number; sellerGini10: number } => {
      let rev = 0,
        gini = 0;
      for (const c of poolCases) {
        const ranked = factory(c).rank(c.ctx, c.candidates);
        rev += revenueAtK(ranked, c.revenueById, K_BUS);
        gini += sellerExposureGini(ranked, c.sellerById, K_BUS);
      }
      const n = Math.max(1, poolCases.length);
      return { revenue10: rev / n, sellerGini10: gini / n };
    };

    // ── Evaluate every reranker on the SAME pool cases. ────────────────────────
    const registry: { name: string; factory: (c: UnifiedCase) => Ranker }[] = [
      { name: "f3-rrf", factory: rrfFor },
      { name: "ltr-relevance", factory: relFor },
      { name: "ltr-revenue", factory: revFor },
    ];
    const rows: RerankerRow[] = [];
    for (const { name, factory } of registry) {
      console.log(`[f6-rev] evaluating ${name} …`);
      const res = aggregateCases(poolCases, factory, KS, name);
      const { revenue10, sellerGini10 } = bizFor(factory);
      rows.push({ name, res, revenue10, sellerGini10 });
    }

    // ── Verdict: does ltr-revenue beat RRF on revenue@10 while nDCG@10 ≥ 0.7·RRF? ─
    const rrf = rows.find((r) => r.name === "f3-rrf")!;
    const rel = rows.find((r) => r.name === "ltr-relevance")!;
    const rev = rows.find((r) => r.name === "ltr-revenue")!;
    const ndcgFloor = RELEVANCE_GUARDRAIL * rrf.res.ndcg[10];
    const beatsRevenue = rev.revenue10 > rrf.revenue10;
    const keepsRelevance = rev.res.ndcg[10] >= ndcgFloor;
    const verdictPass = beatsRevenue && keepsRelevance;
    const pct = (cur: number, base: number): number => (base === 0 ? 0 : ((cur - base) / base) * 100);
    const revDeltaPct = pct(rev.revenue10, rrf.revenue10);
    const ndcgDeltaPct = pct(rev.res.ndcg[10], rrf.res.ndcg[10]);

    // ── Render markdown + JSON sidecar (house style of f6-headtohead / f3-study). ─
    const f3 = (x: number) => x.toFixed(3);
    const f4 = (x: number) => x.toFixed(4);
    const sgn = (x: number) => (x >= 0 ? "+" : "");

    const md: string[] = [];
    md.push("# Thesis F6 W5 — Reranker trained on the business outcome (revenue)", "");
    md.push(
      `Item space: e1_prod2vec (canonical 64d). n=${cli.n}, seed=${cli.seed}. ` +
        `E1 universe: ${loaded.meta.n}. Products: ${productCount}. ` +
        `Eval cases: ${poolCases.length}. Pool size: ${loaded.meta.poolSize}.`,
      "",
    );
    md.push(
      "**Pool frame** — candidates = each case's 4-source RRF(200) pool (excludes train). " +
        "Three rerankers over the IDENTICAL candidate set isolate the value of the LEARNER given the retrieval. " +
        "`f3-rrf` = the fused RRF order (no learner). `ltr-relevance` = the F3 pointwise LTR (binary purchase " +
        "label). `ltr-revenue` = the W5 LTR (target = normalized expected revenue). Both learners share the " +
        "EXACT same features (E1) and train-split-only samples; they differ ONLY in target. No ground-truth " +
        "leaks: positives = train purchases, negatives = seeded pool ids with the held-out test pid excluded.",
      "",
    );
    md.push("## Rerankers over the shared pool", "");
    md.push(
      "| Reranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | revenue@10 | seller-gini@10 |",
      "|---|---|---|---|---|---|---|---|",
    );
    for (const r of rows) {
      md.push(
        `| ${r.name} | ${f3(r.res.ndcg[5])} | ${f3(r.res.ndcg[10])} | ${f3(r.res.ndcg[20])} | ` +
          `${f3(r.res.recall[10])} | ${f3(r.res.mrr)} | ${f4(r.revenue10)} | ${f3(r.sellerGini10)} |`,
      );
    }
    md.push("");
    md.push("## Verdict — does ltr-revenue beat RRF on revenue@10 while keeping nDCG@10 ≥ 0.7·RRF?", "");
    md.push(
      `- revenue@10: ltr-revenue **${f4(rev.revenue10)}** vs RRF **${f4(rrf.revenue10)}** ` +
        `(${sgn(revDeltaPct)}${revDeltaPct.toFixed(1)}%) → beats RRF on revenue: **${beatsRevenue ? "YES" : "NO"}**.`,
    );
    md.push(
      `- nDCG@10: ltr-revenue **${f3(rev.res.ndcg[10])}** vs RRF **${f3(rrf.res.ndcg[10])}** ` +
        `(${sgn(ndcgDeltaPct)}${ndcgDeltaPct.toFixed(1)}%); guardrail floor 0.7·RRF = **${f3(ndcgFloor)}** → ` +
        `relevance kept: **${keepsRelevance ? "YES" : "NO"}**.`,
    );
    md.push(
      `- **Overall verdict: ${verdictPass ? "PASS" : "FAIL"}** — ltr-revenue ` +
        `${verdictPass ? "DOES" : "does NOT"} beat RRF on revenue@10 while holding nDCG@10 ≥ 0.7·RRF.`,
      "",
    );
    md.push("### Honest read", "");
    md.push(
      verdictPass
        ? `Training a pointwise LTR directly on the business outcome (expected revenue) **lifts revenue@10 by ` +
            `${sgn(revDeltaPct)}${revDeltaPct.toFixed(1)}% over RRF** while staying within the relevance guardrail ` +
            `(nDCG@10 ${f3(rev.res.ndcg[10])} ≥ ${f3(ndcgFloor)}). This is a genuinely new result: F4 dialed revenue ` +
            `via a hand-set scorer weight, whereas W5 LEARNS the revenue ranking from train-split data alone. ` +
            `Caveat (spec §10): the outcome model is synthetic (P·price·margin), so the lift is revenue of the ` +
            `MODEL, not of real users — the same caveat that bounds every F4/F6 revenue claim.`
        : `On this synthetic pool, the revenue-target LTR does **${beatsRevenue ? "lift revenue@10 but " : ""}NOT** ` +
            `clear the bar: ${
              !beatsRevenue
                ? `revenue@10 ${f4(rev.revenue10)} ≤ RRF ${f4(rrf.revenue10)}`
                : `nDCG@10 ${f3(rev.res.ndcg[10])} falls below the 0.7·RRF floor ${f3(ndcgFloor)}`
            }. ` +
            `Reported as-is per F6's honesty mandate. RRF fuses four sources whose top-10 is already revenue-dense; ` +
            `a pointwise learner on ${revSamples.length} samples has little headroom to re-sort it without paying ` +
            `relevance. The relevance LTR (nDCG@10 ${f3(rel.res.ndcg[10])}, revenue@10 ${f4(rel.revenue10)}) is ` +
            `tabled alongside so the relevance↔revenue trade-off of the two targets is visible, not hidden.`,
      "",
    );
    md.push("## Revenue-LTR feature weights (interpretability)", "");
    md.push("| feature | ltr-relevance | ltr-revenue |", "|---|---|---|");
    for (let i = 0; i < FEATURE_NAMES.length; i++) {
      md.push(
        `| ${FEATURE_NAMES[i]} | ${relModel.weights[i]?.toFixed(4) ?? "—"} | ${revModel.weights[i]?.toFixed(4) ?? "—"} |`,
      );
    }
    md.push(`| (bias) | ${relModel.bias.toFixed(4)} | ${revModel.bias.toFixed(4)} |`, "");

    const mdStr = md.join("\n") + "\n";

    const json = {
      generated_at: new Date().toISOString(),
      item_space: loaded.meta.space,
      frame: "pool",
      n: cli.n,
      seed: cli.seed,
      e1_universe: loaded.meta.n,
      product_count: productCount,
      pool_size: loaded.meta.poolSize,
      eval_cases: poolCases.length,
      ks: KS,
      relevance_guardrail: RELEVANCE_GUARDRAIL,
      revenue_ltr_variant: "regression",
      revenue_ltr_samples: revSamples.length,
      rerankers: rows.map((r) => ({
        name: r.name,
        ndcg: r.res.ndcg,
        recall: r.res.recall,
        map: r.res.map,
        hit: r.res.hit,
        mrr: r.res.mrr,
        revenue10: r.revenue10,
        seller_gini10: r.sellerGini10,
      })),
      verdict: {
        question:
          "does ltr-revenue beat RRF on revenue@10 while keeping nDCG@10 >= 0.7*RRF?",
        ndcg10_floor: ndcgFloor,
        revenue10_rrf: rrf.revenue10,
        revenue10_ltr_revenue: rev.revenue10,
        revenue10_delta_pct: revDeltaPct,
        ndcg10_rrf: rrf.res.ndcg[10],
        ndcg10_ltr_revenue: rev.res.ndcg[10],
        ndcg10_delta_pct: ndcgDeltaPct,
        beats_rrf_on_revenue: beatsRevenue,
        keeps_relevance: keepsRelevance,
        pass: verdictPass,
      },
      ltr_relevance_weights: Object.fromEntries(
        FEATURE_NAMES.map((name, i) => [name, relModel.weights[i] ?? 0]),
      ),
      ltr_relevance_bias: relModel.bias,
      ltr_revenue_weights: Object.fromEntries(
        FEATURE_NAMES.map((name, i) => [name, revModel.weights[i] ?? 0]),
      ),
      ltr_revenue_bias: revModel.bias,
    };

    const base =
      cli.out ??
      resolve(
        process.cwd(),
        `docs/superpowers/reports/2026-06-08-thesis-f6-revenue-rerank-n${cli.n}-seed${cli.seed}`,
      );
    const outMd = base.endsWith(".md") ? base : `${base}.md`;
    const outJson = base.endsWith(".md") ? base.replace(/\.md$/, ".json") : `${base}.json`;
    writeFileSync(outMd, mdStr);
    writeFileSync(outJson, JSON.stringify(json, null, 2) + "\n");

    console.log(mdStr);
    console.log(`[f6-rev] wrote ${outMd}`);
    console.log(`[f6-rev] wrote ${outJson}`);
  } finally {
    await pg.end();
  }
}

// ── Item age band from age_target range (matches unified-cases ageBandOf). ──────
function ageBandOfRange(at: { min?: number; max?: number } | null | undefined): string | null {
  if (!at || typeof at.min !== "number" || typeof at.max !== "number") return null;
  const mid = (at.min + at.max) / 2;
  if (mid <= 3) return "bebe";
  if (mid <= 11) return "nino";
  if (mid <= 25) return "joven";
  if (mid <= 59) return "adulto";
  return "mayor";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
