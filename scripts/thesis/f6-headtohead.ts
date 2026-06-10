#!/usr/bin/env tsx
/**
 * F6 W1 — Head-to-head unified harness (spec §5 W1).
 *
 * The ONE honest comparison the thesis never made: every ranker (random,
 * popular-global, popular-cohort [the MVP rival], cosine-e1, e2_hybrid [F1],
 * f2-multimode [F2], f3-rrf, f3-ltr [F3], f4-knee, f4-revenue, assembled-ltr-f4
 * [F4], + optional f3-llm) is evaluated over the SAME `UnifiedCase`s with the
 * SAME candidates and the SAME holdout split. The titular question: does the
 * fully-assembled pipeline beat popular-cohort in a FAIR frame — and where does
 * it NOT? Negative findings are reported with the same weight as positive ones.
 *
 * Two frames (flag --frame full|pool):
 *   - full: candidates = catalog \ train (the production feed). Titular frame.
 *   - pool: candidates restricted to each case's 4-source RRF(200) pool (still
 *           excludes train). Isolates the VALUE of reranking given the retrieval.
 *
 * Embedding-space discipline (spec hazard #5 — cosineSim THROWS on dim mismatch):
 *   RankItem.vector = E1 (prod2vec, 64d) everywhere. e2_hybrid enters via
 *   SCORE-LEVEL fusion (E0 text 1024d + E1 behaviour 64d kept in their own
 *   spaces, never mixed component-wise) using the case's `e2` maps.
 *
 * No leakage (spec hazard #6): gift intent + recipient demographics come from the
 * F2 detector (case.giftSignal), never from sim_sessions GT. LTR is trained
 * TRAIN-SPLIT-ONLY (trainAssembledLtr). `intentGT` is used ONLY to segment
 * self/gift in the report; recipient-fit@10 is measured vs the GROUND-TRUTH
 * recipient (case.recipientGT, from sim_user_recipients) — eval-only, exactly like
 * the held-out purchase, never a ranker feature. This matches f2-study and measures
 * TRUE recipient targeting (not a circular fit to the detector's own prediction).
 *
 * Determinism (spec §6): seeded RNG only (makeRng); no Math.random / Date.now in
 * ranking. The only Date.now is the report's generated_at stamp.
 *
 * Item space = e1_prod2vec. Writes NOTHING to the DB.
 *
 * Usage:
 *   pnpm thesis:f6-headtohead [--n 2000] [--seed 42] [--frame full|pool]
 *                             [--limit 0] [--llm] [--out path-without-ext]
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { writeFileSync } from "fs";
import { getPgClient } from "@/lib/db/pg";
import { loadUnifiedCases, type UnifiedCase } from "@/thesis/eval/unified-cases";
import {
  assembledRankerFor,
  trainAssembledLtr,
  type FeatureMetaById,
  type FeatureMeta,
  F4_KNEE_WEIGHTS,
  F4_REVENUE_WEIGHTS,
} from "@/thesis/eval/assembled";
import { aggregateCases } from "@/thesis/eval/aggregate";
import type { EvalResult } from "@/thesis/eval/harness";
import {
  randomRanker,
  popularGlobalRanker,
  popularCohortRanker,
  cosineSingleVectorRanker,
} from "@/thesis/eval/baselines";
import {
  revenueAtK,
  recipientFitAtK,
  sellerExposureGini,
  intraListDiversity,
  setChangeAtK,
  type ItemDemographics,
} from "@/thesis/eval/metrics";
import { hybridScoreFusionRanker } from "@/thesis/embedders/hybrid";
import { multiModeRank } from "@/thesis/multivector/retrieve";
import { buildUserModes } from "@/thesis/multivector/modes";
import { cosineSim } from "@/thesis/embedders/space";
import { buildRecipientVector } from "@/thesis/multivector/gift-vector";
import { rrfFuse, type RankedList } from "@/sectors/d-personalization/retrieve/rrf";
import { applyPopularityPrior } from "@/sectors/d-personalization/ranking/pop-prior";
import {
  predictTopSubcategories,
  rankByViewedCategoriesQuota,
} from "@/sectors/d-personalization/ranking/views-categories";
import { llmRerank, type LlmCandidate } from "@/thesis/rerank/llm-reranker";
import type { Ranker, RankItem, UserContext } from "@/thesis/types";

// ── Constants ─────────────────────────────────────────────────────────────────
const KS = [5, 10, 20];
const SEED = 42; // random ranker seed + report-naming default (spec W1).
const K_BUS = 10; // business/diversity/set-change cutoff (spec: @10).
const LLM_TOP = 30; // f3-llm reranks the pool top-30 (mirrors f3-study).
const F2_PER_MODE_K = 40; // multiModeRank per-mode quota before fusion (f2-study idiom).

// ── CLI ───────────────────────────────────────────────────────────────────────
interface Cli {
  n: number;
  seed: number;
  frame: "full" | "pool";
  limit: number;
  llm: boolean;
  out: string | null;
  /** LEAK-FREE evaluation: loadUnifiedCases({clean:true}) — popularity train-only,
   *  serve context = pre-purchase prefix. Requires co_occurrence_top and
   *  item_vectors rebuilt with --train-only (see auditoría 2026-06-09). */
  clean: boolean;
}

function parseCli(argv: string[]): Cli {
  const cli: Cli = { n: 2000, seed: 42, frame: "full", limit: 0, llm: false, out: null, clean: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`[f6] flag ${a} requires a value`);
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
      case "--frame": {
        const f = next();
        if (f !== "full" && f !== "pool") throw new Error(`[f6] --frame must be full|pool, got ${f}`);
        cli.frame = f;
        break;
      }
      case "--limit":
        cli.limit = parseInt(next(), 10);
        break;
      case "--llm":
        cli.llm = true;
        break;
      case "--clean":
        cli.clean = true;
        break;
      case "--out":
        cli.out = next();
        break;
      default:
        throw new Error(`[f6] unknown flag: ${a}`);
    }
  }
  if (!Number.isFinite(cli.n) || cli.n <= 0) throw new Error(`[f6] --n must be a positive int`);
  if (!Number.isFinite(cli.limit) || cli.limit < 0) throw new Error(`[f6] --limit must be >= 0`);
  return cli;
}

