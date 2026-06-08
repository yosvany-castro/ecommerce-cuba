#!/usr/bin/env tsx
/**
 * F6 W9 — Pool source ablations (leave-one-source-out) — spec §5 W9 / §8-I.
 *
 * The thesis claims the 4-source RRF candidate pool fuses ORTHOGONAL signals — in
 * particular that NPMI (co-purchase complements) recovers held-out purchases that
 * cosine retrieval misses. F6 W9 confirms-or-refutes that claim by rebuilding the
 * pool with ONE source removed at a time and measuring what is lost.
 *
 * The four sources (verbatim from scripts/thesis/f3-study.ts / src/thesis/eval/
 * unified-cases.ts, identical quotas):
 *   - retrieval   : top-80 by max cosine to the user's E1 interest-mode medoids.
 *   - npmi        : last-viewed product's co-occurrence (NPMI) neighbours, top-50.
 *   - popular     : cohort-popularity of train[0]'s subcategory, top-40.
 *   - exploration : 30 ids via a seeded shuffle of catalog \ train.
 * They are fused with Reciprocal Rank Fusion (rrfFuse, k0=60), capped at 200.
 *
 * Ablations (5 pool variants per case):
 *   full           — all four sources (the production pool).
 *   -retrieval     — drop retrieval.
 *   -npmi          — drop NPMI (the orthogonality test).
 *   -popular       — drop cohort-popularity.
 *   -exploration   — drop exploration.
 *
 * Metrics per variant (the spec's two):
 *   - pool-recall  : fraction of cases whose held-out test purchase is in the pool
 *                    (the retrieval ceiling — a reranker can never recover what the
 *                    pool omits).
 *   - nDCG@10      : nDCG@10 of the RRF order itself (no reranker), so the metric
 *                    isolates the retrieval+fusion quality, not a downstream model.
 * Plus a per-source diagnostic: source-only recall (test item reachable from each
 * single source) and the NPMI-orthogonality counts (cases the test item is in NPMI
 * but NOT in retrieval — the complements cosine misses).
 *
 * Embedding-space discipline (spec hazard #5 — cosineSim THROWS on dim mismatch):
 *   every cosine is E1 (prod2vec, 64d) vs E1; no 1024d text vectors enter here.
 *
 * No leakage (spec hazard #6): the pool is built from the F2 detector path (modes /
 * last-viewed / cohort), NEVER from sim_sessions GT. The held-out test purchase is
 * used ONLY as the label for pool-recall / nDCG — it never seeds any source. This
 * exactly mirrors how f3-study computes pool-recall.
 *
 * Determinism (spec §6, hazard #2): the exploration shuffle uses makeRng(uidSeed)
 * with the SAME per-user seed derivation as f3-study; no Math.random / Date.now in
 * any ranking path. The only Date.now is the report's generated_at stamp.
 *
 * DB free-tier (spec hazard #8): every query is wrapped in queryWithRetry — one
 * retry on a connection-class failure (pooler lag), real SQL errors re-thrown.
 *
 * Writes NOTHING to the DB.
 *
 * Usage: pnpm tsx scripts/thesis/f6-pool-ablation.ts [--limit N]
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { writeFileSync } from "fs";
import type { Client } from "pg";
import { getPgClient } from "@/lib/db/pg";
import { cosineSim } from "@/thesis/embedders/space";
import { buildUserModes } from "@/thesis/multivector/modes";
import { buildCandidatePool, type SourceList } from "@/thesis/rerank/candidates";
import { ndcgAtK } from "@/thesis/eval/metrics";
import { makeRng } from "@/thesis/data/rng";

// ── Constants (verbatim from f3-study.ts / unified-cases.ts) ─────────────────
const SEED = 42;
const POOL_SIZE = 200;
const SPACE = "e1_prod2vec";
const RETRIEVAL_TOP = 80;
const NPMI_TOP = 50;
const POPULAR_TOP = 40;
const EXPLORATION_N = 30;
const MODE_OPTS = { distanceThreshold: 0.5, maxModes: 5 } as const;
const K_NDCG = 10;

/** Canonical source names (order = report column order). */
const SOURCES = ["retrieval", "npmi", "popular", "exploration"] as const;
type SourceName = (typeof SOURCES)[number];
/** Ablation variants: the full pool + one leave-one-source-out per source. */
const VARIANTS = ["full", "-retrieval", "-npmi", "-popular", "-exploration"] as const;
type VariantName = (typeof VARIANTS)[number];

