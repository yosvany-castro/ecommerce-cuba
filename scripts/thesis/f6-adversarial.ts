#!/usr/bin/env tsx
/**
 * F6 W7 — Adversarial profiles runner (spec §5 W7).
 *
 * Runs the assembled pipeline + the popular-cohort MVP rival on EXTREME synthetic
 * profiles (built by src/thesis/eval/adversarial.ts from real catalog + E1 vectors):
 *   1. pure-gift     — buyer vs recipient demographically opposite.
 *   2. multi-modal   — 6 orthogonal subcategories (disjoint cohorts).
 *   3. price-extreme — high-tail-only / cheap-only.
 *   4. ambiguous     — mixed signals challenging the gift detector.
 *
 * NO held-out purchase exists for a synthetic profile, so per spec §5 W7 this runner
 * DOES NOT report nDCG/recall/MRR. It reports, per profile and per ranker:
 *   - gift-detector firing + predicted recipient (gender/age band)
 *   - mode count (PinnerSage interest modes the profile produced)
 *   - recipient-fit@10 (vs the profile's intended recipient)
 *   - set-change@10 vs popular-cohort
 *   - revenue@10
 *   - diversity@10 (intra-list, E1 64d)
 *   + a qualitative note on graceful adaptation / degradation.
 *
 * Rankers compared (same UnifiedCase geometry as the head-to-head):
 *   - popular-cohort      — the MVP rival (set-change baseline).
 *   - assembled-rrf-f4    — F1→F2→F3-RRF→F4-knee (the pool-driven pipeline).
 *   - assembled-ltr-f4    — F1→F2→F3-LTR→F4-knee (the integrated end-to-end config;
 *                           LTR trained TRAIN-SPLIT-ONLY on the REAL holdout, then
 *                           applied to the synthetic profiles — no leakage, the
 *                           adversarial cases are never training samples).
 *
 * Embedding-space discipline (spec hazard #5): every vector is E1 (prod2vec, 64d);
 * cosineSim never sees a dim mismatch. No e2_hybrid (1024d text) in this path.
 *
 * No leakage (spec hazard #6): giftSignal is the F2 detector on the synthetic
 * session; intentGT is the profile's INTENDED label (segments report + drives the
 * recipient-fit target), never a ranking feature; the LTR is train-split-only on the
 * real holdout.
 *
 * Determinism (spec §6): seeded RNG only. The only Date.now is the report stamp.
 * Writes NOTHING to the DB.
 *
 * Usage:
 *   pnpm tsx scripts/thesis/f6-adversarial.ts [--n 2000] [--seed 42] [--out path-no-ext]
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { writeFileSync } from "fs";
import { getPgClient } from "@/lib/db/pg";
import {
  buildAdversarialProfiles,
  buildAdversarialCase,
  type CatalogData,
  type AdvProductMeta,
  type AdversarialProfile,
} from "@/thesis/eval/adversarial";
import type { UnifiedCase } from "@/thesis/eval/unified-cases";
import { loadUnifiedCases } from "@/thesis/eval/unified-cases";
import {
  assembledRankerFor,
  trainAssembledLtr,
  buildPoolFeatures,
  type FeatureMetaById,
  type FeatureMeta,
  F4_KNEE_WEIGHTS,
} from "@/thesis/eval/assembled";
import { popularCohortRanker } from "@/thesis/eval/baselines";
import {
  revenueAtK,
  recipientFitAtK,
  sellerExposureGini,
  intraListDiversity,
  setChangeAtK,
  type ItemDemographics,
  type RecipientProfile,
} from "@/thesis/eval/metrics";
import type { Ranker } from "@/thesis/types";

// ── Constants ─────────────────────────────────────────────────────────────────
const SPACE = "e1_prod2vec";
const K = 10; // all W7 metrics @10 (spec §5 W7).

// ── CLI ───────────────────────────────────────────────────────────────────────
interface Cli {
  n: number;
  seed: number;
  out: string | null;
}
function parseCli(argv: string[]): Cli {
  const cli: Cli = { n: 2000, seed: 42, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`[f6-adv] flag ${a} requires a value`);
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
      case "--out":
        cli.out = next();
        break;
      default:
        throw new Error(`[f6-adv] unknown flag: ${a}`);
    }
  }
  if (!Number.isFinite(cli.n) || cli.n <= 0) throw new Error(`[f6-adv] --n must be a positive int`);
  return cli;
}

// ── pg connection error / single-retry (spec hazard #8). ───────────────────────
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
async function queryRows<T>(
  pg: Awaited<ReturnType<typeof getPgClient>>,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  try {
    return (await pg.query(sql, params)).rows as T[];
  } catch (e) {
    if (!isConnectionError(e)) throw e;
    return (await pg.query(sql, params)).rows as T[];
  }
}

/** Age-band bucket from a product's age_target {min,max}; null if absent. */
function ageBandOf(at: { min?: number; max?: number } | null | undefined): string | null {
  if (!at || typeof at.min !== "number" || typeof at.max !== "number") return null;
  const mid = (at.min + at.max) / 2;
  if (mid <= 3) return "bebe";
  if (mid <= 11) return "nino";
  if (mid <= 25) return "joven";
  if (mid <= 59) return "adulto";
  return "mayor";
}

