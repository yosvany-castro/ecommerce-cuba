#!/usr/bin/env tsx
/**
 * F6 W6 — End-to-end serving latency / p99 of the assembled feed (spec §5 W6).
 *
 * The thesis claims a production-shaped pipeline (F1 retrieval → F2 modes → F3
 * pool+rerank → F4 multi-objective scorer). W6 asks the only question an operator
 * cares about: how long does ONE request take, end to end, and does p99 clear the
 * Fase-3c reference gate of < 1.5 s?
 *
 * Per request (one UnifiedCase) we TIME — with performance.now(), which is
 * MONOTONIC INSTRUMENTATION ONLY (never stored as data, never feeds any ranking
 * decision; spec §2 exception) — the three serve-time stages:
 *
 *   1. retrieval / pool-order  — the real per-request retrieval cost: max-cosine
 *      of every candidate (catalog \ train) to the user's E1 mode medoids, top-80
 *      sort, plus the NPMI / popular / exploration source lists, fused into the
 *      4-source RRF(200) pool (buildCandidatePool). This is the dominant O(N·dim)
 *      cost and the part that grows with catalog size (W2 reports the n=10000 scale
 *      numbers; this baseline is n=2000).
 *   2. rerank — pointwise LTR scoring + sort of the pool (the F3 stage). With
 *      --llm we additionally time a DeepSeek listwise pass over the pool top-30 via
 *      src/thesis/rerank/llm-reranker.ts (llmRerank) and account its $/request +
 *      fallback rate. The LTR model is trained ONCE up front (train-split-only) and
 *      is NOT part of the per-request timing — training is offline.
 *   3. scorer — multiObjectiveRanker (F4) over the LTR-ordered pooled prefix.
 *
 * End-to-end per request = stage1 + stage2(LTR [+ LLM]) + stage3. We report
 * p50 / p95 / p99 of the end-to-end and of every stage, with and without the LLM
 * leg broken out (the LLM is a network call; its tail dominates when enabled).
 *
 * Determinism (spec §2, hazard #6): every ranking decision is seed-deterministic
 * (makeRng; no Math.random / Date.now in ranking). performance.now() is used
 * SOLELY to time stages — it never affects which items are ranked, and the timing
 * is not persisted as dataset/ranking data. The only Date.now is the report stamp.
 *
 * No mocks (hard rule #1): real Postgres (E1 vectors, holdout, NPMI, popularity)
 * and, with --llm, the real DeepSeek API. No DB writes.
 *
 * Item space = e1_prod2vec (64d). cosineSim THROWS on dim mismatch (hazard #5) —
 * every cosine here is E1-vs-E1.
 *
 * Usage:
 *   pnpm tsx scripts/thesis/f6-latency.ts [--n 2000] [--seed 42] [--limit 200]
 *                                         [--llm] [--out path-without-ext]
 *   Smoke (no LLM): pnpm tsx scripts/thesis/f6-latency.ts --limit 50
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { performance } from "perf_hooks";
import { writeFileSync } from "fs";
import { getPgClient } from "@/lib/db/pg";
import { cosineSim } from "@/thesis/embedders/space";
import { loadUnifiedCases, type UnifiedCase } from "@/thesis/eval/unified-cases";
import {
  trainAssembledLtr,
  assembledRankerFor,
  type FeatureMetaById,
  type FeatureMeta,
  F4_KNEE_WEIGHTS,
} from "@/thesis/eval/assembled";
import { buildCandidatePool } from "@/thesis/rerank/candidates";
import { llmRerank, type LlmCandidate } from "@/thesis/rerank/llm-reranker";
import type { LtrModel } from "@/thesis/rerank/ltr";

// ── Constants ─────────────────────────────────────────────────────────────────
const SEED = 42;
const POOL_SIZE = 200;
const RETRIEVAL_TOP = 80;
const NPMI_TOP = 50;
const POPULAR_TOP = 40;
const EXPLORATION_N = 30;
const LLM_TOP = 30; // DeepSeek listwise reranks the pool top-30 (mirrors f3-study).
const REF_GATE_MS = 1500; // Fase-3c reference gate: p99 < 1.5 s end-to-end.

// DeepSeek-chat pricing (deepseek-v4-flash, src/lib/llm/deepseek.ts header):
// cache-miss input $0.14/M, output $0.28/M. We price input at the cache-MISS rate
// (conservative upper bound; server-side cache hits would only make it cheaper).
const USD_PER_M_INPUT = 0.14;
const USD_PER_M_OUTPUT = 0.28;
// Chars→tokens heuristic for the cost ESTIMATE (DeepSeek does not return usage via
// llmRerank). ~4 chars/token is the standard rule of thumb for this tokenizer
// family; the report labels the $ figure "estimated" accordingly (spec W6 wording).
const CHARS_PER_TOKEN = 4;

// ── CLI ───────────────────────────────────────────────────────────────────────
interface Cli {
  n: number;
  seed: number;
  limit: number;
  llm: boolean;
  out: string | null;
}

function parseCli(argv: string[]): Cli {
  const cli: Cli = { n: 2000, seed: SEED, limit: 200, llm: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`[f6-latency] flag ${a} requires a value`);
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
      case "--llm":
        cli.llm = true;
        break;
      case "--out":
        cli.out = next();
        break;
      default:
        throw new Error(`[f6-latency] unknown flag: ${a}`);
    }
  }
  if (!Number.isFinite(cli.n) || cli.n <= 0) throw new Error(`[f6-latency] --n must be a positive int`);
  if (!Number.isFinite(cli.limit) || cli.limit <= 0)
    throw new Error(`[f6-latency] --limit must be a positive int`);
  return cli;
}

// ── Percentile helper (nearest-rank on a SORTED-ASCENDING array). ─────────────
/** Nearest-rank percentile (p in [0,1]) over `sorted` (ascending). Empty → 0. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (p <= 0) return sorted[0];
  if (p >= 1) return sorted[sorted.length - 1];
  // Nearest-rank: rank = ceil(p · N), 1-indexed.
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** p50/p95/p99 + mean/max of a latency sample (ms), sorting a COPY (no mutation). */
function summarize(samples: number[]): {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  max: number;
  n: number;
} {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    mean: mean(sorted),
    max: sorted.length ? sorted[sorted.length - 1] : 0,
    n: sorted.length,
  };
}

