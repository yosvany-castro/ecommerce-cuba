/**
 * AUDIT shared lib — faithful in-memory replication of the unified-cases loader
 * (src/thesis/eval/unified-cases.ts) over the local dump, with every LEAK KNOB
 * parameterized:
 *   - npmi graph        : shipped (all events) | train-only
 *   - popularity        : shipped (all events) | train-only
 *   - E1 vectors        : shipped (prod2vec on all events) | retrained train-only
 *   - serve-time context: shipped (full test session: lastViewed + gift session)
 *                         | prefix-only (events strictly before the purchase)
 *
 * Ranking logic is IMPORTED from the project (popularCohortRanker, rrfFuse via
 * buildCandidatePool, buildUserModes, detectGiftIntent, buildRecipientVector,
 * metrics) or mirrored verbatim (assembled f3-rrf path: pool order + PC tail).
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { l2normalize, meanPool, cosineSim } from "@/thesis/embedders/space";
import { buildCandidatePool, type PooledCandidate } from "@/thesis/rerank/candidates";
import { buildUserModes, type UserMode } from "@/thesis/multivector/modes";
import {
  detectGiftIntent,
  type SessionItem,
  type GiftSignal,
} from "@/thesis/multivector/gift-detect";
import { buildRecipientVector } from "@/thesis/multivector/gift-vector";
import { popularCohortRanker } from "@/thesis/eval/baselines";
import { expectedRevenue } from "@/thesis/objectives/outcome";
import { npmiFromCounts } from "@/sectors/d-personalization/co-occurrence/npmi-recompute";
import { makeRng } from "@/thesis/data/rng";
import type { RankItem, UserContext } from "@/thesis/types";

const DIR = resolve(process.cwd(), "scripts/_audit/data");

// ── Loader-verbatim constants ─────────────────────────────────────────────────
export const SEED = 42;
const POOL_SIZE = 200;
const PRICE_BANDS = 4;
const RETRIEVAL_TOP = 80;
const NPMI_TOP = 50;
const POPULAR_TOP = 40;
const EXPLORATION_N = 30;
const MODE_OPTS = { distanceThreshold: 0.5, maxModes: 5 } as const;
const GIFT_OPTS = { minItems: 2, minDemographicCoherence: 0.6 } as const;
const MIN_COUNT_FOR_NPMI = 3;
const NPMI_TOP_K = 50;

// ── Dump types ────────────────────────────────────────────────────────────────
export interface EvRow {
  sid: string;
  uid: string;
  et: "product_view" | "add_to_cart" | "purchase";
  pid: string;
  ts: string;
}
export interface ProductMeta {
  gender: string | null;
  ageBand: string | null;
  priceBand: number;
  cohort: string | null;
  priceCents: number;
  marginPct: number;
  title: string;
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(DIR, `${name}.json`), "utf8")) as T;
}

/** unified-cases ageBandOf, verbatim. */
function ageBandOf(at: { min?: number; max?: number } | null | undefined): string | null {
  if (!at || typeof at.min !== "number" || typeof at.max !== "number") return null;
  const mid = (at.min + at.max) / 2;
  if (mid <= 3) return "bebe";
  if (mid <= 11) return "nino";
  if (mid <= 25) return "joven";
  if (mid <= 59) return "adulto";
  return "mayor";
}

/** unified-cases modeOf, verbatim. */
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

/** unified-cases modeNum / meanBand, verbatim. */
function meanBand(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((s, x) => s + x, 0) / values.length);
}

/** unified-cases uidSeed, verbatim (FNV-1a ^ SEED). */
function uidSeed(uid: string): number {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) ^ SEED;
}

