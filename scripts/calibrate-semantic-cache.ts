#!/usr/bin/env tsx
/**
 * Semantic-cache threshold calibration (roadmap #8; mentor Fix 3 in
 * feedback_comphrensive.md; anisotropy finding in
 * docs/diseno-como-hacer-que-funcione-2026-06-09.md §1c).
 *
 * The cache threshold θ=0.92 in src/sectors/c-search/cache/semantic.ts was
 * decreed, not calibrated. The F6 audit measured E0/Voyage anisotropy at mean
 * cosine ≈0.613 between random pairs — the cosine "floor" is not 0, so a fixed
 * θ implies an unknown false-positive rate. This script estimates it:
 *
 *   1. Loads E0 product embeddings (local audit dump if present, else
 *      read-only from thesis.item_vectors via getPgClient scope "thesis").
 *   2. Cosine distribution of RANDOM pairs (seeded makeRng, no Math.random):
 *      mean / p95 / p99 / p99.9, and the FPR implied by the current θ=0.92.
 *   3. Proxy for "should match" pairs — products sharing (subcategory, brand)
 *      stand in for query paraphrases — and a simple ROC (FPR over random
 *      negatives, TPR over the proxy) on a θ grid.
 *   4. Recommends θ* = smallest grid θ with FPR ≤ 0.1% over random pairs.
 *
 * HONEST LIMITATION: products embedded from TEMPLATED text are only a proxy
 * for user queries. The definitive calibration requires real query logs
 * (mentor Fix 3, steps 1–4): log ~10k production queries, label paraphrase
 * pairs, recompute these distributions on query embeddings. Until then θ*
 * here bounds the FPR on this corpus, not on production traffic.
 *
 * Usage: npx tsx scripts/calibrate-semantic-cache.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { existsSync, readFileSync } from "fs";
import { makeRng } from "@/thesis/data/rng";
import { DEFAULT_THETA } from "@/sectors/c-search/cache/semantic";

const SEED = 8_2026; // fixed: same pairs every run (reproducibility requirement)
const N_RANDOM_PAIRS = 50_000; // ≥20k per task spec; 50k gives ~50 tail samples at p99.9
const N_PROXY_PAIRS_MAX = 20_000;
const FPR_TARGET = 0.001; // ≤0.1% over random pairs (mentor Fix 3)
// Grid is fine near the top where the random-pair tail lives (anisotropy 0.613
// pushes mass far above 0, so coarse steps below 0.8 would miss the action).
const THETA_GRID = [
  0.6, 0.65, 0.7, 0.75, 0.8, 0.82, 0.84, 0.86, 0.88, 0.9, 0.91, 0.92, 0.93,
  0.94, 0.95, 0.96, 0.97, 0.98, 0.99,
];

const VECTORS_DUMP = resolve(process.cwd(), "scripts/_audit/data/item_vectors_e0.json");
const PRODUCTS_DUMP = resolve(process.cwd(), "scripts/_audit/data/products.json");

interface Item {
  id: string;
  v: number[];
  /** Proxy-pair key: products sharing (subcategory, brand) ≈ paraphrases. */
  groupKey: string | null;
}