// ── Stage 1: the real per-request retrieval + 4-source pool build. ────────────
// Reproduces the unified-loader pool logic VERBATIM (so the timed work is exactly
// the serve-time cost), but here it runs per-request and is TIMED. It returns
// nothing the harness consumes for correctness — we already have case.pool from
// the loader; this re-derivation exists purely to measure stage-1 latency.
function timedRetrieval(c: UnifiedCase, e1Item: Map<string, number[]>): number {
  const t0 = performance.now();

  const trainSet = new Set(c.trainIds);
  const candidateIds = c.candidates.map((x) => x.id); // catalog \ train (loader frame).
  const modeMedoids = c.modes.map((m) => m.medoid);

  // SOURCE 1: retrieval — top-80 by max cosine to mode medoids (E1-vs-E1).
  const retrieval = candidateIds
    .map((id) => {
      const v = e1Item.get(id)!;
      return {
        id,
        s: modeMedoids.length ? Math.max(...modeMedoids.map((m) => cosineSim(m, v))) : 0,
      };
    })
    .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
    .slice(0, RETRIEVAL_TOP)
    .map((x) => x.id);

  // SOURCE 2: npmi — neighbours of last-viewed (already on the case, ordered by
  // rank in lvNpmi insertion order). Re-filter as the loader does.
  const npmi = [...c.lvNpmi.keys()]
    .filter((id) => e1Item.has(id) && !trainSet.has(id))
    .slice(0, NPMI_TOP);

  // SOURCE 3: popular — cohort-popularity tail; the loader already encoded it in
  // the pool's `popular` source, but for a faithful re-time we rank the candidate
  // frame by popById (popularity desc, id tie-break) and take the top-40. This is
  // the same O(N) popularity sort the serve path runs.
  const popular = [...candidateIds]
    .sort((a, b) => (c.popById.get(b) ?? 0) - (c.popById.get(a) ?? 0) || a.localeCompare(b))
    .slice(0, POPULAR_TOP);

  // SOURCE 4: exploration — first 30 candidate ids in their (sorted) frame order.
  // The loader uses a seeded shuffle; the per-request COST of taking 30 ids is the
  // same O(EXPLORATION_N) slice — we time the slice, not the (offline) shuffle.
  const exploration = candidateIds.slice(0, EXPLORATION_N);

  // Fuse the four sources (RRF) into the pool — the pool-order step.
  buildCandidatePool(
    [
      { source: "retrieval", ids: retrieval },
      { source: "npmi", ids: npmi },
      { source: "popular", ids: popular },
      { source: "exploration", ids: exploration },
    ],
    POOL_SIZE,
  );

  return performance.now() - t0;
}

