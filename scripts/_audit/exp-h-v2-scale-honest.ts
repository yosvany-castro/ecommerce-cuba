#!/usr/bin/env tsx
/**
 * EXP H — The HONEST scale table: simulator v2 (calibrated realism) + leak-free
 * artifacts + realized revenue, at n=2000/5000/10000 (users ∝ n, days=90, seed=42).
 *
 * World: zipfS=1.0, zipfEta=0.7 (top-20% ≈ 70% of sales ≈ Brynjolfsson 72/28),
 * priceGamma=0.8 (MNL-style conversion elasticity), pGiftMax=0.16 (≈8% gift),
 * stochasticChoice (Plackett–Luce) — a world where popularity baselines have
 * REAL signal and pushing expensive items costs conversion.
 *
 * Evaluation: train-only NPMI graph + train-only popularity + train-only
 * prod2vec + pre-purchase prefix anchor (global-timeline discipline, Ji et al.
 * TOIS 2023). Rankers:
 *   pc-oracle   popularity within the TEST item's subcategory (navigation ceiling)
 *   pc-real     popularity within the modal TRAIN subcategory (realistic naive store)
 *   e1-modes    max-cosine to PinnerSage modes over clean prod2vec
 *   knn-clean   item-kNN over the clean NPMI graph (train items + prefix anchor)
 *   fusion-v2   RRF(e1-modes top-80, knn top-50, pc-real top-40, npmi-prefix top-50) + pc-real tail
 *
 * Metrics: nDCG@10, Hit@10, and REALIZED revenue@10 = price×margin of the
 * held-out purchase actually captured in the top-10 (not the self-referential
 * expected-revenue of F4 — a ranker can only "earn" what the user truly bought).
 * Paired bootstrap CI95 for the key deltas.
 */
import { writeFileSync } from "fs";
import { resolve } from "path";
import { sampleCatalog, type SynthProduct } from "@/thesis/data/catalog-model";
import { buildRelations } from "@/thesis/data/relations-model";
import { sampleBehavior, type ComplementsBySource } from "@/thesis/data/behavior-model";
import { buildUserModes } from "@/thesis/multivector/modes";
import { popularCohortRanker } from "@/thesis/eval/baselines";
import { rrfFuse, type RankedList } from "@/sectors/d-personalization/retrieve/rrf";
import { toSessionSequences, type EventRow } from "@/thesis/embedders/sessions";
import { trainProd2Vec } from "@/thesis/embedders/prod2vec";
import { ndcgAtK, hitRateAtK } from "@/thesis/eval/metrics";
import { buildPairCounts, buildNpmiTop, pairedBootstrap, mean, type EvRow } from "./lib";
import type { RankItem, UserContext } from "@/thesis/types";

const V2 = { zipfS: 1.0, zipfEta: 0.7, priceGamma: 0.8, pGiftMax: 0.16, stochasticChoice: true } as const;
const SCALES = [
  { n: 2000, users: 800 },
  { n: 5000, users: 2000 },
  { n: 10000, users: 4000 },
];
const DAYS = 90;
const SEED = 42;
const CASE_CAP = 1500;

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const OUT: string[] = [];
const log = (s: string) => {
  console.log(s);
  OUT.push(s);
};