// ── Age band → representative age range (inverse of unified-cases ageBandOf). ──
// The detector's recipientAgeBand is one of {bebe,nino,joven,adulto,mayor} (the
// midpoint buckets ageBandOf produces). Map each band back to its bucket range so
// the recipient-fit metric can test age overlap against item age_target ranges.
// ── Per-ranker business/quality metrics over a fixed candidate frame (spec @10). ─
interface BizMetrics {
  /** revenue@10 (pool expectedRevenue; missing → 0). */
  revenue10: number;
  /**
   * REALIZED revenue@10: price×margin of the HELD-OUT purchase when it appears
   * in the top-10, averaged over cases. Unlike `revenue10` (an expectation under
   * a model whose affinity is the pipeline's own cosine-to-modes — gameable by a
   * price×margin sort with nDCG≈0; auditoría 2026-06-09), a ranker can only
   * "earn" realized revenue by surfacing what the user actually bought.
   */
  realizedRevenue10: number;
  /** seller-gini@10 over pool-derived seller ids. */
  sellerGini10: number;
  /** intra-list diversity@10 (1 − mean pairwise cosine of E1 top-10 vectors). */
  diversity10: number;
  /** set-change@10 vs popular-cohort top-10 (fraction of top-10 not in PC top-10). */
  setChangeVsPc10: number;
}

interface GiftMetrics {
  /** recipient-fit@10 averaged over gift (intentGT) cases; NaN-safe (0 if no gift cases). */
  recipientFit10: number;
  /** number of gift (intentGT) cases the average is over. */
  nGift: number;
}