// ── Stage 2: the F3 LTR rerank of the pool (pointwise score + sort). ──────────
function timedLtrRerank(
  c: UnifiedCase,
  model: LtrModel,
  featuresById: Map<string, number[]>,
): number {
  const t0 = performance.now();
  // assembledRankerFor with rerank=ltr, F4 off → the F3 LTR ordering of the pool
  // (plus the deterministic popular-cohort tail). This IS the F3 rerank stage.
  const ranker = assembledRankerFor(c, { rerank: "ltr", f4Weights: null }, model, featuresById);
  ranker.rank(c.ctx, c.candidates);
  return performance.now() - t0;
}

// ── Stage 3: the F4 multi-objective scorer over the pooled prefix. ────────────
function timedScorer(
  c: UnifiedCase,
  model: LtrModel,
  featuresById: Map<string, number[]>,
): number {
  const t0 = performance.now();
  // Full assembled pipeline F3-LTR → F4-knee. We isolate the scorer cost by timing
  // the F4-on minus F4-off delta is NOT used (the greedy scorer dominates F4); we
  // instead time the F4-on assembled rank and subtract the rerank-only time at the
  // call site, giving the marginal F4 cost. Here we time the F4-on path itself.
  const ranker = assembledRankerFor(c, { rerank: "ltr", f4Weights: F4_KNEE_WEIGHTS }, model, featuresById);
  ranker.rank(c.ctx, c.candidates);
  return performance.now() - t0;
}

interface LlmAccount {
  ms: number;
  inputTokensEst: number;
  outputTokensEst: number;
  fallback: boolean;
}

