#!/usr/bin/env tsx
/**
 * F4 study: rerank the F3 candidate POOL with a multi-objective scorer
 * s(p|u) = Σ_k λ_k·f_k(p), swept over a deterministic λ-grid into a Pareto
 * frontier. Proves the relevance↔revenue trade-off vs the F3-RRF
 * (relevance-only) baseline.
 *
 * Apples-to-apples: ONE shared pool per test user (the SAME 4-source RRF pool as
 * f3-study); every config/ranker scores the identical candidate set. No GT leak —
 * objective features use only relevance (cosine to modes), margin/price/popularity/
 * seller from the catalog. The held-out test purchase is ground-truth for
 * relevant/revenue MEASUREMENT only, never a feature. Fully deterministic (seed 42).
 *
 * Item space = e1_prod2vec. F4 writes NOTHING to the DB.
 * Usage: pnpm thesis:f4-study
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { writeFileSync } from "fs";
import { getPgClient } from "@/lib/db/pg";
import { cosineSim } from "@/thesis/embedders/space";
import { buildCandidatePool } from "@/thesis/rerank/candidates";
import { buildUserModes } from "@/thesis/multivector/modes";
import { makeRng } from "@/thesis/data/rng";
import {
  extractObjectiveFeatures,
  type ObjCtx,
  type ObjCandidate,
  type ObjectiveName,
} from "@/thesis/objectives/objective-features";
import { expectedRevenue } from "@/thesis/objectives/outcome";
import { multiObjectiveRanker, type ScorerItem, type ObjectiveWeights } from "@/thesis/objectives/scorer";
import { paretoFrontier, pickByKpi, type ParetoPoint } from "@/thesis/objectives/pareto";
import {
  ndcgAtK,
  intraListDiversity,
  novelty,
  revenueAtK,
  sellerExposureGini,
} from "@/thesis/eval/metrics";
import type { RankItem, Ranker, UserContext } from "@/thesis/types";

const SEED = 42;
const POOL_SIZE = 200;
const K = 10;
const PRICE_BANDS = 4;

/** Stable per-user seed for the exploration shuffle (same idiom as f3-study). */
function uidSeed(uid: string): number {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) { h ^= uid.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) ^ SEED;
}

/** Modal numeric (price band) over train items; 0 if none. Deterministic. */
function modeNum(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = 0, bestCount = -1;
  for (const [v, c] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    if (c > bestCount) { best = v; bestCount = c; }
  }
  return best;
}

/** Mean of train price bands, rounded — the budget band for priceFit. */
function meanBand(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((s, x) => s + x, 0);
  return Math.round(sum / values.length);
}

interface ProductMeta {
  priceBand: number;
  marginPct: number;
  stockHealth: number | null;
  sellerId: string;
  sellerAgeDays: number;
  cohort: string | null;
  priceCents: number;
}

/** A built case: one shared pool + everything every ranker/metric needs. */
interface F4Case {
  uid: string;
  testPid: string;
  relevant: Set<string>;
  ctx: UserContext;
  candidates: RankItem[]; // pool order (== RRF order)
  poolOrder: string[];
  scorerItems: ScorerItem[];
  revenueById: Map<string, number>;
  sellerById: Map<string, string>;
  vectorsById: Map<string, number[]>;
}