// ── Core data bundle ──────────────────────────────────────────────────────────
export interface Data {
  meta: Map<string, ProductMeta>;
  e1Shipped: Map<string, number[]>;
  events: EvRow[];
  sessionsIntent: Map<string, { uid: string; intent: string; rid: string | null }>;
  trainByUser: Map<string, string[]>;
  testRows: { uid: string; pid: string }[];
  /** (uid|pid) -> sid of the session containing the test PURCHASE. */
  testSession: Map<string, string>;
  /** sid -> distinct pids (any event type). */
  sessionItems: Map<string, Set<string>>;
  /** set of session ids that contain at least one held-out test purchase. */
  testSessionIds: Set<string>;
  /** per uid: last product_view pid over ALL events (shipped lastViewed). */
  lastViewedAll: Map<string, string>;
  /** per uid: last product_view pid over NON-test-session events. */
  lastViewedTrain: Map<string, string>;
  /** (uid|pid) -> last view pid strictly BEFORE the test purchase (session prefix, else train). */
  lastViewedPrefix: Map<string, string>;
  /** (uid|pid) -> session item pids viewed strictly BEFORE the purchase (prefix gift context). */
  prefixSessionItems: Map<string, string[]>;
  /** shipped popularity: event count per pid over ALL events. */
  popAll: Map<string, number>;
  /** clean popularity: event count per pid excluding test sessions. */
  popTrain: Map<string, number>;
  /** shipped NPMI neighbours from the DB artifact co_occurrence_top. */
  npmiShipped: Map<string, { id: string; score: number }[]>;
  recipients: Map<string, { gender: string; age_min: number; age_max: number }>;
}