// ── CLI ───────────────────────────────────────────────────────────────────────
function parseLimit(argv: string[]): number {
  let limit = 0;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") {
      const v = argv[i + 1];
      if (v === undefined) throw new Error("[f6-pool-ablation] --limit requires a value");
      limit = parseInt(v, 10);
      i++;
    } else {
      throw new Error(`[f6-pool-ablation] unknown flag: ${argv[i]}`);
    }
  }
  if (!Number.isFinite(limit) || limit < 0) throw new Error("[f6-pool-ablation] --limit must be >= 0");
  return limit;
}

// ── DB retry (spec hazard #8 — one retry on connection-class failure only) ────
function isConnectionError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  if (typeof code === "string") {
    if (code.startsWith("08") || code === "57P01") return true;
    if (code === "ECONNRESET" || code === "ECONNREFUSED" || code === "EPIPE" || code === "ETIMEDOUT")
      return true;
  }
  const msg = (e as { message?: string } | null)?.message ?? "";
  return /connection terminated|connection reset|server closed the connection|terminating connection|ECONNRESET/i.test(
    msg,
  );
}
async function queryWithRetry<T>(pg: Client, sql: string, params?: unknown[]): Promise<T[]> {
  try {
    return (await pg.query(sql, params)).rows as T[];
  } catch (e) {
    if (!isConnectionError(e)) throw e;
    return (await pg.query(sql, params)).rows as T[];
  }
}

// ── Local helpers (verbatim from f3-study.ts / unified-cases.ts) ─────────────
/** Stable per-user seed for the exploration shuffle (identical to f3-study). */
function uidSeed(uid: string): number {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) ^ SEED;
}

interface ProductMeta {
  cohort: string | null;
}

// ── Running accumulator per ablation variant ─────────────────────────────────
interface VariantAcc {
  /** held-out test item present in this variant's pool. */
  recallHits: number;
  /** sum of nDCG@10 of the RRF order over cases (avg = sum / nCases). */
  ndcgSum: number;
  /** sum of pool sizes (avg pool length, ≤ POOL_SIZE). */
  poolSizeSum: number;
}

