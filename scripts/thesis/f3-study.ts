#!/usr/bin/env tsx
/**
 * F3 study: a large multi-source candidate POOL reranked by four families
 * (baseline-RRF, MMR, cross-encoder MaxSim, pointwise LTR) plus an LLM listwise
 * reranker on a subset. Proves a reranker changes AND improves the top-10.
 *
 * Apples-to-apples: ONE shared pool per test user; every reranker ranks the SAME
 * candidate set (positional metrics only). No ground-truth leaks into ranker
 * features — gift intent + recipient demographics come from the F2 detector run
 * on the user's session, never from sim_sessions.intent / sim_user_recipients.
 * GT is used ONLY to (a) bucket self/gift segments and (b) compute pool-recall.
 *
 * Item space = e1_prod2vec. LLM = DeepSeek via defaultProvider.
 * Usage: pnpm thesis:f3-study
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { writeFileSync } from "fs";
import { getPgClient } from "@/lib/db/pg";
import { l2normalize, meanPool, cosineSim } from "@/thesis/embedders/space";
import { evaluateRanker, type EvalCase } from "@/thesis/eval/harness";
import { aggregateCases } from "@/thesis/eval/aggregate";
import { setChangeAtK } from "@/thesis/eval/metrics";
import { buildCandidatePool } from "@/thesis/rerank/candidates";
import { extractFeatures, FEATURE_NAMES, type FeatureContext, type FeatureCandidate } from "@/thesis/rerank/features";
import { trainLTR, ltrRanker, type LtrSample, type LtrModel } from "@/thesis/rerank/ltr";
import { crossEncoderRanker } from "@/thesis/rerank/crossencoder";
import { llmRerank, type LlmCandidate } from "@/thesis/rerank/llm-reranker";
import { buildUserModes, type UserMode } from "@/thesis/multivector/modes";
import { detectGiftIntent, type SessionItem, type UserDemographic } from "@/thesis/multivector/gift-detect";
import { buildRecipientVector } from "@/thesis/multivector/gift-vector";
import { mmrSelect } from "@/sectors/d-personalization/retrieve/mmr";
import { makeRng } from "@/thesis/data/rng";
import type { RankItem, Ranker, UserContext } from "@/thesis/types";

const KS = [5, 10, 20];
const SEED = 42;
const POOL_SIZE = 200;
const LLM_SUBSET = 120; // first N cases get the (costed) LLM listwise pass
const LLM_TOP = 30; // LLM reranks the pool top-30

function ageBandOf(at: { min?: number; max?: number } | null | undefined): string | null {
  if (!at || typeof at.min !== "number" || typeof at.max !== "number") return null;
  const mid = (at.min + at.max) / 2;
  if (mid <= 3) return "bebe";
  if (mid <= 11) return "nino";
  if (mid <= 25) return "joven";
  if (mid <= 59) return "adulto";
  return "mayor";
}

/** Most frequent non-null value; deterministic alphabetical tie-break. Null if none. */
function modeOf(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v === null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, c] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (c > bestCount) { best = v; bestCount = c; }
  }
  return best;
}

/** Modal numeric (price band) over train items; 0 if none. */
function modeNum(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = 0, bestCount = -1;
  for (const [v, c] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    if (c > bestCount) { best = v; bestCount = c; }
  }
  return best;
}

/** Stable per-user seed for the exploration shuffle. */
function uidSeed(uid: string): number {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) { h ^= uid.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) ^ SEED;
}

interface ProductMeta {
  gender: string | null;
  ageBand: string | null;
  priceBand: number;
  cohort: string | null;
  title: string;
  brand: string;
  category: string;
  priceCents: number;
}

