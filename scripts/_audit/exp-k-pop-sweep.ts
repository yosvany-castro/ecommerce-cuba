#!/usr/bin/env tsx
/**
 * EXP K — Can personalization beat plain popularity in the OFFICIAL v2 world?
 *
 * exp-I proved the pop-aware fixes at eta=0.3 (in-taste 32%); the official DB
 * calibration is eta=0.7, where popular-global is much stronger (0.044 in the
 * official v2-clean report). Nobody has measured the fixes there. This sweep:
 *
 *   - world: v2, zipfS=1.0, zipfEta=ETA (default 0.7 = official), priceGamma
 *     0.8, pGiftMax 0.16, stochastic choice — same knobs as the official chain;
 *   - artifacts: STRICTLY leak-free (train-session events only);
 *   - rankers built from the SHARED PRODUCTION MODULE
 *     (src/sectors/d-personalization/ranking/) so what we validate here is
 *     bit-the-same logic that ships in feed.ts;
 *   - grid: pc-views-multi (maxSubcats 2/3/4), e1-views-pop (strength 0.5/1/2),
 *     production-shaped RRF fusion; baselines pc-oracle / pop-global / pc-real /
 *     knn;
 *   - metrics: nDCG@10, hit@10, realizedRev@10; paired bootstrap CI95 of the
 *     champions vs pop-global AND pc-real.
 *
 * Protocol: tune on SEEDS=123, confirm untouched on SEEDS=42,7 (no peeking).
 * Honest by construction: numbers are reported whatever they say.
 */
import { writeFileSync } from "fs";
import { resolve } from "path";
import { sampleCatalog, type SynthProduct } from "@/thesis/data/catalog-model";
import { buildRelations } from "@/thesis/data/relations-model";
import { sampleBehavior, type ComplementsBySource } from "@/thesis/data/behavior-model";
import { buildUserModes } from "@/thesis/multivector/modes";
import { toSessionSequences, type EventRow } from "@/thesis/embedders/sessions";
import { trainProd2Vec } from "@/thesis/embedders/prod2vec";
import { ndcgAtK, hitRateAtK } from "@/thesis/eval/metrics";
import { rrfFuse, type RankedList } from "@/sectors/d-personalization/retrieve/rrf";
import { applyPopularityPrior } from "@/sectors/d-personalization/ranking/pop-prior";
import {
  predictTopSubcategories,
  rankByViewedCategoriesQuota,
} from "@/sectors/d-personalization/ranking/views-categories";
import { buildPairCounts, buildNpmiTop, mean, pairedBootstrap, type EvRow } from "./lib";

const N = 5000,
  USERS = 2000,
  DAYS = 90;
const ETA = process.env.ETA ? Number(process.env.ETA) : 0.7;
const CAP = process.env.CAP ? Number(process.env.CAP) : 4000;
const SEEDS = (process.env.SEEDS ?? "123").split(",").map(Number);

const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const OUT: string[] = [];
const log = (s: string) => {
  console.log(s);
  OUT.push(s);
};

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
function modeOfStr(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null,
    bc = 0;
  for (const [v, c] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (c > bc) {
      best = v;
      bc = c;
    }
  }
  return best;
}