// ── Per-ranker adaptation metrics on one adversarial case. ────────────────────
interface CaseMetrics {
  ranker: string;
  recipientFit10: number;
  setChangeVsPc10: number;
  revenue10: number;
  diversity10: number;
  sellerGini10: number;
}

function metricsFor(
  ranker: Ranker,
  c: UnifiedCase,
  pcTop10: string[],
  e1: Map<string, number[]>,
  demoRecord: Record<string, ItemDemographics>,
  recipient: RecipientProfile | null,
): CaseMetrics {
  const ranked = ranker.rank(c.ctx, c.candidates);
  const topVecs = ranked
    .slice(0, K)
    .map((id) => e1.get(id))
    .filter((v): v is number[] => v !== undefined);
  return {
    ranker: ranker.name,
    recipientFit10: recipient ? recipientFitAtK(ranked, recipient, demoRecord, K) : NaN,
    setChangeVsPc10: setChangeAtK(ranked, pcTop10, K),
    revenue10: revenueAtK(ranked, c.revenueById, K),
    diversity10: intraListDiversity(topVecs),
    sellerGini10: sellerExposureGini(ranked, c.sellerById, K),
  };
}

// ── A single profile's full result bundle. ─────────────────────────────────────
interface ProfileResult {
  profile: AdversarialProfile;
  giftFired: boolean;
  giftScore: number;
  giftReasons: string[];
  predictedRecipientGender: string | null;
  predictedRecipientAgeBand: string | null;
  detectorCorrect: boolean; // detector firing matches intentGT="gift"
  modeCount: number;
  modeWeights: number[];
  poolSize: number;
  metrics: CaseMetrics[]; // popular-cohort, assembled-rrf-f4, assembled-ltr-f4
  qualitativeNote: string;
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  const pg = await getPgClient({ scope: "thesis" });
  try {
    // ── Sanity: product count == --n (fail loud on mislabel / silent regen). ──
    const productCount = parseInt(
      (await queryRows<{ c: string }>(pg, `SELECT count(*)::text c FROM thesis.products`))[0]?.c ?? "0",
      10,
    );
    if (productCount !== cli.n) {
      throw new Error(
        `[f6-adv] product-count sanity FAILED: thesis.products has ${productCount} but --n=${cli.n}.`,
      );
    }

    // ── Catalog reads (the same the unified loader does, minus holdout). ──────
    const e1 = new Map<string, number[]>();
    for (const r of await queryRows<{ id: string; vector: number[] }>(
      pg,
      `SELECT product_id::text id, vector FROM thesis.item_vectors WHERE space=$1`,
      [SPACE],
    )) {
      e1.set(r.id, r.vector.map(Number));
    }
    if (e1.size === 0) throw new Error("[f6-adv] no e1_prod2vec vectors — run pnpm thesis:train-prod2vec");

    const meta = new Map<string, AdvProductMeta>();
    const demoRecord: Record<string, ItemDemographics> = {};
    const metaById: FeatureMetaById = new Map<string, FeatureMeta>();
    for (const r of await queryRows<{
      id: string;
      title: string;
      metadata: Record<string, unknown>;
      price_cents: number;
    }>(pg, `SELECT id::text id, title, metadata, price_cents FROM thesis.products`)) {
      const m = r.metadata ?? {};
      const at = m.age_target as { min?: number; max?: number } | null | undefined;
      const gender = (m.gender_target as string | null) ?? null;
      const ageBand = ageBandOf(at);
      const priceBand = typeof m.price_band === "number" ? m.price_band : 0;
      meta.set(r.id, {
        gender,
        ageBand,
        priceBand,
        cohort: (m.subcategory as string | null) ?? null,
        category: (m.category as string | null) ?? "",
        title: r.title ?? "",
        priceCents: r.price_cents ?? 0,
        marginPct: typeof m.margin_pct === "number" ? m.margin_pct : 0,
        sellerId: (m.seller_id as string | null) ?? "__none__",
        sellerAgeDays: typeof m.seller_age_days === "number" ? m.seller_age_days : 0,
      });
      demoRecord[r.id] = { gender_target: gender, age_min: at?.min ?? 0, age_max: at?.max ?? 130 };
      const vec = e1.get(r.id);
      if (vec !== undefined) {
        metaById.set(r.id, { vector: vec, priceBand, gender_target: gender, ageBand });
      }
    }

    const popById = new Map<string, number>();
    for (const r of await queryRows<{ pid: string; c: number }>(
      pg,
      `SELECT payload->>'product_id' pid, count(*)::int c FROM thesis.events WHERE payload->>'product_id' IS NOT NULL GROUP BY 1`,
    )) {
      popById.set(r.pid, r.c);
    }

    const npmiNeighbours = new Map<string, { id: string; score: number }[]>();
    for (const r of await queryRows<{ pid: string; rid: string; npmi_score: number; rank: number }>(
      pg,
      `SELECT product_id::text pid, related_product_id::text rid, npmi_score, rank FROM thesis.co_occurrence_top ORDER BY product_id, rank`,
    )) {
      const a = npmiNeighbours.get(r.pid) ?? [];
      a.push({ id: r.rid, score: Number(r.npmi_score) });
      npmiNeighbours.set(r.pid, a);
    }

    // cohort → ids by popularity desc; global popular fallback (E1 universe only).
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

    const cat: CatalogData = { e1, meta, popById, npmiNeighbours, cohortPopular, globalPopular };

    // ── Build adversarial profiles + cases. ──────────────────────────────────
    const profiles = buildAdversarialProfiles(cat);
    if (profiles.length === 0) throw new Error("[f6-adv] no adversarial profiles built (catalog too sparse?)");
    const advCases = profiles.map((p) => ({ profile: p, case: buildAdversarialCase(cat, p) }));

    // ── Train the assembled LTR on the REAL holdout (train-split-only). The ───
    // adversarial cases are NEVER training samples — no leakage. We reuse the
    // canonical loader so the model is identical to the head-to-head's.
    const holdout = await loadUnifiedCases(pg);
    const assembledLtr = trainAssembledLtr(holdout.cases, metaById);

    console.log(
      `[f6-adv] profiles=${profiles.length} e1-universe=${e1.size} products=${productCount} ` +
        `holdout-train-cases=${holdout.cases.length}`,
    );

    // ── Per-profile evaluation. ──────────────────────────────────────────────
    const results: ProfileResult[] = [];
    for (const { profile, case: c } of advCases) {
      const pcTop10 = popularCohortRanker().rank(c.ctx, c.candidates).slice(0, K);

      // Recipient target for recipient-fit: the profile's intended recipient (gift
      // only). For self profiles recipient-fit is N/A (NaN).
      const recipient: RecipientProfile | null =
        profile.expectedRecipient !== null
          ? {
              gender: profile.expectedRecipient.gender,
              ...bandToAgeRange(profile.expectedRecipient.ageBand),
            }
          : null;

      // Rankers: popular-cohort, assembled-rrf-f4, assembled-ltr-f4.
      const pcRanker = popularCohortRanker();
      const rrfRanker = ((): Ranker => {
        const inner = assembledRankerFor(c, { rerank: "rrf", f4Weights: F4_KNEE_WEIGHTS });
        return { name: "assembled-rrf-f4", rank: inner.rank };
      })();
      const ltrRanker = ((): Ranker => {
        // The adversarial case is not in the holdout, so it has no pre-built pool
        // feature map; build it on the fly with the SAME builder the trainer used.
        const feats = buildPoolFeatsFor(c, metaById);
        const inner = assembledRankerFor(c, { rerank: "ltr", f4Weights: F4_KNEE_WEIGHTS }, assembledLtr.model, feats);
        return { name: "assembled-ltr-f4", rank: inner.rank };
      })();

      const metrics: CaseMetrics[] = [
        metricsFor(pcRanker, c, pcTop10, e1, demoRecord, recipient),
        metricsFor(rrfRanker, c, pcTop10, e1, demoRecord, recipient),
        metricsFor(ltrRanker, c, pcTop10, e1, demoRecord, recipient),
      ];

      const detectorCorrect = c.giftSignal.isGift === (profile.intentGT === "gift");
      results.push({
        profile,
        giftFired: c.giftSignal.isGift,
        giftScore: c.giftSignal.score,
        giftReasons: c.giftSignal.reasons,
        predictedRecipientGender: c.recipientGender,
        predictedRecipientAgeBand: c.recipientAgeBand,
        detectorCorrect,
        modeCount: c.modes.length,
        modeWeights: c.modes.map((m) => Number(m.weight.toFixed(3))),
        poolSize: c.pool.length,
        metrics,
        qualitativeNote: qualitativeNote(profile, c, metrics, detectorCorrect),
      });

      console.log(
        `[f6-adv] ${profile.id}: giftFired=${c.giftSignal.isGift} ` +
          `(intent=${profile.intentGT}, correct=${detectorCorrect}) modes=${c.modes.length} ` +
          `pool=${c.pool.length}`,
      );
    }

    // ── Render + write. ──────────────────────────────────────────────────────
    const md = renderMarkdown(cli, productCount, e1.size, holdout.cases.length, results);
    const json = {
      generated_at: new Date().toISOString(),
      item_space: SPACE,
      n: cli.n,
      seed: cli.seed,
      e1_universe: e1.size,
      product_count: productCount,
      holdout_train_cases: holdout.cases.length,
      k: K,
      note: "No held-out purchase for synthetic profiles → nDCG/recall/MRR NOT reported (spec §5 W7).",
      profiles: results.map((r) => ({
        id: r.profile.id,
        kind: r.profile.kind,
        intent_gt: r.profile.intentGT,
        description: r.profile.description,
        train_ids: r.profile.trainIds,
        expected_recipient: r.profile.expectedRecipient,
        gift_fired: r.giftFired,
        gift_score: r.giftScore,
        gift_reasons: r.giftReasons,
        predicted_recipient: {
          gender: r.predictedRecipientGender,
          age_band: r.predictedRecipientAgeBand,
        },
        detector_correct: r.detectorCorrect,
        mode_count: r.modeCount,
        mode_weights: r.modeWeights,
        pool_size: r.poolSize,
        metrics: r.metrics.map((m) => ({
          ranker: m.ranker,
          recipient_fit10: Number.isNaN(m.recipientFit10) ? null : m.recipientFit10,
          set_change_vs_pc10: m.setChangeVsPc10,
          revenue10: m.revenue10,
          diversity10: m.diversity10,
          seller_gini10: m.sellerGini10,
        })),
        qualitative_note: r.qualitativeNote,
      })),
    };

    const base =
      cli.out ??
      resolve(
        process.cwd(),
        `docs/superpowers/reports/2026-06-08-thesis-f6-adversarial-n${cli.n}-seed${cli.seed}`,
      );
    const outMd = base.endsWith(".md") ? base : `${base}.md`;
    const outJson = base.endsWith(".md") ? base.replace(/\.md$/, ".json") : `${base}.json`;
    writeFileSync(outMd, md);
    writeFileSync(outJson, JSON.stringify(json, null, 2) + "\n");

    console.log(`\n[f6-adv] wrote ${outMd}`);
    console.log(`[f6-adv] wrote ${outJson}`);
  } finally {
    await pg.end();
  }
}