async function main() {
  const limit = parseLimit(process.argv.slice(2));
  const pg = await getPgClient({ scope: "thesis" });
  try {
    // ── E1 vectors (canonical 64d space). ──────────────────────────────────────
    const e1 = new Map<string, number[]>();
    for (const r of await queryWithRetry<{ id: string; vector: number[] }>(
      pg,
      `SELECT product_id::text id, vector FROM thesis.item_vectors WHERE space=$1`,
      [SPACE],
    )) {
      e1.set(r.id, r.vector.map(Number));
    }
    if (e1.size === 0) {
      throw new Error("[f6-pool-ablation] no e1_prod2vec vectors — run pnpm thesis:train-prod2vec");
    }

    // ── Product meta (cohort/subcategory). ─────────────────────────────────────
    const meta = new Map<string, ProductMeta>();
    for (const r of await queryWithRetry<{ id: string; metadata: Record<string, unknown> }>(
      pg,
      `SELECT id::text id, metadata FROM thesis.products`,
    )) {
      const m = r.metadata ?? {};
      meta.set(r.id, { cohort: (m.subcategory as string | null) ?? null });
    }

    // ── Popularity (event count per product). ──────────────────────────────────
    const popById = new Map<string, number>();
    for (const r of await queryWithRetry<{ pid: string; c: number }>(
      pg,
      `SELECT payload->>'product_id' pid, count(*)::int c FROM thesis.events WHERE payload->>'product_id' IS NOT NULL GROUP BY 1`,
    )) {
      popById.set(r.pid, r.c);
    }

    // ── NPMI neighbours per product (ordered by rank). ─────────────────────────
    const npmiNeighbours = new Map<string, { id: string; score: number }[]>();
    for (const r of await queryWithRetry<{ pid: string; rid: string; npmi_score: number; rank: number }>(
      pg,
      `SELECT product_id::text pid, related_product_id::text rid, npmi_score, rank FROM thesis.co_occurrence_top ORDER BY product_id, rank`,
    )) {
      const a = npmiNeighbours.get(r.pid) ?? [];
      a.push({ id: r.rid, score: Number(r.npmi_score) });
      npmiNeighbours.set(r.pid, a);
    }

    // ── Holdout train/test. ────────────────────────────────────────────────────
    const trainByUser = new Map<string, string[]>();
    for (const r of await queryWithRetry<{ uid: string; pid: string }>(
      pg,
      `SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='train'`,
    )) {
      const a = trainByUser.get(r.uid) ?? [];
      a.push(r.pid);
      trainByUser.set(r.uid, a);
    }
    // ORDER BY the natural unique key so --limit is deterministic (matches loader).
    const tests = await queryWithRetry<{ uid: string; pid: string }>(
      pg,
      `SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='test' ORDER BY user_id, product_id`,
    );

    // ── Last-viewed product per user (most recent product_view). ───────────────
    const lastViewed = new Map<string, string>();
    for (const r of await queryWithRetry<{ uid: string; pid: string }>(
      pg,
      `SELECT DISTINCT ON (anonymous_id) anonymous_id::text uid, payload->>'product_id' pid
         FROM thesis.events
         WHERE event_type='product_view' AND payload->>'product_id' IS NOT NULL
         ORDER BY anonymous_id, occurred_at DESC`,
    )) {
      lastViewed.set(r.uid, r.pid);
    }

    // ── Cohort → ids sorted by popularity (popular source). ────────────────────
    const cohortPopular = new Map<string, string[]>();
    {
      const byCohort = new Map<string, string[]>();
      for (const [id, m] of meta) {
        if (!e1.has(id)) continue;
        const c = m.cohort ?? "__none__";
        const a = byCohort.get(c) ?? [];
        a.push(id);
        byCohort.set(c, a);
      }
      for (const [c, ids] of byCohort) {
        cohortPopular.set(
          c,
          ids.sort((a, b) => (popById.get(b) ?? 0) - (popById.get(a) ?? 0) || a.localeCompare(b)),
        );
      }
    }
    const globalPopular = [...e1.keys()].sort(
      (a, b) => (popById.get(b) ?? 0) - (popById.get(a) ?? 0) || a.localeCompare(b),
    );

    // ── Common universe = ids with an E1 vector (sorted). ──────────────────────
    const commonIds = [...e1.keys()].sort((a, b) => a.localeCompare(b));
    const commonSet = new Set(commonIds);

    // ── Per-variant accumulators + per-source diagnostics. ─────────────────────
    const acc: Record<VariantName, VariantAcc> = {
      full: { recallHits: 0, ndcgSum: 0, poolSizeSum: 0 },
      "-retrieval": { recallHits: 0, ndcgSum: 0, poolSizeSum: 0 },
      "-npmi": { recallHits: 0, ndcgSum: 0, poolSizeSum: 0 },
      "-popular": { recallHits: 0, ndcgSum: 0, poolSizeSum: 0 },
      "-exploration": { recallHits: 0, ndcgSum: 0, poolSizeSum: 0 },
    };
    // source-only recall: held-out test item reachable from a SINGLE source's list.
    const sourceOnlyRecall: Record<SourceName, number> = {
      retrieval: 0,
      npmi: 0,
      popular: 0,
      exploration: 0,
    };
    // NPMI orthogonality counts: cases where the test item is in NPMI's list.
    let npmiHasTest = 0; // test item in npmi source list
    let retrievalHasTest = 0; // test item in retrieval source list
    let npmiOnlyNotRetrieval = 0; // test item in npmi but NOT in retrieval (the complements cosine misses)
    let casesWithLastViewed = 0; // cases that have a last-viewed (npmi is reachable at all)
    let nCases = 0;

    for (const t of tests) {
      if (limit > 0 && nCases >= limit) break;

      const train = (trainByUser.get(t.uid) ?? []).filter((id) => commonSet.has(id));
      if (train.length === 0 || !commonSet.has(t.pid)) continue;
      const trainSet = new Set(train);
      // Held-out purchase = the single relevant item for recall/nDCG (the LABEL,
      // never a pool seed). Mirrors UnifiedCase.relevant = new Set([t.pid]).
      const relevant = new Set([t.pid]);
      const history = train.map((id) => e1.get(id)!);
      const modes = buildUserModes(history, MODE_OPTS);
      const modeMedoids = modes.map((m) => m.medoid);

      const allMinusTrain = commonIds.filter((id) => !trainSet.has(id));

      // ── SOURCE 1: retrieval — top-80 by max cosine to mode medoids. ──────────
      const retrieval = [...allMinusTrain]
        .map((id) => ({
          id,
          s: modeMedoids.length ? Math.max(...modeMedoids.map((m) => cosineSim(m, e1.get(id)!))) : 0,
        }))
        .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
        .slice(0, RETRIEVAL_TOP)
        .map((x) => x.id);

      // ── SOURCE 2: npmi — neighbours of last-viewed (<=50, minus train). ──────
      const lv = lastViewed.get(t.uid) ?? null;
      const npmi = (lv ? (npmiNeighbours.get(lv) ?? []) : [])
        .map((n) => n.id)
        .filter((id) => commonSet.has(id) && !trainSet.has(id))
        .slice(0, NPMI_TOP);

      // ── SOURCE 3: popular — cohort-popularity of train[0]'s cohort (<=40). ────
      const seedCohort = meta.get(train[0])?.cohort ?? "__none__";
      const popSource = (cohortPopular.get(seedCohort) ?? globalPopular)
        .filter((id) => !trainSet.has(id))
        .slice(0, POPULAR_TOP);
      const popular = popSource.length
        ? popSource
        : globalPopular.filter((id) => !trainSet.has(id)).slice(0, POPULAR_TOP);

      // ── SOURCE 4: exploration — 30 ids via seeded shuffle of all-minus-train. ─
      const rng = makeRng(uidSeed(t.uid));
      const shuf = [...allMinusTrain];
      for (let i = shuf.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [shuf[i], shuf[j]] = [shuf[j], shuf[i]];
      }
      const exploration = shuf.slice(0, EXPLORATION_N);

      // ── Per-source lists keyed by name (the building blocks of every variant). ─
      const sourceLists: Record<SourceName, string[]> = { retrieval, npmi, popular, exploration };

      // ── Build the 5 pool variants by leaving one source out (or none). ───────
      for (const variant of VARIANTS) {
        const dropped: SourceName | null = variant === "full" ? null : (variant.slice(1) as SourceName);
        const lists: SourceList[] = SOURCES.filter((s) => s !== dropped).map((s) => ({
          source: s,
          ids: sourceLists[s],
        }));
        const pool = buildCandidatePool(lists, POOL_SIZE);
        if (pool.length === 0) continue; // degenerate (no sources produced ids) — skip from this variant.
        const poolOrder = pool.map((p) => p.id);
        const a = acc[variant];
        a.poolSizeSum += poolOrder.length;
        if (poolOrder.includes(t.pid)) a.recallHits++;
        // nDCG@10 of the RRF order itself — no reranker, isolates retrieval+fusion.
        a.ndcgSum += ndcgAtK(poolOrder, relevant, K_NDCG);
      }

      // ── Per-source diagnostics (held-out test item reachability). ────────────
      for (const s of SOURCES) {
        if (sourceLists[s].includes(t.pid)) sourceOnlyRecall[s]++;
      }
      const inNpmi = npmi.includes(t.pid);
      const inRetrieval = retrieval.includes(t.pid);
      if (inNpmi) npmiHasTest++;
      if (inRetrieval) retrievalHasTest++;
      if (inNpmi && !inRetrieval) npmiOnlyNotRetrieval++;
      if (lv) casesWithLastViewed++;

      nCases++;
    }

    if (nCases === 0) {
      throw new Error("[f6-pool-ablation] no eval cases produced");
    }

    // ── Derive averages + drops vs full. ───────────────────────────────────────
    const recall = (v: VariantName) => acc[v].recallHits / nCases;
    const ndcg = (v: VariantName) => acc[v].ndcgSum / nCases;
    const avgPool = (v: VariantName) => acc[v].poolSizeSum / nCases;
    const fullRecall = recall("full");
    const fullNdcg = ndcg("full");

    const f3 = (x: number) => x.toFixed(3);
    const sgn = (x: number) => (x >= 0 ? "+" : "");
    // Drop = ablated − full (negative number = the source helped: removing it hurt).
    const recallDrop = (v: VariantName) => recall(v) - fullRecall;
    const ndcgDrop = (v: VariantName) => ndcg(v) - fullNdcg;

    // The orthogonality verdict: NPMI is orthogonal iff (a) removing it drops
    // pool-recall, AND (b) it reaches test items retrieval does NOT. Both are
    // measured; the verdict is data-driven.
    const npmiRecallDrop = recallDrop("-npmi"); // <0 means NPMI helped recall
    const npmiAddsRecall = npmiRecallDrop < 0;
    const npmiReachesUnique = npmiOnlyNotRetrieval > 0;
    const npmiOrthogonal = npmiAddsRecall && npmiReachesUnique;

    // ── Markdown report. ───────────────────────────────────────────────────────
    const rows: string[] = [];
    rows.push("# Thesis F6 W9 — Pool source ablations (leave-one-source-out)", "");
    rows.push(
      `Item space: ${SPACE} (canonical 64d). E1 universe: ${commonIds.length}. ` +
        `Eval cases: ${nCases}${limit > 0 ? ` (--limit ${limit})` : ""}. Pool cap: ${POOL_SIZE}. ` +
        `RRF k0=60.`,
      "",
    );
    rows.push(
      "Four sources fused via RRF: **retrieval** (top-80 max-cos to E1 mode medoids), " +
        "**npmi** (last-viewed co-occurrence neighbours, top-50), **popular** (cohort " +
        "popularity, top-40), **exploration** (seeded shuffle, 30). Each ablation rebuilds " +
        "the pool with ONE source dropped, then measures pool-recall (held-out purchase in " +
        "pool) and nDCG@10 of the RRF order (no reranker — isolates retrieval+fusion).",
      "",
    );
    rows.push(
      "No GT leaks: the pool is built from the F2 detector path (modes / last-viewed / " +
        "cohort); the held-out test purchase is used ONLY as the recall/nDCG label.",
      "",
    );

    rows.push("## Ablation results (pool-recall + nDCG@10 of the RRF order)", "");
    rows.push(
      "| Variant | pool-recall | Δrecall vs full | nDCG@10 | ΔnDCG@10 vs full | avg pool size |",
      "|---|---|---|---|---|---|",
    );
    for (const v of VARIANTS) {
      const dR = v === "full" ? 0 : recallDrop(v);
      const dN = v === "full" ? 0 : ndcgDrop(v);
      rows.push(
        `| ${v} | ${f3(recall(v))} | ${v === "full" ? "—" : `${sgn(dR)}${f3(dR)}`} | ` +
          `${f3(ndcg(v))} | ${v === "full" ? "—" : `${sgn(dN)}${f3(dN)}`} | ${avgPool(v).toFixed(1)} |`,
      );
    }
    rows.push("");

    rows.push("## Per-source diagnostics (held-out test item reachability)", "");
    rows.push("| Source | source-only recall | hits |", "|---|---|---|");
    for (const s of SOURCES) {
      rows.push(`| ${s} | ${f3(sourceOnlyRecall[s] / nCases)} | ${sourceOnlyRecall[s]}/${nCases} |`);
    }
    rows.push("");

    rows.push("## NPMI orthogonality test (does NPMI recover complements cosine misses?)", "");
    rows.push(
      `- Cases with a last-viewed (NPMI reachable at all): ${casesWithLastViewed}/${nCases} ` +
        `(${f3(casesWithLastViewed / nCases)}).`,
    );
    rows.push(`- Test item in NPMI source list: ${npmiHasTest}/${nCases} (${f3(npmiHasTest / nCases)}).`);
    rows.push(
      `- Test item in retrieval source list: ${retrievalHasTest}/${nCases} (${f3(retrievalHasTest / nCases)}).`,
    );
    rows.push(
      `- **Test item in NPMI but NOT in retrieval (the complements cosine misses): ` +
        `${npmiOnlyNotRetrieval}/${nCases} (${f3(npmiOnlyNotRetrieval / nCases)}).**`,
    );
    rows.push(
      `- Removing NPMI changes pool-recall by ${sgn(npmiRecallDrop)}${f3(npmiRecallDrop)} ` +
        `(${npmiAddsRecall ? "recall DROPS — NPMI helped" : "no recall loss"}).`,
      "",
    );

    rows.push("## Verdict (honest read)", "");
    if (npmiOrthogonal) {
      rows.push(
        `**CONFIRMED — NPMI adds orthogonal signal.** Dropping NPMI lowers pool-recall by ` +
          `${f3(-npmiRecallDrop)} (and nDCG@10 by ${f3(-ndcgDrop("-npmi"))}), and in ` +
          `${npmiOnlyNotRetrieval}/${nCases} cases the held-out purchase is reachable via the ` +
          `NPMI co-occurrence list but NOT via cosine retrieval — exactly the complements the ` +
          `coseno fails to surface. NPMI is not redundant with retrieval on this dataset.`,
        "",
      );
    } else if (npmiReachesUnique && !npmiAddsRecall) {
      rows.push(
        `**PARTIAL — NPMI reaches ${npmiOnlyNotRetrieval} test items retrieval misses, but ` +
          `removing it does not drop pool-recall** (the 200-cap pool already absorbs those ids ` +
          `from other sources, or those NPMI-unique hits fall outside the held-out test items). ` +
          `NPMI carries some non-redundant reach, but the orthogonality is not load-bearing for ` +
          `pool-recall at this pool cap / n.`,
        "",
      );
    } else {
      rows.push(
        `**REFUTED (on this dataset) — NPMI does not add measurable orthogonal recall.** ` +
          `Removing NPMI changes pool-recall by ${sgn(npmiRecallDrop)}${f3(npmiRecallDrop)} and ` +
          `only ${npmiOnlyNotRetrieval}/${nCases} test items are NPMI-reachable-but-not-retrieval. ` +
          `On this synthetic catalog the co-occurrence signal overlaps with cosine retrieval; ` +
          `the orthogonality claim is not supported here. Reported as-is per F6's honesty mandate.`,
        "",
      );
    }
    // Which source is most load-bearing for recall (largest recall drop).
    const ablations = VARIANTS.filter((v) => v !== "full");
    const mostCostly = ablations.reduce((a, b) => (recallDrop(b) < recallDrop(a) ? b : a));
    rows.push(
      `Most load-bearing source for pool-recall: dropping **${mostCostly.slice(1)}** costs the most ` +
        `recall (${sgn(recallDrop(mostCostly))}${f3(recallDrop(mostCostly))}). Full-pool recall = ` +
        `${f3(fullRecall)}, nDCG@10 = ${f3(fullNdcg)}.`,
      "",
    );

    const md = rows.join("\n") + "\n";

    // ── JSON sidecar. ──────────────────────────────────────────────────────────
    const json = {
      generated_at: new Date().toISOString(),
      workstream: "W9",
      item_space: SPACE,
      seed: SEED,
      e1_universe: commonIds.length,
      eval_cases: nCases,
      limit: limit > 0 ? limit : null,
      pool_size: POOL_SIZE,
      rrf_k0: 60,
      quotas: {
        retrieval: RETRIEVAL_TOP,
        npmi: NPMI_TOP,
        popular: POPULAR_TOP,
        exploration: EXPLORATION_N,
      },
      variants: Object.fromEntries(
        VARIANTS.map((v) => [
          v,
          {
            pool_recall: recall(v),
            pool_recall_hits: acc[v].recallHits,
            ndcg10: ndcg(v),
            recall_drop_vs_full: v === "full" ? 0 : recallDrop(v),
            ndcg10_drop_vs_full: v === "full" ? 0 : ndcgDrop(v),
            avg_pool_size: avgPool(v),
          },
        ]),
      ),
      source_only_recall: Object.fromEntries(
        SOURCES.map((s) => [s, { recall: sourceOnlyRecall[s] / nCases, hits: sourceOnlyRecall[s] }]),
      ),
      npmi_orthogonality: {
        cases_with_last_viewed: casesWithLastViewed,
        test_in_npmi: npmiHasTest,
        test_in_retrieval: retrievalHasTest,
        test_in_npmi_not_retrieval: npmiOnlyNotRetrieval,
        npmi_recall_drop_vs_full: npmiRecallDrop,
        npmi_adds_recall: npmiAddsRecall,
        npmi_reaches_unique: npmiReachesUnique,
        npmi_orthogonal: npmiOrthogonal,
      },
      most_costly_source: mostCostly.slice(1),
    };

    // ── Write. ─────────────────────────────────────────────────────────────────
    const base = resolve(
      process.cwd(),
      "docs/superpowers/reports/2026-06-08-thesis-f6-pool-ablation-n2000-seed42",
    );
    const outMd = `${base}.md`;
    const outJson = `${base}.json`;
    writeFileSync(outMd, md);
    writeFileSync(outJson, JSON.stringify(json, null, 2) + "\n");

    console.log(md);
    console.log(`[f6-pool-ablation] wrote ${outMd}`);
    console.log(`[f6-pool-ablation] wrote ${outJson}`);
  } finally {
    await pg.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