for (const SEED of SEEDS) {
  log(`\n━━━ exp-K world: n=${N} users=${USERS} eta=${ETA} seed=${SEED} ━━━ t=${el()}`);
  const catalog = sampleCatalog(N, SEED);
  const byId = new Map<string, SynthProduct>(catalog.map((p) => [p.source_product_id, p]));
  const complementsBySource: ComplementsBySource = (() => {
    const map = new Map<string, string[]>();
    for (const rel of buildRelations(catalog)) {
      if (rel.relation_type !== "complement") continue;
      const arr = map.get(rel.product_a_id) ?? [];
      arr.push(rel.product_b_id);
      map.set(rel.product_a_id, arr);
    }
    return map;
  })();
  const out = sampleBehavior(
    catalog,
    {
      users: USERS,
      days: DAYS,
      seed: SEED,
      zipfS: 1.0,
      zipfEta: ETA,
      priceGamma: 0.8,
      pGiftMax: 0.16,
      stochasticChoice: true,
    },
    complementsBySource,
  );
  log(`  generado: events=${out.events.length} t=${el()}`);

  // ── Leak-free artifacts (train sessions only). ────────────────────────────
  const testRows = out.holdout.filter((h) => h.split === "test");
  const pSid = new Map<string, string>();
  for (const e of out.events) {
    if (e.event_type === "purchase") pSid.set(`${e.user_id}|${e.product_id}|${e.occurred_at}`, e.session_id);
  }
  const testSids = new Set<string>();
  for (const h of testRows) {
    const sid = pSid.get(`${h.user_id}|${h.product_id}|${h.occurred_at}`);
    if (sid) testSids.add(sid);
  }
  const trainByUser = new Map<string, string[]>();
  for (const h of out.holdout) {
    if (h.split !== "train") continue;
    const a = trainByUser.get(h.user_id) ?? [];
    a.push(h.product_id);
    trainByUser.set(h.user_id, a);
  }
  const popTrain = new Map<string, number>();
  for (const e of out.events) {
    if (!testSids.has(e.session_id)) popTrain.set(e.product_id, (popTrain.get(e.product_id) ?? 0) + 1);
  }
  const viewsByUser = new Map<string, string[]>();
  for (const e of out.events) {
    if (e.event_type !== "product_view" || testSids.has(e.session_id)) continue;
    const a = viewsByUser.get(e.user_id) ?? [];
    if (!a.includes(e.product_id)) a.push(e.product_id);
    viewsByUser.set(e.user_id, a);
  }
  // Pre-purchase prefix views of each test purchase's session — the HONEST
  // serve-time context (the user is browsing right now; the purchase hasn't
  // happened). Mirrors unified-cases --clean prefixViews exactly: views of the
  // test session strictly before the purchase ts, excluding the test pid.
  const viewsBySession = new Map<string, { pid: string; ts: string }[]>();
  for (const e of out.events) {
    if (e.event_type !== "product_view") continue;
    const a = viewsBySession.get(e.session_id) ?? [];
    a.push({ pid: e.product_id, ts: e.occurred_at });
    viewsBySession.set(e.session_id, a);
  }
  const prefixViews = new Map<string, string[]>(); // `${uid}|${pid}` -> ordered view pids
  for (const h of testRows) {
    const sid = pSid.get(`${h.user_id}|${h.product_id}|${h.occurred_at}`);
    if (!sid) continue;
    const vs: string[] = [];
    for (const v of viewsBySession.get(sid) ?? []) {
      if (v.ts >= h.occurred_at || v.pid === h.product_id) continue;
      if (!vs.includes(v.pid)) vs.push(v.pid);
    }
    prefixViews.set(`${h.user_id}|${h.product_id}`, vs);
  }
  const events: EvRow[] = out.events.map((e) => ({
    sid: e.session_id,
    uid: e.user_id,
    et: e.event_type,
    pid: e.product_id,
    ts: e.occurred_at,
  }));
  const npmiTrain = buildNpmiTop(buildPairCounts(events, testSids));
  const seqs: EventRow[] = events
    .filter((e) => !testSids.has(e.sid))
    .map((e) => ({ session_id: e.sid, product_id: e.pid, occurred_at: e.ts }));
  const e1raw = trainProd2Vec(toSessionSequences(seqs, 2), {
    dim: 64,
    epochs: 30,
    window: 3,
    negatives: 5,
    seed: SEED,
  });
  const e1 = new Map<string, Float64Array>();
  for (const [id, v] of e1raw) e1.set(id, Float64Array.from(v));
  const commonIds = [...e1.keys()].sort((a, b) => a.localeCompare(b));
  const commonSet = new Set(commonIds);
  const globalPop = [...commonIds].sort(
    (a, b) => (popTrain.get(b) ?? 0) - (popTrain.get(a) ?? 0) || a.localeCompare(b),
  );
  log(`  artefactos limpios: npmi=${npmiTrain.size} e1=${e1.size} t=${el()}`);

  // ── Eval loop. ─────────────────────────────────────────────────────────────
  const subOf = (id: string) => byId.get(id)?.attrs.subcategory ?? null;
  const popOf = (id: string) => popTrain.get(id) ?? 0;
  const NAMES = [
    "pc-oracle",
    "pop-global",
    "pc-real",
    "knn",
    "pc-views-multi-k2",
    "pc-views-multi-k3",
    "pc-views-multi-k4",
    "e1-views-pop-s05",
    "e1-views-pop-s1",
    "e1-views-pop-s2",
    "feed-rrf",
    "feed-rrf-lite",
    "pc-sess-k3",
    "pc-sess3h1-k3",
    "pc-sess3h1-k4",
    "pc-sess5h1-k3",
    "pc-sess3h1rec-k4",
    "rrf-sess-pop",
  ] as const;
  const ndcg: Record<string, number[]> = Object.fromEntries(NAMES.map((n) => [n, []]));
  const hit: Record<string, number> = Object.fromEntries(NAMES.map((n) => [n, 0]));
  const rev: Record<string, number> = Object.fromEntries(NAMES.map((n) => [n, 0]));
  let nC = 0;

  const sorted = [...testRows].sort(
    (a, b) => a.user_id.localeCompare(b.user_id) || a.product_id.localeCompare(b.product_id),
  );
  for (const h of sorted) {
    if (nC >= CAP) break;
    const train = (trainByUser.get(h.user_id) ?? []).filter((id) => commonSet.has(id));
    if (train.length === 0 || !commonSet.has(h.product_id)) continue;
    nC++;
    const trainSet = new Set(train);
    const cands = commonIds.filter((id) => !trainSet.has(id));
    const rel = new Set([h.product_id]);
    const realizedRev = (byId.get(h.product_id)?.price_cents ?? 0) * (byId.get(h.product_id)?.margin_pct ?? 0);

    const popRank = (sub: string | null): string[] => {
      const inC = cands.filter((id) => subOf(id) === sub);
      const outC = cands.filter((id) => subOf(id) !== sub);
      const byPop = (a: string, b: string) => popOf(b) - popOf(a) || a.localeCompare(b);
      return [...inC.sort(byPop), ...outC.sort(byPop)];
    };

    const views = viewsByUser.get(h.user_id) ?? [];
    const viewedSubs = views.map(subOf);

    // pc-views-multi family — SHARED MODULE.
    const pcvm = (k: number): string[] =>
      rankByViewedCategoriesQuota({
        topSubcategories: predictTopSubcategories(viewedSubs, k),
        candidates: cands,
        subcategoryOf: subOf,
        popOf,
        headSize: 10,
      });

    // e1-views-pop family — views-modes cosine + SHARED pop prior.
    const viewVecs = views.filter((id) => e1.has(id)).map((id) => [...e1.get(id)!]);
    const modes =
      viewVecs.length > 0
        ? buildUserModes(viewVecs, { distanceThreshold: 0.5, maxModes: 5 }).map((m) =>
            Float64Array.from(m.medoid),
          )
        : [];
    const cosBest = (id: string): number => {
      if (modes.length === 0) return 0;
      const v = e1.get(id)!;
      let best = -2;
      for (const m of modes) {
        const s = dot(m, v);
        if (s > best) best = s;
      }
      return best;
    };
    const scored = cands.map((id) => ({ id, score: cosBest(id) }));
    const e1vp = (strength: number): string[] =>
      applyPopularityPrior(scored, popOf, strength).map((x) => x.id);

    // knn (NPMI item-kNN over train purchases).
    const knnScore = new Map<string, number>();
    for (const t of train) for (const nb of npmiTrain.get(t) ?? []) knnScore.set(nb.id, (knnScore.get(nb.id) ?? 0) + nb.score);
    const knnRank = cands
      .map((id) => ({ id, s: knnScore.get(id) ?? 0, p: popOf(id) }))
      .sort((a, b) => b.s - a.s || b.p - a.p || a.id.localeCompare(b.id))
      .map((x) => x.id);

    // feed-rrf — the production shape: RRF(views-modes-pop top50, npmi top30,
    // views-categories top20), popularity tail. feed-rrf-lite drops npmi.
    const e1vpList = e1vp(1).slice(0, 50);
    const pcvmK3 = pcvm(3);
    const fuse = (lists: RankedList[]): string[] => {
      const fused = rrfFuse(lists)
        .sort((a, b) => b.rrf_score - a.rrf_score || a.id.localeCompare(b.id))
        .map((x) => x.id);
      const inFused = new Set(fused);
      const tail = cands
        .filter((id) => !inFused.has(id))
        .sort((a, b) => popOf(b) - popOf(a) || a.localeCompare(b));
      return [...fused, ...tail];
    };
    const toList = (source: string, ids: string[]): RankedList => ({
      source,
      items: ids.map((id, i) => ({ id, rank: i + 1 })),
    });
    const feedRrf = fuse([
      toList("modes", e1vpList),
      toList("cooccurrence", knnRank.slice(0, 30)),
      toList("views-categories", pcvmK3.slice(0, 20)),
    ]);
    const feedRrfLite = fuse([toList("modes", e1vpList), toList("views-categories", pcvmK3.slice(0, 20))]);

    // Session-aware family: the pre-purchase prefix views of the CURRENT
    // session (honest serve-time context) reveal today's intent subcategory;
    // blended with the historical views at weight w (session counts ×w).
    const sessViews = prefixViews.get(`${h.user_id}|${h.product_id}`) ?? [];
    const sessSubs = sessViews.map(subOf);
    const blend = (w: number): (string | null)[] => {
      const reps: (string | null)[] = [...viewedSubs];
      for (let i = 0; i < w; i++) reps.push(...sessSubs);
      return reps;
    };
    const pcSess = (subs: (string | null)[], k: number): string[] =>
      rankByViewedCategoriesQuota({
        topSubcategories: predictTopSubcategories(subs, k),
        candidates: cands,
        subcategoryOf: subOf,
        popOf,
        headSize: 10,
      });

    const ranked: Record<string, string[]> = {
      "pc-oracle": popRank(subOf(h.product_id)),
      "pop-global": globalPop.filter((id) => !trainSet.has(id)),
      "pc-real": popRank(modeOfStr(train.map(subOf))),
      knn: knnRank,
      "pc-views-multi-k2": pcvm(2),
      "pc-views-multi-k3": pcvmK3,
      "pc-views-multi-k4": pcvm(4),
      "e1-views-pop-s05": e1vp(0.5),
      "e1-views-pop-s1": e1vp(1),
      "e1-views-pop-s2": e1vp(2),
      "feed-rrf": feedRrf,
      "feed-rrf-lite": feedRrfLite,
      // session-only (historical fallback when the prefix is empty)
      "pc-sess-k3": pcSess(sessSubs.length > 0 ? sessSubs : viewedSubs, 3),
      "pc-sess3h1-k3": pcSess(blend(3), 3),
      "pc-sess3h1-k4": pcSess(blend(3), 4),
      "pc-sess5h1-k3": pcSess(blend(5), 3),
      // recency: the last 30 historical views count double (recent browsing is
      // more predictive of the next purchase's subcategory than old browsing).
      "pc-sess3h1rec-k4": pcSess(
        [...blend(3), ...viewedSubs.slice(-30)],
        4,
      ),
      // ensemble: RRF of the session champion's head with the global-popular
      // head — when the subcategory prediction misses, popularity rescues slots.
      "rrf-sess-pop": (() => {
        const sessHead = pcSess(blend(3), 4).slice(0, 20);
        const popHead = globalPop.filter((id) => !trainSet.has(id)).slice(0, 20);
        const fused = rrfFuse([
          { source: "sess", items: sessHead.map((id, i) => ({ id, rank: i + 1 })) },
          { source: "pop", items: popHead.map((id, i) => ({ id, rank: i + 1 })) },
        ])
          .sort((a, b) => b.rrf_score - a.rrf_score || a.id.localeCompare(b.id))
          .map((x) => x.id);
        const inFused = new Set(fused);
        const tail = cands
          .filter((id) => !inFused.has(id))
          .sort((a, b) => popOf(b) - popOf(a) || a.localeCompare(b));
        return [...fused, ...tail];
      })(),
    };
    for (const [name, r] of Object.entries(ranked)) {
      ndcg[name].push(ndcgAtK(r, rel, 10));
      const h10 = hitRateAtK(r, rel, 10);
      hit[name] += h10;
      rev[name] += h10 * realizedRev;
    }
  }

  log(`  casos=${nC} t=${el()}`);
  log(`  RANKER              ndcg@10  hit@10  realizedRev@10(¢)`);
  for (const name of NAMES) {
    log(
      `  ${name.padEnd(18)} ${mean(ndcg[name]).toFixed(4)}   ${(hit[name] / Math.max(1, nC)).toFixed(3)}   ${(rev[name] / Math.max(1, nC)).toFixed(0)}`,
    );
  }
  for (const champ of [
    "pc-views-multi-k3",
    "pc-sess3h1-k3",
    "pc-sess3h1-k4",
    "pc-sess3h1rec-k4",
    "rrf-sess-pop",
  ]) {
    for (const base of ["pop-global", "pc-real"]) {
      const bs = pairedBootstrap(ndcg[champ], ndcg[base], 10000, 7);
      log(
        `  Δndcg10 ${champ} vs ${base}: rel=${(100 * bs.relDelta).toFixed(1)}% CI95=[${(100 * bs.relCi95[0]).toFixed(1)}%, ${(100 * bs.relCi95[1]).toFixed(1)}%] pFlip=${bs.pSignFlip.toFixed(4)}`,
      );
    }
  }
}

writeFileSync(resolve(process.cwd(), "scripts/_audit/exp-k-results.txt"), OUT.join("\n") + "\n");
log(`\n[k] DONE t=${el()}`);