// ── Pool feature builder for an adversarial case (reuses the assembled module's ─
//    exported buildPoolFeatures so LTR features match the trainer's exactly). ────
function buildPoolFeatsFor(c: UnifiedCase, metaById: FeatureMetaById): Map<string, number[]> {
  return buildPoolFeatures(c, metaById);
}

// ── Age band → representative age range (inverse of ageBandOf). ────────────────
function bandToAgeRange(band: string | null): { age_min: number; age_max: number } {
  switch (band) {
    case "bebe":
      return { age_min: 0, age_max: 3 };
    case "nino":
      return { age_min: 4, age_max: 11 };
    case "joven":
      return { age_min: 12, age_max: 25 };
    case "adulto":
      return { age_min: 26, age_max: 59 };
    case "mayor":
      return { age_min: 60, age_max: 130 };
    default:
      return { age_min: 0, age_max: 130 };
  }
}

// ── Qualitative adaptation/degradation note (pure, deterministic). ─────────────
function qualitativeNote(
  profile: AdversarialProfile,
  c: UnifiedCase,
  metrics: CaseMetrics[],
  detectorCorrect: boolean,
): string {
  const ltr = metrics.find((m) => m.ranker === "assembled-ltr-f4")!;
  const pc = metrics.find((m) => m.ranker === "popular-cohort")!;
  const bits: string[] = [];

  switch (profile.kind) {
    case "pure-gift": {
      if (c.giftSignal.isGift) {
        bits.push(
          `Detector FIRED and routed to recipient (${c.recipientGender ?? "?"}/${c.recipientAgeBand ?? "?"}); ` +
            `recipient-fit@10 ${fmt(ltr.recipientFit10)} vs popular-cohort ${fmt(pc.recipientFit10)} — ` +
            `${ltr.recipientFit10 >= pc.recipientFit10 ? "pipeline targets the recipient at least as well" : "popular-cohort targets the recipient better (degradation)"}.`,
        );
      } else {
        bits.push(
          `Detector MISSED a pure gift (FN) → pipeline degrades to SELF mode. recipient-fit@10 ${fmt(ltr.recipientFit10)}; ` +
            `graceful only if the self-mode feed still partially overlaps the recipient cohort.`,
        );
      }
      break;
    }
    case "multi-modal": {
      bits.push(
        `PinnerSage kept ${c.modes.length} interest modes over ${profile.trainIds.length} orthogonal items — ` +
          `${c.modes.length >= 5 ? "preserves multi-modality (no collapse to one taste)" : "collapsed below 5 modes (some cohorts merged)"}. ` +
          `diversity@10 ${fmt(ltr.diversity10)} vs popular-cohort ${fmt(pc.diversity10)}.`,
      );
      break;
    }
    case "price-extreme": {
      bits.push(
        `Single-band budget (mean band ${c.budgetBandMean}); revenue@10 ${fmt0(ltr.revenue10)} vs popular-cohort ${fmt0(pc.revenue10)} — ` +
          `${ltr.revenue10 >= pc.revenue10 ? "scorer extracts more revenue at the degenerate band" : "scorer under-monetizes the degenerate band"}. ` +
          `set-change@10 vs PC ${fmt(ltr.setChangeVsPc10)} (how far the slate moves from the popularity prior).`,
      );
      break;
    }
    case "ambiguous": {
      bits.push(
        `Detector ${c.giftSignal.isGift ? "FIRED" : "did NOT fire"} on an ambiguous session ` +
          `(intent=${profile.intentGT}); ${detectorCorrect ? "CORRECT" : "WRONG"} ` +
          `(score ${fmt(c.giftSignal.score)}, reasons: ${c.giftSignal.reasons.join("|") || "none"}). ` +
          `${detectorCorrect ? "Pipeline routes to the right mode." : "Pipeline routes to the WRONG mode — degradation test: does the pool still cover the true intent?"}`,
      );
      break;
    }
  }
  return bits.join(" ");
}

