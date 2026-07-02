#!/usr/bin/env tsx
/**
 * EXP I — Calibrate zipfEta against TWO empirical targets at once:
 *   (1) sales concentration: top-20% SKUs ≈ 60–75% of sales (online retail);
 *   (2) repeat-affinity: % of held-out purchases in the buyer's taste
 *       subcategories ≈ 40–60% (purchases must be partially predictable from
 *       history, or personalization has nothing to do).
 * For each eta: quick leak-free eval (800 cases) of pc-oracle / popular-global /
 * pc-real / e1-modes / knn — does ANY personalized signal survive in that world?
 */
import { sampleCatalog, type SynthProduct } from "@/thesis/data/catalog-model";
import { buildRelations } from "@/thesis/data/relations-model";
import { sampleBehavior, type ComplementsBySource } from "@/thesis/data/behavior-model";
import { buildUserModes } from "@/thesis/multivector/modes";
import { toSessionSequences, type EventRow } from "@/thesis/embedders/sessions";
import { trainProd2Vec } from "@/thesis/embedders/prod2vec";
import { ndcgAtK, hitRateAtK } from "@/thesis/eval/metrics";
import { buildPairCounts, buildNpmiTop, mean, type EvRow } from "./lib";

const N = 5000,
  USERS = 2000,
  DAYS = 90,
  SEED = 42,
  CAP = 800;
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