// ── Stage 2b (optional): DeepSeek listwise rerank of pool top-30. ─────────────
async function timedLlmRerank(
  c: UnifiedCase,
  llmMeta: Map<string, { title: string; price_cents: number; brand: string; category: string }>,
): Promise<LlmAccount> {
  const poolTop = c.pool.map((p) => p.id).slice(0, LLM_TOP);
  const llmCands: LlmCandidate[] = poolTop.map((id) => {
    const m = llmMeta.get(id);
    return {
      product_id: id,
      title: m?.title ?? "",
      price_cents: m?.price_cents ?? 0,
      brand: m?.brand ?? "",
      category: m?.category ?? "",
      npmi_to_last_viewed: c.lvNpmi.get(id) ?? 0,
      source: "",
    };
  });
  const profileBits = [c.buyerGender, c.buyerAgeBand].filter(Boolean).join(", ");
  const recipBits = c.giftSignal.isGift
    ? [c.recipientGender, c.recipientAgeBand].filter(Boolean).join(", ")
    : null;
  const ctx = {
    profile_summary: profileBits || "comprador",
    is_gift: c.giftSignal.isGift,
    recipient_summary: recipBits,
    last_viewed: c.lastViewedTitle,
  };

  const t0 = performance.now();
  const res = await llmRerank(llmCands, ctx);
  const ms = performance.now() - t0;

  // Token ESTIMATE (llmRerank does not surface usage). Input ≈ the serialized
  // candidate payload + context (what the prompt carries); output ≈ the returned
  // ordering JSON. Chars/4 — labeled "estimated" in the report.
  const inputChars = JSON.stringify({ ...ctx, candidatos: llmCands }).length;
  const outputChars = JSON.stringify(res.order.map((id, i) => ({ product_id: id, rank: i + 1 }))).length;
  return {
    ms,
    inputTokensEst: Math.ceil(inputChars / CHARS_PER_TOKEN),
    outputTokensEst: Math.ceil(outputChars / CHARS_PER_TOKEN),
    fallback: res.usedFallback,
  };
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  const pg = await getPgClient({ scope: "thesis" });
  try {
    // ── Load canonical cases (E1 64d). Loader reads the holdout intact. ─────────
    const loaded = await loadUnifiedCases(pg, { limit: cli.limit });
    const cases = loaded.cases;
    const e1Item = loaded.e1Item;

    // ── product-count sanity check (fail loud on a mislabeled --n). ─────────────
    const productCountRow = (
      await pg.query<{ c: string }>(`SELECT count(*)::text c FROM thesis.products`)
    ).rows[0];
    const productCount = parseInt(productCountRow?.c ?? "0", 10);
    if (productCount !== cli.n) {
      throw new Error(
        `[f6-latency] product-count sanity check FAILED: thesis.products has ${productCount} rows but ` +
          `--n=${cli.n}. Refusing to mislabel the report. Pass the correct --n or inspect the dataset.`,
      );
    }

    // ── Per-id FeatureMeta for the assembled LTR (same read shape as f6-headtohead). ─
    const metaById: FeatureMetaById = new Map<string, FeatureMeta>();
    for (const r of (
      await pg.query<{ id: string; metadata: Record<string, unknown> }>(
        `SELECT id::text id, metadata FROM thesis.products`,
      )
    ).rows) {
      const m = r.metadata ?? {};
      const at = m.age_target as { min?: number; max?: number } | null | undefined;
      const vec = e1Item.get(r.id);
      if (vec !== undefined) {
        metaById.set(r.id, {
          vector: vec,
          priceBand: typeof m.price_band === "number" ? m.price_band : 0,
          gender_target: (m.gender_target as string | null) ?? null,
          ageBand: ageBandOfRange(at),
        });
      }
    }

    // ── Train the assembled LTR ONCE (offline; NOT in the per-request timing). ──
    const trainT0 = performance.now();
    const assembledLtr = trainAssembledLtr(cases, metaById);
    const trainMs = performance.now() - trainT0;
    const caseKeyOf = (c: UnifiedCase): string => `${c.userId}|${[...c.relevant][0] ?? ""}`;

    // ── LLM candidate meta (title/brand/category/price) when --llm. ─────────────
    const llmMeta = new Map<
      string,
      { title: string; price_cents: number; brand: string; category: string }
    >();
    if (cli.llm) {
      for (const r of (
        await pg.query<{
          id: string;
          title: string;
          metadata: Record<string, unknown>;
          price_cents: number;
        }>(`SELECT id::text id, title, metadata, price_cents FROM thesis.products`)
      ).rows) {
        const m = r.metadata ?? {};
        llmMeta.set(r.id, {
          title: r.title ?? "",
          price_cents: r.price_cents ?? 0,
          brand: (m.brand as string | null) ?? "",
          category: (m.category as string | null) ?? "",
        });
      }
    }

    console.log(
      `[f6-latency] n=${cli.n} seed=${cli.seed} cases=${cases.length} ` +
        `e1-universe=${loaded.meta.n} products=${productCount} llm=${cli.llm}`,
    );

    // ── Per-request timing loop. ────────────────────────────────────────────────
    const stage1: number[] = []; // retrieval / pool-order
    const stage2Ltr: number[] = []; // F3 LTR rerank (ltr score + sort of pool)
    const stage3Scorer: number[] = []; // F4 multi-objective scorer (marginal over rerank)
    const stage2Llm: number[] = []; // DeepSeek listwise (only when --llm)
    const endToEndNoLlm: number[] = []; // s1 + s2-ltr + s3
    const endToEndWithLlm: number[] = []; // s1 + s2-ltr + s2-llm + s3 (only when --llm)
    const llmInputTok: number[] = [];
    const llmOutputTok: number[] = [];
    let llmFallbacks = 0;

    for (const c of cases) {
      const feats = assembledLtr.featuresByCaseKey.get(caseKeyOf(c)) ?? new Map<string, number[]>();

      // Stage 1: retrieval / pool-order.
      const s1 = timedRetrieval(c, e1Item);

      // Stage 2: F3 LTR rerank of the pool.
      const s2ltr = timedLtrRerank(c, assembledLtr.model, feats);

      // Stage 3 (marginal F4): time the full F3-LTR→F4 path and subtract the
      // rerank-only time, giving the marginal scorer cost. Clamp at 0 (timing
      // jitter can make the F4-on path momentarily measure below F4-off).
      const f3f4 = timedScorer(c, assembledLtr.model, feats);
      const s3 = Math.max(0, f3f4 - s2ltr);

      stage1.push(s1);
      stage2Ltr.push(s2ltr);
      stage3Scorer.push(s3);
      endToEndNoLlm.push(s1 + s2ltr + s3);

      if (cli.llm) {
        const llm = await timedLlmRerank(c, llmMeta);
        stage2Llm.push(llm.ms);
        llmInputTok.push(llm.inputTokensEst);
        llmOutputTok.push(llm.outputTokensEst);
        if (llm.fallback) llmFallbacks++;
        endToEndWithLlm.push(s1 + s2ltr + llm.ms + s3);
      }
    }

    // ── Summaries. ──────────────────────────────────────────────────────────────
    const sumS1 = summarize(stage1);
    const sumS2Ltr = summarize(stage2Ltr);
    const sumS3 = summarize(stage3Scorer);
    const sumE2E = summarize(endToEndNoLlm);
    const sumS2Llm = cli.llm ? summarize(stage2Llm) : null;
    const sumE2ELlm = cli.llm ? summarize(endToEndWithLlm) : null;

    // ── LLM cost / request (estimated). ─────────────────────────────────────────
    let llmCost: {
      avgInputTokens: number;
      avgOutputTokens: number;
      usdPerRequest: number;
      usdPerRequestP99Tokens: number;
      fallbackRate: number;
      fallbacks: number;
      n: number;
    } | null = null;
    if (cli.llm) {
      const avgIn = mean(llmInputTok);
      const avgOut = mean(llmOutputTok);
      const usdAvg =
        (avgIn / 1_000_000) * USD_PER_M_INPUT + (avgOut / 1_000_000) * USD_PER_M_OUTPUT;
      const inSorted = [...llmInputTok].sort((a, b) => a - b);
      const outSorted = [...llmOutputTok].sort((a, b) => a - b);
      const usdP99 =
        (percentile(inSorted, 0.99) / 1_000_000) * USD_PER_M_INPUT +
        (percentile(outSorted, 0.99) / 1_000_000) * USD_PER_M_OUTPUT;
      llmCost = {
        avgInputTokens: avgIn,
        avgOutputTokens: avgOut,
        usdPerRequest: usdAvg,
        usdPerRequestP99Tokens: usdP99,
        fallbackRate: cases.length ? llmFallbacks / cases.length : 0,
        fallbacks: llmFallbacks,
        n: cases.length,
      };
    }

    // ── Gate evaluation: the end-to-end p99 that matters operationally. ─────────
    // With --llm the LLM leg is the operative serving path; without it the LTR-only
    // pipeline is. The gate is checked against whichever end-to-end is in scope.
    const operativeE2E = cli.llm ? sumE2ELlm! : sumE2E;
    const gatePass = operativeE2E.p99 < REF_GATE_MS;

    // ── Render markdown + JSON. ─────────────────────────────────────────────────
    const f2 = (x: number) => x.toFixed(2);
    const f3 = (x: number) => x.toFixed(3);
    const md = renderMarkdown({
      cli,
      eUniverse: loaded.meta.n,
      productCount,
      poolSize: loaded.meta.poolSize,
      nCases: cases.length,
      trainMs,
      sumS1,
      sumS2Ltr,
      sumS3,
      sumE2E,
      sumS2Llm,
      sumE2ELlm,
      llmCost,
      gatePass,
      operativeE2E,
      f2,
      f3,
    });

    const json = {
      generated_at: new Date().toISOString(),
      item_space: loaded.meta.space,
      n: cli.n,
      seed: cli.seed,
      e1_universe: loaded.meta.n,
      product_count: productCount,
      pool_size: loaded.meta.poolSize,
      eval_cases: cases.length,
      llm_enabled: cli.llm,
      ref_gate_ms: REF_GATE_MS,
      gate_pass: gatePass,
      offline_ltr_train_ms: trainMs,
      stages_ms: {
        retrieval_pool_order: sumS1,
        rerank_ltr: sumS2Ltr,
        scorer_f4: sumS3,
        ...(sumS2Llm ? { rerank_llm: sumS2Llm } : {}),
      },
      end_to_end_ms: {
        no_llm: sumE2E,
        ...(sumE2ELlm ? { with_llm: sumE2ELlm } : {}),
      },
      llm_cost: llmCost,
    };

    const base =
      cli.out ??
      resolve(
        process.cwd(),
        `docs/superpowers/reports/2026-06-08-thesis-f6-latency-n${cli.n}-seed${cli.seed}`,
      );
    const outMd = base.endsWith(".md") ? base : `${base}.md`;
    const outJson = base.endsWith(".md") ? base.replace(/\.md$/, ".json") : `${base}.json`;
    writeFileSync(outMd, md);
    writeFileSync(outJson, JSON.stringify(json, null, 2) + "\n");

    console.log(md);
    console.log(`[f6-latency] wrote ${outMd}`);
    console.log(`[f6-latency] wrote ${outJson}`);
  } finally {
    await pg.end();
  }
}