const fmt = (x: number): string => (Number.isNaN(x) ? "n/a" : x.toFixed(3));
const fmt0 = (x: number): string => (Number.isNaN(x) ? "n/a" : x.toFixed(0));

// ── Markdown renderer (pure). ──────────────────────────────────────────────────
function renderMarkdown(
  cli: Cli,
  productCount: number,
  e1Universe: number,
  holdoutCases: number,
  results: ProfileResult[],
): string {
  const rows: string[] = [];
  rows.push(`# Thesis F6 W7 — Adversarial profiles`, "");
  rows.push(
    `Item space: e1_prod2vec (canonical 64d). n=${cli.n}, seed=${cli.seed}. ` +
      `E1 universe: ${e1Universe}. Products: ${productCount}. ` +
      `Profiles: ${results.length}. LTR trained train-split-only on ${holdoutCases} REAL holdout cases.`,
    "",
  );
  rows.push(
    "**No held-out purchase exists for a synthetic profile**, so per spec §5 W7 this report does " +
      "**NOT** show nDCG/recall/MRR. It measures graceful adaptation/degradation: gift-detector firing + " +
      "predicted recipient, mode count, recipient-fit@10, set-change@10 vs popular-cohort, revenue@10, " +
      "diversity@10. Gift signal is the F2 detector on the synthetic session (no GT); `intentGT` is the " +
      "profile's INTENDED label (segments the report + sets the recipient-fit target), never a feature.",
    "",
  );

  // ── Detector summary table. ────────────────────────────────────────────────
  rows.push("## Gift detector behavior (per profile)", "");
  rows.push(
    "| Profile | kind | intent | gift fired | predicted recipient | detector correct | modes | pool |",
    "|---|---|---|---|---|---|---|---|",
  );
  for (const r of results) {
    const pr = `${r.predictedRecipientGender ?? "—"}/${r.predictedRecipientAgeBand ?? "—"}`;
    rows.push(
      `| ${r.profile.id} | ${r.profile.kind} | ${r.profile.intentGT} | ${r.giftFired ? "YES" : "no"} | ` +
        `${r.giftFired ? pr : "—"} | ${r.detectorCorrect ? "✓" : "✗"} | ${r.modeCount} | ${r.poolSize} |`,
    );
  }
  rows.push("");

  // ── Adaptation metrics table (per profile × ranker). ───────────────────────
  rows.push("## Adaptation metrics @10 (per profile × ranker)", "");
  rows.push(
    "| Profile | ranker | recipient-fit@10 | set-change@10 (vs PC) | revenue@10 | diversity@10 | seller-gini@10 |",
    "|---|---|---|---|---|---|---|",
  );
  for (const r of results) {
    for (const m of r.metrics) {
      rows.push(
        `| ${r.profile.id} | ${m.ranker} | ${fmt(m.recipientFit10)} | ${fmt(m.setChangeVsPc10)} | ` +
          `${fmt0(m.revenue10)} | ${fmt(m.diversity10)} | ${fmt(m.sellerGini10)} |`,
      );
    }
  }
  rows.push("");

  // ── Per-profile qualitative read. ──────────────────────────────────────────
  rows.push("## Qualitative read (graceful adaptation / degradation)", "");
  for (const r of results) {
    rows.push(`### ${r.profile.id} (${r.profile.kind}, intent=${r.profile.intentGT})`, "");
    rows.push(r.profile.description, "");
    rows.push(`- Session (${r.profile.trainIds.length} real items): ${r.profile.trainIds.join(", ")}`);
    rows.push(
      `- Gift detector: ${r.giftFired ? "FIRED" : "did not fire"} ` +
        `(score ${fmt(r.giftScore)}, reasons: ${r.giftReasons.join(" | ") || "none"})`,
    );
    if (r.giftFired) {
      rows.push(
        `- Predicted recipient: ${r.predictedRecipientGender ?? "?"} / ${r.predictedRecipientAgeBand ?? "?"}`,
      );
    }
    rows.push(`- Interest modes: ${r.modeCount} (weights ${JSON.stringify(r.modeWeights)})`);
    rows.push(`- **Note:** ${r.qualitativeNote}`, "");
  }

  // ── Aggregate verdict (honest). ────────────────────────────────────────────
  const giftProfiles = results.filter((r) => r.profile.intentGT === "gift");
  const giftHits = giftProfiles.filter((r) => r.giftFired).length;
  const ambiguous = results.filter((r) => r.profile.kind === "ambiguous");
  const ambiguousCorrect = ambiguous.filter((r) => r.detectorCorrect).length;
  const multiModal = results.filter((r) => r.profile.kind === "multi-modal");
  const multiKept5 = multiModal.filter((r) => r.modeCount >= 5).length;

  rows.push("## Verdict (honest)", "");
  rows.push(
    `- **Pure-gift / gift-intent detection:** detector fired on ${giftHits}/${giftProfiles.length} ` +
      `gift-intent profiles. Where it fires, the pipeline routes to the recipient (recipient-fit@10 in the table); ` +
      `where it misses, it degrades to self-mode — graceful iff the self feed still overlaps the recipient cohort.`,
  );
  rows.push(
    `- **Multi-modal robustness:** ${multiKept5}/${multiModal.length} multi-modal profiles kept >=5 interest ` +
      `modes, i.e. the feed did not collapse to a single taste under orthogonal interests.`,
  );
  rows.push(
    `- **Ambiguous sessions:** the detector was correct on ${ambiguousCorrect}/${ambiguous.length} ` +
      `knife-edge profiles — consistent with its ~0.43-precision operating point. The degradation question ` +
      `(does the multi-source POOL still cover the true intent when the detector is wrong?) is answered ` +
      `per-profile above via set-change@10 and the pool size.`,
  );
  rows.push(
    `- **Price-extreme:** at a degenerate single budget band the multi-objective scorer's revenue tilt is ` +
      `visible in revenue@10 vs popular-cohort — reported as-is so over/under-monetization is not hidden.`,
    "",
  );

  return rows.join("\n") + "\n";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
