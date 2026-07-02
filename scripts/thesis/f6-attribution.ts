#!/usr/bin/env tsx
/**
 * F6 W4 — Close the F4 attribution caveat (spec §5 W4, §8-C).
 *
 * The F4 study reported that EVERY multi-objective config has relevance well below
 * the F3-RRF baseline, and flagged that the headline "−relevance%" CONFLATES two
 * effects (f4-study.ts "Attribution caveat"):
 *   (a) single-signal-vs-fusion gap — the scorer's relevance FEATURE is one signal
 *       (cosine to the user's modes ≈ the retrieval pool source only), but the
 *       baseline is 4-source RRF fusion. A relevance-only config is handicapped by
 *       this CONFOUND, not by any trade-off.
 *   (b) the TRUE relevance↔revenue trade-off — what relevance you pay to tilt the
 *       scorer toward revenue.
 *
 * This runner DECOMPOSES the two. It re-runs the F4 λ-grid TWICE over the SAME
 * shared pool per user — once with (A) single-signal relevance (the F4 feature),
 * once with (B) multi-signal relevance (retrieval-cosine + NPMI-to-last-viewed +
 * cohort-popularity, RRF-fused — `relevanceMultiSignal`) — and separates:
 *   (a) GAP = the single→multi relevance lift at IDENTICAL weights (most cleanly at
 *       the relevance-only config: rel=1, all else 0). This is the confound.
 *   (b) TRADE-OFF = relevance↔revenue measured WITH multi-signal relevance: how
 *       much multi-signal relevance the revenue-max config sacrifices vs the multi-
 *       signal relevance-only config. This is the genuine cost, confound removed.
 *
 * Apples-to-apples (spec §5 W1 reuse): ONE shared 4-source RRF pool per user via
 * loadUnifiedCases (the SAME pool f3/f4 build). Every config (single AND multi)
 * scores the IDENTICAL candidate set. Objective features use only inference-time
 * signals; the held-out test purchase is ground-truth for nDCG/recall/revenue
 * MEASUREMENT only — never a feature (no leakage, spec hazard #6). Fully
 * deterministic (seed 42; no Math.random / Date.now in ranking, spec hazard #6).
 *
 * Item space = e1_prod2vec (64d). Writes NOTHING to the DB.
 *
 * Usage: pnpm tsx scripts/thesis/f6-attribution.ts [--limit 0] [--out path-no-ext]
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { writeFileSync } from "fs";
import { getPgClient } from "@/lib/db/pg";
import { loadUnifiedCases, type UnifiedCase } from "@/thesis/eval/unified-cases";
import {
  multiObjectiveRanker,
  type ScorerItem,
  type ObjectiveWeights,
} from "@/thesis/objectives/scorer";
import type { ObjectiveName } from "@/thesis/objectives/objective-features";
import {
  relevanceMultiSignal,
  extractObjectiveFeaturesMulti,
  type MultiRelevanceCtx,
} from "@/thesis/objectives/relevance-multi";
import { ndcgAtK, recallAtK, revenueAtK } from "@/thesis/eval/metrics";
import type { RankItem, Ranker, UserContext } from "@/thesis/types";

// ── Constants ─────────────────────────────────────────────────────────────────
const K = 10;
/** Deterministic user subsample for a tractable double sweep (f4-study idiom). */
const SWEEP_USERS = 300;

// ── CLI ───────────────────────────────────────────────────────────────────────
interface Cli {
  limit: number;
  out: string | null;
}
function parseCli(argv: string[]): Cli {
  const cli: Cli = { limit: 0, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`[f6-attr] flag ${a} requires a value`);
      i++;
      return v;
    };
    switch (a) {
      case "--limit":
        cli.limit = parseInt(next(), 10);
        break;
      case "--out":
        cli.out = next();
        break;
      default:
        throw new Error(`[f6-attr] unknown flag: ${a}`);
    }
  }
  if (!Number.isFinite(cli.limit) || cli.limit < 0) throw new Error(`[f6-attr] --limit must be >= 0`);
  return cli;
}

