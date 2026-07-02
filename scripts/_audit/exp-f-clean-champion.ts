#!/usr/bin/env tsx
/**
 * AUDIT EXP F — Can a LEAK-FREE configuration actually beat the clean baseline?
 *
 * All rankers here use ONLY information available at serve time:
 *   - E0 text embeddings (product text → no session leakage by construction)
 *   - train-only co-occurrence graph (test sessions excluded)
 *   - train-only popularity
 *   - serve context = pre-purchase session prefix
 *
 * Rankers:
 *   pc-oracle       popular-cohort, cohort = TEST item's subcategory (their frame)
 *   pc-real         popular-cohort, cohort = modal TRAIN subcategory (realistic)
 *   text-mean       cosine(E0 mean of train, E0 item)
 *   text-mean-ctr   same but corpus-MEAN-CENTERED then renormalized (isotropy fix)
 *   text-modes      max-cosine to E0 train modes (PinnerSage on text)
 *   knn-clean       item-kNN over train-only NPMI (train items + prefix anchor)
 *   e1-clean-modes  max-cosine to retrained-prod2vec train modes (behaviour-only ref)
 *   fusion-v2       RRF(text-modes, knn-clean, pop-cohort-train, prefix-npmi) + PC tail
 *
 * Metrics: nDCG@10 / Recall@10 / MRR + paired bootstrap vs pc-oracle (clean).
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import {
  loadData,
  buildPairCounts,
  buildNpmiTop,
  pairedBootstrap,
  mean,
  type Data,
} from "./lib";
import { ndcgAtK, recallAtK, mrr } from "@/thesis/eval/metrics";
import { buildUserModes } from "@/thesis/multivector/modes";
import { popularCohortRanker } from "@/thesis/eval/baselines";
import { rrfFuse, type RankedList } from "@/sectors/d-personalization/retrieve/rrf";
import { toSessionSequences, type EventRow } from "@/thesis/embedders/sessions";
import { trainProd2Vec } from "@/thesis/embedders/prod2vec";
import type { RankItem, UserContext } from "@/thesis/types";

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const OUT: string[] = [];
const log = (s: string) => {
  console.log(s);
  OUT.push(s);
};

const d: Data = loadData();

// ── E0 text vectors as Float64Array (speed) ───────────────────────────────────
const e0raw = JSON.parse(
  readFileSync(resolve(process.cwd(), "scripts/_audit/data/item_vectors_e0.json"), "utf8"),
) as { id: string; v: number[] }[];
const E0DIM = e0raw[0].v.length;
const e0 = new Map<string, Float64Array>();
for (const r of e0raw) {
  const a = Float64Array.from(r.v);
  let n = 0;
  for (let i = 0; i < a.length; i++) n += a[i] * a[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < a.length; i++) a[i] /= n;
  e0.set(r.id, a);
}
log(`[f] E0: ${e0.size} vectors dim=${E0DIM} (L2-normalized) t=${elapsed()}`);

// corpus mean-centered variant (isotropy fix: remove the common-cone component)
const corpusMean = new Float64Array(E0DIM);
for (const v of e0.values()) for (let i = 0; i < E0DIM; i++) corpusMean[i] += v[i];
for (let i = 0; i < E0DIM; i++) corpusMean[i] /= e0.size;
const e0c = new Map<string, Float64Array>();
for (const [id, v] of e0) {
  const a = new Float64Array(E0DIM);
  let n = 0;
  for (let i = 0; i < E0DIM; i++) {
    a[i] = v[i] - corpusMean[i];
    n += a[i] * a[i];
  }
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < E0DIM; i++) a[i] /= n;
  e0c.set(id, a);
}
{
  // diagnostic: mean pairwise cosine of 200 random-ish pairs, raw vs centered
  const ids = [...e0.keys()];
  let rawSum = 0,
    ctrSum = 0,
    cnt = 0;
  for (let i = 0; i < 200; i++) {
    const a = ids[(i * 13) % ids.length];
    const b = ids[(i * 13 + 7) % ids.length];
    if (a === b) continue;
    const va = e0.get(a)!,
      vb = e0.get(b)!,
      ca = e0c.get(a)!,
      cb = e0c.get(b)!;
    let s1 = 0,
      s2 = 0;
    for (let k = 0; k < E0DIM; k++) {
      s1 += va[k] * vb[k];
      s2 += ca[k] * cb[k];
    }
    rawSum += s1;
    ctrSum += s2;
    cnt++;
  }
  log(
    `[f] anisotropía E0: cosine medio de pares aleatorios RAW=${(rawSum / cnt).toFixed(3)} vs CENTERED=${(ctrSum / cnt).toFixed(3)} (isótropo ideal ≈ 0)`,
  );
}

// ── Clean artifacts ───────────────────────────────────────────────────────────
const npmiTrain = buildNpmiTop(buildPairCounts(d.events, d.testSessionIds));
const popTrain = d.popTrain;
const trainRows: EventRow[] = d.events
  .filter((ev) => !d.testSessionIds.has(ev.sid))
  .map((ev) => ({ session_id: ev.sid, product_id: ev.pid, occurred_at: ev.ts }));
const e1Clean = trainProd2Vec(toSessionSequences(trainRows, 2), {
  dim: 64,
  epochs: 30,
  window: 3,
  negatives: 5,
  seed: 42,
});
log(`[f] artefactos limpios listos (npmi=${npmiTrain.size}, e1=${e1Clean.size}) t=${elapsed()}`);

// universe: products with E0 (all 5000); candidates need popularity + cohort
const commonIds = [...e0.keys()].filter((id) => d.meta.has(id)).sort((a, b) => a.localeCompare(b));
const commonSet = new Set(commonIds);

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

// per-case scaffold
interface FCase {
  uid: string;
  pid: string;
  train: string[];
  prefixAnchor: string | null;
  candIds: string[]; // commonIds minus train
  candidates: RankItem[]; // for PC (popularity=popTrain, cohort)
  ctxOracle: UserContext;
  ctxReal: UserContext;
}

const LIMIT = process.env.FCASES ? parseInt(process.env.FCASES, 10) : 1200;
const fcases: FCase[] = [];
for (const t of d.testRows) {
  if (fcases.length >= LIMIT) break;
  const key = `${t.uid}|${t.pid}`;
  const train = (d.trainByUser.get(t.uid) ?? []).filter((id) => commonSet.has(id));
  if (train.length === 0 || !commonSet.has(t.pid)) continue;
  const trainSet = new Set(train);
  const candIds = commonIds.filter((id) => !trainSet.has(id));
  const candidates: RankItem[] = candIds.map((id) => ({
    id,
    popularity: popTrain.get(id) ?? 0,
    vector: [],
    cohort: d.meta.get(id)?.cohort ?? null,
  }));
  fcases.push({
    uid: t.uid,
    pid: t.pid,
    train,
    prefixAnchor: d.lastViewedPrefix.get(key) ?? null,
    candIds,
    candidates,
    ctxOracle: { userVector: [], cohort: d.meta.get(t.pid)?.cohort ?? null },
    ctxReal: { userVector: [], cohort: modeOfStr(train.map((id) => d.meta.get(id)?.cohort ?? null)) },
  });
}
log(`[f] casos=${fcases.length} t=${elapsed()}`);

// ── helpers ───────────────────────────────────────────────────────────────────
function meanVec(vs: Float64Array[]): Float64Array {
  const out = new Float64Array(vs[0].length);
  for (const v of vs) for (let i = 0; i < v.length; i++) out[i] += v[i];
  let n = 0;
  for (let i = 0; i < out.length; i++) n += out[i] * out[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}
function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
/** rank candIds by max dot to query vectors, desc, tie id asc */
function rankByMaxDot(candIds: string[], space: Map<string, Float64Array>, queries: Float64Array[]): string[] {
  const scored = candIds.map((id) => {
    const v = space.get(id)!;
    let best = -2;
    for (const q of queries) {
      const s = dot(q, v);
      if (s > best) best = s;
    }
    return { id, s: best };
  });
  scored.sort((a, b) => b.s - a.s || a.id.localeCompare(b.id));
  return scored.map((x) => x.id);
}