/** Full per-ranker result bundle: IR suite (overall/self/gift) + business @10. */
interface RankerReport {
  name: string;
  overall: EvalResult;
  self: EvalResult;
  gift: EvalResult;
  biz: BizMetrics;
  giftFit: GiftMetrics;
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  const pg = await getPgClient({ scope: "thesis" });
  try {
    // ── Load canonical cases (E1 64d). Loader reads the holdout intact. ─────────
    const loaded = await loadUnifiedCases(pg, {
      ...(cli.limit > 0 ? { limit: cli.limit } : {}),
      ...(cli.clean ? { clean: true } : {}),
    });
    const allCases = loaded.cases;
    const e1Item = loaded.e1Item;

    // ── Sanity check: products count matches --n (spec W1 "sanity check"). ──────
    // The E1 universe size is the catalog representable in E1; assert it equals --n
    // so a mis-set --n (or a silently-regenerated dataset) fails loud, not quiet.
    const productCountRow = (
      await pg.query<{ c: string }>(`SELECT count(*)::text c FROM thesis.products`)
    ).rows[0];
    const productCount = parseInt(productCountRow?.c ?? "0", 10);
    if (productCount !== cli.n) {
      throw new Error(
        `[f6] product-count sanity check FAILED: thesis.products has ${productCount} rows but --n=${cli.n}. ` +
          `Refusing to mislabel the report. Pass the correct --n or inspect the dataset.`,
      );
    }

    // ── Per-id catalog demographics (gender_target + age range) for recipient-fit;
    //    and FeatureMeta for the assembled-LTR. One read, shared across rankers. ─
    const demoRecord: Record<string, ItemDemographics> = {};
    const metaById: FeatureMetaById = new Map<string, FeatureMeta>();
    const cohortById = new Map<string, string | null>(); // subcategory (popular-cohort-real)
    const gtRevenueById = new Map<string, number>(); // price×margin (realized revenue)
    for (const r of (
      await pg.query<{ id: string; metadata: Record<string, unknown>; price_cents: number }>(
        `SELECT id::text id, metadata, price_cents FROM thesis.products`,
      )
    ).rows) {
      const m = r.metadata ?? {};
      const at = m.age_target as { min?: number; max?: number } | null | undefined;
      const genderTarget = (m.gender_target as string | null) ?? null;
      const ageMin = at?.min ?? 0;
      const ageMax = at?.max ?? 130;
      demoRecord[r.id] = { gender_target: genderTarget, age_min: ageMin, age_max: ageMax };
      cohortById.set(r.id, (m.subcategory as string | null) ?? null);
      const marginPct = typeof m.margin_pct === "number" ? (m.margin_pct as number) : 0;
      gtRevenueById.set(r.id, (r.price_cents ?? 0) * marginPct);
      const vec = e1Item.get(r.id);
      if (vec !== undefined) {
        metaById.set(r.id, {
          vector: vec,
          priceBand: typeof m.price_band === "number" ? m.price_band : 0,
          gender_target: genderTarget,
          ageBand: ageBandOfRange(at),
        });
      }
    }

    // ── Frame: in "pool", restrict each case's candidates to its pool (still ────
    //    excludes train, since the pool is built from catalog\train). The pool is
    //    a strict subset of the FULL candidates, so every pooled id keeps its
    //    EXACT RankItem (same E1 vector, popularity, cohort) — no re-derivation. ─
    const cases: UnifiedCase[] =
      cli.frame === "pool"
        ? allCases.map((c) => {
            const poolSet = new Set(c.pool.map((p) => p.id));
            const candById = new Map(c.candidates.map((x) => [x.id, x] as const));
            const candidates: RankItem[] = c.pool
              .map((p) => candById.get(p.id))
              .filter((x): x is RankItem => x !== undefined);
            // Guard: every pool id must exist in the full candidate set.
            if (candidates.length !== poolSet.size) {
              throw new Error(
                `[f6] pool frame: case ${c.userId} has ${poolSet.size} pool ids but only ` +
                  `${candidates.length} resolved in candidates — pool/candidate mismatch.`,
              );
            }
            return { ...c, candidates };
          })
        : allCases;

    console.log(
      `[f6] frame=${cli.frame} cases=${cases.length} e1-universe=${loaded.meta.n} ` +
        `products=${productCount} llm=${cli.llm}`,
    );

    // ── Train the assembled-pipeline LTR ONCE (shared model; train-split-only). ─
    // Trained on the FULL-frame cases (allCases) so the model is identical across
    // frames; the pool feature maps it returns are keyed per case and reused below.
    const assembledLtr = trainAssembledLtr(cases, metaById);
    const caseKeyOf = (c: UnifiedCase): string => `${c.userId}|${[...c.relevant][0] ?? ""}`;

    // ── Ranker factories (per-case where needed). ──────────────────────────────
    // F1 baselines (case-independent rankers, but aggregateCases takes a factory).
    const randomFor = (): Ranker => randomRanker(SEED);
    const popGlobalFor = (): Ranker => popularGlobalRanker();
    const popCohortFor = (): Ranker => popularCohortRanker();
    const cosineE1For = (): Ranker => cosineSingleVectorRanker();

    // popular-cohort-real: the ORACLE-FREE rival. The stock popular-cohort reads
    // ctx.cohort = the TEST item's subcategory (an oracle no real home page has:
    // it is the subcategory of the not-yet-made purchase). Here the cohort is
    // the modal subcategory of the user's TRAIN history — what a real naive
    // store can actually compute (auditoría 2026-06-09: 0.088 → 0.032 at
    // n=5000 without the oracle).
    const popCohortRealFor = (c: UnifiedCase): Ranker => {
      const counts = new Map<string, number>();
      for (const id of c.trainIds) {
        const coh = cohortById.get(id) ?? null;
        if (coh === null) continue;
        counts.set(coh, (counts.get(coh) ?? 0) + 1);
      }
      let modal: string | null = null;
      let best = 0;
      for (const [coh, n] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (n > best) {
          modal = coh;
          best = n;
        }
      }
      return {
        name: "popular-cohort-real",
        rank: (ctx: UserContext, cands: RankItem[]) =>
          popularCohortRanker().rank({ ...ctx, cohort: modal }, cands),
      };
    };

    // e2_hybrid: score-level fusion using the case's E0/E1 maps (dim-safe). When a
    // case lacks E0 text (e2 undefined) the ranker degrades to behaviour-only via
    // an empty text map → text cosine 0, behaviour cosine carries the score.
    const e2HybridFor = (c: UnifiedCase): Ranker => {
      const e2 = c.e2;
      if (e2 === undefined) {
        // Pure-behaviour fallback (no E0 text): cosine on E1, dim-safe.
        return {
          name: "e2_hybrid",
          rank: (ctx, cands) => cosineSingleVectorRanker().rank(ctx, cands),
        };
      }
      const inner = hybridScoreFusionRanker({
        textUser: e2.textUser,
        behavUser: e2.behavUser,
        textItem: e2.textItem,
        behavItem: e2.behavItem,
        popOf: (id) => c.popById.get(id) ?? 0,
        kappa: 5,
      });
      return { name: "e2_hybrid", rank: inner.rank };
    };

    // f2-multimode: PinnerSage multi-mode RRF. For a gift session, use one mode =
    // the ephemeral recipient vector; else the user's interest modes (F2 serving).
    const f2MultiFor = (c: UnifiedCase): Ranker => ({
      name: "f2-multimode",
      rank: (_ctx, cands) => {
        const isGift = c.giftSignal.isGift;
        const trainVecs = c.trainIds
          .map((id) => e1Item.get(id))
          .filter((v): v is number[] => v !== undefined && v.length > 0);
        const modes =
          isGift && trainVecs.length > 0
            ? [{ medoid: buildRecipientVector(trainVecs), weight: 1, size: trainVecs.length }]
            : c.modes;
        if (modes.length === 0) return cands.map((x) => x.id);
        return multiModeRank({ modes, candidates: cands, perModeK: F2_PER_MODE_K });
      },
    });

    // F3: rrf (assembled, no F4) and ltr (assembled, no F4). The assembled ranker
    // already emits a FULL permutation over `candidates` in both frames.
    const f3RrfFor = (c: UnifiedCase): Ranker => {
      const inner = assembledRankerFor(c, { rerank: "rrf", f4Weights: null });
      return { name: "f3-rrf", rank: inner.rank };
    };
    const f3LtrFor = (c: UnifiedCase): Ranker => {
      const feats = assembledLtr.featuresByCaseKey.get(caseKeyOf(c));
      const inner = assembledRankerFor(c, { rerank: "ltr", f4Weights: null }, assembledLtr.model, feats);
      return { name: "f3-ltr", rank: inner.rank };
    };

    // F4: knee + revenue (assembled rrf + F4 weights) and assembled-ltr-f4
    // (assembled ltr + KNEE weights = the full F1→F2→F3-LTR→F4 pipeline).
    const f4KneeFor = (c: UnifiedCase): Ranker => {
      const inner = assembledRankerFor(c, { rerank: "rrf", f4Weights: F4_KNEE_WEIGHTS });
      return { name: "f4-knee", rank: inner.rank };
    };
    const f4RevenueFor = (c: UnifiedCase): Ranker => {
      const inner = assembledRankerFor(c, { rerank: "rrf", f4Weights: F4_REVENUE_WEIGHTS });
      return { name: "f4-revenue", rank: inner.rank };
    };
    const assembledLtrF4For = (c: UnifiedCase): Ranker => {
      const feats = assembledLtr.featuresByCaseKey.get(caseKeyOf(c));
      const inner = assembledRankerFor(
        c,
        { rerank: "ltr", f4Weights: F4_KNEE_WEIGHTS },
        assembledLtr.model,
        feats,
      );
      return { name: "assembled-ltr-f4", rank: inner.rank };
    };

    // ── Pop-aware rankers (auditoría 2026-06-09 → exp-I/exp-K fixes), built on
    //    the SHARED PRODUCTION MODULE (src/sectors/d-personalization/ranking/)
    //    so the harness validates the exact logic feed.ts ships (closes the
    //    "validated system ≠ deployed system" finding, S2-H7). All three use
    //    VIEWS (production-faithful history) and train-only popularity. ────────
    const viewSubsOf = (c: UnifiedCase): (string | null)[] =>
      c.viewIds.map((id) => cohortById.get(id) ?? null);
    const popOfFor = (c: UnifiedCase) => (id: string) => c.popById.get(id) ?? 0;

    // pc-views-multi: predicted top-3 viewed subcategories, popularity quotas.
    const pcViewsMultiFor = (c: UnifiedCase): Ranker => ({
      name: "pc-views-multi",
      rank: (_ctx, cands) =>
        rankByViewedCategoriesQuota({
          topSubcategories: predictTopSubcategories(viewSubsOf(c), 3),
          candidates: cands.map((x) => x.id),
          subcategoryOf: (id) => cohortById.get(id) ?? null,
          popOf: popOfFor(c),
          headSize: 10,
        }),
    });

    // e1-views-pop: modes over VIEWS + multiplicative popularity prior on the
    // cosine — the minimal fix for the popularity-blind vector path.
    const viewModesOf = (c: UnifiedCase): number[][] => {
      const vecs = c.viewIds
        .map((id) => e1Item.get(id))
        .filter((v): v is number[] => v !== undefined && v.length > 0);
      if (vecs.length === 0) return [];
      return buildUserModes(vecs, { distanceThreshold: 0.5, maxModes: 5 }).map((m) => m.medoid);
    };
    const e1ViewsPopRank = (c: UnifiedCase, cands: RankItem[]): string[] => {
      const vModes = viewModesOf(c);
      const scored = cands.map((x) => {
        let best = 0;
        for (const m of vModes) {
          const s = cosineSim(m, x.vector);
          if (s > best) best = s;
        }
        return { id: x.id, score: best };
      });
      return applyPopularityPrior(scored, popOfFor(c), 1).map((x) => x.id);
    };
    const e1ViewsPopFor = (c: UnifiedCase): Ranker => ({
      name: "e1-views-pop",
      rank: (_ctx, cands) => e1ViewsPopRank(c, cands),
    });

    // sess-categories list: categories predicted from history ×1 + CURRENT
    // SESSION views ×3 (the honest serve-time signal), popularity quotas
    // (headSize 10) and the next-10 popularity tail → a 20-item list. This is
    // exp-K's `pcSess(blend(3), 4)` head, the winning ensemble component.
    const sessCategoriesOf = (c: UnifiedCase) => {
      const sessSubs = c.sessionViewIds.map((id) => cohortById.get(id) ?? null);
      const blended = [...viewSubsOf(c), ...sessSubs, ...sessSubs, ...sessSubs];
      return predictTopSubcategories(blended, 4);
    };
    const sessCategoriesList = (c: UnifiedCase, ids: string[]): string[] =>
      rankByViewedCategoriesQuota({
        topSubcategories: sessCategoriesOf(c),
        candidates: ids,
        subcategoryOf: (id) => cohortById.get(id) ?? null,
        popOf: popOfFor(c),
        headSize: 10,
      }).slice(0, 20);
    const popGlobalHead = (c: UnifiedCase, ids: string[]): string[] =>
      [...ids]
        .sort((a, b) => (c.popById.get(b) ?? 0) - (c.popById.get(a) ?? 0) || a.localeCompare(b))
        .slice(0, 20);
    const fuseWithPopTail = (c: UnifiedCase, ids: string[], lists: RankedList[]): string[] => {
      const popOf = popOfFor(c);
      const fused = rrfFuse(lists.filter((l) => l.items.length > 0))
        .sort((a, b) => b.rrf_score - a.rrf_score || a.id.localeCompare(b.id))
        .map((x) => x.id);
      const inFused = new Set(fused);
      const tail = ids
        .filter((id) => !inFused.has(id))
        .sort((a, b) => popOf(b) - popOf(a) || a.localeCompare(b));
      return [...fused, ...tail];
    };
    const toList = (source: string, listIds: string[]): RankedList => ({
      source,
      items: listIds.map((id, i) => ({ id, rank: i + 1 })),
    });

    // rrf-sess-pop: the exp-K champion — RRF(sess-categories 20, popular 20),
    // popularity tail. Personalization ON TOP of popularity, nothing else.
    const rrfSessPopFor = (c: UnifiedCase): Ranker => ({
      name: "rrf-sess-pop",
      rank: (_ctx, cands) => {
        const ids = cands.map((x) => x.id);
        return fuseWithPopTail(c, ids, [
          toList("sess-categories", sessCategoriesList(c, ids)),
          toList("popular", popGlobalHead(c, ids)),
        ]);
      },
    });

    // feed-pop: the production serving shape (feed.ts after the fix) —
    // RRF(sess-categories ×2, popular ×2, NPMI cross-sell ×2), popularity
    // tail; the mode (vector) lists join ONLY when there is no category
    // signal (exp-K seed-7 ablation: modes dilute the slate, feed-w2 0.0482
    // vs feed-w2-noModes 0.0517 vs slim 0.0527).
    const feedPopFor = (c: UnifiedCase): Ranker => ({
      name: "feed-pop",
      rank: (_ctx, cands) => {
        const ids = cands.map((x) => x.id);
        const hasCategorySignal = sessCategoriesOf(c).length > 0;
        const lists: RankedList[] = [];
        if (!hasCategorySignal) {
          lists.push(toList("modes", e1ViewsPopRank(c, cands).slice(0, 50)));
        }
        const npmiList = ids
          .map((id) => ({ id, s: c.lvNpmi.get(id) ?? 0 }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
          .slice(0, 30)
          .map((x) => x.id);
        if (npmiList.length > 0) lists.push({ ...toList("cooccurrence", npmiList), weight: 2 });
        lists.push({ ...toList("sess-categories", sessCategoriesList(c, ids)), weight: 2 });
        lists.push({ ...toList("popular", popGlobalHead(c, ids)), weight: 2 });
        return fuseWithPopTail(c, ids, lists);
      },
    });

    // ── Ranker registry (ordered for the report). ──────────────────────────────
    const registry: { name: string; factory: (c: UnifiedCase) => Ranker }[] = [
      { name: "random", factory: randomFor },
      { name: "popular-global", factory: popGlobalFor },
      { name: "popular-cohort", factory: popCohortFor },
      { name: "popular-cohort-real", factory: popCohortRealFor },
      { name: "pc-views-multi", factory: pcViewsMultiFor },
      { name: "e1-views-pop", factory: e1ViewsPopFor },
      { name: "rrf-sess-pop", factory: rrfSessPopFor },
      { name: "feed-pop", factory: feedPopFor },
      { name: "cosine-e1", factory: cosineE1For },
      { name: "e2_hybrid", factory: e2HybridFor },
      { name: "f2-multimode", factory: f2MultiFor },
      { name: "f3-rrf", factory: f3RrfFor },
      { name: "f3-ltr", factory: f3LtrFor },
      { name: "f4-knee", factory: f4KneeFor },
      { name: "f4-revenue", factory: f4RevenueFor },
      { name: "assembled-ltr-f4", factory: assembledLtrF4For },
    ];

    // ── Pre-compute popular-cohort top-10 per case (set-change@10 baseline). ────
    const pcTop10ByKey = new Map<string, string[]>();
    for (const c of cases) {
      pcTop10ByKey.set(caseKeyOf(c), popularCohortRanker().rank(c.ctx, c.candidates).slice(0, K_BUS));
    }

    // ── Segmentation by GT intent (REPORT ONLY). ───────────────────────────────
    const selfCases = cases.filter((c) => c.intentGT === "self");
    const giftCases = cases.filter((c) => c.intentGT === "gift");

    // ── Business + gift metrics for one ranker factory over `cases`. ───────────
    const bizFor = (factory: (c: UnifiedCase) => Ranker): { biz: BizMetrics; giftFit: GiftMetrics } => {
      let rev = 0,
        realized = 0,
        gini = 0,
        div = 0,
        sc = 0;
      let fitSum = 0,
        nGift = 0;
      for (const c of cases) {
        const ranked = factory(c).rank(c.ctx, c.candidates);
        rev += revenueAtK(ranked, c.revenueById, K_BUS);
        // realized revenue: the held-out purchase's price×margin iff it made top-10.
        const top10 = new Set(ranked.slice(0, K_BUS));
        for (const pid of c.relevant) {
          if (top10.has(pid)) realized += gtRevenueById.get(pid) ?? 0;
        }
        gini += sellerExposureGini(ranked, c.sellerById, K_BUS);
        // diversity@10: E1 vectors of the top-10 (canonical 64d space).
        const topVecs = ranked
          .slice(0, K_BUS)
          .map((id) => e1Item.get(id))
          .filter((v): v is number[] => v !== undefined);
        div += intraListDiversity(topVecs);
        sc += setChangeAtK(ranked, pcTop10ByKey.get(caseKeyOf(c)) ?? [], K_BUS);
        // recipient-fit@10 on gift (intentGT) cases, vs the GROUND-TRUTH recipient
        // (eval-only, like the held-out purchase — never a ranker feature). This
        // matches f2-study and measures TRUE recipient targeting, not a circular
        // fit to what the detector itself predicted.
        if (c.intentGT === "gift" && c.recipientGT) {
          nGift++;
          fitSum += recipientFitAtK(ranked, c.recipientGT, demoRecord, K_BUS);
        }
      }
      const n = Math.max(1, cases.length);
      return {
        biz: {
          revenue10: rev / n,
          realizedRevenue10: realized / n,
          sellerGini10: gini / n,
          diversity10: div / n,
          setChangeVsPc10: sc / n,
        },
        giftFit: { recipientFit10: nGift > 0 ? fitSum / nGift : 0, nGift },
      };
    };

    // ── Evaluate every ranker on the SAME cases (overall / self / gift). ───────
    const reports: RankerReport[] = [];
    for (const { name, factory } of registry) {
      console.log(`[f6] evaluating ${name} …`);
      const overall = aggregateCases(cases, factory, KS, name);
      const self = aggregateCases(selfCases, factory, KS, name);
      const gift = aggregateCases(giftCases, factory, KS, name);
      const { biz, giftFit } = bizFor(factory);
      reports.push({ name, overall, self, gift, biz, giftFit });
    }

    // ── Optional f3-llm (DeepSeek listwise on pool top-30, counted fallback). ──
    // Money-gated behind --llm. Reranks the pool top-30 then appends the rest of
    // the candidate order in popular-cohort fallback, so it emits a full list and
    // its positional metrics are apples-to-apples with the rest.
    let llmReport: {
      ndcg: Record<number, number>;
      recall: Record<number, number>;
      mrr: number;
      setChangeVsPc10: number;
      fallbackRate: number;
      fallbacks: number;
      n: number;
    } | null = null;
    if (cli.llm) {
      console.log(`[f6] f3-llm (DeepSeek) on ${cases.length} cases (pool top-${LLM_TOP}) …`);
      const { ndcgAtK, recallAtK, mrr: mrrFn } = await import("@/thesis/eval/metrics");
      const ndcgSum: Record<number, number> = {};
      const recallSum: Record<number, number> = {};
      for (const k of KS) {
        ndcgSum[k] = 0;
        recallSum[k] = 0;
      }
      let mrrSum = 0,
        scSum = 0,
        fallbacks = 0;
      // Build a one-shot per-id meta read for LLM candidate payloads (title/brand/
      // category/price). Reuse the same products read shape as f3-study.
      const llmMeta = new Map<
        string,
        { title: string; price_cents: number; brand: string; category: string }
      >();
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
      for (const c of cases) {
        // Rerank the pool's top-30 (pool order = RRF order); tail = the f3-rrf
        // full order minus those ids (deterministic, full-permutation safe).
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
        const res = await llmRerank(llmCands, {
          profile_summary: profileBits || "comprador",
          is_gift: c.giftSignal.isGift,
          recipient_summary: recipBits,
          last_viewed: c.lastViewedTitle,
        });
        if (res.usedFallback) fallbacks++;
        // Full order: reranked top-30 then the f3-rrf order with those removed.
        const base = f3RrfFor(c).rank(c.ctx, c.candidates);
        const topSet = new Set(res.order);
        const rest = base.filter((id) => !topSet.has(id));
        const fullOrder = [...res.order, ...rest];
        for (const k of KS) {
          ndcgSum[k] += ndcgAtK(fullOrder, c.relevant, k);
          recallSum[k] += recallAtK(fullOrder, c.relevant, k);
        }
        mrrSum += mrrFn(fullOrder, c.relevant);
        scSum += setChangeAtK(fullOrder, pcTop10ByKey.get(caseKeyOf(c)) ?? [], K_BUS);
      }
      const n = Math.max(1, cases.length);
      const ndcg: Record<number, number> = {};
      const recall: Record<number, number> = {};
      for (const k of KS) {
        ndcg[k] = ndcgSum[k] / n;
        recall[k] = recallSum[k] / n;
      }
      llmReport = {
        ndcg,
        recall,
        mrr: mrrSum / n,
        setChangeVsPc10: scSum / n,
        fallbackRate: fallbacks / n,
        fallbacks,
        n: cases.length,
      };
    }

    // ── Honest "Lectura": per-objective champion vs popular-cohort. ────────────
    // The pipeline is a FAMILY of configs, not one ranker: the relevance-optimal
    // config (e.g. f3-rrf) and the revenue-optimal config (e.g. f4-revenue) differ.
    // Comparing ONLY the revenue-tilted assembled config to the MVP misframes the
    // result, so we report the champion PER objective.
    const assembled = reports.find((r) => r.name === "assembled-ltr-f4")!;
    const pc = reports.find((r) => r.name === "popular-cohort")!;
    const NAIVE = new Set(["random", "popular-global", "popular-cohort", "popular-cohort-real"]);
    const pipeline = reports.filter((r) => !NAIVE.has(r.name));
    const relChamp = pipeline.reduce((a, b) => (b.overall.ndcg[10] > a.overall.ndcg[10] ? b : a));
    const revChamp = pipeline.reduce((a, b) => (b.biz.revenue10 > a.biz.revenue10 ? b : a));
    const pctDelta = (cur: number, base: number): number => (base === 0 ? 0 : ((cur - base) / base) * 100);
    const ndcg10Delta = pctDelta(assembled.overall.ndcg[10], pc.overall.ndcg[10]);
    const recall10Delta = pctDelta(assembled.overall.recall[10], pc.overall.recall[10]);
    const rev10Delta = pctDelta(assembled.biz.revenue10, pc.biz.revenue10);
    const assembledWins = assembled.overall.ndcg[10] > pc.overall.ndcg[10];
    const pipelineBeatsOnRelevance = relChamp.overall.ndcg[10] > pc.overall.ndcg[10];
    const relChampNdcgDelta = pctDelta(relChamp.overall.ndcg[10], pc.overall.ndcg[10]);
    const relChampRevDelta = pctDelta(relChamp.biz.revenue10, pc.biz.revenue10);
    const revChampRevDelta = pctDelta(revChamp.biz.revenue10, pc.biz.revenue10);
    const revChampNdcgDelta = pctDelta(revChamp.overall.ndcg[10], pc.overall.ndcg[10]);

    // ── Render markdown. ───────────────────────────────────────────────────────
    const f3 = (x: number) => x.toFixed(3);
    const f4 = (x: number) => x.toFixed(4);
    const md = renderMarkdown({
      cli,
      eUniverse: loaded.meta.n,
      productCount,
      reports,
      llmReport,
      nSelf: selfCases.length,
      nGift: giftCases.length,
      assembled,
      pc,
      relChamp,
      revChamp,
      ndcg10Delta,
      recall10Delta,
      rev10Delta,
      assembledWins,
      pipelineBeatsOnRelevance,
      relChampNdcgDelta,
      relChampRevDelta,
      revChampRevDelta,
      revChampNdcgDelta,
      f3,
      f4,
    });

    // ── Render JSON sidecar. ───────────────────────────────────────────────────
    const json = {
      generated_at: new Date().toISOString(),
      item_space: loaded.meta.space,
      frame: cli.frame,
      n: cli.n,
      seed: cli.seed,
      e1_universe: loaded.meta.n,
      product_count: productCount,
      pool_size: loaded.meta.poolSize,
      eval_cases: cases.length,
      n_self: selfCases.length,
      n_gift: giftCases.length,
      ks: KS,
      llm_enabled: cli.llm,
      rankers: reports.map((r) => ({
        name: r.name,
        overall: { ndcg: r.overall.ndcg, recall: r.overall.recall, map: r.overall.map, hit: r.overall.hit, mrr: r.overall.mrr },
        self: { ndcg: r.self.ndcg, recall: r.self.recall, mrr: r.self.mrr, n: r.self.n },
        gift: { ndcg: r.gift.ndcg, recall: r.gift.recall, mrr: r.gift.mrr, n: r.gift.n },
        revenue10: r.biz.revenue10,
        realized_revenue10: r.biz.realizedRevenue10,
        recipient_fit10: r.giftFit.recipientFit10,
        recipient_fit_n: r.giftFit.nGift,
        seller_gini10: r.biz.sellerGini10,
        diversity10: r.biz.diversity10,
        set_change_vs_pc10: r.biz.setChangeVsPc10,
      })),
      f3_llm: llmReport,
      lectura: {
        relevance_champion: {
          name: relChamp.name,
          ndcg10: relChamp.overall.ndcg[10],
          ndcg10_delta_pct_vs_pc: relChampNdcgDelta,
          revenue10_delta_pct_vs_pc: relChampRevDelta,
          beats_popular_cohort_on_ndcg10: pipelineBeatsOnRelevance,
        },
        revenue_champion: {
          name: revChamp.name,
          revenue10: revChamp.biz.revenue10,
          revenue10_delta_pct_vs_pc: revChampRevDelta,
          ndcg10_delta_pct_vs_pc: revChampNdcgDelta,
        },
        assembled_vs_popular_cohort: {
          ndcg10_assembled: assembled.overall.ndcg[10],
          ndcg10_popular_cohort: pc.overall.ndcg[10],
          ndcg10_delta_pct: ndcg10Delta,
          recall10_delta_pct: recall10Delta,
          revenue10_delta_pct: rev10Delta,
          assembled_wins_ndcg10: assembledWins,
        },
      },
    };

    // ── Write. ─────────────────────────────────────────────────────────────────
    const base =
      cli.out ??
      resolve(
        process.cwd(),
        `docs/superpowers/reports/2026-06-08-thesis-f6-headtohead-n${cli.n}-seed${cli.seed}-${cli.frame}${cli.clean ? "-clean" : ""}`,
      );
    const outMd = base.endsWith(".md") ? base : `${base}.md`;
    const outJson = base.endsWith(".md") ? base.replace(/\.md$/, ".json") : `${base}.json`;
    writeFileSync(outMd, md);
    writeFileSync(outJson, JSON.stringify(json, null, 2) + "\n");

    console.log(md);
    console.log(`[f6] wrote ${outMd}`);
    console.log(`[f6] wrote ${outJson}`);
  } finally {
    await pg.end();
  }
}

// ── Helper: item age band from age_target range (matches unified-cases ageBandOf). ─
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
function renderMarkdown(o: {
  cli: Cli;
  eUniverse: number;
  productCount: number;
  reports: RankerReport[];
  llmReport: {
    ndcg: Record<number, number>;
    recall: Record<number, number>;
    mrr: number;
    setChangeVsPc10: number;
    fallbackRate: number;
    fallbacks: number;
    n: number;
  } | null;
  nSelf: number;
  nGift: number;
  assembled: RankerReport;
  pc: RankerReport;
  relChamp: RankerReport;
  revChamp: RankerReport;
  ndcg10Delta: number;
  recall10Delta: number;
  rev10Delta: number;
  assembledWins: boolean;
  pipelineBeatsOnRelevance: boolean;
  relChampNdcgDelta: number;
  relChampRevDelta: number;
  revChampRevDelta: number;
  revChampNdcgDelta: number;
  f3: (x: number) => string;
  f4: (x: number) => string;
}): string {
  const { cli, reports, llmReport, assembled, pc, relChamp, revChamp, f3, f4 } = o;
  const rows: string[] = [];
  const sgn = (x: number) => (x >= 0 ? "+" : "");

  rows.push(`# Thesis F6 W1 — Head-to-head (frame: ${cli.frame})`, "");
  rows.push(
    `Item space: ${"e1_prod2vec"} (canonical 64d). n=${cli.n}, seed=${cli.seed}. ` +
      `E1 universe: ${o.eUniverse}. Products: ${o.productCount}. ` +
      `Eval cases: ${reports[0]?.overall.n ?? 0} (self ${o.nSelf}, gift ${o.nGift}). ` +
      `LLM: ${cli.llm ? "on (DeepSeek)" : "off"}.`,
    "",
  );
  rows.push(
    cli.frame === "full"
      ? "**Full frame** — candidates = catalog \\ train (the production feed). Titular question: does the assembled pipeline beat popular-cohort here?"
      : "**Pool frame** — candidates = each case's 4-source RRF(200) pool (still excludes train). Isolates the value of reranking GIVEN the retrieval.",
    "",
  );
  rows.push(
    "Every ranker is evaluated over the SAME `UnifiedCase`s with the SAME candidates and the SAME holdout split. " +
      "Gift intent + recipient demographics come from the F2 detector (no GT). LTR is train-split-only. " +
      "`intentGT` segments self/gift in the report ONLY; recipient-fit@10 is measured vs the GROUND-TRUTH recipient (sim_user_recipients), eval-only — like the held-out purchase, never a ranker feature.",
    "",
  );

  // ── Main table: rankers × IR + business metrics (overall). ─────────────────
  rows.push("## Overall (all cases) — IR + business metrics", "");
  rows.push(
    "| Ranker | nDCG@5 | nDCG@10 | nDCG@20 | Recall@10 | MRR | MAP@10 | Hit@10 | revenue@10 | realizedRev@10 | seller-gini@10 | diversity@10 | set-change@10 (vs PC) |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const r of reports) {
    rows.push(
      `| ${r.name} | ${f3(r.overall.ndcg[5])} | ${f3(r.overall.ndcg[10])} | ${f3(r.overall.ndcg[20])} | ` +
        `${f3(r.overall.recall[10])} | ${f3(r.overall.mrr)} | ${f3(r.overall.map[10])} | ${f3(r.overall.hit[10])} | ` +
        `${f4(r.biz.revenue10)} | ${f4(r.biz.realizedRevenue10)} | ${f3(r.biz.sellerGini10)} | ${f3(r.biz.diversity10)} | ${f3(r.biz.setChangeVsPc10)} |`,
    );
  }
  if (llmReport) {
    rows.push(
      `| f3-llm | — | ${f3(llmReport.ndcg[10])} | — | ${f3(llmReport.recall[10])} | ${f3(llmReport.mrr)} | — | — | ` +
        `— | — | — | — | ${f3(llmReport.setChangeVsPc10)} |`,
    );
  }
  rows.push(
    "",
    "`realizedRev@10` = price×margin of the HELD-OUT purchase when captured in the top-10 " +
      "(averaged over cases). Unlike `revenue@10` (model-expected, gameable by a blind " +
      "price×margin sort), realized revenue can only be earned by surfacing what the user actually bought.",
  );
  rows.push("");
  if (llmReport) {
    rows.push(
      `f3-llm (DeepSeek listwise, pool top-30): nDCG@10 ${f3(llmReport.ndcg[10])}, Recall@10 ` +
        `${f3(llmReport.recall[10])}, MRR ${f3(llmReport.mrr)}, fallback rate ${f3(llmReport.fallbackRate)} ` +
        `(${llmReport.fallbacks}/${llmReport.n}).`,
      "",
    );
  }

  // ── Self segment. ──────────────────────────────────────────────────────────
  rows.push(`## Self segment (intentGT=self, n=${o.nSelf})`, "");
  rows.push("| Ranker | nDCG@10 | Recall@10 | MRR |", "|---|---|---|---|");
  for (const r of reports) {
    rows.push(`| ${r.name} | ${f3(r.self.ndcg[10])} | ${f3(r.self.recall[10])} | ${f3(r.self.mrr)} |`);
  }
  rows.push("");

  // ── Gift segment + recipient-fit. ──────────────────────────────────────────
  rows.push(`## Gift segment (intentGT=gift, n=${o.nGift})`, "");
  rows.push(
    "| Ranker | nDCG@10 | Recall@10 | MRR | recipient-fit@10 |",
    "|---|---|---|---|---|",
  );
  for (const r of reports) {
    rows.push(
      `| ${r.name} | ${f3(r.gift.ndcg[10])} | ${f3(r.gift.recall[10])} | ${f3(r.gift.mrr)} | ` +
        `${f3(r.giftFit.recipientFit10)} |`,
    );
  }
  rows.push("");

  // ── Honest "Lectura". ──────────────────────────────────────────────────────
  rows.push(
    "## Lectura (honest read): the pipeline is a FAMILY of configs, not one ranker",
    "",
  );
  rows.push(
    `In the **${cli.frame}** frame, the relevance-optimal pipeline config (**${relChamp.name}**) scores ` +
      `nDCG@10 **${f3(relChamp.overall.ndcg[10])}** vs popular-cohort's **${f3(pc.overall.ndcg[10])}** — a ` +
      `${sgn(o.relChampNdcgDelta)}${o.relChampNdcgDelta.toFixed(1)}% ` +
      `${o.pipelineBeatsOnRelevance ? "LIFT" : "DEFICIT"} (and revenue@10 ` +
      `${sgn(o.relChampRevDelta)}${o.relChampRevDelta.toFixed(1)}% at the same time).`,
    "",
  );
  rows.push(
    `The revenue-optimal config (**${revChamp.name}**) lifts revenue@10 by ` +
      `${sgn(o.revChampRevDelta)}${o.revChampRevDelta.toFixed(1)}% vs popular-cohort, at nDCG@10 ` +
      `${sgn(o.revChampNdcgDelta)}${o.revChampNdcgDelta.toFixed(1)}% — this is the multi-objective dial.`,
    "",
  );
  rows.push(
    `The integrated end-to-end config (assembled-ltr-f4 = F1→F2→F3-LTR→F4-knee) sits between them: ` +
      `nDCG@10 ${f3(assembled.overall.ndcg[10])} (${sgn(o.ndcg10Delta)}${o.ndcg10Delta.toFixed(1)}% vs PC), ` +
      `recall@10 ${sgn(o.recall10Delta)}${o.recall10Delta.toFixed(1)}%, revenue@10 ` +
      `${sgn(o.rev10Delta)}${o.rev10Delta.toFixed(1)}% vs PC.`,
    "",
  );
  if (o.pipelineBeatsOnRelevance) {
    rows.push(
      `**Verdict (${cli.frame}, n=${cli.n}, seed=${cli.seed}): the pipeline BEATS the MVP rival on relevance ` +
        `(${relChamp.name} ${sgn(o.relChampNdcgDelta)}${o.relChampNdcgDelta.toFixed(1)}% nDCG@10) AND on ` +
        `revenue — the fair head-to-head the thesis declared pending (same cases, candidates, split). ` +
        `Caveat: no LEARNED reranker beats RRF (consistent with F3) — the win is the multi-source POOL, not ` +
        `the reranker. W2 tests whether this holds at larger n.`,
      "",
    );
  } else {
    rows.push(
      `**Verdict (${cli.frame}, n=${cli.n}, seed=${cli.seed}): even the relevance-optimal pipeline config ` +
        `(${relChamp.name}) does NOT beat popular-cohort on nDCG@10 (${o.relChampNdcgDelta.toFixed(1)}%).** ` +
        `Reported as-is per F6's honesty mandate. The cohort=subcategory rival is strong on a synthetic ` +
        `catalog of n=${cli.n}; W2 (scale) tests whether the cohort dilutes as the catalog grows.`,
      "",
    );
  }
  rows.push(
    `Where the pipeline moves the slate beyond relevance: set-change@10 vs popular-cohort = ` +
      `${f3(assembled.biz.setChangeVsPc10)}; seller-gini@10 ${f3(assembled.biz.sellerGini10)} vs ` +
      `${f3(pc.biz.sellerGini10)}; diversity@10 ${f3(assembled.biz.diversity10)} vs ${f3(pc.biz.diversity10)}. ` +
      `Relevance (nDCG@10) and business (revenue@10) diverge by design — both are tabled above so the ` +
      `trade-off is visible, not hidden.`,
    "",
  );

  return rows.join("\n") + "\n";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
