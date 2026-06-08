/**
 * F6 — Single canonical eval-case loader for the head-to-head harness.
 *
 * Every F6 ranker (random, popular-global, popular-cohort, cosine-e2hybrid,
 * f2-multimode, f3-rrf, f3-ltr, f4-knee, f4-revenue, assembled) must see
 * IDENTICAL cases and candidates. This module loads the holdout ONCE and
 * reproduces, faithfully, the data-loading and 4-source RRF pool logic that
 * lives (duplicated) in scripts/thesis/f3-study.ts and scripts/thesis/f4-study.ts,
 * so F6 numbers are consistent with F3/F4.
 *
 * Frame note (spec §5 W1):
 *   - The canonical `candidates` of a UnifiedCase is the FULL production frame:
 *     catalog \ train (every id with an E1 vector, minus the user's train items),
 *     each carrying its E1 (prod2vec, 64d) vector. This is the "candidate-complete"
 *     frame in which every ranker is compared.
 *   - `pool` is the 4-source RRF(200) subset DERIVED from exactly those candidates
 *     (retrieval top-80 by cosine-to-mode-medoids, NPMI top-50 of last-viewed,
 *     popular-cohort top-40, exploration 30 seeded-shuffle). The pool-only frame
 *     restricts `candidates` to this pool (done by the runner, not here).
 *
 * Embedding-space discipline (spec §4, hazard #5 — cosineSim THROWS on mismatch):
 *   - RankItem.vector canonical = E1 (prod2vec, 64d). All F2/F3/F4 stages of the
 *     assembled pipeline operate in E1. NEVER mix dims.
 *   - e2_hybrid enters as a SEPARATE F1 baseline via score-level fusion. Its text
 *     (E0, 1024d) and behaviour (E1, 64d) maps live OUTSIDE RankItem.vector, in the
 *     optional `e2` field, so the runner can build hybridScoreFusionRanker without
 *     dimension mixing.
 *
 * No leakage (spec §7 #6):
 *   - `giftSignal` comes from detectGiftIntent run on the TRAIN session — NEVER
 *     from thesis.sim_sessions ground truth.
 *   - `intentGT` is loaded from thesis.sim_sessions ONLY to segment reports.
 *
 * No API calls: uses already-stored E1 vectors (thesis.item_vectors) + E0 text
 * (thesis.products.embedding). Deterministic: seeded RNG only (seed 42).
 */
import type { Client } from "pg";
import { l2normalize, meanPool, cosineSim } from "../embedders/space";
import type { EvalCase } from "./harness";
import type { RecipientProfile } from "./metrics";
import { buildCandidatePool, type PooledCandidate } from "../rerank/candidates";
import { buildUserModes, type UserMode } from "../multivector/modes";
import {
  detectGiftIntent,
  type GiftSignal,
  type SessionItem,
  type UserDemographic,
} from "../multivector/gift-detect";
import { buildRecipientVector } from "../multivector/gift-vector";
import {
  extractObjectiveFeatures,
  type ObjCtx,
  type ObjCandidate,
  type ObjectiveName,
} from "../objectives/objective-features";
import { expectedRevenue } from "../objectives/outcome";
import { makeRng } from "../data/rng";
import type { RankItem, UserContext } from "../types";

// ── Constants (verbatim from f3-study.ts / f4-study.ts) ──────────────────────
const SEED = 42;
const POOL_SIZE = 200;
const PRICE_BANDS = 4;
const SPACE = "e1_prod2vec";

// 4-source pool quotas (f3/f4).
const RETRIEVAL_TOP = 80;
const NPMI_TOP = 50;
const POPULAR_TOP = 40;
const EXPLORATION_N = 30;

// Mode-building opts (f3/f4).
const MODE_OPTS = { distanceThreshold: 0.5, maxModes: 5 } as const;
// Gift-detector opts (f3).
const GIFT_OPTS = { minItems: 2, minDemographicCoherence: 0.6 } as const;

// ── Local helpers (verbatim from f3-study.ts / f4-study.ts) ──────────────────