// item-kNN over a graph
function rankKnn(c: FCase, graph: Map<string, { id: string; score: number }[]>): string[] {
  const score = new Map<string, number>();
  for (const t of c.train) for (const n of graph.get(t) ?? []) score.set(n.id, (score.get(n.id) ?? 0) + n.score);
  if (c.prefixAnchor) for (const n of graph.get(c.prefixAnchor) ?? []) score.set(n.id, (score.get(n.id) ?? 0) + n.score);
  return c.candIds
    .map((id) => ({ id, s: score.get(id) ?? 0, pop: popTrain.get(id) ?? 0 }))
    .sort((a, b) => b.s - a.s || b.pop - a.pop || a.id.localeCompare(b.id))
    .map((x) => x.id);
}

// E1-clean modes (behaviour reference): only items with clean vector
function rankE1Modes(c: FCase): string[] {
  const hist = c.train.map((id) => e1Clean.get(id)).filter((v): v is number[] => v !== undefined);
  if (hist.length === 0) return c.candIds;
  const modes = buildUserModes(hist, { distanceThreshold: 0.5, maxModes: 5 }).map((m) =>
    Float64Array.from(m.medoid),
  );
  // candidates without clean e1 go to the bottom (popularity order)
  const withV: string[] = [],
    withoutV: string[] = [];
  for (const id of c.candIds) (e1Clean.has(id) ? withV : withoutV).push(id);
  const e1f = new Map<string, Float64Array>();
  for (const id of withV) e1f.set(id, Float64Array.from(e1Clean.get(id)!));
  return [...rankByMaxDot(withV, e1f, modes), ...withoutV];
}