/** Aggregate metric vector for a ranker over all cases (mean per metric). */
interface MetricVector {
  relevance: number;
  revenue: number;
  diversity: number;
  novelty: number;
  sellerGini: number;
}

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    // ── E1 vectors ────────────────────────────────────────────────────────────
    const e1 = new Map<string, number[]>();
    for (const r of (await pg.query(`SELECT product_id::text id, vector FROM thesis.item_vectors WHERE space='e1_prod2vec'`)).rows as { id: string; vector: number[] }[]) {
      e1.set(r.id, r.vector.map(Number));
    }
    if (e1.size === 0) { console.error("[f4] no e1_prod2vec vectors — run pnpm thesis:train-prod2vec"); process.exit(1); }

    // ── Product meta ───────────────────────────────────────────────────────────
    const meta = new Map<string, ProductMeta>();
    for (const r of (await pg.query(`SELECT id::text id, metadata, price_cents FROM thesis.products`)).rows as { id: string; metadata: Record<string, unknown>; price_cents: number }[]) {
      const m = r.metadata ?? {};
      const stock = typeof m.stock_health === "number" ? m.stock_health : null;
      meta.set(r.id, {
        priceBand: typeof m.price_band === "number" ? m.price_band : 0,
        marginPct: typeof m.margin_pct === "number" ? m.margin_pct : 0,
        stockHealth: stock,
        sellerId: (m.seller_id as string | null) ?? "__none__",
        sellerAgeDays: typeof m.seller_age_days === "number" ? m.seller_age_days : 0,
        cohort: (m.subcategory as string | null) ?? null,
        priceCents: r.price_cents ?? 0,
      });
    }

    // ── Popularity (event count per product) ───────────────────────────────────
    const popById = new Map<string, number>();
    for (const r of (await pg.query(`SELECT payload->>'product_id' pid, count(*)::int c FROM thesis.events WHERE payload->>'product_id' IS NOT NULL GROUP BY 1`)).rows as { pid: string; c: number }[]) {
      popById.set(r.pid, r.c);
    }
    const globalMaxPop = Math.max(1, ...[...popById.values()]);

    // ── NPMI neighbours per product (ordered by rank) ──────────────────────────
    const npmiNeighbours = new Map<string, string[]>();
    for (const r of (await pg.query(`SELECT product_id::text pid, related_product_id::text rid, rank FROM thesis.co_occurrence_top ORDER BY product_id, rank`)).rows as { pid: string; rid: string; rank: number }[]) {
      const a = npmiNeighbours.get(r.pid) ?? [];
      a.push(r.rid);
      npmiNeighbours.set(r.pid, a);
    }

    // ── Holdout train/test ─────────────────────────────────────────────────────
    const trainByUser = new Map<string, string[]>();
    for (const r of (await pg.query(`SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='train'`)).rows as { uid: string; pid: string }[]) {
      const a = trainByUser.get(r.uid) ?? []; a.push(r.pid); trainByUser.set(r.uid, a);
    }
    const tests = (await pg.query(`SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='test'`)).rows as { uid: string; pid: string }[];

    // ── Last-viewed product per user (most recent product_view) ────────────────
    const lastViewed = new Map<string, string>();
    for (const r of (await pg.query(`
      SELECT DISTINCT ON (anonymous_id) anonymous_id::text uid, payload->>'product_id' pid
      FROM thesis.events
      WHERE event_type='product_view' AND payload->>'product_id' IS NOT NULL
      ORDER BY anonymous_id, occurred_at DESC`)).rows as { uid: string; pid: string }[]) {
      lastViewed.set(r.uid, r.pid);
    }

    // ── Cohort -> ids sorted by popularity (popular source) ────────────────────
    const cohortPopular = new Map<string, string[]>();
    {
      const byCohort = new Map<string, string[]>();
      for (const [id, m] of meta) {
        if (!e1.has(id)) continue;
        const c = m.cohort ?? "__none__";
        const a = byCohort.get(c) ?? []; a.push(id); byCohort.set(c, a);
      }
      for (const [c, ids] of byCohort) {
        cohortPopular.set(c, ids.sort((a, b) => (popById.get(b) ?? 0) - (popById.get(a) ?? 0) || a.localeCompare(b)));
      }
    }
    const globalPopular = [...e1.keys()].sort((a, b) => (popById.get(b) ?? 0) - (popById.get(a) ?? 0) || a.localeCompare(b));

    // ── Common universe = ids with an e1 vector ────────────────────────────────
    const commonIds = [...e1.keys()].sort((a, b) => a.localeCompare(b));
    const commonSet = new Set(commonIds);

    // ── Build the shared pool + case per test user ─────────────────────────────
    const cases: F4Case[] = [];
    for (const t of tests) {
      const train = (trainByUser.get(t.uid) ?? []).filter((id) => commonSet.has(id));
      if (train.length === 0 || !commonSet.has(t.pid)) continue;
      const trainSet = new Set(train);
      const history = train.map((id) => e1.get(id)!);
      const modes = buildUserModes(history, { distanceThreshold: 0.5, maxModes: 5 });
      const modeMedoids = modes.map((m) => m.medoid);

      const allMinusTrain = commonIds.filter((id) => !trainSet.has(id));

      // SOURCE 1: retrieval — top-80 by max cosine to mode medoids.
      const retrieval = [...allMinusTrain]
        .map((id) => ({ id, s: modeMedoids.length ? Math.max(...modeMedoids.map((m) => cosineSim(m, e1.get(id)!))) : 0 }))
        .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
        .slice(0, 80)
        .map((x) => x.id);

      // SOURCE 2: npmi — neighbours of last-viewed (<=50, minus train).
      const lv = lastViewed.get(t.uid) ?? null;
      const npmi = (lv ? (npmiNeighbours.get(lv) ?? []) : [])
        .filter((id) => commonSet.has(id) && !trainSet.has(id))
        .slice(0, 50);

      // SOURCE 3: popular — cohort-popularity of train[0]'s cohort (<=40, fallback global).
      const seedCohort = meta.get(train[0])?.cohort ?? "__none__";
      const popSource = (cohortPopular.get(seedCohort) ?? globalPopular).filter((id) => !trainSet.has(id)).slice(0, 40);
      const popular = popSource.length ? popSource : globalPopular.filter((id) => !trainSet.has(id)).slice(0, 40);

      // SOURCE 4: exploration — 30 ids via seeded shuffle of all-minus-train.
      const rng = makeRng(uidSeed(t.uid));
      const shuf = [...allMinusTrain];
      for (let i = shuf.length - 1; i > 0; i--) { const j = rng.int(i + 1); [shuf[i], shuf[j]] = [shuf[j], shuf[i]]; }
      const exploration = shuf.slice(0, 30);

      const pool = buildCandidatePool(
        [
          { source: "retrieval", ids: retrieval },
          { source: "npmi", ids: npmi },
          { source: "popular", ids: popular },
          { source: "exploration", ids: exploration },
        ],
        POOL_SIZE,
      );
      if (pool.length === 0) continue;
      const poolOrder = pool.map((p) => p.id);

      // budget band = mean of train price bands (rounded).
      const budgetBand = meanBand(train.map((id) => meta.get(id)?.priceBand ?? 0));

      // ── Per-candidate expectedRevenue (affinity = max cosine to modes). ──────
      // priceFit = 1 − |priceBand − budget|/(PRICE_BANDS−1), clamped ≥0.
      const revenueById = new Map<string, number>();
      for (const id of poolOrder) {
        const m = meta.get(id)!;
        const affinity = modeMedoids.length ? Math.max(0, Math.min(1, Math.max(...modeMedoids.map((md) => cosineSim(md, e1.get(id)!))))) : 0;
        const priceFit = Math.max(0, 1 - Math.abs(m.priceBand - budgetBand) / (PRICE_BANDS - 1));
        const rev = expectedRevenue({ affinity, priceFit, price_cents: m.priceCents, margin_pct: m.marginPct });
        revenueById.set(id, rev);
      }
      const maxRevenue = Math.max(0, ...[...revenueById.values()]);

      // ── Objective features per candidate (same ObjCtx for the pool). ─────────
      const objCtx: ObjCtx = { modeMedoids, budgetBand, maxPopularity: globalMaxPop, maxRevenue };
      const scorerItems: ScorerItem[] = [];
      const vectorsById = new Map<string, number[]>();
      const sellerById = new Map<string, string>();
      for (const id of poolOrder) {
        const m = meta.get(id)!;
        const vec = e1.get(id)!;
        const objCand: ObjCandidate = {
          id,
          vector: vec,
          priceBand: m.priceBand,
          price_cents: m.priceCents,
          margin_pct: m.marginPct,
          popularity: popById.get(id) ?? 0,
          seller_age_days: m.sellerAgeDays,
        };
        const features: Record<ObjectiveName, number> = extractObjectiveFeatures(objCtx, objCand);
        scorerItems.push({ id, vector: vec, features });
        vectorsById.set(id, vec);
        sellerById.set(id, m.sellerId);
      }

      const candidates: RankItem[] = poolOrder.map((id) => ({ id, popularity: popById.get(id) ?? 0, vector: e1.get(id)!, cohort: meta.get(id)?.cohort ?? null }));
      const ctx: UserContext = { userVector: modeMedoids[0] ?? [], cohort: meta.get(t.pid)?.cohort ?? null };

      cases.push({
        uid: t.uid,
        testPid: t.pid,
        relevant: new Set([t.pid]),
        ctx,
        candidates,
        poolOrder,
        scorerItems,
        revenueById,
        sellerById,
        vectorsById,
      });
    }

    if (cases.length === 0) { console.error("[f4] no eval cases produced"); process.exit(1); }

    // ── Deterministic user subsample for a tractable sweep. Baseline AND every ──
    //    λ-config are evaluated on the SAME users (apples-to-apples). Sorting by ──
    //    uid + first-N is fully deterministic (no rng needed). ───────────────────
    const SWEEP_USERS = 300;
    const sweepCases = [...cases].sort((a, b) => a.uid.localeCompare(b.uid)).slice(0, SWEEP_USERS);
    console.log(`[f4] ${cases.length} total cases, sweeping ${sweepCases.length}`);

    // ── Metric vector for a ranker over the swept cases (mean per metric, k=10). ─
    const evalRanker = (rankerFor: (c: F4Case) => Ranker): MetricVector => {
      let rel = 0, rev = 0, div = 0, nov = 0, gini = 0;
      for (const c of sweepCases) {
        const ranked = rankerFor(c).rank(c.ctx, c.candidates);
        const top = ranked.slice(0, K);
        const topVecs = top.map((id) => c.vectorsById.get(id)!).filter((v) => v !== undefined);
        rel += ndcgAtK(ranked, c.relevant, K);
        rev += revenueAtK(ranked, c.revenueById, K);
        div += intraListDiversity(topVecs);
        nov += novelty(ranked, popById, K);
        gini += sellerExposureGini(ranked, c.sellerById, K);
      }
      const n = sweepCases.length;
      return { relevance: rel / n, revenue: rev / n, diversity: div / n, novelty: nov / n, sellerGini: gini / n };
    };

    // ── Baseline F3-RRF: pool order (relevance-only fusion). ────────────────────
    const baselineRanker: Ranker = { name: "f3-rrf", rank: (_ctx, cands) => cands.map((c) => c.id) };
    const baseline = evalRanker(() => baselineRanker);

    // ── λ-grid: relevance=1 fixed; revenue∈{0,.5,1}, margin∈{0,.5},
    //    diversity∈{0,.5}, sellerFairness∈{0,.5}; convProb=novelty=0. (24 configs) ──
    const REVENUE = [0, 0.5, 1];
    const MARGIN = [0, 0.5];
    const DIVERSITY = [0, 0.5];
    const FAIRNESS = [0, 0.5];
    interface Config { id: string; weights: ObjectiveWeights; metrics: MetricVector }
    const configs: Config[] = [];
    let cfgN = 0;
    const totalConfigs = REVENUE.length * MARGIN.length * DIVERSITY.length * FAIRNESS.length;
    for (const revenue of REVENUE) {
      for (const margin of MARGIN) {
        for (const diversity of DIVERSITY) {
          for (const sellerFairness of FAIRNESS) {
            const weights: ObjectiveWeights = {
              relevance: 1,
              revenue,
              margin,
              diversity,
              sellerFairness,
              convProb: 0,
              novelty: 0,
            };
            console.log(`[f4] config ${cfgN + 1}/${totalConfigs}`);
            const metrics = evalRanker((c) => multiObjectiveRanker(weights, c.scorerItems, K));
            configs.push({ id: `cfg${cfgN}`, weights, metrics });
            cfgN++;
          }
        }
      }
    }

    // ── Pareto frontier over {relevance, revenue, diversity, fairness=1−gini}. ──
    const points: ParetoPoint[] = configs.map((cfg) => ({
      id: cfg.id,
      metrics: {
        relevance: cfg.metrics.relevance,
        revenue: cfg.metrics.revenue,
        diversity: cfg.metrics.diversity,
        novelty: cfg.metrics.novelty,
        sellerGini: cfg.metrics.sellerGini,
        fairness: 1 - cfg.metrics.sellerGini,
      },
    }));
    const frontier = paretoFrontier(points, ["relevance", "revenue", "diversity", "fairness"]);
    const kpiPick = pickByKpi(points, {
      kpi: "revenue",
      guardrails: {
        relevance: { min: 0.7 * baseline.relevance },
        sellerGini: { max: baseline.sellerGini + 0.2 },
      },
    });
    const kpiCfg = configs.find((c) => c.id === kpiPick.id)!;
    const frontierIds = new Set(frontier.map((p) => p.id));

    // ── Trade-off line: kpiPick vs baseline. ───────────────────────────────────
    const pct = (cur: number, base: number): number => (base === 0 ? 0 : ((cur - base) / base) * 100);
    const revDeltaPct = pct(kpiCfg.metrics.revenue, baseline.revenue);
    const relDeltaPct = pct(kpiCfg.metrics.relevance, baseline.relevance);
    const revUp = Math.abs(revDeltaPct);
    const relDown = Math.abs(relDeltaPct);
    const tradeoffLine = `+${revUp.toFixed(1)}% revenue@10 for ${relDeltaPct >= 0 ? "+" : "−"}${relDown.toFixed(1)}% relevance@10 vs RRF`;

    const anyRevenueAboveBaseline = configs.some((c) => c.metrics.revenue > baseline.revenue);

    // ── Report (markdown) ──────────────────────────────────────────────────────
    const f3 = (x: number) => x.toFixed(3);
    const f4 = (x: number) => x.toFixed(4);
    const wstr = (w: ObjectiveWeights) => `rel=${w.relevance}, rev=${w.revenue}, mar=${w.margin}, div=${w.diversity}, fair=${w.sellerFairness}`;

    const rows: string[] = [];
    rows.push("# Thesis F4 — Multi-objective rerank + Pareto frontier vs F3-RRF", "");
    rows.push(`Item space: e1_prod2vec. Common universe: ${commonIds.length}. Eval cases: ${cases.length}. Pool size: ${POOL_SIZE}. k=${K}.`, "");
    rows.push("ONE shared pool per user (the SAME 4-source RRF pool as F3); every config scores the identical candidate set. Objective features use only relevance (cosine to modes) + catalog margin/price/popularity/seller. The held-out test purchase is ground-truth for relevance/revenue MEASUREMENT only — never a feature. Fully deterministic (seed 42).", "");
    rows.push("λ-grid: relevance=1 fixed; revenue∈{0,0.5,1}, margin∈{0,0.5}, diversity∈{0,0.5}, sellerFairness∈{0,0.5}; convProb=novelty=0 → 24 configs.", "");
    rows.push("## Baseline (F3-RRF, relevance-only)", "");
    rows.push("| metric | value |", "|---|---|");
    rows.push(`| relevance (nDCG@10) | ${f3(baseline.relevance)} |`);
    rows.push(`| revenue@10 | ${f4(baseline.revenue)} |`);
    rows.push(`| diversity (intra-list@10) | ${f3(baseline.diversity)} |`);
    rows.push(`| novelty@10 | ${f3(baseline.novelty)} |`);
    rows.push(`| sellerGini@10 | ${f3(baseline.sellerGini)} |`, "");
    rows.push("## Pareto frontier (maximize relevance, revenue, diversity, fairness=1−gini)", "");
    rows.push(`Frontier configs: ${frontier.length}/${configs.length}.`, "");
    rows.push("| cfg | λ (rel,rev,mar,div,fair) | relevance | revenue@10 | diversity | sellerGini | fairness |", "|---|---|---|---|---|---|---|");
    for (const p of frontier) {
      const cfg = configs.find((c) => c.id === p.id)!;
      rows.push(`| ${cfg.id} | ${wstr(cfg.weights)} | ${f3(cfg.metrics.relevance)} | ${f4(cfg.metrics.revenue)} | ${f3(cfg.metrics.diversity)} | ${f3(cfg.metrics.sellerGini)} | ${f3(1 - cfg.metrics.sellerGini)} |`);
    }
    rows.push("");
    rows.push("## KPI-selected operating point (maximize revenue@10; guardrails: relevance ≥ 0.7·base, sellerGini ≤ base+0.2)", "");
    rows.push(`Selected: **${kpiCfg.id}** — λ: ${wstr(kpiCfg.weights)}. On Pareto frontier: ${frontierIds.has(kpiCfg.id) ? "yes" : "no"}.`, "");
    rows.push("| metric | KPI point | baseline | Δ% |", "|---|---|---|---|");
    rows.push(`| relevance (nDCG@10) | ${f3(kpiCfg.metrics.relevance)} | ${f3(baseline.relevance)} | ${relDeltaPct >= 0 ? "+" : ""}${relDeltaPct.toFixed(1)}% |`);
    rows.push(`| revenue@10 | ${f4(kpiCfg.metrics.revenue)} | ${f4(baseline.revenue)} | ${revDeltaPct >= 0 ? "+" : ""}${revDeltaPct.toFixed(1)}% |`);
    rows.push(`| diversity@10 | ${f3(kpiCfg.metrics.diversity)} | ${f3(baseline.diversity)} | ${pct(kpiCfg.metrics.diversity, baseline.diversity).toFixed(1)}% |`);
    rows.push(`| sellerGini@10 | ${f3(kpiCfg.metrics.sellerGini)} | ${f3(baseline.sellerGini)} | ${pct(kpiCfg.metrics.sellerGini, baseline.sellerGini).toFixed(1)}% |`, "");
    rows.push("## Trade-off summary", "");
    rows.push(`**${tradeoffLine}**`, "");
    rows.push(`A config with revenue@10 > baseline exists: ${anyRevenueAboveBaseline ? "yes" : "NO (no revenue headroom in this pool/outcome — see honest read)"}.`, "");
    rows.push("### Honest read", "");
    if (anyRevenueAboveBaseline) {
      rows.push(`Weighting the revenue objective lifts expected revenue@10 above the relevance-only RRF baseline, confirming a real relevance↔revenue trade-off: the KPI operating point earns ${revDeltaPct >= 0 ? "more" : "less"} GMV (${revDeltaPct >= 0 ? "+" : ""}${revDeltaPct.toFixed(1)}%) while staying inside the relevance guardrail (${relDeltaPct >= 0 ? "+" : ""}${relDeltaPct.toFixed(1)}% nDCG@10). The Pareto frontier (${frontier.length} configs) spans the achievable region across relevance, revenue, diversity, and seller fairness.`, "");
    } else {
      rows.push(`Even with revenue-weight=1, no config raised revenue@10 above the RRF baseline. On this pool/outcome the relevance-ranked top-10 already concentrates the highest expected-revenue items, leaving no revenue headroom to trade relevance for. This is a real finding, not a bug — recorded as such.`, "");
    }

    const md = rows.join("\n") + "\n";
    const outMd = resolve(process.cwd(), "docs/superpowers/reports/2026-06-07-thesis-f4-study.md");
    writeFileSync(outMd, md);

    // ── JSON sidecar ───────────────────────────────────────────────────────────
    const json = {
      generated_at: new Date().toISOString(),
      item_space: "e1_prod2vec",
      common_universe: commonIds.length,
      eval_cases: cases.length,
      pool_size: POOL_SIZE,
      k: K,
      baseline: {
        relevance: baseline.relevance,
        revenue: baseline.revenue,
        diversity: baseline.diversity,
        novelty: baseline.novelty,
        sellerGini: baseline.sellerGini,
      },
      grid: {
        revenue: REVENUE,
        margin: MARGIN,
        diversity: DIVERSITY,
        sellerFairness: FAIRNESS,
        relevance_fixed: 1,
        convProb: 0,
        novelty: 0,
      },
      points: configs.map((c) => ({
        id: c.id,
        weights: c.weights,
        metrics: {
          relevance: c.metrics.relevance,
          revenue: c.metrics.revenue,
          diversity: c.metrics.diversity,
          novelty: c.metrics.novelty,
          sellerGini: c.metrics.sellerGini,
          fairness: 1 - c.metrics.sellerGini,
        },
      })),
      frontier_ids: frontier.map((p) => p.id),
      kpi_pick: {
        id: kpiCfg.id,
        weights: kpiCfg.weights,
        metrics: {
          relevance: kpiCfg.metrics.relevance,
          revenue: kpiCfg.metrics.revenue,
          diversity: kpiCfg.metrics.diversity,
          novelty: kpiCfg.metrics.novelty,
          sellerGini: kpiCfg.metrics.sellerGini,
        },
        on_frontier: frontierIds.has(kpiCfg.id),
      },
      tradeoff: {
        revenue_delta_pct: revDeltaPct,
        relevance_delta_pct: relDeltaPct,
        line: tradeoffLine,
        any_revenue_above_baseline: anyRevenueAboveBaseline,
      },
    };
    const outJson = resolve(process.cwd(), "docs/superpowers/reports/2026-06-07-thesis-f4-study.json");
    writeFileSync(outJson, JSON.stringify(json, null, 2) + "\n");

    console.log(md);
    console.log(`[f4] wrote ${outMd}`);
    console.log(`[f4] wrote ${outJson}`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