// ── Per-case precompute for the attribution sweep ───────────────────────────────
/**
 * For one unified case: the shared pool candidates, single-signal scorer items
 * (from the loader's objById), and the multi-signal scorer items (relevance
 * feature swapped via extractObjectiveFeaturesMulti). Both share every non-
 * relevance feature and the SAME ObjCtx-derived margin/convProb/novelty/etc.
 */
interface AttrCase {
  uid: string;
  relevant: Set<string>;
  ctx: UserContext;
  candidates: RankItem[]; // pool order
  revenueById: Map<string, number>;
  /** id → single-signal scorer item (F4 feature). */
  single: Map<string, ScorerItem>;
  /** id → multi-signal scorer item (relevance fused). */
  multi: Map<string, ScorerItem>;
}

// ── Aggregate metric vector for one ranker over the swept cases. ────────────────
interface MetricVector {
  /** nDCG@10 — relevance metric (vs the held-out purchase). */
  ndcg: number;
  /** recall@10 — recall metric. */
  recall: number;
  /** revenue@10 — business metric (pool expectedRevenue). */
  revenue: number;
}

/** Build the F4 λ-grid: relevance=1 fixed; revenue/margin/diversity/fairness swept. */
function buildGrid(): { id: string; weights: ObjectiveWeights }[] {
  const REVENUE = [0, 0.5, 1];
  const MARGIN = [0, 0.5];
  const DIVERSITY = [0, 0.5];
  const FAIRNESS = [0, 0.5];
  const grid: { id: string; weights: ObjectiveWeights }[] = [];
  let n = 0;
  for (const revenue of REVENUE)
    for (const margin of MARGIN)
      for (const diversity of DIVERSITY)
        for (const sellerFairness of FAIRNESS) {
          grid.push({
            id: `cfg${n++}`,
            weights: { relevance: 1, revenue, margin, diversity, sellerFairness, convProb: 0, novelty: 0 },
          });
        }
  return grid;
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  const pg = await getPgClient({ scope: "thesis" });
  try {
    // ── Load canonical cases (E1 64d). loadUnifiedCases reads the holdout intact. ─
    const loaded = await loadUnifiedCases(pg, cli.limit > 0 ? { limit: cli.limit } : undefined);
    const e1Item = loaded.e1Item;

    // ── Per-id catalog cohort (for the cohort-popularity relevance signal). One
    //    read; cohort = product subcategory, matching the pool's "popular" source. ─
    const cohortById = new Map<string, string>();
    for (const r of (
      await pg.query<{ id: string; metadata: Record<string, unknown> }>(
        `SELECT id::text id, metadata FROM thesis.products`,
      )
    ).rows) {
      const m = r.metadata ?? {};
      cohortById.set(r.id, (m.subcategory as string | null) ?? "__none__");
    }

    // ── Build the attribution case per test user (single + multi scorer items). ─
    const attrCases: AttrCase[] = [];
    for (const c of loaded.cases) {
      const poolIds = c.pool.map((p) => p.id);
      // E1 vectors of the pool (canonical 64d; pool ⊆ E1 universe so all present).
      const vecById = new Map<string, number[]>();
      for (const id of poolIds) {
        const v = e1Item.get(id);
        if (v !== undefined) vecById.set(id, v);
      }

      // ── Single-signal scorer items: straight from the loader's F4 features. ──
      const single = new Map<string, ScorerItem>();
      for (const id of poolIds) {
        const features = c.objById.get(id);
        const vec = vecById.get(id);
        if (features === undefined || vec === undefined) continue;
        single.set(id, { id, vector: vec, features });
      }

      // ── Multi-signal relevance: fuse retrieval-cosine + NPMI-to-last-viewed +
      //    cohort-popularity over THIS pool. cohort-popularity = the candidate's
      //    event-count popularity when it shares the user's seed cohort (train[0]'s
      //    cohort), else 0 — mirroring the pool's cohort-popularity "popular"
      //    source. NPMI from the case's full last-viewed→npmi map (no leakage). ───
      const seedCohort = cohortById.get(c.trainIds[0]) ?? "__none__";
      const cohortPopularity = new Map<string, number>();
      for (const id of poolIds) {
        const inSeedCohort = (cohortById.get(id) ?? "__none__") === seedCohort;
        cohortPopularity.set(id, inSeedCohort ? c.popById.get(id) ?? 0 : 0);
      }
      const relCtx: MultiRelevanceCtx = {
        modeMedoids: c.modes.map((m) => m.medoid),
        npmiByLastViewed: c.lvNpmi,
        cohortPopularity,
        fusion: "rrf",
      };
      const relById = relevanceMultiSignal(
        relCtx,
        poolIds.map((id) => ({ id, vector: vecById.get(id)! })).filter((x) => x.vector !== undefined),
      );

      // ── Multi-signal scorer items: SAME ObjCtx-derived features, relevance
      //    feature swapped for the fused value via extractObjectiveFeaturesMulti.
      //    We rebuild from the single features (which already carry the full F4
      //    feature record) by overriding ONLY relevance — equivalent to
      //    extractObjectiveFeaturesMulti without re-reading catalog meta. ─────────
      const multi = new Map<string, ScorerItem>();
      for (const id of poolIds) {
        const item = single.get(id);
        if (item === undefined) continue;
        const features: Record<ObjectiveName, number> = {
          ...item.features,
          relevance: Math.max(0, Math.min(1, relById(id))),
        };
        multi.set(id, { id, vector: item.vector, features });
      }

      const candidates: RankItem[] = poolIds
        .filter((id) => vecById.has(id))
        .map((id) => ({ id, popularity: c.popById.get(id) ?? 0, vector: vecById.get(id)!, cohort: cohortById.get(id) ?? null }));

      attrCases.push({
        uid: c.userId,
        relevant: c.relevant,
        ctx: c.ctx,
        candidates,
        revenueById: c.revenueById,
        single,
        multi,
      });
    }

    if (attrCases.length === 0) throw new Error("[f6-attr] no eval cases produced");

    // ── Deterministic user subsample (sort by uid, first-N). Apples-to-apples:
    //    single AND multi sweeps run on the SAME swept users. ─────────────────────
    const sweep = [...attrCases].sort((a, b) => a.uid.localeCompare(b.uid)).slice(0, SWEEP_USERS);
    console.log(`[f6-attr] ${attrCases.length} total cases, sweeping ${sweep.length}`);

    // ── Evaluate one ranker-factory over the swept cases (mean nDCG/recall/rev@10). ─
    const evalRanker = (rankerFor: (c: AttrCase) => Ranker): MetricVector => {
      let nd = 0, rc = 0, rv = 0;
      for (const c of sweep) {
        const ranked = rankerFor(c).rank(c.ctx, c.candidates);
        nd += ndcgAtK(ranked, c.relevant, K);
        rc += recallAtK(ranked, c.relevant, K);
        rv += revenueAtK(ranked, c.revenueById, K);
      }
      const n = sweep.length;
      return { ndcg: nd / n, recall: rc / n, revenue: rv / n };
    };

    // ── F3-RRF baseline: pool order (4-source fusion, relevance-only). The frame
    //    of reference both sweeps are read against. ───────────────────────────────
    const baselineRanker: Ranker = { name: "f3-rrf", rank: (_ctx, cands) => cands.map((x) => x.id) };
    const baseline = evalRanker(() => baselineRanker);

    // ── Run the λ-grid for BOTH relevance signals. ──────────────────────────────
    const grid = buildGrid();
    interface ConfigRow { id: string; weights: ObjectiveWeights; single: MetricVector; multi: MetricVector }
    const configs: ConfigRow[] = [];
    for (let i = 0; i < grid.length; i++) {
      const g = grid[i];
      console.log(`[f6-attr] config ${i + 1}/${grid.length} (${g.id})`);
      const single = evalRanker((c) => multiObjectiveRanker(g.weights, [...c.single.values()], K));
      const multi = evalRanker((c) => multiObjectiveRanker(g.weights, [...c.multi.values()], K));
      configs.push({ id: g.id, weights: g.weights, single, multi });
    }

    // ── Identify the relevance-only config (rel=1, everything else 0) — the
    //    cleanest point to read the single→multi GAP (no revenue tilt). ───────────
    const isRelOnly = (w: ObjectiveWeights): boolean =>
      w.relevance === 1 && w.revenue === 0 && w.margin === 0 && w.diversity === 0 &&
      w.sellerFairness === 0 && w.convProb === 0 && w.novelty === 0;
    const relOnly = configs.find((c) => isRelOnly(c.weights))!;

    // ── Revenue-max config per signal (max revenue@10 over the grid). ───────────
    const revMaxSingle = configs.reduce((a, b) => (b.single.revenue > a.single.revenue ? b : a));
    const revMaxMulti = configs.reduce((a, b) => (b.multi.revenue > a.multi.revenue ? b : a));

    // ── DECOMPOSITION ───────────────────────────────────────────────────────────
    const pct = (cur: number, base: number): number => (base === 0 ? 0 : ((cur - base) / base) * 100);

    // (a) CONFOUND — single→multi relevance gap at IDENTICAL weights (rel-only). ──
    //     This is the part of the F4 "−relevance%" that is NOT a trade-off: it is
    //     the single-signal feature underperforming the fused baseline.
    const gapNdcgAbs = relOnly.multi.ndcg - relOnly.single.ndcg;
    const gapNdcgPct = pct(relOnly.multi.ndcg, relOnly.single.ndcg);
    // Single rel-only vs the 4-source RRF baseline (the F4 confound, signed).
    const singleRelOnlyVsBasePct = pct(relOnly.single.ndcg, baseline.ndcg);
    // Multi rel-only vs the 4-source RRF baseline (confound largely removed).
    const multiRelOnlyVsBasePct = pct(relOnly.multi.ndcg, baseline.ndcg);
    // Fraction of the original (single rel-only → baseline) gap that the multi
    // signal closes. >0 means multi narrows the gap to the fused baseline.
    const singleGapAbs = baseline.ndcg - relOnly.single.ndcg; // how far single fell short
    const multiGapAbs = baseline.ndcg - relOnly.multi.ndcg;
    const confoundClosedPct =
      singleGapAbs === 0 ? 0 : ((singleGapAbs - multiGapAbs) / Math.abs(singleGapAbs)) * 100;

    // (b) TRUE TRADE-OFF — measured WITH multi-signal relevance: revenue-max-multi
    //     vs the multi-signal relevance-only config. nDCG cost & revenue gain are
    //     now confound-free (both legs use the SAME fused relevance feature).
    const tradeRevGainPct = pct(revMaxMulti.multi.revenue, relOnly.multi.revenue);
    const tradeNdcgCostPct = pct(revMaxMulti.multi.ndcg, relOnly.multi.ndcg);
    // For contrast, the NAIVE (single-signal) trade-off the F4 study reported.
    const naiveRevGainPct = pct(revMaxSingle.single.revenue, relOnly.single.revenue);
    const naiveNdcgCostPct = pct(revMaxSingle.single.ndcg, relOnly.single.ndcg);

    // ── Render markdown ─────────────────────────────────────────────────────────
    const f3 = (x: number) => x.toFixed(3);
    const f4 = (x: number) => x.toFixed(4);
    const sgn = (x: number) => (x >= 0 ? "+" : "");
    const wstr = (w: ObjectiveWeights) =>
      `rel=${w.relevance}, rev=${w.revenue}, mar=${w.margin}, div=${w.diversity}, fair=${w.sellerFairness}`;

    const rows: string[] = [];
    rows.push("# Thesis F6 W4 — F4 attribution caveat: single- vs multi-signal relevance", "");
    rows.push(
      `Item space: e1_prod2vec (64d). E1 universe: ${loaded.meta.n}. Products match dataset. ` +
        `Eval cases: ${attrCases.length}, sweeping ${sweep.length}. Pool size: ${loaded.meta.poolSize}. k=${K}. Seed 42.`,
      "",
    );
    rows.push(
      "ONE shared 4-source RRF pool per user (the SAME pool as F3/F4); every config — single AND multi — scores " +
        "the IDENTICAL candidate set. The multi-signal relevance FUSES retrieval-cosine + NPMI-to-last-viewed + " +
        "cohort-popularity (RRF, mirroring the pool fusion). Every OTHER objective feature is unchanged. The held-out " +
        "purchase is ground-truth for nDCG/recall/revenue MEASUREMENT only — never a feature. Deterministic (seed 42).",
      "",
    );

    rows.push("## Baseline (F3-RRF, 4-source fusion, relevance-only ordering)", "");
    rows.push("| metric | value |", "|---|---|");
    rows.push(`| nDCG@10 | ${f3(baseline.ndcg)} |`);
    rows.push(`| recall@10 | ${f3(baseline.recall)} |`);
    rows.push(`| revenue@10 | ${f4(baseline.revenue)} |`, "");

    rows.push("## Per-config: single-signal vs multi-signal relevance (nDCG@10 / recall@10 / revenue@10)", "");
    rows.push(
      "| cfg | λ (rel,rev,mar,div,fair) | nDCG single | nDCG multi | recall single | recall multi | rev single | rev multi |",
      "|---|---|---|---|---|---|---|---|",
    );
    for (const c of configs) {
      rows.push(
        `| ${c.id}${isRelOnly(c.weights) ? " (rel-only)" : ""} | ${wstr(c.weights)} | ${f3(c.single.ndcg)} | ${f3(c.multi.ndcg)} | ` +
          `${f3(c.single.recall)} | ${f3(c.multi.recall)} | ${f4(c.single.revenue)} | ${f4(c.multi.revenue)} |`,
      );
    }
    rows.push("");

    rows.push("## Decomposition", "");
    rows.push("### (a) The CONFOUND — single→multi relevance gap at identical weights", "");
    rows.push(
      `At the relevance-only config (**${relOnly.id}**: ${wstr(relOnly.weights)}), swapping the single-signal ` +
        `relevance feature for the multi-signal fusion moves nDCG@10 from **${f3(relOnly.single.ndcg)}** to ` +
        `**${f3(relOnly.multi.ndcg)}** (${sgn(gapNdcgPct)}${gapNdcgPct.toFixed(1)}%, Δ=${sgn(gapNdcgAbs)}${f3(gapNdcgAbs)}).`,
      "",
    );
    rows.push(
      `Relative to the 4-source RRF baseline (${f3(baseline.ndcg)}): single rel-only is ` +
        `${sgn(singleRelOnlyVsBasePct)}${singleRelOnlyVsBasePct.toFixed(1)}%, multi rel-only is ` +
        `${sgn(multiRelOnlyVsBasePct)}${multiRelOnlyVsBasePct.toFixed(1)}%. The multi signal closes ` +
        `**${confoundClosedPct.toFixed(1)}%** of the single→baseline gap. This is the single-signal-vs-fusion ` +
        `CONFOUND the F4 study flagged — NOT a relevance↔revenue trade-off cost.`,
      "",
    );
    rows.push("### (b) The TRUE trade-off — measured WITH multi-signal relevance", "");
    rows.push(
      `Confound-free: revenue-max config (**${revMaxMulti.id}**: ${wstr(revMaxMulti.weights)}) vs the multi-signal ` +
        `relevance-only config (${relOnly.id}). Revenue@10 ${sgn(tradeRevGainPct)}${tradeRevGainPct.toFixed(1)}% for ` +
        `nDCG@10 ${sgn(tradeNdcgCostPct)}${tradeNdcgCostPct.toFixed(1)}%. Both legs use the SAME fused relevance ` +
        `feature, so this is the GENUINE cost of tilting toward revenue — the single-signal handicap is removed.`,
      "",
    );
    rows.push(
      `For contrast, the NAIVE single-signal trade-off (what F4 reported): revenue-max-single (${revMaxSingle.id}) vs ` +
        `single relevance-only — revenue@10 ${sgn(naiveRevGainPct)}${naiveRevGainPct.toFixed(1)}% for nDCG@10 ` +
        `${sgn(naiveNdcgCostPct)}${naiveNdcgCostPct.toFixed(1)}%.`,
      "",
    );

    rows.push("### Honest read", "");
    rows.push(
      `The F4 headline "every reranked config has relevance well below the RRF baseline" conflated TWO effects. ` +
        `(a) is the confound: a single-signal relevance feature (cosine-to-modes ≈ retrieval source) cannot match a ` +
        `4-source fused baseline; fusing NPMI + cohort-popularity into the relevance feature ` +
        `${confoundClosedPct >= 0 ? "narrows" : "does NOT narrow"} that gap by ${confoundClosedPct.toFixed(1)}%. ` +
        `(b) is the trade-off, now measured on equal footing: the revenue dial costs ` +
        `${Math.abs(tradeNdcgCostPct).toFixed(1)}% nDCG@10 for ${sgn(tradeRevGainPct)}${tradeRevGainPct.toFixed(1)}% ` +
        `revenue@10 — the figure the thesis can defend, with the single-signal artifact removed.`,
      "",
    );

    const md = rows.join("\n") + "\n";

    // ── JSON sidecar ────────────────────────────────────────────────────────────
    const json = {
      generated_at: new Date().toISOString(),
      item_space: "e1_prod2vec",
      e1_universe: loaded.meta.n,
      pool_size: loaded.meta.poolSize,
      eval_cases: attrCases.length,
      swept_cases: sweep.length,
      k: K,
      fusion: "rrf",
      baseline: { ndcg: baseline.ndcg, recall: baseline.recall, revenue: baseline.revenue },
      grid: { revenue: [0, 0.5, 1], margin: [0, 0.5], diversity: [0, 0.5], sellerFairness: [0, 0.5], relevance_fixed: 1 },
      configs: configs.map((c) => ({
        id: c.id,
        weights: c.weights,
        rel_only: isRelOnly(c.weights),
        single: c.single,
        multi: c.multi,
      })),
      decomposition: {
        rel_only_id: relOnly.id,
        confound: {
          single_rel_only_ndcg: relOnly.single.ndcg,
          multi_rel_only_ndcg: relOnly.multi.ndcg,
          gap_ndcg_abs: gapNdcgAbs,
          gap_ndcg_pct: gapNdcgPct,
          single_rel_only_vs_baseline_pct: singleRelOnlyVsBasePct,
          multi_rel_only_vs_baseline_pct: multiRelOnlyVsBasePct,
          confound_closed_pct: confoundClosedPct,
        },
        true_tradeoff_multi: {
          rev_max_id: revMaxMulti.id,
          rev_max_weights: revMaxMulti.weights,
          revenue_gain_pct: tradeRevGainPct,
          ndcg_cost_pct: tradeNdcgCostPct,
        },
        naive_tradeoff_single: {
          rev_max_id: revMaxSingle.id,
          rev_max_weights: revMaxSingle.weights,
          revenue_gain_pct: naiveRevGainPct,
          ndcg_cost_pct: naiveNdcgCostPct,
        },
      },
    };

    const base =
      cli.out ??
      resolve(process.cwd(), "docs/superpowers/reports/2026-06-08-thesis-f6-attribution-n2000-seed42");
    const outMd = base.endsWith(".md") ? base : `${base}.md`;
    const outJson = base.endsWith(".md") ? base.replace(/\.md$/, ".json") : `${base}.json`;
    writeFileSync(outMd, md);
    writeFileSync(outJson, JSON.stringify(json, null, 2) + "\n");

    console.log(md);
    console.log(`[f6-attr] wrote ${outMd}`);
    console.log(`[f6-attr] wrote ${outJson}`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