interface ProductMetaRow {
  id: string;
  subcategory: string | null;
  brand: string | null;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

/** Empirical quantile (nearest-rank) over a SORTED ascending array. */
function quantile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

function groupKeyOf(subcategory: string | null, brand: string | null): string | null {
  // Both fields required: (subcategory=null, brand=X) pairs would conflate
  // unrelated products under one key and inflate the proxy-positive set.
  if (!subcategory || !brand) return null;
  return `${subcategory}||${brand}`;
}

async function loadItems(): Promise<Item[]> {
  if (existsSync(VECTORS_DUMP) && existsSync(PRODUCTS_DUMP)) {
    console.log(`Loading local audit dumps:\n  ${VECTORS_DUMP}\n  ${PRODUCTS_DUMP}`);
    const vectors = JSON.parse(readFileSync(VECTORS_DUMP, "utf8")) as { id: string; v: number[] }[];
    const products = JSON.parse(readFileSync(PRODUCTS_DUMP, "utf8")) as {
      id: string;
      metadata: { subcategory?: string | null; brand?: string | null };
    }[];
    const metaById = new Map(products.map((p) => [p.id, p.metadata]));
    return vectors.map((r) => {
      const m = metaById.get(r.id);
      return { id: r.id, v: r.v, groupKey: groupKeyOf(m?.subcategory ?? null, m?.brand ?? null) };
    });
  }
  // Fallback: read-only from the thesis schema (never writes).
  console.log("Local dumps not found — reading E0 vectors from thesis.item_vectors (read-only).");
  const { getPgClient } = await import("@/lib/db/pg");
  const pg = await getPgClient({ scope: "thesis" });
  try {
    const vr = await pg.query(
      `SELECT product_id::text id, vector FROM thesis.item_vectors WHERE space='e0_text'`,
    );
    const mr = await pg.query(
      `SELECT id::text id, metadata->>'subcategory' subcategory, metadata->>'brand' brand
       FROM thesis.products`,
    );
    const metaById = new Map((mr.rows as ProductMetaRow[]).map((r) => [r.id, r]));
    return (vr.rows as { id: string; vector: number[] }[]).map((r) => {
      const m = metaById.get(r.id);
      return {
        id: r.id,
        v: r.vector,
        groupKey: groupKeyOf(m?.subcategory ?? null, m?.brand ?? null),
      };
    });
  } finally {
    await pg.end();
  }
}

function main(items: Item[]): void {
  console.log(`\nItems: ${items.length} (dim=${items[0].v.length})`);
  const rng = makeRng(SEED);
  // Precompute norms once: the dump vectors are ~L2-normalized but we do not
  // assume it — pgvector's <=> operator computes true cosine, so must we.
  const norms = items.map((it) => norm(it.v));

  // ---- 2) Random pairs ------------------------------------------------------
  const randomCos: number[] = [];
  // Random pairs that share a groupKey are (by our own proxy) plausible
  // matches, not false positives; count them so the contamination is explicit.
  let contaminated = 0;
  while (randomCos.length < N_RANDOM_PAIRS) {
    const i = rng.int(items.length);
    const j = rng.int(items.length);
    if (i === j) continue;
    if (items[i].groupKey !== null && items[i].groupKey === items[j].groupKey) contaminated++;
    randomCos.push(dot(items[i].v, items[j].v) / (norms[i] * norms[j]));
  }
  randomCos.sort((a, b) => a - b);
  const mean = randomCos.reduce((s, x) => s + x, 0) / randomCos.length;
  const fprAt = (theta: number) => randomCos.filter((c) => c >= theta).length / randomCos.length;

  console.log(`\n== Random pairs (n=${N_RANDOM_PAIRS}, seed=${SEED}) ==`);
  console.log(`same-(subcategory,brand) contamination: ${contaminated} pairs (${((100 * contaminated) / N_RANDOM_PAIRS).toFixed(3)}%)`);
  console.log(`mean   = ${mean.toFixed(4)}   <- anisotropy floor (not 0!)`);
  console.log(`p95    = ${quantile(randomCos, 0.95).toFixed(4)}`);
  console.log(`p99    = ${quantile(randomCos, 0.99).toFixed(4)}`);
  console.log(`p99.9  = ${quantile(randomCos, 0.999).toFixed(4)}`);
  console.log(`max    = ${randomCos[randomCos.length - 1].toFixed(4)}`);
  console.log(`FPR at current θ=${DEFAULT_THETA}: ${(100 * fprAt(DEFAULT_THETA)).toFixed(4)}%`);

  // ---- 3) Proxy positives: same (subcategory, brand) ------------------------
  const byGroup = new Map<string, number[]>();
  items.forEach((it, idx) => {
    if (it.groupKey === null) return;
    const arr = byGroup.get(it.groupKey);
    if (arr) arr.push(idx);
    else byGroup.set(it.groupKey, [idx]);
  });
  const groups = [...byGroup.values()].filter((g) => g.length >= 2);
  const totalPairs = groups.reduce((s, g) => s + (g.length * (g.length - 1)) / 2, 0);
  const proxyCos: number[] = [];
  if (totalPairs <= N_PROXY_PAIRS_MAX) {
    // Small enough: enumerate every within-group pair (no sampling noise).
    for (const g of groups) {
      for (let a = 0; a < g.length; a++) {
        for (let b = a + 1; b < g.length; b++) {
          proxyCos.push(dot(items[g[a]].v, items[g[b]].v) / (norms[g[a]] * norms[g[b]]));
        }
      }
    }
  } else {
    // Sample group-uniform-by-pair-mass: pick a group ∝ #pairs, then a pair.
    const cumulative: number[] = [];
    let acc = 0;
    for (const g of groups) {
      acc += (g.length * (g.length - 1)) / 2;
      cumulative.push(acc);
    }
    while (proxyCos.length < N_PROXY_PAIRS_MAX) {
      const t = rng.next() * acc;
      let lo = 0;
      let hi = cumulative.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid] <= t) lo = mid + 1;
        else hi = mid;
      }
      const g = groups[lo];
      const a = rng.int(g.length);
      let b = rng.int(g.length);
      if (a === b) b = (b + 1) % g.length;
      proxyCos.push(dot(items[g[a]].v, items[g[b]].v) / (norms[g[a]] * norms[g[b]]));
    }
  }
  proxyCos.sort((a, b) => a - b);
  const proxyMean = proxyCos.reduce((s, x) => s + x, 0) / proxyCos.length;
  const tprAt = (theta: number) => proxyCos.filter((c) => c >= theta).length / proxyCos.length;

  console.log(`\n== Proxy "should match" pairs: same (subcategory, brand) ==`);
  console.log(`groups with ≥2 products: ${groups.length}; pairs available: ${totalPairs}; pairs used: ${proxyCos.length}${totalPairs <= N_PROXY_PAIRS_MAX ? " (exhaustive)" : " (sampled)"}`);
  console.log(`mean = ${proxyMean.toFixed(4)}  p5 = ${quantile(proxyCos, 0.05).toFixed(4)}  median = ${quantile(proxyCos, 0.5).toFixed(4)}  p95 = ${quantile(proxyCos, 0.95).toFixed(4)}`);
  console.log(`separation of means (proxy - random): ${(proxyMean - mean).toFixed(4)}`);

  // ---- ROC grid --------------------------------------------------------------
  console.log(`\n== ROC: θ vs FPR (random) / TPR (proxy) ==`);
  console.log(`| θ    | FPR (random) | TPR (proxy) |`);
  console.log(`|------|--------------|-------------|`);
  for (const theta of THETA_GRID) {
    console.log(
      `| ${theta.toFixed(2)} | ${(100 * fprAt(theta)).toFixed(4).padStart(11)}% | ${(100 * tprAt(theta)).toFixed(2).padStart(10)}% |`,
    );
  }

  // ---- 4) Recommendation -----------------------------------------------------
  // θ* = the empirical p99.9 of random pairs, rounded UP to 3 decimals so the
  // realized FPR stays ≤ target (rounding down could let it creep above 0.1%).
  const p999 = quantile(randomCos, 1 - FPR_TARGET);
  const thetaStar = Math.ceil(p999 * 1000) / 1000;
  console.log(`\n== Recommendation ==`);
  console.log(`θ* = ${thetaStar.toFixed(3)} (= p99.9 of random pairs, rounded up) → FPR ${(100 * fprAt(thetaStar)).toFixed(4)}% ≤ ${100 * FPR_TARGET}%, TPR (proxy) ${(100 * tprAt(thetaStar)).toFixed(2)}%`);
  console.log(`Current θ=${DEFAULT_THETA}: FPR ${(100 * fprAt(DEFAULT_THETA)).toFixed(4)}%, TPR (proxy) ${(100 * tprAt(DEFAULT_THETA)).toFixed(2)}%`);
  console.log(`Deploy via SEMANTIC_CACHE_THRESHOLD=${thetaStar.toFixed(3)} (src/sectors/c-search/cache/semantic.ts reads it; default unchanged at ${DEFAULT_THETA}).`);
  console.log(
    `\nWARNING (honest scope): this calibration uses PRODUCT embeddings from` +
      `\nTEMPLATED text as a stand-in for user queries, and (subcategory, brand)` +
      `\nco-membership as a stand-in for paraphrase labels. It bounds the FPR on` +
      `\nthis corpus only. The definitive θ requires logging ~10k REAL queries,` +
      `\nlabeling paraphrase pairs, and recomputing these distributions on query` +
      `\nembeddings (mentor Fix 3, steps 1-4). Re-run before trusting θ* in prod.`,
  );
}

loadItems()
  .then((items) => {
    if (items.length < 2) throw new Error("need ≥2 items with E0 vectors");
    main(items);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