export function loadData(): Data {
  const products = readJson<{ id: string; title: string; metadata: Record<string, unknown>; price_cents: number }[]>("products");
  const meta = new Map<string, ProductMeta>();
  for (const r of products) {
    const m = r.metadata ?? {};
    meta.set(r.id, {
      gender: (m.gender_target as string | null) ?? null,
      ageBand: ageBandOf(m.age_target as { min?: number; max?: number } | null),
      priceBand: typeof m.price_band === "number" ? (m.price_band as number) : 0,
      cohort: (m.subcategory as string | null) ?? null,
      priceCents: r.price_cents ?? 0,
      marginPct: typeof m.margin_pct === "number" ? (m.margin_pct as number) : 0,
      title: r.title ?? "",
    });
  }

  const e1Shipped = new Map<string, number[]>();
  for (const r of readJson<{ id: string; vector: number[] }[]>("item_vectors_e1")) {
    e1Shipped.set(r.id, r.vector.map(Number));
  }

  const events = readJson<EvRow[]>("events");
  const sessionsIntent = new Map<string, { uid: string; intent: string; rid: string | null }>();
  for (const s of readJson<{ sid: string; uid: string; intent: string; rid: string | null }[]>("sessions")) {
    sessionsIntent.set(s.sid, { uid: s.uid, intent: s.intent, rid: s.rid });
  }

  const trainByUser = new Map<string, string[]>();
  for (const r of readJson<{ uid: string; pid: string }[]>("holdout_train")) {
    const a = trainByUser.get(r.uid) ?? [];
    a.push(r.pid);
    trainByUser.set(r.uid, a);
  }
  const testRows = readJson<{ uid: string; pid: string }[]>("holdout_test");

  // session containing the test PURCHASE (deterministic, purchase-anchored)
  const testSession = new Map<string, string>();
  const purchasesByUidPid = new Map<string, { sid: string; ts: string }[]>();
  for (const ev of events) {
    if (ev.et !== "purchase") continue;
    const k = `${ev.uid}|${ev.pid}`;
    const a = purchasesByUidPid.get(k) ?? [];
    a.push({ sid: ev.sid, ts: ev.ts });
    purchasesByUidPid.set(k, a);
  }
  for (const t of testRows) {
    const k = `${t.uid}|${t.pid}`;
    const ps = purchasesByUidPid.get(k);
    if (ps && ps.length > 0) {
      // the LAST purchase of that product by that user = the held-out one
      ps.sort((a, b) => a.ts.localeCompare(b.ts));
      testSession.set(k, ps[ps.length - 1].sid);
    }
  }
  const testSessionIds = new Set<string>(testSession.values());

  const sessionItems = new Map<string, Set<string>>();
  for (const ev of events) {
    const s = sessionItems.get(ev.sid) ?? new Set<string>();
    s.add(ev.pid);
    sessionItems.set(ev.sid, s);
  }

  // lastViewed maps. Events are dumped ORDER BY uid, ts so later rows win.
  const lastViewedAll = new Map<string, string>();
  const lastViewedTrain = new Map<string, string>();
  for (const ev of events) {
    if (ev.et !== "product_view") continue;
    lastViewedAll.set(ev.uid, ev.pid);
    if (!testSessionIds.has(ev.sid)) lastViewedTrain.set(ev.uid, ev.pid);
  }

  // prefix context per test case: views strictly before the held-out purchase ts
  const purchaseTs = new Map<string, string>(); // uid|pid -> ts of held-out purchase
  for (const t of testRows) {
    const k = `${t.uid}|${t.pid}`;
    const ps = purchasesByUidPid.get(k);
    if (ps && ps.length > 0) purchaseTs.set(k, ps[ps.length - 1].ts);
  }
  const lastViewedPrefix = new Map<string, string>();
  const prefixSessionItems = new Map<string, string[]>();
  {
    // group views by session for prefix scans
    const viewsBySession = new Map<string, { pid: string; ts: string }[]>();
    for (const ev of events) {
      if (ev.et !== "product_view") continue;
      const a = viewsBySession.get(ev.sid) ?? [];
      a.push({ pid: ev.pid, ts: ev.ts });
      viewsBySession.set(ev.sid, a);
    }
    for (const t of testRows) {
      const k = `${t.uid}|${t.pid}`;
      const sid = testSession.get(k);
      const cutoff = purchaseTs.get(k);
      let lastPrefix: string | undefined = lastViewedTrain.get(t.uid);
      const prefixItems: string[] = [];
      if (sid && cutoff) {
        // Views strictly before the held-out purchase, EXCLUDING the held-out
        // product itself (its own view immediately precedes its purchase; using
        // it as the anchor would be asking NPMI to predict an item from itself).
        const vs = (viewsBySession.get(sid) ?? []).filter((v) => v.ts < cutoff && v.pid !== t.pid);
        vs.sort((a, b) => a.ts.localeCompare(b.ts));
        for (const v of vs) {
          prefixItems.push(v.pid);
          lastPrefix = v.pid;
        }
      }
      if (lastPrefix !== undefined) lastViewedPrefix.set(k, lastPrefix);
      prefixSessionItems.set(k, prefixItems);
    }
  }

  // popularity (shipped vs train-only)
  const popAll = new Map<string, number>();
  const popTrain = new Map<string, number>();
  for (const ev of events) {
    popAll.set(ev.pid, (popAll.get(ev.pid) ?? 0) + 1);
    if (!testSessionIds.has(ev.sid)) popTrain.set(ev.pid, (popTrain.get(ev.pid) ?? 0) + 1);
  }

  const npmiShipped = new Map<string, { id: string; score: number }[]>();
  for (const r of readJson<{ pid: string; rid: string; s: number; rank: number }[]>("co_occurrence_top")) {
    const a = npmiShipped.get(r.pid) ?? [];
    a.push({ id: r.rid, score: Number(r.s) });
    npmiShipped.set(r.pid, a);
  }

  const recipients = new Map<string, { gender: string; age_min: number; age_max: number }>();
  for (const r of readJson<{ id: string; gender: string; age_min: number; age_max: number }[]>("recipients")) {
    recipients.set(r.id, { gender: r.gender, age_min: r.age_min, age_max: r.age_max });
  }

  return {
    meta,
    e1Shipped,
    events,
    sessionsIntent,
    trainByUser,
    testRows,
    testSession,
    sessionItems,
    testSessionIds,
    lastViewedAll,
    lastViewedTrain,
    lastViewedPrefix,
    prefixSessionItems,
    popAll,
    popTrain,
    npmiShipped,
    recipients,
  };
}