/** Age-band bucket from a product's age_target {min,max}; null if absent. (f3) */
function ageBandOf(at: { min?: number; max?: number } | null | undefined): string | null {
  if (!at || typeof at.min !== "number" || typeof at.max !== "number") return null;
  const mid = (at.min + at.max) / 2;
  if (mid <= 3) return "bebe";
  if (mid <= 11) return "nino";
  if (mid <= 25) return "joven";
  if (mid <= 59) return "adulto";
  return "mayor";
}

/** Most frequent non-null value; deterministic alphabetical tie-break. (f3) */
function modeOf(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v === null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, c] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/** Modal numeric (price band) over train items; 0 if none. (f3) */
function modeNum(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = 0;
  let bestCount = -1;
  for (const [v, c] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/** Mean of train price bands, rounded — the budget band for priceFit. (f4) */
function meanBand(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((s, x) => s + x, 0);
  return Math.round(sum / values.length);
}

/** Stable per-user seed for the exploration shuffle. (f3/f4) */
function uidSeed(uid: string): number {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) ^ SEED;
}

/** True for pg errors that look like a connection/pooler-lag failure (free-tier),
 *  NOT a genuinely bad query. Spec hazard #7 scopes the retry to "connection
 *  failure (pooler lag)". pg surfaces these as connection-class SQLSTATEs (class
 *  08), termination by the admin (57P01), or node-level socket errors. */
function isConnectionError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  // SQLSTATE class 08 = connection exception; 57P01 = admin_shutdown (pooler kill).
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

/** Run a query once, retrying a single time ONLY on a connection-level failure
 *  (DB free-tier pooler lag, per spec hazard #7). A genuinely bad query (or any
 *  non-connection error) is re-thrown immediately so real SQL errors are not
 *  masked by a duplicate round-trip. */
async function queryWithRetry<T>(pg: Client, sql: string, params?: unknown[]): Promise<T[]> {
  try {
    return (await pg.query(sql, params)).rows as T[];
  } catch (e) {
    if (!isConnectionError(e)) throw e;
    // One retry only — pooler lag, not a real outage.
    return (await pg.query(sql, params)).rows as T[];
  }
}

// ── Product metadata (union of what f3 + f4 need) ────────────────────────────
interface ProductMeta {
  gender: string | null;
  ageBand: string | null;
  priceBand: number;
  cohort: string | null;
  title: string;
  brand: string;
  category: string;
  priceCents: number;
  marginPct: number;
  sellerId: string;
  sellerAgeDays: number;
}

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * One canonical F6 eval case. Extends EvalCase (ctx, candidates, relevant) with
 * the full per-case context every F6 ranker stage needs, all derived from the
 * SAME data so every ranker is compared apples-to-apples.
 */
export interface UnifiedCase extends EvalCase {
  /** Holdout user id. */
  userId: string;
  /** The user's train item ids (filtered to the E1 universe). */
  trainIds: string[];
  /** Most recent product_view of the user (NPMI source); null if none in-universe. */
  lastViewedId: string | null;
  /** Gift signal from the F2 detector on the TRAIN session (NOT GT). */
  giftSignal: GiftSignal;
  /** Ground-truth session intent — for report SEGMENTATION ONLY, never a feature. */
  intentGT: "self" | "gift";
  /** PinnerSage interest modes built from the user's E1 history. */
  modes: UserMode[];
  /** 4-source RRF(200) pool derived from this case's candidates (E1 universe \ train). */
  pool: PooledCandidate[];
  /** F4 objective features per POOL id (relevance, margin, convProb, novelty, sellerFairness, revenue). */
  objById: Map<string, Record<ObjectiveName, number>>;
  /** Expected revenue per POOL id (P(buy)·price·margin). */
  revenueById: Map<string, number>;
  /** Seller id per POOL id (for seller-exposure-gini). */
  sellerById: Map<string, string>;
  /** Event-count popularity over ALL candidate ids (full frame). */
  popById: Map<string, number>;
  /** NPMI to last-viewed over ALL candidate ids (full last-viewed map; 0 if no edge). */
  lvNpmi: Map<string, number>;
  /** Budget band as the MODE of train price bands (f3 features convention). */
  budgetBandMode: number;
  /** Budget band as the rounded MEAN of train price bands (f4 objective convention). */
  budgetBandMean: number;
  /** Buyer dominant gender (modal over train). */
  buyerGender: string | null;
  /** Buyer dominant age band (modal over train). */
  buyerAgeBand: string | null;
  /** Recipient gender from the detector (null when not gift). */
  recipientGender: string | null;
  /** Recipient age band from the detector (null when not gift). */
  recipientAgeBand: string | null;
  /** GROUND-TRUTH recipient profile from the test session (eval-only: used for
   *  recipient-fit@k vs the TRUE recipient; NEVER a ranker feature). Null if the
   *  session has no recipient (self) or it cannot be resolved. */
  recipientGT: RecipientProfile | null;
  /** Title of the last-viewed product (for LLM prompts); null if none. */
  lastViewedTitle: string | null;
  /**
   * E2-hybrid score-fusion inputs (dimension-safe). Present only when E0 text
   * vectors exist for this user's train. `textItem`/`behavItem` are the SHARED
   * catalog maps (same object across all cases) so the runner builds
   * hybridScoreFusionRanker without mixing the 1024d text and 64d behaviour spaces.
   */
  e2?: {
    /** L2-normalized mean of train E0 (text, 1024d) vectors. */
    textUser: number[];
    /** L2-normalized mean of train E1 (behaviour, 64d) vectors; non-null in practice (E1 universe). */
    behavUser: number[] | null;
    /** Shared id → E0 text vector map (1024d). */
    textItem: Map<string, number[]>;
    /** Shared id → E1 behaviour vector map (64d). */
    behavItem: Map<string, number[]>;
  };
}

export interface UnifiedCasesResult {
  cases: UnifiedCase[];
  /** Shared id → E0 text vector map (1024d). Empty if no E0 vectors persisted. */
  textItem: Map<string, number[]>;
  /** Shared id → E1 prod2vec vector map (64d) — the canonical RankItem.vector space. */
  e1Item: Map<string, number[]>;
  meta: {
    /** Size of the E1 candidate universe (catalog representable in E1). */
    n: number;
    /** Number of UnifiedCases produced. */
    nCases: number;
    /** Fused pool cap. */
    poolSize: number;
    /** Canonical embedding space name for RankItem.vector. */
    space: string;
  };
}

// ── Loader ───────────────────────────────────────────────────────────────────

/**
 * Load the canonical F6 eval cases. Reads the n=2000/seed-42 holdout intact (no
 * data-gen). Reproduces f3/f4 loading + 4-source RRF pool exactly.
 *
 * @param pg   thesis-scoped pg client (getPgClient({ scope: "thesis" })).
 * @param opts.limit  cap the number of cases (deterministic: the holdout-test
 *                    rows are read ORDER BY (user_id, product_id) — the natural
 *                    unique key — so the first `limit` kept are stable across
 *                    runs regardless of plan/VACUUM/replica).
 */
export async function loadUnifiedCases(
  pg: Client,
  opts?: { limit?: number },
): Promise<UnifiedCasesResult> {
  // ── E1 vectors (canonical 64d space) ───────────────────────────────────────
  const e1 = new Map<string, number[]>();
  for (const r of await queryWithRetry<{ id: string; vector: number[] }>(
    pg,
    `SELECT product_id::text id, vector FROM thesis.item_vectors WHERE space=$1`,
    [SPACE],
  )) {
    e1.set(r.id, r.vector.map(Number));
  }
  if (e1.size === 0) {
    throw new Error("[unified-cases] no e1_prod2vec vectors — run pnpm thesis:train-prod2vec");
  }

  // ── E0 text vectors (1024d) from products.embedding (for e2_hybrid). ────────
  const e0 = new Map<string, number[]>();
  for (const r of await queryWithRetry<{ id: string; v: string }>(
    pg,
    `SELECT id::text id, embedding::text v FROM thesis.products WHERE embedding IS NOT NULL`,
  )) {
    e0.set(r.id, JSON.parse(r.v) as number[]);
  }

  // ── Product meta (union of f3 + f4 fields). ─────────────────────────────────
  const meta = new Map<string, ProductMeta>();
  for (const r of await queryWithRetry<{
    id: string;
    title: string;
    metadata: Record<string, unknown>;
    price_cents: number;
  }>(pg, `SELECT id::text id, title, metadata, price_cents FROM thesis.products`)) {
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
      marginPct: typeof m.margin_pct === "number" ? m.margin_pct : 0,
      sellerId: (m.seller_id as string | null) ?? "__none__",
      sellerAgeDays: typeof m.seller_age_days === "number" ? m.seller_age_days : 0,
    });
  }

  // ── Popularity (event count per product). ───────────────────────────────────
  const popById = new Map<string, number>();
  for (const r of await queryWithRetry<{ pid: string; c: number }>(
    pg,
    `SELECT payload->>'product_id' pid, count(*)::int c FROM thesis.events WHERE payload->>'product_id' IS NOT NULL GROUP BY 1`,
  )) {
    popById.set(r.pid, r.c);
  }
  const globalMaxPop = Math.max(1, ...[...popById.values()]);

  // ── NPMI neighbours per product (ordered by rank), with scores. ─────────────
  const npmiNeighbours = new Map<string, { id: string; score: number }[]>();
  for (const r of await queryWithRetry<{ pid: string; rid: string; npmi_score: number; rank: number }>(
    pg,
    `SELECT product_id::text pid, related_product_id::text rid, npmi_score, rank FROM thesis.co_occurrence_top ORDER BY product_id, rank`,
  )) {
    const a = npmiNeighbours.get(r.pid) ?? [];
    a.push({ id: r.rid, score: Number(r.npmi_score) });
    npmiNeighbours.set(r.pid, a);
  }

  // ── Holdout train/test. ─────────────────────────────────────────────────────
  const trainByUser = new Map<string, string[]>();
  for (const r of await queryWithRetry<{ uid: string; pid: string }>(
    pg,
    `SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='train'`,
  )) {
    const a = trainByUser.get(r.uid) ?? [];
    a.push(r.pid);
    trainByUser.set(r.uid, a);
  }
  // ORDER BY the natural unique key of a holdout-test row so the opts.limit
  // subset is deterministic across runs (Postgres gives no row order for an
  // unordered SELECT; the early-break at the build loop relies on this). Spec §6
  // hazard #6 (hard determinism).
  const tests = await queryWithRetry<{ uid: string; pid: string }>(
    pg,
    `SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='test' ORDER BY user_id, product_id`,
  );

  // ── Test item's ACTUAL session (GT intent + that session's browsed items). ───
  // The gift detector MUST run on the session the held-out purchase belongs to
  // (as f2-study does), NOT the user's whole train history — otherwise the
  // session's modal demographic always equals the buyer's own and gift NEVER
  // fires (the W8 degeneracy). `${uid}|${pid}` -> the session containing pid.
  const testSession = new Map<string, { sid: string; intent: string; rid: string | null }>();
  for (const r of await queryWithRetry<{ uid: string; pid: string; sid: string; intent: string; rid: string | null }>(
    pg,
    `SELECT DISTINCT h.user_id::text uid, h.product_id::text pid, e.session_id::text sid, s.intent, s.recipient_id::text rid
       FROM thesis.holdout h
       JOIN thesis.events e ON e.anonymous_id = h.user_id AND e.payload->>'product_id' = h.product_id::text
       JOIN thesis.sim_sessions s ON s.session_id = e.session_id
      WHERE h.split='test'`,
  )) {
    const k = `${r.uid}|${r.pid}`;
    if (!testSession.has(k)) testSession.set(k, { sid: r.sid, intent: r.intent, rid: r.rid });
  }
  const sessionItems = new Map<string, string[]>();
  for (const r of await queryWithRetry<{ sid: string; pid: string }>(
    pg,
    `SELECT e.session_id::text sid, e.payload->>'product_id' pid
       FROM thesis.events e WHERE e.payload->>'product_id' IS NOT NULL GROUP BY 1, 2`,
  )) {
    const a = sessionItems.get(r.sid) ?? [];
    a.push(r.pid);
    sessionItems.set(r.sid, a);
  }
  // ── GT recipient profiles (eval-only, for recipient-fit vs the TRUE recipient;
  //    NEVER a ranker feature — same status as the held-out purchase). ──────────
  const recById = new Map<string, RecipientProfile>();
  for (const r of await queryWithRetry<{ id: string; gender: string; age_min: number; age_max: number }>(
    pg,
    `SELECT id::text id, gender, age_min, age_max FROM thesis.sim_user_recipients`,
  )) {
    recById.set(r.id, { gender: r.gender, age_min: r.age_min, age_max: r.age_max });
  }
  // ── Last session intent per user (fallback when an item maps to no session). ─
  const lastSession = new Map<string, { intent: string }>();
  for (const r of await queryWithRetry<{ uid: string; intent: string }>(
    pg,
    `SELECT user_id::text uid, intent FROM thesis.sim_sessions ORDER BY user_id, started_at DESC`,
  )) {
    if (!lastSession.has(r.uid)) lastSession.set(r.uid, { intent: r.intent });
  }

  // ── Last-viewed product per user (most recent product_view). ────────────────
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

  // ── Cohort → ids sorted by popularity (popular source). ─────────────────────
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

  // ── Common universe = ids with an E1 vector (sorted). ───────────────────────
  const commonIds = [...e1.keys()].sort((a, b) => a.localeCompare(b));
  const commonSet = new Set(commonIds);

  const e2Participates = e0.size > 0;

  // ── Build one UnifiedCase per test user. ────────────────────────────────────
  const cases: UnifiedCase[] = [];
  for (const t of tests) {
    if (opts?.limit !== undefined && cases.length >= opts.limit) break;

    const train = (trainByUser.get(t.uid) ?? []).filter((id) => commonSet.has(id));
    if (train.length === 0 || !commonSet.has(t.pid)) continue;
    const trainSet = new Set(train);
    const history = train.map((id) => e1.get(id)!);
    const trainModes = buildUserModes(history, MODE_OPTS);

    // ── Gift detection on the test item's ACTUAL session (DETECTOR, not GT). ──
    // Exclude the held-out product itself (no leakage); buyer demographic comes
    // from the TRAIN history so cross-cohort is measured vs the buyer's own taste.
    const tsess = testSession.get(`${t.uid}|${t.pid}`);
    const sessionProductIds = (tsess ? sessionItems.get(tsess.sid) ?? [] : []).filter(
      (id) => commonSet.has(id) && id !== t.pid,
    );
    const session: SessionItem[] = sessionProductIds.map((id) => ({
      product_id: id,
      gender_target: meta.get(id)?.gender ?? null,
      age_band: meta.get(id)?.ageBand ?? null,
    }));
    const buyerGender = modeOf(train.map((id) => meta.get(id)?.gender ?? null));
    const buyerAgeBand = modeOf(train.map((id) => meta.get(id)?.ageBand ?? null));
    const userDemographic: UserDemographic = { gender: buyerGender, ageBand: buyerAgeBand };
    const giftSignal = detectGiftIntent(session, userDemographic, GIFT_OPTS);
    const recipientGender = giftSignal.isGift ? giftSignal.targetGender : null;
    const recipientAgeBand = giftSignal.isGift ? giftSignal.targetAgeBand : null;
    // Effective modes: a gift routes to a single ephemeral recipient vector built
    // from the session items (f2-study parity); otherwise the buyer's train modes.
    const sessionVectors = sessionProductIds.map((id) => e1.get(id)!);
    const modes =
      giftSignal.isGift && sessionVectors.length
        ? [{ medoid: buildRecipientVector(sessionVectors), weight: 1, size: sessionVectors.length }]
        : trainModes;
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

    // ── Budget bands (f3 mode for features, f4 mean for objectives). ─────────
    const budgetBandMode = modeNum(train.map((id) => meta.get(id)?.priceBand ?? 0));
    const budgetBandMean = meanBand(train.map((id) => meta.get(id)?.priceBand ?? 0));

    // ── Full last-viewed → npmi map (ANY id, superset of pool). ──────────────
    const lvNpmi = new Map<string, number>();
    if (lv) for (const n of npmiNeighbours.get(lv) ?? []) lvNpmi.set(n.id, n.score);

    // ── Per-POOL expectedRevenue (f4: affinity = max cosine to modes). ───────
    const revenueById = new Map<string, number>();
    for (const id of poolOrder) {
      const m = meta.get(id)!;
      const affinity = modeMedoids.length
        ? Math.max(0, Math.min(1, Math.max(...modeMedoids.map((md) => cosineSim(md, e1.get(id)!)))))
        : 0;
      const priceFit = Math.max(0, 1 - Math.abs(m.priceBand - budgetBandMean) / (PRICE_BANDS - 1));
      revenueById.set(
        id,
        expectedRevenue({ affinity, priceFit, price_cents: m.priceCents, margin_pct: m.marginPct }),
      );
    }
    const maxRevenue = Math.max(0, ...[...revenueById.values()]);

    // ── F4 objective features per POOL id (same ObjCtx for the pool). ────────
    const objCtx: ObjCtx = {
      modeMedoids,
      budgetBand: budgetBandMean,
      maxPopularity: globalMaxPop,
      maxRevenue,
    };
    const objById = new Map<string, Record<ObjectiveName, number>>();
    const sellerById = new Map<string, string>();
    for (const id of poolOrder) {
      const m = meta.get(id)!;
      const objCand: ObjCandidate = {
        id,
        vector: e1.get(id)!,
        priceBand: m.priceBand,
        price_cents: m.priceCents,
        margin_pct: m.marginPct,
        popularity: popById.get(id) ?? 0,
        seller_age_days: m.sellerAgeDays,
      };
      objById.set(id, extractObjectiveFeatures(objCtx, objCand));
      sellerById.set(id, m.sellerId);
    }

    // ── Canonical candidates = FULL frame (catalog \ train) in E1. ───────────
    const candidates: RankItem[] = allMinusTrain.map((id) => ({
      id,
      popularity: popById.get(id) ?? 0,
      vector: e1.get(id)!,
      cohort: meta.get(id)?.cohort ?? null,
    }));
    // ctx.userVector follows the F3 convention: the L2-normalized mean-pool of
    // the user's E1 (prod2vec, 64d) history. NOTE the two source studies diverge
    // here — f3-study uses meanPool(history) (this), f4-study uses modeMedoids[0].
    // The unified loader standardizes on f3's mean-pool. F4-style rankers must
    // therefore NOT read ctx.userVector for their query; they must derive it from
    // the exposed `modes` (modeMedoids[0] === case.modes[0]?.medoid) to stay
    // apples-to-apples with the original f4 study. (Current rankers are unaffected:
    // multiObjectiveRanker ignores ctx via _ctx, so no live ranker reads userVector
    // with f4 semantics — this guards a future F6 ranker.)
    const ctx: UserContext = {
      userVector: l2normalize(meanPool(history)),
      cohort: meta.get(t.pid)?.cohort ?? null,
    };

    // ── E2-hybrid score-fusion inputs (dimension-safe). ──────────────────────
    const trainE0 = train.map((id) => e0.get(id)).filter((v): v is number[] => v !== undefined);
    const e2 =
      e2Participates && trainE0.length > 0
        ? {
            textUser: l2normalize(meanPool(trainE0)),
            behavUser: l2normalize(meanPool(history)),
            textItem: e0,
            behavItem: e1,
          }
        : undefined;

    const intentGT: "self" | "gift" =
      (tsess?.intent ?? lastSession.get(t.uid)?.intent) === "gift" ? "gift" : "self";

    cases.push({
      ctx,
      candidates,
      relevant: new Set([t.pid]),
      userId: t.uid,
      trainIds: train,
      lastViewedId: lv,
      giftSignal,
      intentGT,
      modes,
      pool,
      objById,
      revenueById,
      sellerById,
      popById,
      lvNpmi,
      budgetBandMode,
      budgetBandMean,
      buyerGender,
      buyerAgeBand,
      recipientGender,
      recipientAgeBand,
      recipientGT: tsess?.rid ? recById.get(tsess.rid) ?? null : null,
      lastViewedTitle: lv ? meta.get(lv)?.title ?? null : null,
      e2,
    });
  }

  if (cases.length === 0) {
    throw new Error("[unified-cases] no eval cases produced");
  }

  return {
    cases,
    textItem: e0,
    e1Item: e1,
    meta: {
      n: commonIds.length,
      nCases: cases.length,
      poolSize: POOL_SIZE,
      space: SPACE,
    },
  };
}