function modeOfStr(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v === null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
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

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

for (const sc of SCALES) {
  log(`\n━━━ v2 n=${sc.n} users=${sc.users} seed=${SEED} ━━━ t=${elapsed()}`);
  const catalog = sampleCatalog(sc.n, SEED);
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
  const out = sampleBehavior(catalog, { users: sc.users, days: DAYS, seed: SEED, ...V2 }, complementsBySource);
  log(`  generado: events=${out.events.length} t=${elapsed()}`);

  // ── indexes ────────────────────────────────────────────────────────────────
  const events: EvRow[] = out.events.map((e) => ({
    sid: e.session_id,
    uid: e.user_id,
    et: e.event_type,
    pid: e.product_id,
    ts: e.occurred_at,
  }));
  const purchaseKeyToSid = new Map<string, string>();
  for (const e of out.events) {
    if (e.event_type === "purchase")
      purchaseKeyToSid.set(`${e.user_id}|${e.product_id}|${e.occurred_at}`, e.session_id);
  }
  const testRowsRaw = out.holdout.filter((h) => h.split === "test");
  const testSessionIds = new Set<string>();
  const testSidByCase = new Map<string, { sid: string; pts: string }>();
  for (const h of testRowsRaw) {
    const sid = purchaseKeyToSid.get(`${h.user_id}|${h.product_id}|${h.occurred_at}`);
    if (sid) {
      testSessionIds.add(sid);
      testSidByCase.set(`${h.user_id}|${h.product_id}`, { sid, pts: h.occurred_at });
    }
  }
  const trainByUser = new Map<string, string[]>();
  for (const h of out.holdout) {
    if (h.split !== "train") continue;
    const a = trainByUser.get(h.user_id) ?? [];
    a.push(h.product_id);
    trainByUser.set(h.user_id, a);
  }

  // train-only popularity + last train view + per-session views
  const popTrain = new Map<string, number>();
  const lastViewedTrain = new Map<string, string>();
  const viewsBySession = new Map<string, { pid: string; ts: string }[]>();
  for (const e of out.events) {
    if (!testSessionIds.has(e.session_id))
      popTrain.set(e.product_id, (popTrain.get(e.product_id) ?? 0) + 1);
    if (e.event_type !== "product_view") continue;
    if (!testSessionIds.has(e.session_id)) lastViewedTrain.set(e.user_id, e.product_id);
    const a = viewsBySession.get(e.session_id) ?? [];
    a.push({ pid: e.product_id, ts: e.occurred_at });
    viewsBySession.set(e.session_id, a);
  }

  // clean artifacts
  const npmiTrain = buildNpmiTop(buildPairCounts(events, testSessionIds));
  const trainSeqRows: EventRow[] = events
    .filter((e) => !testSessionIds.has(e.sid))
    .map((e) => ({ session_id: e.sid, product_id: e.pid, occurred_at: e.ts }));
  const e1raw = trainProd2Vec(toSessionSequences(trainSeqRows, 2), {
    dim: 64,
    epochs: 30,
    window: 3,
    negatives: 5,
    seed: SEED,
  });
  const e1 = new Map<string, Float64Array>();
  for (const [id, v] of e1raw) e1.set(id, Float64Array.from(v));
  log(`  artefactos limpios: npmi=${npmiTrain.size} e1=${e1.size} t=${elapsed()}`);

  const commonIds = [...e1.keys()].sort((a, b) => a.localeCompare(b));
  const commonSet = new Set(commonIds);

  // ── cases (sorted by uid|pid like the official loader; capped) ────────────
  const sortedTests = [...testRowsRaw].sort(
    (a, b) => a.user_id.localeCompare(b.user_id) || a.product_id.localeCompare(b.product_id),
  );
  interface HCase {
    uid: string;
    pid: string;
    train: string[];
    prefixAnchor: string | null;
    candIds: string[];
    candidates: RankItem[];
    ctxOracle: UserContext;
    ctxReal: UserContext;
    realizedRev: number; // price×margin of the held-out purchase
  }
  const cases: HCase[] = [];
  for (const h of sortedTests) {
    if (cases.length >= CASE_CAP) break;
    const train = (trainByUser.get(h.user_id) ?? []).filter((id) => commonSet.has(id));
    if (train.length === 0 || !commonSet.has(h.product_id)) continue;
    const trainSet = new Set(train);
    const key = `${h.user_id}|${h.product_id}`;
    const tinfo = testSidByCase.get(key);
    // prefix anchor: last view in the test session strictly before the purchase,
    // excluding the held-out product; fallback to last train-session view.
    let anchor: string | null = lastViewedTrain.get(h.user_id) ?? null;
    if (tinfo) {
      const vs = (viewsBySession.get(tinfo.sid) ?? [])
        .filter((v) => v.ts < tinfo.pts && v.pid !== h.product_id)
        .sort((a, b) => a.ts.localeCompare(b.ts));
      if (vs.length > 0) anchor = vs[vs.length - 1].pid;
    }
    const candIds = commonIds.filter((id) => !trainSet.has(id));
    const candidates: RankItem[] = candIds.map((id) => ({
      id,
      popularity: popTrain.get(id) ?? 0,
      vector: [],
      cohort: byId.get(id)?.attrs.subcategory ?? null,
    }));
    const prod = byId.get(h.product_id)!;
    cases.push({
      uid: h.user_id,
      pid: h.product_id,
      train,
      prefixAnchor: anchor,
      candIds,
      candidates,
      ctxOracle: { userVector: [], cohort: prod.attrs.subcategory },
      ctxReal: {
        userVector: [],
        cohort: modeOfStr(train.map((id) => byId.get(id)?.attrs.subcategory ?? null)),
      },
      realizedRev: prod.price_cents * prod.margin_pct,
    });
  }
  log(`  casos=${cases.length} (de ${testRowsRaw.length} test rows) t=${elapsed()}`);

  // ── rankers ────────────────────────────────────────────────────────────────
  const modesOf = (c: HCase): Float64Array[] =>
    buildUserModes(
      c.train.map((id) => [...e1.get(id)!]),
      { distanceThreshold: 0.5, maxModes: 5 },
    ).map((m) => Float64Array.from(m.medoid));

  const rankByModes = (c: HCase, modes: Float64Array[]): string[] =>
    c.candIds
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

  const rankKnn = (c: HCase): string[] => {
    const score = new Map<string, number>();
    for (const t of c.train)
      for (const nb of npmiTrain.get(t) ?? []) score.set(nb.id, (score.get(nb.id) ?? 0) + nb.score);
    if (c.prefixAnchor)
      for (const nb of npmiTrain.get(c.prefixAnchor) ?? [])
        score.set(nb.id, (score.get(nb.id) ?? 0) + nb.score);
    return c.candIds
      .map((id) => ({ id, s: score.get(id) ?? 0, pop: popTrain.get(id) ?? 0 }))
      .sort((a, b) => b.s - a.s || b.pop - a.pop || a.id.localeCompare(b.id))
      .map((x) => x.id);
  };

  const rankFusion = (c: HCase, modes: Float64Array[]): string[] => {
    const trainSet = new Set(c.train);
    const retrieval = rankByModes(c, modes).slice(0, 80);
    const knn = rankKnn(c).slice(0, 50);
    const popReal = c.candIds
      .filter((id) => (byId.get(id)?.attrs.subcategory ?? null) === c.ctxReal.cohort)
      .sort((a, b) => (popTrain.get(b) ?? 0) - (popTrain.get(a) ?? 0) || a.localeCompare(b))
      .slice(0, 40);
    const npmiPrefix = (c.prefixAnchor ? (npmiTrain.get(c.prefixAnchor) ?? []) : [])
      .map((nb) => nb.id)
      .filter((id) => commonSet.has(id) && !trainSet.has(id))
      .slice(0, 50);
    const lists: RankedList[] = [
      { source: "retrieval", items: retrieval.map((id, i) => ({ id, rank: i + 1 })) },
      { source: "knn", items: knn.map((id, i) => ({ id, rank: i + 1 })) },
      { source: "popular", items: popReal.map((id, i) => ({ id, rank: i + 1 })) },
      { source: "npmi", items: npmiPrefix.map((id, i) => ({ id, rank: i + 1 })) },
    ];
    const fused = rrfFuse(lists).slice(0, 200).map((f) => f.id);
    const fusedSet = new Set(fused);
    const tail = popularCohortRanker().rank(
      c.ctxReal,
      c.candidates.filter((x) => !fusedSet.has(x.id)),
    );
    const seen = new Set<string>();
    const outIds: string[] = [];
    for (const id of [...fused, ...tail]) {
      if (!seen.has(id)) {
        seen.add(id);
        outIds.push(id);
      }
    }
    for (const id of c.candIds) if (!seen.has(id)) outIds.push(id);
    return outIds;
  };

  const rankers: Record<string, (c: HCase) => string[]> = {
    "pc-oracle": (c) => popularCohortRanker().rank(c.ctxOracle, c.candidates),
    "pc-real": (c) => popularCohortRanker().rank(c.ctxReal, c.candidates),
    "e1-modes": (c) => rankByModes(c, modesOf(c)),
    "knn-clean": (c) => rankKnn(c),
    "fusion-v2": (c) => rankFusion(c, modesOf(c)),
  };

  // ── evaluate ───────────────────────────────────────────────────────────────
  const ndcg: Record<string, number[]> = {};
  const hit: Record<string, number> = {};
  const rev: Record<string, number> = {};
  for (const name of Object.keys(rankers)) {
    ndcg[name] = [];
    hit[name] = 0;
    rev[name] = 0;
  }
  let done = 0;
  for (const c of cases) {
    const rel = new Set([c.pid]);
    for (const [name, fn] of Object.entries(rankers)) {
      const ranked = fn(c);
      ndcg[name].push(ndcgAtK(ranked, rel, 10));
      const h10 = hitRateAtK(ranked, rel, 10);
      hit[name] += h10;
      rev[name] += h10 * c.realizedRev; // realized: only what the user truly bought
    }
    done++;
    if (done % 500 === 0) console.log(`  ${done}/${cases.length} t=${elapsed()}`);
  }
  const nC = cases.length;
  log(`  RANKER          ndcg@10  hit@10  realizedRev@10(¢)`);
  for (const name of Object.keys(rankers)) {
    log(
      `  ${name.padEnd(14)} ${mean(ndcg[name]).toFixed(3)}    ${(hit[name] / nC).toFixed(3)}   ${(rev[name] / nC).toFixed(0)}`,
    );
  }
  for (const [a, b] of [
    ["fusion-v2", "pc-real"],
    ["fusion-v2", "pc-oracle"],
    ["e1-modes", "pc-real"],
  ] as const) {
    const bs = pairedBootstrap(ndcg[a], ndcg[b], 5000, 7);
    log(
      `  Δndcg10 ${a} vs ${b}: rel=${(100 * bs.relDelta).toFixed(1)}% CI95=[${(100 * bs.relCi95[0]).toFixed(1)}%, ${(100 * bs.relCi95[1]).toFixed(1)}%]`,
    );
  }
}

writeFileSync(resolve(process.cwd(), "scripts/_audit/exp-h-results.txt"), OUT.join("\n") + "\n");
log(`\n[h] DONE t=${elapsed()}`);