// ── Co-occurrence rebuild (mirrors backfill-cooccurrence.ts SQL) ──────────────
export function buildPairCounts(events: EvRow[], excludeSessionIds?: Set<string>): Map<string, number> {
  // per session, per pid: MAX weight (view=1, cart=3, purchase=5)
  const w = (et: string) => (et === "purchase" ? 5 : et === "add_to_cart" ? 3 : 1);
  const perSession = new Map<string, Map<string, number>>();
  for (const ev of events) {
    if (excludeSessionIds?.has(ev.sid)) continue;
    let m = perSession.get(ev.sid);
    if (!m) {
      m = new Map();
      perSession.set(ev.sid, m);
    }
    m.set(ev.pid, Math.max(m.get(ev.pid) ?? 0, w(ev.et)));
  }
  // pairs a<b, weight GREATEST(wa,wb), summed over sessions
  const pairs = new Map<string, number>();
  for (const m of perSession.values()) {
    const ids = [...m.keys()].sort((a, b) => a.localeCompare(b));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}|${ids[j]}`;
        const weight = Math.max(m.get(ids[i])!, m.get(ids[j])!);
        pairs.set(key, (pairs.get(key) ?? 0) + weight);
      }
    }
  }
  return pairs;
}

/** Mirrors recomputeNPMI: count>=3 filter, symmetric expansion, npmi>0, top-50. */
export function buildNpmiTop(pairs: Map<string, number>): Map<string, { id: string; score: number }[]> {
  let nTotal = 0;
  const perProduct = new Map<string, number>();
  const filtered: { a: string; b: string; count: number }[] = [];
  for (const [key, count] of pairs) {
    if (count < MIN_COUNT_FOR_NPMI) continue;
    const [a, b] = key.split("|");
    filtered.push({ a, b, count });
    nTotal += count;
    perProduct.set(a, (perProduct.get(a) ?? 0) + count);
    perProduct.set(b, (perProduct.get(b) ?? 0) + count);
  }
  const expanded = new Map<string, { id: string; score: number }[]>();
  const push = (p: string, r: string, s: number) => {
    const a = expanded.get(p) ?? [];
    a.push({ id: r, score: s });
    expanded.set(p, a);
  };
  for (const f of filtered) {
    const npmi = npmiFromCounts({
      countAB: f.count,
      countA: perProduct.get(f.a)!,
      countB: perProduct.get(f.b)!,
      nTotal,
    });
    if (npmi <= 0) continue;
    push(f.a, f.b, npmi);
    push(f.b, f.a, npmi);
  }
  for (const [p, arr] of expanded) {
    arr.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
    expanded.set(p, arr.slice(0, NPMI_TOP_K));
  }
  return expanded;
}

// ── Case building (mirrors unified-cases.ts build loop) ───────────────────────
export interface VariantKnobs {
  e1: Map<string, number[]>;
  pop: Map<string, number>;
  npmi: Map<string, { id: string; score: number }[]>;
  /** "full" = shipped (lastViewedAll + full test session); "prefix" = honest serving. */
  serve: "full" | "prefix";
  /** "oracle" = ctx.cohort from the TEST item (shipped); "train" = modal train subcategory. */
  pcCohort: "oracle" | "train";
}

export interface AuditCase {
  uid: string;
  pid: string;
  ctx: UserContext;
  candidates: RankItem[];
  pool: PooledCandidate[];
  modes: UserMode[];
  modeMedoids: number[][];
  giftSignal: GiftSignal;
  intentGT: "self" | "gift";
  trainIds: string[];
  lastViewedId: string | null;
  budgetBandMean: number;
  sources: { retrieval: string[]; npmi: string[]; popular: string[]; exploration: string[] };
}

export function buildCases(d: Data, knobs: VariantKnobs, opts?: { limit?: number }): AuditCase[] {
  const { meta } = d;
  const e1 = knobs.e1;
  const popById = knobs.pop;

  const commonIds = [...e1.keys()].sort((a, b) => a.localeCompare(b));
  const commonSet = new Set(commonIds);

  // cohort -> ids sorted by popularity (loader lines 433-453)
  const cohortPopular = new Map<string, string[]>();
  {
    const byCohort = new Map<string, string[]>();
    for (const id of commonIds) {
      const c = meta.get(id)?.cohort ?? "__none__";
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
  const globalPopular = [...commonIds].sort(
    (a, b) => (popById.get(b) ?? 0) - (popById.get(a) ?? 0) || a.localeCompare(b),
  );

  const cases: AuditCase[] = [];
  for (const t of d.testRows) {
    if (opts?.limit !== undefined && cases.length >= opts.limit) break;
    const key = `${t.uid}|${t.pid}`;
    const train = (d.trainByUser.get(t.uid) ?? []).filter((id) => commonSet.has(id));
    if (train.length === 0 || !commonSet.has(t.pid)) continue;
    const trainSet = new Set(train);
    const history = train.map((id) => e1.get(id)!);
    const trainModes = buildUserModes(history, MODE_OPTS);

    // gift detection on the test item's session (minus pid), or the prefix
    const sid = d.testSession.get(key);
    const fullSessionIds = sid ? [...(d.sessionItems.get(sid) ?? [])] : [];
    const rawSessionIds =
      knobs.serve === "full" ? fullSessionIds : (d.prefixSessionItems.get(key) ?? []);
    const sessionProductIds = rawSessionIds.filter((id) => commonSet.has(id) && id !== t.pid);
    const session: SessionItem[] = sessionProductIds.map((id) => ({
      product_id: id,
      gender_target: meta.get(id)?.gender ?? null,
      age_band: meta.get(id)?.ageBand ?? null,
    }));
    const buyerGender = modeOf(train.map((id) => meta.get(id)?.gender ?? null));
    const buyerAgeBand = modeOf(train.map((id) => meta.get(id)?.ageBand ?? null));
    const giftSignal = detectGiftIntent(session, { gender: buyerGender, ageBand: buyerAgeBand }, GIFT_OPTS);
    const sessionVectors = sessionProductIds.map((id) => e1.get(id)!);
    const modes =
      giftSignal.isGift && sessionVectors.length
        ? [{ medoid: buildRecipientVector(sessionVectors), weight: 1, size: sessionVectors.length }]
        : trainModes;
    const modeMedoids = modes.map((m) => m.medoid);

    const allMinusTrain = commonIds.filter((id) => !trainSet.has(id));

    // SOURCE 1: retrieval top-80 by max cosine to mode medoids
    const retrieval = allMinusTrain
      .map((id) => ({
        id,
        s: modeMedoids.length ? Math.max(...modeMedoids.map((m) => cosineSim(m, e1.get(id)!))) : 0,
      }))
      .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
      .slice(0, RETRIEVAL_TOP)
      .map((x) => x.id);

    // SOURCE 2: npmi of last-viewed
    const lv =
      knobs.serve === "full" ? (d.lastViewedAll.get(t.uid) ?? null) : (d.lastViewedPrefix.get(key) ?? null);
    const npmi = (lv ? (knobs.npmi.get(lv) ?? []) : [])
      .map((n) => n.id)
      .filter((id) => commonSet.has(id) && !trainSet.has(id))
      .slice(0, NPMI_TOP);

    // SOURCE 3: popular (cohort of train[0])
    const seedCohort = meta.get(train[0])?.cohort ?? "__none__";
    const popSource = (cohortPopular.get(seedCohort) ?? globalPopular)
      .filter((id) => !trainSet.has(id))
      .slice(0, POPULAR_TOP);
    const popular = popSource.length
      ? popSource
      : globalPopular.filter((id) => !trainSet.has(id)).slice(0, POPULAR_TOP);

    // SOURCE 4: exploration seeded shuffle
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

    const candidates: RankItem[] = allMinusTrain.map((id) => ({
      id,
      popularity: popById.get(id) ?? 0,
      vector: e1.get(id)!,
      cohort: meta.get(id)?.cohort ?? null,
    }));

    const pcCohortVal =
      knobs.pcCohort === "oracle"
        ? (meta.get(t.pid)?.cohort ?? null)
        : modeOf(train.map((id) => meta.get(id)?.cohort ?? null));

    const ctx: UserContext = {
      userVector: l2normalize(meanPool(history)),
      cohort: pcCohortVal,
    };

    const intentGT: "self" | "gift" =
      (sid ? d.sessionsIntent.get(sid)?.intent : undefined) === "gift" ? "gift" : "self";

    cases.push({
      uid: t.uid,
      pid: t.pid,
      ctx,
      candidates,
      pool,
      modes,
      modeMedoids,
      giftSignal,
      intentGT,
      trainIds: train,
      lastViewedId: lv,
      budgetBandMean: meanBand(train.map((id) => meta.get(id)?.priceBand ?? 0)),
      sources: { retrieval, npmi, popular, exploration },
    });
  }
  return cases;
}

// ── Rankers ───────────────────────────────────────────────────────────────────

/** popular-cohort, via the project's own baseline. */
export function rankPC(c: AuditCase): string[] {
  return popularCohortRanker().rank(c.ctx, c.candidates);
}

/** f3-rrf: pool RRF order + popular-cohort tail (assembledRankerFor rrf path, verbatim). */
export function rankF3Rrf(c: AuditCase): string[] {
  const poolIds = c.pool.map((p) => p.id);
  const poolSet = new Set(poolIds);
  const tailCands = c.candidates.filter((x) => !poolSet.has(x.id));
  const tail = popularCohortRanker().rank(c.ctx, tailCands);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of poolIds) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of tail) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const cand of c.candidates) {
    if (!seen.has(cand.id)) {
      seen.add(cand.id);
      out.push(cand.id);
    }
  }
  return out;
}

/** Cynical price ranker: price*margin desc. Tests revenue@10 gameability. */
export function rankPriceCynic(c: AuditCase, meta: Map<string, ProductMeta>): string[] {
  return c.candidates
    .map((x) => {
      const m = meta.get(x.id)!;
      return { id: x.id, v: m.priceCents * m.marginPct };
    })
    .sort((a, b) => b.v - a.v || a.id.localeCompare(b.id))
    .map((x) => x.id);
}

/** item-kNN over the co-occurrence graph: score = Σ_{t∈train} npmi(t→cand). 2003-era CF. */
export function rankItemKnn(
  c: AuditCase,
  npmi: Map<string, { id: string; score: number }[]>,
): string[] {
  const score = new Map<string, number>();
  for (const t of c.trainIds) {
    for (const n of npmi.get(t) ?? []) {
      score.set(n.id, (score.get(n.id) ?? 0) + n.score);
    }
  }
  if (c.lastViewedId) {
    for (const n of npmi.get(c.lastViewedId) ?? []) {
      score.set(n.id, (score.get(n.id) ?? 0) + n.score);
    }
  }
  const trainSet = new Set(c.trainIds);
  return c.candidates
    .map((x) => ({
      id: x.id,
      s: trainSet.has(x.id) ? -1 : (score.get(x.id) ?? 0),
      pop: x.popularity,
    }))
    .sort((a, b) => b.s - a.s || b.pop - a.pop || a.id.localeCompare(b.id))
    .map((x) => x.id);
}

/** revenue@10 with the harness's own expectedRevenue semantics (affinity = max cosine to modes). */
export function revenue10(c: AuditCase, ranked: string[], meta: Map<string, ProductMeta>, e1: Map<string, number[]>): number {
  let total = 0;
  for (const id of ranked.slice(0, 10)) {
    const m = meta.get(id);
    const v = e1.get(id);
    if (!m || !v) continue;
    const affinity = c.modeMedoids.length
      ? Math.max(0, Math.min(1, Math.max(...c.modeMedoids.map((md) => cosineSim(md, v)))))
      : 0;
    const priceFit = Math.max(0, 1 - Math.abs(m.priceBand - c.budgetBandMean) / (PRICE_BANDS - 1));
    total += expectedRevenue({ affinity, priceFit, price_cents: m.priceCents, margin_pct: m.marginPct });
  }
  return total;
}

// ── Stats ─────────────────────────────────────────────────────────────────────
export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** Paired bootstrap CI for mean(a-b) and for relative delta mean(a)/mean(b)-1. */
export function pairedBootstrap(
  a: number[],
  b: number[],
  iters = 10000,
  seed = 7,
): { deltaMean: number; ci95: [number, number]; relDelta: number; relCi95: [number, number]; pSignFlip: number } {
  const n = a.length;
  const rng = makeRng(seed);
  const deltas: number[] = [];
  const rels: number[] = [];
  let flips = 0;
  const baseDelta = mean(a) - mean(b);
  for (let it = 0; it < iters; it++) {
    let sa = 0,
      sb = 0;
    for (let i = 0; i < n; i++) {
      const j = rng.int(n);
      sa += a[j];
      sb += b[j];
    }
    const d = (sa - sb) / n;
    deltas.push(d);
    rels.push(sb === 0 ? 0 : sa / sb - 1);
    if (Math.sign(d) !== Math.sign(baseDelta)) flips++;
  }
  deltas.sort((x, y) => x - y);
  rels.sort((x, y) => x - y);
  const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  return {
    deltaMean: baseDelta,
    ci95: [q(deltas, 0.025), q(deltas, 0.975)],
    relDelta: mean(a) / mean(b) - 1,
    relCi95: [q(rels, 0.025), q(rels, 0.975)],
    pSignFlip: flips / iters,
  };
}