function topShare(values: number[], frac: number): number {
  const v = [...values].sort((a, b) => b - a);
  const sum = v.reduce((s, x) => s + x, 0);
  if (sum === 0) return 0;
  return v.slice(0, Math.max(1, Math.floor(v.length * frac))).reduce((s, x) => s + x, 0) / sum;
}
function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
function modeOfStr(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
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

const ETAS = process.env.ETAS ? process.env.ETAS.split(",").map(Number) : [0.3, 0.45, 0.6];
for (const eta of ETAS) {
  const out = sampleBehavior(
    catalog,
    { users: USERS, days: DAYS, seed: SEED, zipfS: 1.0, zipfEta: eta, priceGamma: 0.8, pGiftMax: 0.16, stochasticChoice: true },
    complementsBySource,
  );

  // diagnostics
  const buys = new Map<string, number>();
  for (const e of out.events) {
    if (e.event_type === "purchase") buys.set(e.product_id, (buys.get(e.product_id) ?? 0) + 1);
  }
  const counts = catalog.map((p) => buys.get(p.source_product_id) ?? 0);
  const taste = new Map(out.users.map((u) => [u.user_id, new Set(u.latent_state.tasteSubcategories)]));
  const testRows = out.holdout.filter((h) => h.split === "test");
  let inTasteTest = 0;
  for (const h of testRows) {
    if (taste.get(h.user_id)?.has(byId.get(h.product_id)?.attrs.subcategory ?? "")) inTasteTest++;
  }

  // leak-free artifacts
  const events: EvRow[] = out.events.map((e) => ({ sid: e.session_id, uid: e.user_id, et: e.event_type, pid: e.product_id, ts: e.occurred_at }));
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
  // VIEW history per user (train sessions only) — production-faithful profiles:
  // track-hook updates user modes on EVERY event, not just purchases. The
  // purchases-only history (~2.8 items) under-represents production.
  const viewsByUser = new Map<string, string[]>();
  for (const e of out.events) {
    if (e.event_type !== "product_view" || testSids.has(e.session_id)) continue;
    const a = viewsByUser.get(e.user_id) ?? [];
    if (!a.includes(e.product_id)) a.push(e.product_id);
    viewsByUser.set(e.user_id, a);
  }
  const npmiTrain = buildNpmiTop(buildPairCounts(events, testSids));
  const seqs: EventRow[] = events.filter((e) => !testSids.has(e.sid)).map((e) => ({ session_id: e.sid, product_id: e.pid, occurred_at: e.ts }));
  const e1raw = trainProd2Vec(toSessionSequences(seqs, 2), { dim: 64, epochs: 30, window: 3, negatives: 5, seed: SEED });
  const e1 = new Map<string, Float64Array>();
  for (const [id, v] of e1raw) e1.set(id, Float64Array.from(v));
  const commonIds = [...e1.keys()].sort((a, b) => a.localeCompare(b));
  const commonSet = new Set(commonIds);
  const globalPop = [...commonIds].sort((a, b) => (popTrain.get(b) ?? 0) - (popTrain.get(a) ?? 0) || a.localeCompare(b));

  // quick eval
  const sorted = [...testRows].sort((a, b) => a.user_id.localeCompare(b.user_id) || a.product_id.localeCompare(b.product_id));
  const NAMES = ["pc-oracle", "pop-global", "pc-real", "pc-views", "pc-views-multi", "e1-modes", "e1-views", "e1-views-pop", "knn"];
  const ndcg: Record<string, number[]> = Object.fromEntries(NAMES.map((n) => [n, []]));
  const hit: Record<string, number> = Object.fromEntries(NAMES.map((n) => [n, 0]));
  let nC = 0;
  for (const h of sorted) {
    if (nC >= CAP) break;
    const train = (trainByUser.get(h.user_id) ?? []).filter((id) => commonSet.has(id));
    if (train.length === 0 || !commonSet.has(h.product_id)) continue;
    nC++;
    const trainSet = new Set(train);
    const cands = commonIds.filter((id) => !trainSet.has(id));
    const rel = new Set([h.product_id]);

    const subOf = (id: string) => byId.get(id)?.attrs.subcategory ?? null;
    const oracleSub = subOf(h.product_id);
    const realSub = modeOfStr(train.map(subOf));
    const popRank = (sub: string | null): string[] => {
      const inC = cands.filter((id) => subOf(id) === sub);
      const outC = cands.filter((id) => subOf(id) !== sub);
      const byPop = (a: string, b: string) => (popTrain.get(b) ?? 0) - (popTrain.get(a) ?? 0) || a.localeCompare(b);
      return [...inC.sort(byPop), ...outC.sort(byPop)];
    };
    const rankByHistory = (hist: string[]): string[] => {
      const vecs = hist.filter((id) => e1.has(id)).map((id) => [...e1.get(id)!]);
      if (vecs.length === 0) return cands;
      const modes = buildUserModes(vecs, { distanceThreshold: 0.5, maxModes: 5 }).map((m) => Float64Array.from(m.medoid));
      return cands
        .map((id) => {
          const v = e1.get(id)!;
          let best = -2;
          for (const m of modes) {
            const s = dot(m, v);
            if (s > best) best = s;
          }
          return { id, s: best };
        })
        .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
        .map((x) => x.id);
    };
    const e1Rank = rankByHistory(train);
    const views = viewsByUser.get(h.user_id) ?? [];
    const e1ViewsRank = rankByHistory(views);

    // pc-views: popularity within the modal VIEWED subcategory (category
    // prediction from the rich view history, then popularity does the work).
    const viewedSubs = views.map(subOf);
    const pcViewsRank = popRank(modeOfStr(viewedSubs));

    // pc-views-multi: quota the top-10 across the user's top-3 viewed
    // subcategories (proportional to view share), popularity inside each.
    const subCounts = new Map<string, number>();
    for (const s of viewedSubs) if (s !== null) subCounts.set(s, (subCounts.get(s) ?? 0) + 1);
    const topSubs = [...subCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
    const byPopCmp = (a: string, b: string) => (popTrain.get(b) ?? 0) - (popTrain.get(a) ?? 0) || a.localeCompare(b);
    let pcMultiRank: string[];
    if (topSubs.length === 0) pcMultiRank = globalPop.filter((id) => !trainSet.has(id));
    else {
      const totalViews = topSubs.reduce((s, [, c]) => s + c, 0);
      const head: string[] = [];
      const used = new Set<string>();
      for (const [sub, c] of topSubs) {
        const quota = Math.max(1, Math.round((10 * c) / totalViews));
        for (const id of cands.filter((x) => subOf(x) === sub).sort(byPopCmp).slice(0, quota)) {
          if (!used.has(id)) {
            used.add(id);
            head.push(id);
          }
        }
      }
      const tail = cands.filter((id) => !used.has(id)).sort(byPopCmp);
      pcMultiRank = [...head, ...tail];
    }

    // e1-views-pop: the MINIMAL pipeline fix — cosine retrieval with a
    // multiplicative popularity prior (cosine is popularity-blind by itself).
    const viewVecs = views.filter((id) => e1.has(id)).map((id) => [...e1.get(id)!]);
    let e1ViewsPopRank: string[] = cands;
    if (viewVecs.length > 0) {
      const m2 = buildUserModes(viewVecs, { distanceThreshold: 0.5, maxModes: 5 }).map((m) => Float64Array.from(m.medoid));
      e1ViewsPopRank = cands
        .map((id) => {
          const v = e1.get(id)!;
          let best = -2;
          for (const m of m2) {
            const s = dot(m, v);
            if (s > best) best = s;
          }
          return { id, s: Math.max(0, best) * Math.log(2 + (popTrain.get(id) ?? 0)) };
        })
        .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
        .map((x) => x.id);
    }
    const knnScore = new Map<string, number>();
    for (const t of train) for (const nb of npmiTrain.get(t) ?? []) knnScore.set(nb.id, (knnScore.get(nb.id) ?? 0) + nb.score);
    const knnRank = cands
      .map((id) => ({ id, s: knnScore.get(id) ?? 0, p: popTrain.get(id) ?? 0 }))
      .sort((a, b) => b.s - a.s || b.p - a.p || a.id.localeCompare(b.id))
      .map((x) => x.id);

    const ranked: Record<string, string[]> = {
      "pc-oracle": popRank(oracleSub),
      "pop-global": globalPop.filter((id) => !trainSet.has(id)),
      "pc-real": popRank(realSub),
      "pc-views": pcViewsRank,
      "pc-views-multi": pcMultiRank,
      "e1-modes": e1Rank,
      "e1-views": e1ViewsRank,
      "e1-views-pop": e1ViewsPopRank,
      knn: knnRank,
    };
    for (const [name, r] of Object.entries(ranked)) {
      ndcg[name].push(ndcgAtK(r, rel, 10));
      hit[name] += hitRateAtK(r, rel, 10);
    }
  }

  console.log(
    `\neta=${eta}: top20%ventas=${(100 * topShare(counts, 0.2)).toFixed(0)}% | compras-test in-taste=${(100 * inTasteTest / Math.max(1, testRows.length)).toFixed(0)}% | casos=${nC} | t=${el()}`,
  );
  for (const name of Object.keys(ndcg)) {
    console.log(`  ${name.padEnd(10)} ndcg@10=${mean(ndcg[name]).toFixed(3)} hit@10=${(hit[name] / Math.max(1, nC)).toFixed(3)}`);
  }
}