// ── Item age band from age_target range (matches unified-cases ageBandOf). ─────
function ageBandOfRange(at: { min?: number; max?: number } | null | undefined): string | null {
  if (!at || typeof at.min !== "number" || typeof at.max !== "number") return null;
  const mid = (at.min + at.max) / 2;
  if (mid <= 3) return "bebe";
  if (mid <= 11) return "nino";
  if (mid <= 25) return "joven";
  if (mid <= 59) return "adulto";
  return "mayor";
}

// ── Markdown renderer (pure). ──────────────────────────────────────────────────
type StageSummary = {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  max: number;
  n: number;
};

function renderMarkdown(o: {
  cli: Cli;
  eUniverse: number;
  productCount: number;
  poolSize: number;
  nCases: number;
  trainMs: number;
  sumS1: StageSummary;
  sumS2Ltr: StageSummary;
  sumS3: StageSummary;
  sumE2E: StageSummary;
  sumS2Llm: StageSummary | null;
  sumE2ELlm: StageSummary | null;
  llmCost: {
    avgInputTokens: number;
    avgOutputTokens: number;
    usdPerRequest: number;
    usdPerRequestP99Tokens: number;
    fallbackRate: number;
    fallbacks: number;
    n: number;
  } | null;
  gatePass: boolean;
  operativeE2E: StageSummary;
  f2: (x: number) => string;
  f3: (x: number) => string;
}): string {
  const { cli, f2, f3 } = o;
  const rows: string[] = [];
  const stageRow = (label: string, s: StageSummary): string =>
    `| ${label} | ${f2(s.p50)} | ${f2(s.p95)} | ${f2(s.p99)} | ${f2(s.mean)} | ${f2(s.max)} | ${s.n} |`;

  rows.push(`# Thesis F6 W6 — End-to-end serving latency / p99`, "");
  rows.push(
    `Item space: e1_prod2vec (canonical 64d). n=${cli.n}, seed=${cli.seed}. ` +
      `E1 universe: ${o.eUniverse}. Products: ${o.productCount}. Pool size: ${o.poolSize}. ` +
      `Requests timed: ${o.nCases}. LLM: ${cli.llm ? "on (DeepSeek listwise, pool top-30)" : "off"}.`,
    "",
  );
  rows.push(
    "All latencies are **per-request** wall times from `performance.now()` " +
      "(monotonic instrumentation only — never stored as data, never affects ranking; spec §2 exception). " +
      "Reference gate: **p99 < 1.5 s** end-to-end (Fase-3c spec). " +
      "**Scale caveat:** these are n=2000 baseline numbers; the real-scale figures come at n=10000 (W2). " +
      "Stage-1 (retrieval) is O(N·dim) so it grows with the catalog — extrapolate accordingly.",
    "",
  );
  rows.push(
    `Offline LTR training (NOT in per-request timing; done once): ${f2(o.trainMs)} ms ` +
      `for all ${o.nCases} cases.`,
    "",
  );

  // ── Per-stage breakdown. ────────────────────────────────────────────────────
  rows.push("## Per-stage latency (ms)", "");
  rows.push(
    "| Stage | p50 | p95 | p99 | mean | max | n |",
    "|---|---|---|---|---|---|---|",
  );
  rows.push(stageRow("1. retrieval / pool-order", o.sumS1));
  rows.push(stageRow("2. rerank (F3 LTR)", o.sumS2Ltr));
  if (o.sumS2Llm) rows.push(stageRow("2b. rerank (DeepSeek listwise)", o.sumS2Llm));
  rows.push(stageRow("3. scorer (F4 multi-objective)", o.sumS3));
  rows.push("");

  // ── End-to-end. ─────────────────────────────────────────────────────────────
  rows.push("## End-to-end latency (ms)", "");
  rows.push(
    "| Path | p50 | p95 | p99 | mean | max | n |",
    "|---|---|---|---|---|---|---|",
  );
  rows.push(stageRow("end-to-end (no LLM): retrieval+LTR+scorer", o.sumE2E));
  if (o.sumE2ELlm) rows.push(stageRow("end-to-end (with LLM): +DeepSeek listwise", o.sumE2ELlm));
  rows.push("");

  // ── Gate. ───────────────────────────────────────────────────────────────────
  const gateStr = o.gatePass ? "PASS" : "FAIL";
  const scope = cli.llm ? "with-LLM" : "no-LLM";
  rows.push("## Reference gate — p99 < 1.5 s", "");
  rows.push(
    `Operative end-to-end (${scope}) p99 = **${f2(o.operativeE2E.p99)} ms** ` +
      `→ gate (< ${1500} ms): **${gateStr}**.`,
    "",
  );

  // ── LLM cost. ───────────────────────────────────────────────────────────────
  if (o.llmCost) {
    rows.push("## LLM cost / request (DeepSeek listwise, estimated)", "");
    rows.push(
      "Token counts are **estimated** from prompt/response char length (≈4 chars/token); " +
        "`llmRerank` does not surface provider usage. Priced at the deepseek-chat cache-MISS " +
        `rate ($${USD_PER_M_INPUT}/M input, $${USD_PER_M_OUTPUT}/M output) — a conservative upper bound ` +
        "(server-side cache hits would only lower it).",
      "",
    );
    rows.push("| metric | value |", "|---|---|");
    rows.push(`| avg input tokens (est) | ${f2(o.llmCost.avgInputTokens)} |`);
    rows.push(`| avg output tokens (est) | ${f2(o.llmCost.avgOutputTokens)} |`);
    rows.push(`| **$/request (avg tokens, est)** | $${o.llmCost.usdPerRequest.toFixed(6)} |`);
    rows.push(`| $/request (p99 tokens, est) | $${o.llmCost.usdPerRequestP99Tokens.toFixed(6)} |`);
    rows.push(
      `| fallback rate | ${f3(o.llmCost.fallbackRate)} (${o.llmCost.fallbacks}/${o.llmCost.n}) |`,
    );
    rows.push("");
  }

  // ── Honest read. ────────────────────────────────────────────────────────────
  rows.push("## Lectura (honest read)", "");
  const dominant = [
    { name: "retrieval/pool-order", p99: o.sumS1.p99 },
    { name: "rerank (LTR)", p99: o.sumS2Ltr.p99 },
    { name: "scorer (F4)", p99: o.sumS3.p99 },
    ...(o.sumS2Llm ? [{ name: "rerank (LLM)", p99: o.sumS2Llm.p99 }] : []),
  ].reduce((a, b) => (b.p99 > a.p99 ? b : a));
  rows.push(
    `Without the LLM, end-to-end p99 is **${f2(o.sumE2E.p99)} ms** — ` +
      `${o.sumE2E.p99 < 1500 ? "well under" : "over"} the 1.5 s gate. ` +
      `The dominant stage (p99) is **${dominant.name}** (${f2(dominant.p99)} ms). ` +
      `Note that retrieval / pool-order is the O(N·dim) scan over ~${o.eUniverse} candidates ` +
      `(p99 ${f2(o.sumS1.p99)} ms) — the stage that grows with the catalog, so at n=10000 (W2) ` +
      `it is expected to overtake the fixed-cost rerank/scorer stages, which only touch the 200-item pool.`,
    "",
  );
  if (o.sumE2ELlm) {
    rows.push(
      `With the DeepSeek listwise leg, end-to-end p99 jumps to **${f2(o.sumE2ELlm.p99)} ms** ` +
        `(${o.sumE2ELlm.p99 < 1500 ? "still under" : "OVER"} the 1.5 s gate) — the network round-trip ` +
        `tail dominates. At an estimated $${o.llmCost?.usdPerRequest.toFixed(6)}/request this is the ` +
        `relevance-vs-latency-vs-$ dial: the LLM leg is optional (--llm), gated behind a fallback ` +
        `(rate ${f3(o.llmCost?.fallbackRate ?? 0)}) that returns the RRF order on any failure.`,
      "",
    );
  } else {
    rows.push(
      "The LLM leg was OFF for this run (`--llm` not passed); only the deterministic LTR pipeline " +
        "was timed. Re-run with `--llm` to measure the DeepSeek listwise tail + $/request.",
      "",
    );
  }
  rows.push(
    "**Caveat (honest):** every latency here is single-process, single-thread tsx on the dev box, " +
      "with all vectors already resident in memory (the loader bulk-reads them once). A real serving " +
      "tier adds DB/cache round-trips per request, GC pressure under concurrency, and cold-start. " +
      "These numbers are a LOWER BOUND on the compute cost of the ranking math, not a production SLA.",
    "",
  );

  return rows.join("\n") + "\n";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