// fusion-v2: RRF of 4 clean sources, then PC(real) tail — the leak-free pipeline shape
function rankFusionV2(c: FCase, textModes: Float64Array[]): string[] {
  const K = 80;
  const retrieval = rankByMaxDot(c.candIds, e0c, textModes).slice(0, K);
  const knn = rankKnn(c, npmiTrain).slice(0, 50);
  const trainSet = new Set(c.train);
  const seedCohort = modeOfStr(c.train.map((id) => d.meta.get(id)?.cohort ?? null)) ?? "__none__";
  const popList = c.candIds
    .filter((id) => (d.meta.get(id)?.cohort ?? "__none__") === seedCohort && !trainSet.has(id))
    .sort((a, b) => (popTrain.get(b) ?? 0) - (popTrain.get(a) ?? 0) || a.localeCompare(b))
    .slice(0, 40);
  const npmiPrefix = (c.prefixAnchor ? (npmiTrain.get(c.prefixAnchor) ?? []) : [])
    .map((n) => n.id)
    .filter((id) => commonSet.has(id) && !trainSet.has(id))
    .slice(0, 50);
  const lists: RankedList[] = [
    { source: "retrieval", items: retrieval.map((id, i) => ({ id, rank: i + 1 })) },
    { source: "knn", items: knn.map((id, i) => ({ id, rank: i + 1 })) },
    { source: "popular", items: popList.map((id, i) => ({ id, rank: i + 1 })) },
    { source: "npmi", items: npmiPrefix.map((id, i) => ({ id, rank: i + 1 })) },
  ];
  const fused = rrfFuse(lists).slice(0, 200).map((f) => f.id);
  const fusedSet = new Set(fused);
  const tail = popularCohortRanker()
    .rank(c.ctxReal, c.candidates.filter((x) => !fusedSet.has(x.id)));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...fused, ...tail]) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of c.candIds) if (!seen.has(id)) out.push(id);
  return out;
}

// ── Evaluate ──────────────────────────────────────────────────────────────────
type RankFn = (c: FCase) => string[];
const rankers: Record<string, RankFn> = {
  "pc-oracle": (c) => popularCohortRanker().rank(c.ctxOracle, c.candidates),
  "pc-real": (c) => popularCohortRanker().rank(c.ctxReal, c.candidates),
  "text-mean": (c) => {
    const u = meanVec(c.train.map((id) => e0.get(id)!));
    return rankByMaxDot(c.candIds, e0, [u]);
  },
  "text-mean-ctr": (c) => {
    const u = meanVec(c.train.map((id) => e0c.get(id)!));
    return rankByMaxDot(c.candIds, e0c, [u]);
  },
  "text-modes": (c) => {
    const hist = c.train.map((id) => [...e0c.get(id)!]);
    const modes = buildUserModes(hist, { distanceThreshold: 0.5, maxModes: 5 }).map((m) =>
      Float64Array.from(m.medoid),
    );
    return rankByMaxDot(c.candIds, e0c, modes);
  },
  "knn-clean": (c) => rankKnn(c, npmiTrain),
  "e1-clean-modes": (c) => rankE1Modes(c),
  "fusion-v2": (c) => {
    const hist = c.train.map((id) => [...e0c.get(id)!]);
    const modes = buildUserModes(hist, { distanceThreshold: 0.5, maxModes: 5 }).map((m) =>
      Float64Array.from(m.medoid),
    );
    return rankFusionV2(c, modes);
  },
};

const perCase: Record<string, number[]> = {};
const agg: Record<string, { r10: number; m: number }> = {};
for (const name of Object.keys(rankers)) {
  perCase[name] = [];
  agg[name] = { r10: 0, m: 0 };
}

let done = 0;
for (const c of fcases) {
  const rel = new Set([c.pid]);
  for (const [name, fn] of Object.entries(rankers)) {
    const ranked = fn(c);
    perCase[name].push(ndcgAtK(ranked, rel, 10));
    agg[name].r10 += recallAtK(ranked, rel, 10);
    agg[name].m += mrr(ranked, rel);
  }
  done++;
  if (done % 500 === 0) console.log(`[f] ${done}/${fcases.length} t=${elapsed()}`);
}

const n = fcases.length;
log(`\n[f] RESULTADOS LIMPIOS (n=${n}, todos los rankers 100% sin fuga):`);
for (const name of Object.keys(rankers)) {
  log(
    `  ${name.padEnd(15)} ndcg@10=${mean(perCase[name]).toFixed(3)} recall@10=${(agg[name].r10 / n).toFixed(3)} mrr=${(agg[name].m / n).toFixed(3)}`,
  );
}
for (const name of Object.keys(rankers)) {
  if (name === "pc-oracle") continue;
  const bs = pairedBootstrap(perCase[name], perCase["pc-oracle"], 5000, 7);
  log(
    `  ${name.padEnd(15)} vs pc-oracle: rel=${(100 * bs.relDelta).toFixed(1)}% CI95=[${(100 * bs.relCi95[0]).toFixed(1)}%, ${(100 * bs.relCi95[1]).toFixed(1)}%]`,
  );
}
writeFileSync(resolve(process.cwd(), "scripts/_audit/exp-f-results.txt"), OUT.join("\n") + "\n");
log(`[f] DONE t=${elapsed()}`);