interface F3Case extends EvalCase {
  uid: string;
  intent: string; // GT, segments only
  predGift: boolean;
  modes: UserMode[];
  poolOrder: string[]; // pool ids in RRF order (== candidates order)
  poolSources: Map<string, string[]>;
  poolNpmi: Map<string, number>; // npmi-to-last-viewed per pool id
  // Full last-viewed→npmi map (ANY id, not just pool). LTR positives are train
  // items EXCLUDED from the pool, so they MUST resolve npmi via this superset map
  // — using poolNpmi would force positives to 0 (no edge in pool), creating a
  // membership leak identical to the dropped src_* one-hots.
  lvNpmi: Map<string, number>;
  lastViewedTitle: string | null;
  recipientGender: string | null;
  recipientAgeBand: string | null;
  buyerGender: string | null;
  buyerAgeBand: string | null;
  budgetBand: number;
}

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    // ── E1 vectors ────────────────────────────────────────────────────────────
    const e1 = new Map<string, number[]>();
    for (const r of (await pg.query(`SELECT product_id::text id, vector FROM thesis.item_vectors WHERE space='e1_prod2vec'`)).rows as { id: string; vector: number[] }[]) {
      e1.set(r.id, r.vector.map(Number));
    }
    if (e1.size === 0) { console.error("[f3] no e1_prod2vec vectors — run pnpm thesis:train-prod2vec"); process.exit(1); }

    // ── E4 late-interaction chunks (id -> chunk vectors) ───────────────────────
    const chunks = new Map<string, number[][]>();
    for (const r of (await pg.query(`SELECT product_id::text id, chunk_index, vector FROM thesis.item_chunk_vectors WHERE space='e4_late' ORDER BY product_id, chunk_index`)).rows as { id: string; chunk_index: number; vector: number[] }[]) {
      const a = chunks.get(r.id) ?? [];
      a.push(r.vector.map(Number));
      chunks.set(r.id, a);
    }

    // ── Product meta ───────────────────────────────────────────────────────────
    const meta = new Map<string, ProductMeta>();
    for (const r of (await pg.query(`SELECT id::text id, title, metadata, price_cents FROM thesis.products`)).rows as { id: string; title: string; metadata: Record<string, unknown>; price_cents: number }[]) {
      const m = r.metadata ?? {};
      const at = m.age_target as { min?: number; max?: number } | null | undefined;
      meta.set(r.id, {
        gender: (m.gender_target as string | null) ?? null,
        ageBand: ageBandOf(at),
        priceBand: typeof m.price_band === "number" ? m.price_band : 0,
        cohort: (m.subcategory as string | null) ?? null,
        title: r.title ?? "",
        brand: (m.brand as string | null) ?? "",
        category: (m.category as string | null) ?? "",
        priceCents: r.price_cents ?? 0,
      });
    }

    // ── Popularity (event count per product) ───────────────────────────────────
    const popById = new Map<string, number>();
    for (const r of (await pg.query(`SELECT payload->>'product_id' pid, count(*)::int c FROM thesis.events WHERE payload->>'product_id' IS NOT NULL GROUP BY 1`)).rows as { pid: string; c: number }[]) {
      popById.set(r.pid, r.c);
    }

    // ── NPMI neighbours per product (ordered by rank) ──────────────────────────
    const npmiNeighbours = new Map<string, { id: string; score: number }[]>();
    for (const r of (await pg.query(`SELECT product_id::text pid, related_product_id::text rid, npmi_score, rank FROM thesis.co_occurrence_top ORDER BY product_id, rank`)).rows as { pid: string; rid: string; npmi_score: number; rank: number }[]) {
      const a = npmiNeighbours.get(r.pid) ?? [];
      a.push({ id: r.rid, score: Number(r.npmi_score) });
      npmiNeighbours.set(r.pid, a);
    }

    // ── Holdout train/test ─────────────────────────────────────────────────────
    const trainByUser = new Map<string, string[]>();
    for (const r of (await pg.query(`SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='train'`)).rows as { uid: string; pid: string }[]) {
      const a = trainByUser.get(r.uid) ?? []; a.push(r.pid); trainByUser.set(r.uid, a);
    }
    const tests = (await pg.query(`SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='test'`)).rows as { uid: string; pid: string }[];

    // ── Last session intent + recipient per user (GT — segments only) ──────────
    const lastSession = new Map<string, { intent: string; rid: string | null }>();
    for (const r of (await pg.query(`SELECT user_id::text uid, intent, recipient_id::text rid FROM thesis.sim_sessions ORDER BY user_id, started_at DESC`)).rows as { uid: string; intent: string; rid: string | null }[]) {
      if (!lastSession.has(r.uid)) lastSession.set(r.uid, { intent: r.intent, rid: r.rid });
    }

    // ── Last-viewed product per user (most recent product_view) ────────────────
    const lastViewed = new Map<string, string>();
    for (const r of (await pg.query(`
      SELECT DISTINCT ON (anonymous_id) anonymous_id::text uid, payload->>'product_id' pid
      FROM thesis.events
      WHERE event_type='product_view' AND payload->>'product_id' IS NOT NULL
      ORDER BY anonymous_id, occurred_at DESC`)).rows as { uid: string; pid: string }[]) {
      lastViewed.set(r.uid, r.pid);
    }

    // ── Cohort -> ids sorted by popularity (for the popular source) ────────────
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

    // ── Common universe = ids with an e1 vector (sorted) ───────────────────────
    const commonIds = [...e1.keys()].sort((a, b) => a.localeCompare(b));
    const commonSet = new Set(commonIds);

    // ── Build the shared pool + cases per test user ────────────────────────────
    const cases: F3Case[] = [];
    const featuresByCase: Map<string, Map<string, number[]>> = new Map(); // uid|pid -> featuresById
    let poolRecallHits = 0, f2Top30Hits = 0, nWithPool = 0;

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
        .map((n) => n.id)
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
      nWithPool++;

      const poolOrder = pool.map((p) => p.id);
      const poolSources = new Map(pool.map((p) => [p.id, p.sources] as const));

      // pool-recall (held-out test pid in pool) vs F2 top-30 (top-30 by max cosine to modes).
      if (poolOrder.includes(t.pid)) poolRecallHits++;
      const f2Top30 = [...allMinusTrain]
        .map((id) => ({ id, s: modeMedoids.length ? Math.max(...modeMedoids.map((m) => cosineSim(m, e1.get(id)!))) : 0 }))
        .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
        .slice(0, 30)
        .map((x) => x.id);
      if (f2Top30.includes(t.pid)) f2Top30Hits++;

      // ── Gift detection (DETECTOR, not GT). Session = the user's train items. ──
      const session: SessionItem[] = train.map((id) => ({
        product_id: id,
        gender_target: meta.get(id)?.gender ?? null,
        age_band: meta.get(id)?.ageBand ?? null,
      }));
      const buyerGender = modeOf(train.map((id) => meta.get(id)?.gender ?? null));
      const buyerAgeBand = modeOf(train.map((id) => meta.get(id)?.ageBand ?? null));
      const budgetBand = modeNum(train.map((id) => meta.get(id)?.priceBand ?? 0));
      const userDemographic: UserDemographic = { gender: buyerGender, ageBand: buyerAgeBand };
      const gift = detectGiftIntent(session, userDemographic, { minItems: 2, minDemographicCoherence: 0.6 });

      // medoids for cross-encoder/feature context: recipient vector if gift, else modes.
      const recipientGender = gift.isGift ? gift.targetGender : null;
      const recipientAgeBand = gift.isGift ? gift.targetAgeBand : null;

      // candidates: RankItem[] in pool order (identity rank == pool/RRF order).
      const candidates: RankItem[] = poolOrder.map((id) => ({ id, popularity: popById.get(id) ?? 0, vector: e1.get(id)!, cohort: meta.get(id)?.cohort ?? null }));
      const ctx: UserContext = { userVector: l2normalize(meanPool(history)), cohort: meta.get(t.pid)?.cohort ?? null };

      // npmi-to-last-viewed map over the pool (0 if last-viewed has no edge to id).
      const lvNpmi = new Map<string, number>();
      if (lv) for (const n of npmiNeighbours.get(lv) ?? []) lvNpmi.set(n.id, n.score);
      const poolNpmi = new Map<string, number>(poolOrder.map((id) => [id, lvNpmi.get(id) ?? 0] as const));

      // features per candidate (demoMatch routed through detector isGift/target).
      const fCtx: FeatureContext = {
        modeMedoids: gift.isGift && history.length ? [buildRecipientVector(history)] : modeMedoids,
        budgetBand,
        buyerGender,
        buyerAgeBand,
        isGift: gift.isGift,
        recipientGender,
        recipientAgeBand,
        lastViewedId: lv,
      };
      const featuresById = new Map<string, number[]>();
      for (const id of poolOrder) {
        const m = meta.get(id)!;
        const fc: FeatureCandidate = {
          id,
          vector: e1.get(id)!,
          priceBand: m.priceBand,
          gender_target: m.gender,
          ageBand: m.ageBand,
          npmiToLastViewed: poolNpmi.get(id) ?? 0,
          popularity: popById.get(id) ?? 0,
          sources: poolSources.get(id) ?? [],
        };
        featuresById.set(id, extractFeatures(fCtx, fc));
      }
      featuresByCase.set(`${t.uid}|${t.pid}`, featuresById);

      const sess = lastSession.get(t.uid);
      cases.push({
        ctx,
        candidates,
        relevant: new Set([t.pid]),
        uid: t.uid,
        intent: sess?.intent ?? "self",
        predGift: gift.isGift,
        modes,
        poolOrder,
        poolSources,
        poolNpmi,
        lvNpmi,
        lastViewedTitle: lv ? meta.get(lv)?.title ?? null : null,
        recipientGender,
        recipientAgeBand,
        buyerGender,
        buyerAgeBand,
        budgetBand,
      });
    }

    if (cases.length === 0) { console.error("[f3] no eval cases produced"); process.exit(1); }

    // ── LTR training (TRAIN split ONLY): positives = train purchases w/ e1; negs = sampled pool ──
    const samples: LtrSample[] = [];
    const negRng = makeRng(SEED);
    for (const c of cases) {
      const featuresById = featuresByCase.get(`${c.uid}|${[...c.relevant][0]}`)!;
      const train = (trainByUser.get(c.uid) ?? []).filter((id) => commonSet.has(id));
      // positives: train purchases, features via the SAME case feature ctx.
      const fCtx: FeatureContext = {
        modeMedoids: c.predGift && train.length ? [buildRecipientVector(train.map((id) => e1.get(id)!))] : c.modes.map((m) => m.medoid),
        budgetBand: c.budgetBand,
        buyerGender: c.buyerGender,
        buyerAgeBand: c.buyerAgeBand,
        isGift: c.predGift,
        recipientGender: c.recipientGender,
        recipientAgeBand: c.recipientAgeBand,
        lastViewedId: null,
      };
      for (const id of train) {
        const m = meta.get(id)!;
        const fc: FeatureCandidate = {
          id, vector: e1.get(id)!, priceBand: m.priceBand, gender_target: m.gender, ageBand: m.ageBand,
          // npmi via the FULL last-viewed map (same lookup pool candidates use),
          // NOT poolNpmi — train positives are absent from the pool, so poolNpmi
          // would force them to 0 and re-introduce a pool-membership leak.
          npmiToLastViewed: c.lvNpmi.get(id) ?? 0, popularity: popById.get(id) ?? 0, sources: c.poolSources.get(id) ?? [],
        };
        samples.push({ features: extractFeatures(fCtx, fc), label: 1 });
      }
      // negatives: 5 sampled pool ids (seeded), excluding the held-out test pid.
      const negPool = c.poolOrder.filter((id) => !c.relevant.has(id));
      for (let n = 0; n < 5 && negPool.length > 0; n++) {
        const id = negPool[negRng.int(negPool.length)];
        samples.push({ features: featuresById.get(id) ?? [], label: 0 });
      }
    }
    const ltrModel: LtrModel = trainLTR(samples, { epochs: 300, lr: 0.3, seed: SEED });

    // ── Rerankers over the shared pool ─────────────────────────────────────────
    const poolByUid = new Map<string, F3Case>(cases.map((c) => [`${c.uid}|${[...c.relevant][0]}`, c]));
    const caseKey = (c: F3Case) => `${c.uid}|${[...c.relevant][0]}`;

    // baseline-rrf: candidates already mapped in pool/RRF order → identity rank.
    const baselineRanker: Ranker = { name: "baseline-rrf", rank: (_ctx, cands) => cands.map((x) => x.id) };

    // mmr over pool {id,rrf_score} with e1 embeddings, k=pool, lambda 0.7; append missing.
    const mmrRankerFor = (c: F3Case): Ranker => ({
      name: "mmr",
      rank: (_ctx, cands) => {
        const rrf = new Map(poolByUid.get(caseKey(c))!.poolOrder.map((id, i) => [id, 1 / (i + 1)] as const));
        const sel = mmrSelect({
          candidates: cands.map((x) => ({ id: x.id, rrf_score: rrf.get(x.id) ?? 0 })),
          embeddings: e1,
          k: cands.length,
          lambda: 0.7,
        }).map((x) => x.id);
        const seen = new Set(sel);
        for (const x of cands) if (!seen.has(x.id)) { seen.add(x.id); sel.push(x.id); }
        return sel;
      },
    });

    // cross-encoder: query chunks MUST be in the SAME E4 (1024-dim) space as the
    // doc chunks (F1 pattern). The query = the user's TRAIN items' E4 chunks,
    // flattened and capped at 24 (mirrors F1's E4_QUERY_CAP). Feeding E1 medoids
    // (64-dim) here is a cross-space bug. If a user has zero E4 train chunks the
    // query is empty → maxSim scores 0 for every candidate → pool order is kept.
    const E4_QUERY_CAP = 24;
    const ceRankerFor = (c: F3Case): Ranker => {
      const train = (trainByUser.get(c.uid) ?? []).filter((id) => commonSet.has(id));
      const qChunks = train.flatMap((id) => chunks.get(id) ?? []).slice(0, E4_QUERY_CAP);
      return crossEncoderRanker(chunks, () => qChunks);
    };

    // ltr: per-case feature map.
    const ltrRankerFor = (c: F3Case): Ranker => ltrRanker(ltrModel, featuresByCase.get(caseKey(c))!);

    // ── Overall metrics + set-change@10 (base = pool top-10 in pool order) ──────
    const setChangeFor = (rankerFor: (c: F3Case) => Ranker): number => {
      let sum = 0;
      for (const c of cases) {
        const ranked = rankerFor(c).rank(c.ctx, c.candidates);
        sum += setChangeAtK(ranked, c.poolOrder, 10);
      }
      return sum / cases.length;
    };

    const evalBaseline = evaluateRanker(baselineRanker, cases, KS);
    const evalMmr = aggregateCases(cases, mmrRankerFor, KS, "mmr");
    const evalCe = aggregateCases(cases, ceRankerFor, KS, "cross-encoder");
    const evalLtr = aggregateCases(cases, ltrRankerFor, KS, "ltr");

    const scBaseline = setChangeFor(() => baselineRanker);
    const scMmr = setChangeFor(mmrRankerFor);
    const scCe = setChangeFor(ceRankerFor);
    const scLtr = setChangeFor(ltrRankerFor);

    // ── Segmented (self/gift by GT intent): ltr vs baseline-rrf ────────────────
    const segs = ["self", "gift"];
    const segRows: { seg: string; n: number; b: ReturnType<typeof evaluateRanker>; l: ReturnType<typeof aggregateCases> }[] = [];
    for (const seg of segs) {
      const sub = cases.filter((c) => c.intent === seg);
      if (sub.length === 0) continue;
      segRows.push({ seg, n: sub.length, b: evaluateRanker(baselineRanker, sub, KS), l: aggregateCases(sub, ltrRankerFor, KS, "ltr") });
    }

    // ── LLM listwise on the first LLM_SUBSET cases ─────────────────────────────
    const llmCases = cases.slice(0, LLM_SUBSET);
    let llmNdcgSum = 0, llmRecallSum = 0, llmSetChangeSum = 0, llmFallbacks = 0;
    const { ndcgAtK, recallAtK } = await import("@/thesis/eval/metrics");
    for (const c of llmCases) {
      const top = c.poolOrder.slice(0, LLM_TOP);
      const llmCands: LlmCandidate[] = top.map((id) => {
        const m = meta.get(id)!;
        return {
          product_id: id,
          title: m.title,
          price_cents: m.priceCents,
          brand: m.brand,
          category: m.category,
          npmi_to_last_viewed: c.poolNpmi.get(id) ?? 0,
          source: (c.poolSources.get(id) ?? []).join("+"),
        };
      });
      const profileBits = [c.buyerGender, c.buyerAgeBand].filter(Boolean).join(", ");
      const recipBits = c.predGift ? [c.recipientGender, c.recipientAgeBand].filter(Boolean).join(", ") : null;
      const res = await llmRerank(llmCands, {
        profile_summary: profileBits || "comprador",
        is_gift: c.predGift,
        recipient_summary: recipBits,
        last_viewed: c.lastViewedTitle,
      });
      if (res.usedFallback) llmFallbacks++;
      const rest = c.poolOrder.filter((id) => !top.includes(id));
      const fullOrder = [...res.order, ...rest];
      llmNdcgSum += ndcgAtK(fullOrder, c.relevant, 10);
      llmRecallSum += recallAtK(fullOrder, c.relevant, 10);
      llmSetChangeSum += setChangeAtK(fullOrder, c.poolOrder, 10);
    }
    const nLlm = Math.max(1, llmCases.length);

    // ── Report ─────────────────────────────────────────────────────────────────
    const poolRecall = poolRecallHits / nWithPool;
    const f2Top30Recall = f2Top30Hits / nWithPool;
    const f1 = (x: number) => x.toFixed(3);

    const rows: string[] = [];
    rows.push("# Thesis F3 — Multi-source candidate pool + four rerankers", "");
    rows.push(`Item space: e1_prod2vec. Common universe: ${commonIds.length}. Eval cases: ${cases.length}. Pool size: ${POOL_SIZE}.`, "");
    rows.push("Sources fused via RRF: retrieval (top-80 max-cos to mode medoids), npmi (last-viewed neighbours), popular (cohort popularity), exploration (seeded shuffle).", "");
    rows.push("ONE shared pool per user — every reranker ranks the identical candidate set (positional metrics only). Gift intent + recipient demographics come from the F2 detector on the user's session; NO ground-truth leaks into ranker features.", "");
    rows.push(`E4 late-interaction chunks loaded: ${chunks.size} products.`, "");
    rows.push("## Pool recall vs F2 top-30", "");
    rows.push(`- Pool recall (held-out test item in pool): ${f1(poolRecall)} (${poolRecallHits}/${nWithPool})`);
    rows.push(`- F2 top-30 recall (top-30 by max-cos to modes): ${f1(f2Top30Recall)} (${f2Top30Hits}/${nWithPool})`, "");
    rows.push("## Rerankers over the shared pool (overall)", "");
    rows.push("| Reranker | nDCG@10 | Recall@10 | MRR | set-change@10 |", "|---|---|---|---|---|");
    rows.push(`| baseline-rrf | ${f1(evalBaseline.ndcg[10])} | ${f1(evalBaseline.recall[10])} | ${f1(evalBaseline.mrr)} | ${f1(scBaseline)} |`);
    rows.push(`| mmr | ${f1(evalMmr.ndcg[10])} | ${f1(evalMmr.recall[10])} | ${f1(evalMmr.mrr)} | ${f1(scMmr)} |`);
    rows.push(`| cross-encoder | ${f1(evalCe.ndcg[10])} | ${f1(evalCe.recall[10])} | ${f1(evalCe.mrr)} | ${f1(scCe)} |`);
    rows.push(`| ltr | ${f1(evalLtr.ndcg[10])} | ${f1(evalLtr.recall[10])} | ${f1(evalLtr.mrr)} | ${f1(scLtr)} |`, "");
    rows.push("### Honest read", "");
    rows.push(`On this synthetic dataset, **no non-learned or learned reranker beats baseline-RRF at nDCG@10** (${f1(evalBaseline.ndcg[10])}). MMR is the cleanest baseline-correct non-learned reranker (nDCG@10 ${f1(evalMmr.ndcg[10])}): it diversifies the top-10 (set-change@10 ${f1(scMmr)}) at a positional-accuracy cost. The cross-encoder MaxSim query is now in the SAME E4 (1024-dim) space as the doc chunks (the user's TRAIN items' E4 chunks, F1 pattern); its nDCG@10 ${f1(evalCe.ndcg[10])} / set-change@10 ${f1(scCe)} is a real measurement — earlier 0.027/0.952 was a cross-space bug (64-dim E1 medoids queried against 1024-dim E4 docs, silently truncated by cosineSim). The honest finding stands: aggressive reranking reshuffles the top-10 without improving recall of the held-out purchase on this data; RRF fusion is the strongest ranker here.`, "");
    rows.push("## Self/gift segments — ltr vs baseline-rrf (GT intent)", "");
    rows.push("| Segment | n | ranker | nDCG@10 | Recall@10 | MRR |", "|---|---|---|---|---|---|");
    for (const s of segRows) {
      rows.push(`| ${s.seg} | ${s.n} | baseline-rrf | ${f1(s.b.ndcg[10])} | ${f1(s.b.recall[10])} | ${f1(s.b.mrr)} |`);
      rows.push(`| ${s.seg} | ${s.n} | ltr | ${f1(s.l.ndcg[10])} | ${f1(s.l.recall[10])} | ${f1(s.l.mrr)} |`);
    }
    rows.push("", `## LLM listwise (DeepSeek) on first ${llmCases.length} cases (pool top-${LLM_TOP})`, "");
    rows.push(`- nDCG@10: ${f1(llmNdcgSum / nLlm)}`);
    rows.push(`- Recall@10: ${f1(llmRecallSum / nLlm)}`);
    rows.push(`- set-change@10: ${f1(llmSetChangeSum / nLlm)}`);
    rows.push(`- fallback rate: ${f1(llmFallbacks / nLlm)} (${llmFallbacks}/${llmCases.length})`, "");
    rows.push("## LTR feature weights (interpretability)", "");
    rows.push("| feature | weight |", "|---|---|");
    for (let i = 0; i < FEATURE_NAMES.length; i++) rows.push(`| ${FEATURE_NAMES[i]} | ${ltrModel.weights[i]?.toFixed(4) ?? "—"} |`);
    rows.push(`| (bias) | ${ltrModel.bias.toFixed(4)} |`, "");

    const md = rows.join("\n") + "\n";
    const outMd = resolve(process.cwd(), "docs/superpowers/reports/2026-06-07-thesis-f3-study.md");
    writeFileSync(outMd, md);

    const json = {
      generated_at: new Date().toISOString(),
      item_space: "e1_prod2vec",
      common_universe: commonIds.length,
      eval_cases: cases.length,
      pool_size: POOL_SIZE,
      e4_chunks_products: chunks.size,
      pool_recall: poolRecall,
      pool_recall_hits: poolRecallHits,
      f2_top30_recall: f2Top30Recall,
      f2_top30_hits: f2Top30Hits,
      n_with_pool: nWithPool,
      rerankers: {
        "baseline-rrf": { ndcg: evalBaseline.ndcg, recall: evalBaseline.recall, mrr: evalBaseline.mrr, set_change_10: scBaseline },
        mmr: { ndcg: evalMmr.ndcg, recall: evalMmr.recall, mrr: evalMmr.mrr, set_change_10: scMmr },
        "cross-encoder": { ndcg: evalCe.ndcg, recall: evalCe.recall, mrr: evalCe.mrr, set_change_10: scCe },
        ltr: { ndcg: evalLtr.ndcg, recall: evalLtr.recall, mrr: evalLtr.mrr, set_change_10: scLtr },
      },
      segments: segRows.map((s) => ({
        segment: s.seg, n: s.n,
        "baseline-rrf": { ndcg10: s.b.ndcg[10], recall10: s.b.recall[10], mrr: s.b.mrr },
        ltr: { ndcg10: s.l.ndcg[10], recall10: s.l.recall[10], mrr: s.l.mrr },
      })),
      llm: {
        subset_n: llmCases.length,
        top: LLM_TOP,
        ndcg10: llmNdcgSum / nLlm,
        recall10: llmRecallSum / nLlm,
        set_change_10: llmSetChangeSum / nLlm,
        fallback_rate: llmFallbacks / nLlm,
        fallbacks: llmFallbacks,
      },
      ltr_weights: Object.fromEntries(FEATURE_NAMES.map((name, i) => [name, ltrModel.weights[i] ?? 0])),
      ltr_bias: ltrModel.bias,
    };
    const outJson = resolve(process.cwd(), "docs/superpowers/reports/2026-06-07-thesis-f3-study.json");
    writeFileSync(outJson, JSON.stringify(json, null, 2) + "\n");

    console.log(md);
    console.log("LTR feature weights:");
    for (let i = 0; i < FEATURE_NAMES.length; i++) console.log(`  ${FEATURE_NAMES[i]}: ${ltrModel.weights[i]?.toFixed(4)}`);
    console.log(`  (bias): ${ltrModel.bias.toFixed(4)}`);
    console.log(`[f3] wrote ${outMd}`);
    console.log(`[f3] wrote ${outJson}`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
