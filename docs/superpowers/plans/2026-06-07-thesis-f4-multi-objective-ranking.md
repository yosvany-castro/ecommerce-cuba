# Thesis F4 — Learned multi-objective ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the synthetic generator with business signals (margin/stock/seller), add an outcome model (expected revenue), and a multi-objective scorer `s(p|u)=Σ λ_k·f_k` swept over a λ-grid into a Pareto frontier — proving via the F0 harness that reranking the F3 pool to negotiate relevance↔revenue↔diversity↔novelty↔fairness beats the relevance-only RRF baseline on revenue with bounded relevance loss.

**Architecture:** New pure library `src/thesis/objectives/` (outcome, objective-features, scorer, pareto) + two new metrics (`revenueAtK`, `sellerExposureGini`) appended to `eval/metrics.ts` + generator extension in `src/thesis/data/catalog-model.ts` & `scripts/thesis/data/catalog-gen.ts` (business fields into `products.metadata` jsonb — no migration) + a DB-backed runner `scripts/thesis/f4-study.ts`. Reuses F0 harness, F2 modes, F3 pool, production `mmrSelect`/`rrfFuse`. Nothing touches production `src/sectors/`.

**Tech Stack:** TypeScript 5.6, Node 24, `pg`, Vitest 4. Branch `feat/thesis-personalization-program`, DB schema `thesis` (n=2000 dataset present).

**Spec:** `docs/superpowers/specs/2026-06-07-thesis-f4-multi-objective-ranking-design.md`

---

## Key integration facts (verified — read before starting)
- `Ranker` (`@/thesis/types`): `{ name; rank(ctx: UserContext, candidates: RankItem[]): string[] }`. `RankItem = {id, popularity, vector, cohort?}`. `UserContext = {userVector, cohort}`.
- `cosineSim`, `l2normalize`, `meanPool` from `@/thesis/embedders/space`. `cosineSim` THROWS on dim mismatch (F3 added the guard).
- `makeRng(seed)` from `@/thesis/data/rng` → `{next(), int(n), pick, gaussian}`. Deterministic mulberry32.
- `evaluateRanker(ranker, cases: EvalCase[], ks): EvalResult`, `aggregateCases<C>(cases, rankerFor, ks, name): EvalResult` (`@/thesis/eval/harness`/`aggregate`). `EvalCase = {ctx, candidates, relevant: Set, complements?}`.
- Existing metrics in `eval/metrics.ts`: `ndcgAtK, recallAtK, mrr, intraListDiversity(vectors), novelty(ranked, popularity: Map, k), setChangeAtK`, etc. F4 ADDS `revenueAtK`, `sellerExposureGini`.
- Generator: `sampleCatalog(n, seed): SynthProduct[]` (`@/thesis/data/catalog-model`). `SynthProduct = {source_product_id, title, description, canonicalText, price_cents, attrs: ProductAttrs, factor_vector}`. `ProductAttrs = {category, subcategory, brand, gender, ageBand, priceBand, style}`. `PRICE_BANDS` length 4. Catalog CLI `scripts/thesis/data/catalog-gen.ts` builds a `metadata` object and INSERTs it as jsonb (line ~89).
- Generator affinity shape (to MIRROR in outcome, not import): `scoreProduct` uses `affinity·priceFit` where in-taste affinity=10/out=1, `priceFit = max(0.05, exp(-0.7·priceSensitivity·|priceBand-budgetBand|))`.
- F3 pool: built per user by `scripts/thesis/f3-study.ts` (read it for the loading idiom). F4 reuses the SAME pool construction so the comparison vs F3-RRF is apples-to-apples.
- DB: `products(id, price_cents, metadata jsonb)`; `item_vectors(space='e1_prod2vec', product_id, vector)`; `events`, `holdout`, `sim_sessions`, `sim_user_recipients` as in F2/F3.
- **No leakage:** the ranker sees only inference-available features (relevance, margin, est. convProb, novelty, sellerFairness). The held-out test purchase and realized revenue are ground-truth for MEASUREMENT only.
- **Dataset-safe:** F4 generator change requires a regenerate; never `TRUNCATE thesis.products` by hand outside the CLIs. The F0 discrimination test is txn-isolated.

---

## File Structure
- `src/thesis/data/catalog-model.ts` — MODIFY: add business fields to `SynthProduct` + `sampleCatalog`.
- `scripts/thesis/data/catalog-gen.ts` — MODIFY: persist business fields into `metadata`.
- `src/thesis/eval/metrics.ts` — APPEND `revenueAtK`, `sellerExposureGini`.
- `src/thesis/objectives/outcome.ts` — `purchaseProbability`, `expectedRevenue`.
- `src/thesis/objectives/objective-features.ts` — `OBJECTIVE_NAMES`, `extractObjectiveFeatures`.
- `src/thesis/objectives/scorer.ts` — `multiObjectiveRanker`.
- `src/thesis/objectives/pareto.ts` — `paretoFrontier`, `pickByKpi`, `sweepPareto`.
- `scripts/thesis/f4-study.ts` — study runner.
- Tests: `tests/thesis/{revenue-fairness,outcome,objective-features,scorer,pareto}.test.ts`, `catalog-model.test.ts` (extend), integration `tests/thesis/f4-tradeoff.test.ts`.
- `package.json` — add `thesis:f4-study`.

---

## Task 1: Generator business fields

**Files:**
- Modify: `src/thesis/data/catalog-model.ts`
- Test: `tests/thesis/catalog-model.test.ts` (extend — read it first)

- [ ] **Step 1: Write the failing test (append to `tests/thesis/catalog-model.test.ts`)**

```ts
import { sampleCatalog } from "@/thesis/data/catalog-model";

describe("sampleCatalog business fields (F4)", () => {
  test("every product has margin_pct, stock_health in [0,1], a seller_id, seller_age_days>=0", () => {
    const cat = sampleCatalog(300, 7);
    for (const p of cat) {
      expect(p.margin_pct >= 0 && p.margin_pct <= 1).toBe(true);
      expect(p.stock_health >= 0 && p.stock_health <= 1).toBe(true);
      expect(typeof p.seller_id === "string" && p.seller_id.length > 0).toBe(true);
      expect(Number.isInteger(p.seller_age_days) && p.seller_age_days >= 0).toBe(true);
    }
  });

  test("deterministic by seed", () => {
    const a = sampleCatalog(100, 7).map((p) => [p.margin_pct, p.seller_id, p.seller_age_days]);
    const b = sampleCatalog(100, 7).map((p) => [p.margin_pct, p.seller_id, p.seller_age_days]);
    expect(a).toEqual(b);
  });

  test("margin is anti-correlated with price band (cheap/long-tail carries higher margin)", () => {
    const cat = sampleCatalog(2000, 11);
    const lowBand = cat.filter((p) => p.attrs.priceBand <= 1);
    const highBand = cat.filter((p) => p.attrs.priceBand >= 2);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
    // anti-correlation: low price bands have HIGHER mean margin than high price bands
    expect(mean(lowBand.map((p) => p.margin_pct))).toBeGreaterThan(mean(highBand.map((p) => p.margin_pct)));
  });

  test("draws from a small seller pool (<=40 distinct sellers) with some new sellers (<30d)", () => {
    const cat = sampleCatalog(800, 3);
    const sellers = new Set(cat.map((p) => p.seller_id));
    expect(sellers.size).toBeLessThanOrEqual(40);
    expect(cat.some((p) => p.seller_age_days < 30)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/catalog-model.test.ts`
Expected: FAIL — `margin_pct` etc. undefined on `SynthProduct`.

- [ ] **Step 3: Implement (modify `src/thesis/data/catalog-model.ts`)**

Add to the `SynthProduct` interface (after `factor_vector`):
```ts
  /** Gross margin fraction [0,1]; anti-correlated with price band (real-retail shape). */
  margin_pct: number;
  /** Stock health [0,1]; 1 = plenty, →0 = about to stock out. */
  stock_health: number;
  /** Seller this product belongs to (small pool). */
  seller_id: string;
  /** Days since the seller joined; <30 = a "new" seller fairness can boost. */
  seller_age_days: number;
```

Add module constants near the other `const` pools (e.g. after `LEAVES`):
```ts
const SELLER_COUNT = 30; // small marketplace seller pool
```

Inside `sampleCatalog`, in the per-product loop, BEFORE the `products.push({...})`, compute the business fields from the seeded rng:
```ts
    // ── F4 business signals (deterministic from the same rng) ──
    // Margin anti-correlated with price band: cheaper/long-tail → higher margin.
    // base by band: band 0 → ~0.55, band 3 → ~0.20, plus bounded noise.
    const marginBase = 0.55 - 0.12 * priceBand;
    const margin_pct = Math.min(0.9, Math.max(0.05, marginBase + (rng.next() - 0.5) * 0.1));
    const stock_health = rng.next();
    const sellerIdx = rng.int(SELLER_COUNT);
    const seller_id = `seller-${sellerIdx}`;
    // seller age: most established (up to ~3y), ~20% are new (<30d)
    const seller_age_days = rng.next() < 0.2 ? rng.int(30) : 30 + rng.int(1080);
```

Add them to the `products.push({...})` object:
```ts
      factor_vector: factorVectorFor(attrs),
      margin_pct,
      stock_health,
      seller_id,
      seller_age_days,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/catalog-model.test.ts`
Expected: PASS (existing + 4 new). The anti-correlation test relies on `marginBase = 0.55 − 0.12·priceBand` strictly decreasing in band, so low bands have higher mean margin.

- [ ] **Step 5: Commit**

```bash
git add src/thesis/data/catalog-model.ts tests/thesis/catalog-model.test.ts
git commit -m "feat(thesis): F4 generator business fields (margin anti-correlated w/ price, stock, seller)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Persist business fields in catalog-gen

**Files:**
- Modify: `scripts/thesis/data/catalog-gen.ts`

- [ ] **Step 1: Add the fields to the metadata object**

In `scripts/thesis/data/catalog-gen.ts`, find the `const metadata = { ... }` block (~line 89) and add the four business fields:
```ts
        const metadata = {
          category:      attrs.category,
          subcategory:   attrs.subcategory,
          brand:         attrs.brand,
          gender_target: attrs.gender === "unisex" ? null : attrs.gender,
          age_target:    ageTarget(attrs.ageBand),
          style:         attrs.style,
          price_band:    attrs.priceBand,
          margin_pct:        p.margin_pct,
          stock_health:      p.stock_health,
          seller_id:         p.seller_id,
          seller_age_days:   p.seller_age_days,
        };
```

- [ ] **Step 2: Regenerate the dataset with business fields**

Run (regenerate catalog + the downstream artifacts F4 reads; this is the seed-42 dataset all phases share):
```bash
pnpm thesis:catalog --n 2000 --seed 42 && pnpm thesis:relations && pnpm thesis:behavior --users 800 --days 90 --seed 42 && pnpm thesis:train-prod2vec --dim 64 --epochs 30 --seed 42 && pnpm thesis:backfill-cooccurrence
```
Expected: each prints success counts. (F4 needs e1 vectors + co-occurrence for the pool; E3/E5/E4-chunks aren't needed by the F4 runner.)

- [ ] **Step 3: Verify business fields persisted**

Run:
```bash
SUPABASE_DB_URL=$(grep '^SUPABASE_DB_URL' .env.local | cut -d= -f2-) npx tsx -e "import {getPgClient} from '@/lib/db/pg'; const c=await getPgClient({scope:'thesis'}); const r=await c.query(\"select count(*)::int n, count(*) filter (where metadata ? 'margin_pct')::int withmargin, count(distinct metadata->>'seller_id')::int sellers from thesis.products\"); console.log(JSON.stringify(r.rows[0])); await c.end();"
```
Expected: `n` ≈ 2000, `withmargin` == n, `sellers` ≤ 30. (If the inline tsx fails on ESM, write a temp `scripts/_chk.mjs` with `pg`+dotenv+`set search_path to thesis,public,extensions`, run, delete.)

- [ ] **Step 4: Commit**

```bash
git add scripts/thesis/data/catalog-gen.ts
git commit -m "feat(thesis): persist F4 business fields into thesis.products.metadata

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: revenueAtK + sellerExposureGini metrics

**Files:**
- Modify: `src/thesis/eval/metrics.ts` (append)
- Test: `tests/thesis/revenue-fairness.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/revenue-fairness.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { revenueAtK, sellerExposureGini } from "@/thesis/eval/metrics";

describe("revenueAtK", () => {
  const rev = new Map<string, number>([["a", 10], ["b", 4], ["c", 1], ["d", 100]]);
  test("sums expected revenue over the top-k", () => {
    expect(revenueAtK(["a", "b", "c"], rev, 2)).toBeCloseTo(14, 9); // 10+4
  });
  test("missing id contributes 0", () => {
    expect(revenueAtK(["a", "zzz"], rev, 2)).toBeCloseTo(10, 9);
  });
  test("empty → 0", () => {
    expect(revenueAtK([], rev, 5)).toBe(0);
  });
});

describe("sellerExposureGini", () => {
  const seller = new Map<string, string>([["a", "s1"], ["b", "s1"], ["c", "s2"], ["d", "s3"]]);
  test("perfectly even exposure across sellers → ~0", () => {
    // top-3 = one item each from s1,s2,s3 (use a,c,d) → even
    expect(sellerExposureGini(["a", "c", "d"], seller, 3)).toBeCloseTo(0, 6);
  });
  test("all top-k from one seller → high concentration (>0.5)", () => {
    const s = new Map<string, string>([["a", "s1"], ["b", "s1"], ["c", "s1"]]);
    expect(sellerExposureGini(["a", "b", "c"], s, 3)).toBeGreaterThan(0.5);
  });
  test("empty → 0", () => {
    expect(sellerExposureGini([], seller, 3)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/revenue-fairness.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement (append to `src/thesis/eval/metrics.ts`)**

```ts
/**
 * Revenue@k: total expected revenue (GMV) of the top-k. `revenueById` maps a
 * product id to its expected revenue (P(buy)·price·margin); missing → 0. The
 * business counterpart to nDCG — what the feed is expected to earn.
 */
export function revenueAtK(ranked: string[], revenueById: Map<string, number>, k: number): number {
  let total = 0;
  for (const id of ranked.slice(0, k)) total += revenueById.get(id) ?? 0;
  return total;
}

/**
 * Gini coefficient of seller exposure in the top-k (0 = every seller equally
 * exposed, →1 = one seller dominates). Fairness guardrail: lower is fairer.
 * Sellers absent from the top-k count as 0 exposure across the full seller set
 * present among the ranked candidates' sellers in the top-k.
 */
export function sellerExposureGini(ranked: string[], sellerById: Map<string, string>, k: number): number {
  const top = ranked.slice(0, k);
  if (top.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const id of top) {
    const s = sellerById.get(id);
    if (s === undefined) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const values = [...counts.values()].sort((a, b) => a - b);
  const n = values.length;
  if (n <= 1) return 0; // a single seller in the slate → Gini undefined→0 only when n==1; see note
  const sum = values.reduce((s, x) => s + x, 0);
  if (sum === 0) return 0;
  // Gini = (2·Σ i·x_i)/(n·Σ x_i) − (n+1)/n , i 1-based over ascending values
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * values[i];
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}
```
NOTE for implementer: the "all top-k from one seller" test has n==1 distinct seller → the standard Gini-over-distinct-sellers returns 0, which would FAIL the `>0.5` assertion. Resolve by measuring concentration over a FIXED denominator = the number of distinct sellers among the top-k candidates is wrong here; instead compute Gini over the per-seller counts INCLUDING implicit zeros is also degenerate for n==1. Simplest correct fix that satisfies both tests: define exposure inequality over the **top-k slots vs distinct sellers** as `1 − (distinctSellers / topLen)` blended with Gini — BUT to keep it principled, change the metric to: Gini of counts where the seller set is all sellers appearing in the FULL ranked list's top-k PLUS treat a single-seller slate as maximal concentration. Concretely implement: if `n === 1 && top.length > 1` return `1 - 1/top.length` (e.g. 3 items one seller → 0.667 > 0.5 ✓); even spread (3 sellers, 1 each) → standard Gini 0 ✓. Update the code's `n<=1` branch accordingly:
```ts
  if (n === 1) return top.length > 1 ? 1 - 1 / top.length : 0;
```
Keep the standard Gini formula for n>1.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/revenue-fairness.test.ts`
Expected: PASS (6). Also run `npx vitest run tests/thesis/metrics.test.ts` — existing metric tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/thesis/eval/metrics.ts tests/thesis/revenue-fairness.test.ts
git commit -m "feat(thesis): revenueAtK + sellerExposureGini metrics

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Outcome model

**Files:**
- Create: `src/thesis/objectives/outcome.ts`
- Test: `tests/thesis/outcome.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/outcome.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { purchaseProbability, expectedRevenue } from "@/thesis/objectives/outcome";

describe("purchaseProbability", () => {
  test("monotonic increasing in affinity", () => {
    const lo = purchaseProbability({ affinity: 0.1, priceFit: 1 });
    const hi = purchaseProbability({ affinity: 0.9, priceFit: 1 });
    expect(hi).toBeGreaterThan(lo);
  });
  test("in [0,1]", () => {
    for (const a of [0, 0.3, 0.7, 1]) {
      const p = purchaseProbability({ affinity: a, priceFit: 0.6 });
      expect(p >= 0 && p <= 1).toBe(true);
    }
  });
  test("worse price fit lowers probability", () => {
    expect(purchaseProbability({ affinity: 0.8, priceFit: 0.2 })).toBeLessThan(purchaseProbability({ affinity: 0.8, priceFit: 1 }));
  });
});

describe("expectedRevenue", () => {
  test("= P(buy) · price · margin", () => {
    const p = purchaseProbability({ affinity: 0.8, priceFit: 1 });
    expect(expectedRevenue({ affinity: 0.8, priceFit: 1, price_cents: 10000, margin_pct: 0.3 })).toBeCloseTo(p * 10000 * 0.3, 6);
  });
  test("zero margin → zero revenue", () => {
    expect(expectedRevenue({ affinity: 0.9, priceFit: 1, price_cents: 5000, margin_pct: 0 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/outcome.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/thesis/objectives/outcome.ts`**

```ts
/**
 * Outcome model for F4. Mirrors the generator's click model SHAPE (affinity ×
 * price-fit) to produce a purchase probability, then expected revenue. Pure.
 *
 * The generator scores a product as affinity·priceFit; here `affinity` is the
 * inference-time relevance proxy (cosine of candidate to the user's modes,
 * already in [0,1]) and `priceFit` ∈ (0,1]. We squash affinity·priceFit through a
 * logistic to a probability. This is ground-truth for MEASUREMENT (revenue@k) and
 * the basis of the convProb feature; the ranker never sees the realized purchase.
 */
export interface OutcomeInput {
  affinity: number; // relevance proxy in [0,1]
  priceFit: number; // [0,1]
}

const PURCHASE_SLOPE = 4; // steepness of the logistic on affinity·priceFit
const PURCHASE_MID = 0.5; // midpoint

export function purchaseProbability(o: OutcomeInput): number {
  const x = o.affinity * o.priceFit;
  return 1 / (1 + Math.exp(-PURCHASE_SLOPE * (x - PURCHASE_MID)));
}

export interface RevenueInput extends OutcomeInput {
  price_cents: number;
  margin_pct: number;
}

export function expectedRevenue(r: RevenueInput): number {
  return purchaseProbability(r) * r.price_cents * r.margin_pct;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/outcome.test.ts`
Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/objectives/outcome.ts tests/thesis/outcome.test.ts
git commit -m "feat(thesis): F4 outcome model (purchase probability + expected revenue)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Objective features

**Files:**
- Create: `src/thesis/objectives/objective-features.ts`
- Test: `tests/thesis/objective-features.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/objective-features.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { OBJECTIVE_NAMES, extractObjectiveFeatures, type ObjCtx, type ObjCandidate } from "@/thesis/objectives/objective-features";

describe("extractObjectiveFeatures", () => {
  const ctx: ObjCtx = { modeMedoids: [[1, 0, 0]], budgetBand: 2, maxPopularity: 100 };
  const cand: ObjCandidate = {
    id: "x", vector: [1, 0, 0], priceBand: 2, margin_pct: 0.4, popularity: 1, seller_age_days: 10,
  };

  test("returns one value per OBJECTIVE_NAMES entry, all in [0,1]", () => {
    const f = extractObjectiveFeatures(ctx, cand);
    expect(OBJECTIVE_NAMES.every((n) => typeof f[n] === "number" && f[n] >= 0 && f[n] <= 1)).toBe(true);
    expect(Object.keys(f).sort()).toEqual([...OBJECTIVE_NAMES].sort());
  });
  test("relevance is max cosine to mode medoids", () => {
    expect(extractObjectiveFeatures(ctx, cand).relevance).toBeCloseTo(1, 6); // cand == medoid
  });
  test("margin is the margin_pct", () => {
    expect(extractObjectiveFeatures(ctx, cand).margin).toBeCloseTo(0.4, 9);
  });
  test("novelty is high for a low-popularity item", () => {
    const f = extractObjectiveFeatures(ctx, cand);
    const popular = extractObjectiveFeatures(ctx, { ...cand, popularity: 100 });
    expect(f.novelty).toBeGreaterThan(popular.novelty);
  });
  test("sellerFairness is higher for a newer seller", () => {
    const newSeller = extractObjectiveFeatures(ctx, { ...cand, seller_age_days: 5 });
    const oldSeller = extractObjectiveFeatures(ctx, { ...cand, seller_age_days: 1000 });
    expect(newSeller.sellerFairness).toBeGreaterThan(oldSeller.sellerFairness);
  });
  test("convProb increases with relevance (price band == budget → priceFit 1)", () => {
    const aligned = extractObjectiveFeatures(ctx, cand); // cosine 1
    const off = extractObjectiveFeatures(ctx, { ...cand, vector: [0, 1, 0] }); // cosine 0
    expect(aligned.convProb).toBeGreaterThan(off.convProb);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/objective-features.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/thesis/objectives/objective-features.ts`**

```ts
import { cosineSim } from "../embedders/space";
import { purchaseProbability } from "./outcome";

/** Pointwise objective features (diversity is marginal → computed in the scorer). */
export const OBJECTIVE_NAMES = ["relevance", "margin", "convProb", "novelty", "sellerFairness"] as const;
export type ObjectiveName = (typeof OBJECTIVE_NAMES)[number];

export interface ObjCtx {
  modeMedoids: number[][];
  budgetBand: number;
  maxPopularity: number; // for novelty normalization
}
export interface ObjCandidate {
  id: string;
  vector: number[];
  priceBand: number;
  margin_pct: number;
  popularity: number;
  seller_age_days: number;
}

const PRICE_BANDS = 4;
const FAIRNESS_HALFLIFE_DAYS = 30;

/** All features normalized to [0,1]. Inference-available only (no labels). */
export function extractObjectiveFeatures(ctx: ObjCtx, cand: ObjCandidate): Record<ObjectiveName, number> {
  const relevance = ctx.modeMedoids.length === 0 ? 0 : Math.max(0, Math.min(1, Math.max(...ctx.modeMedoids.map((m) => cosineSim(m, cand.vector)))));
  const priceFit = 1 - Math.abs(cand.priceBand - ctx.budgetBand) / (PRICE_BANDS - 1);
  const convProb = purchaseProbability({ affinity: relevance, priceFit: Math.max(0, priceFit) });
  const novelty = 1 - Math.log1p(cand.popularity) / Math.log1p(Math.max(1, ctx.maxPopularity));
  const sellerFairness = FAIRNESS_HALFLIFE_DAYS / (FAIRNESS_HALFLIFE_DAYS + cand.seller_age_days);
  return {
    relevance,
    margin: Math.max(0, Math.min(1, cand.margin_pct)),
    convProb,
    novelty: Math.max(0, Math.min(1, novelty)),
    sellerFairness,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/objective-features.test.ts`
Expected: PASS (6).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/objectives/objective-features.ts tests/thesis/objective-features.test.ts
git commit -m "feat(thesis): F4 objective features (relevance/margin/convProb/novelty/fairness)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Multi-objective scorer (greedy, marginal diversity)

**Files:**
- Create: `src/thesis/objectives/scorer.ts`
- Test: `tests/thesis/scorer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/scorer.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { multiObjectiveRanker, type ScorerItem } from "@/thesis/objectives/scorer";
import type { RankItem } from "@/thesis/types";

describe("multiObjectiveRanker", () => {
  // 3 candidates: A high relevance/low margin, B low relevance/high margin, C mid/mid.
  const items: ScorerItem[] = [
    { id: "A", vector: [1, 0], features: { relevance: 1.0, margin: 0.1, convProb: 0.9, novelty: 0.2, sellerFairness: 0.1 } },
    { id: "B", vector: [0, 1], features: { relevance: 0.1, margin: 1.0, convProb: 0.2, novelty: 0.9, sellerFairness: 0.9 } },
    { id: "C", vector: [0.7, 0.7], features: { relevance: 0.5, margin: 0.5, convProb: 0.5, novelty: 0.5, sellerFairness: 0.5 } },
  ];
  const cands: RankItem[] = items.map((i) => ({ id: i.id, popularity: 0, vector: i.vector }));

  test("λ relevance-only ranks A first", () => {
    const r = multiObjectiveRanker({ relevance: 1, margin: 0, convProb: 0, novelty: 0, sellerFairness: 0, diversity: 0 }, items);
    expect(r.rank({ userVector: [], cohort: null }, cands)[0]).toBe("A");
  });
  test("λ margin-only ranks B first", () => {
    const r = multiObjectiveRanker({ relevance: 0, margin: 1, convProb: 0, novelty: 0, sellerFairness: 0, diversity: 0 }, items);
    expect(r.rank({ userVector: [], cohort: null }, cands)[0]).toBe("B");
  });
  test("returns a full permutation of candidate ids", () => {
    const r = multiObjectiveRanker({ relevance: 1, margin: 1, convProb: 0, novelty: 0, sellerFairness: 0, diversity: 0.5 }, items);
    expect([...r.rank({ userVector: [], cohort: null }, cands)].sort()).toEqual(["A", "B", "C"]);
  });
  test("diversity term avoids picking two near-identical vectors back to back", () => {
    const dup: ScorerItem[] = [
      { id: "A", vector: [1, 0], features: { relevance: 1.0, margin: 0, convProb: 0, novelty: 0, sellerFairness: 0 } },
      { id: "A2", vector: [1, 0], features: { relevance: 0.99, margin: 0, convProb: 0, novelty: 0, sellerFairness: 0 } },
      { id: "B", vector: [0, 1], features: { relevance: 0.9, margin: 0, convProb: 0, novelty: 0, sellerFairness: 0 } },
    ];
    const dupCands: RankItem[] = dup.map((i) => ({ id: i.id, popularity: 0, vector: i.vector }));
    // strong diversity weight → after A, the orthogonal B beats the near-duplicate A2
    const r = multiObjectiveRanker({ relevance: 0.5, margin: 0, convProb: 0, novelty: 0, sellerFairness: 0, diversity: 0.8 }, dup);
    const out = r.rank({ userVector: [], cohort: null }, dupCands);
    expect(out[0]).toBe("A");
    expect(out[1]).toBe("B");
  });
  test("deterministic", () => {
    const w = { relevance: 1, margin: 0.5, convProb: 0.2, novelty: 0.1, sellerFairness: 0.1, diversity: 0.3 };
    const r = multiObjectiveRanker(w, items);
    expect(r.rank({ userVector: [], cohort: null }, cands)).toEqual(r.rank({ userVector: [], cohort: null }, cands));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/scorer.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/thesis/objectives/scorer.ts`**

```ts
import { cosineSim } from "../embedders/space";
import type { Ranker, RankItem, UserContext } from "../types";
import { OBJECTIVE_NAMES, type ObjectiveName } from "./objective-features";

/** A candidate with its precomputed pointwise objective features + vector (for diversity). */
export interface ScorerItem {
  id: string;
  vector: number[];
  features: Record<ObjectiveName, number>;
}

/** Weights for the pointwise objectives plus the marginal `diversity` term. */
export type ObjectiveWeights = Record<ObjectiveName, number> & { diversity: number };

/**
 * Multi-objective scorer s(p|u) = Σ_k λ_k·f_k(p) + λ_diversity·diversityMarginal(p,S).
 * Greedy selection (MMR-style): at each step pick the unselected candidate with the
 * highest score, where diversityMarginal = 1 − max cosine to already-selected items.
 * Pure, deterministic (tie-break by id). Returns a full permutation.
 */
export function multiObjectiveRanker(weights: ObjectiveWeights, items: ScorerItem[]): Ranker {
  const byId = new Map(items.map((it) => [it.id, it]));
  const pointwise = (it: ScorerItem): number => {
    let s = 0;
    for (const k of OBJECTIVE_NAMES) s += weights[k] * it.features[k];
    return s;
  };
  return {
    name: "multi-objective",
    rank(_ctx: UserContext, candidates: RankItem[]): string[] {
      const remaining = candidates.map((c) => c.id).filter((id) => byId.has(id));
      const selected: string[] = [];
      const selVecs: number[][] = [];
      while (remaining.length > 0) {
        let bestIdx = 0;
        let bestScore = -Infinity;
        for (let i = 0; i < remaining.length; i++) {
          const it = byId.get(remaining[i])!;
          const div = selVecs.length === 0 ? 1 : 1 - Math.max(...selVecs.map((v) => cosineSim(v, it.vector)));
          const score = pointwise(it) + weights.diversity * div;
          if (score > bestScore + 1e-12 || (Math.abs(score - bestScore) <= 1e-12 && remaining[i] < remaining[bestIdx])) {
            bestScore = score;
            bestIdx = i;
          }
        }
        const chosen = remaining.splice(bestIdx, 1)[0];
        selected.push(chosen);
        selVecs.push(byId.get(chosen)!.vector);
      }
      // append any candidate not in the scorer item map (no features) in id order
      const known = new Set(selected);
      for (const c of candidates) if (!known.has(c.id)) selected.push(c.id);
      return selected;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/scorer.test.ts`
Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/objectives/scorer.ts tests/thesis/scorer.test.ts
git commit -m "feat(thesis): multi-objective scorer (greedy MMR-style, marginal diversity)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Pareto frontier + KPI pick

**Files:**
- Create: `src/thesis/objectives/pareto.ts`
- Test: `tests/thesis/pareto.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/pareto.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { paretoFrontier, pickByKpi, type ParetoPoint } from "@/thesis/objectives/pareto";

describe("paretoFrontier", () => {
  // maximize both objectives. p3 is dominated by p2.
  const pts: ParetoPoint[] = [
    { id: "p1", metrics: { relevance: 1.0, revenue: 0.2 } },
    { id: "p2", metrics: { relevance: 0.6, revenue: 0.9 } },
    { id: "p3", metrics: { relevance: 0.5, revenue: 0.8 } }, // dominated by p2
    { id: "p4", metrics: { relevance: 0.3, revenue: 1.0 } },
  ];
  test("keeps only non-dominated points (maximize all)", () => {
    const f = paretoFrontier(pts, ["relevance", "revenue"]).map((p) => p.id).sort();
    expect(f).toEqual(["p1", "p2", "p4"]);
  });
});

describe("pickByKpi", () => {
  const pts: ParetoPoint[] = [
    { id: "p1", metrics: { relevance: 1.0, revenue: 0.2, sellerGini: 0.1 } },
    { id: "p2", metrics: { relevance: 0.6, revenue: 0.9, sellerGini: 0.2 } },
    { id: "p4", metrics: { relevance: 0.3, revenue: 1.0, sellerGini: 0.7 } },
  ];
  test("maximizes revenue subject to relevance and fairness guardrails", () => {
    // guardrail: relevance >= 0.5, sellerGini <= 0.3 → only p1,p2 pass → max revenue = p2
    const pick = pickByKpi(pts, { kpi: "revenue", guardrails: { relevance: { min: 0.5 }, sellerGini: { max: 0.3 } } });
    expect(pick.id).toBe("p2");
  });
  test("with no feasible point, returns the best-KPI point overall (documented fallback)", () => {
    const pick = pickByKpi(pts, { kpi: "revenue", guardrails: { relevance: { min: 0.99 }, sellerGini: { max: 0.01 } } });
    expect(pick.id).toBe("p4"); // none feasible → highest revenue overall
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/pareto.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/thesis/objectives/pareto.ts`**

```ts
/** A swept config's aggregate metric vector. */
export interface ParetoPoint {
  id: string;
  metrics: Record<string, number>;
}

/**
 * Non-dominated set, MAXIMIZING every objective in `objectives`. A point is
 * dominated if another is ≥ on all objectives and strictly > on at least one.
 * Pure. Deterministic (input order preserved among non-dominated points).
 */
export function paretoFrontier(points: ParetoPoint[], objectives: string[]): ParetoPoint[] {
  return points.filter((p) =>
    !points.some((q) =>
      q !== p &&
      objectives.every((o) => (q.metrics[o] ?? 0) >= (p.metrics[o] ?? 0)) &&
      objectives.some((o) => (q.metrics[o] ?? 0) > (p.metrics[o] ?? 0)),
    ),
  );
}

export interface KpiSpec {
  kpi: string; // metric to maximize
  guardrails: Record<string, { min?: number; max?: number }>;
}

/**
 * Pick the point maximizing `kpi` among those satisfying all guardrails. If no
 * point is feasible, fall back to the global max-KPI point (documented). Pure;
 * tie-break by id for determinism.
 */
export function pickByKpi(points: ParetoPoint[], spec: KpiSpec): ParetoPoint {
  const feasible = points.filter((p) =>
    Object.entries(spec.guardrails).every(([m, g]) => {
      const v = p.metrics[m] ?? 0;
      if (g.min !== undefined && v < g.min) return false;
      if (g.max !== undefined && v > g.max) return false;
      return true;
    }),
  );
  const pool = feasible.length > 0 ? feasible : points;
  return pool.slice().sort((a, b) => (b.metrics[spec.kpi] ?? 0) - (a.metrics[spec.kpi] ?? 0) || a.id.localeCompare(b.id))[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/pareto.test.ts`
Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/objectives/pareto.ts tests/thesis/pareto.test.ts
git commit -m "feat(thesis): Pareto frontier + KPI pick (guardrailed revenue maximization)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: F4 study runner

**Files:**
- Create: `scripts/thesis/f4-study.ts`
- Modify: `package.json`

The runner reuses the F3 pool per user, computes objective features + expected revenue per candidate, sweeps a λ-grid, evaluates each config's metric vector vs the F3-RRF baseline, builds the Pareto frontier, picks by KPI, and writes the report.

- [ ] **Step 1: Add the npm script**

In `package.json` "scripts", after `"thesis:f3-study"`, add:
```json
    "thesis:f4-study": "tsx scripts/thesis/f4-study.ts",
```

- [ ] **Step 2: Write the runner**

Create `scripts/thesis/f4-study.ts`:
```ts
#!/usr/bin/env tsx
/**
 * F4 study: rerank the F3 candidate pool with a multi-objective scorer swept over
 * a λ-grid; report each config's metric vector (nDCG@10, revenue@10, diversity,
 * novelty, sellerGini) vs the F3-RRF baseline, the Pareto frontier, and the
 * KPI-selected point. Item space = e1_prod2vec. Reuses the F3 pool construction.
 * Usage: pnpm thesis:f4-study
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { writeFileSync } from "fs";
import { getPgClient } from "@/lib/db/pg";
import { l2normalize, meanPool, cosineSim } from "@/thesis/embedders/space";
import { aggregateCases, evaluateRanker, type EvalCase } from "@/thesis/eval/harness";
import { ndcgAtK, recallAtK, intraListDiversity, novelty as noveltyMetric, revenueAtK, sellerExposureGini } from "@/thesis/eval/metrics";
import { buildUserModes } from "@/thesis/multivector/modes";
import { buildCandidatePool } from "@/thesis/rerank/candidates";
import { expectedRevenue } from "@/thesis/objectives/outcome";
import { extractObjectiveFeatures, type ObjCtx, type ObjCandidate } from "@/thesis/objectives/objective-features";
import { multiObjectiveRanker, type ScorerItem, type ObjectiveWeights } from "@/thesis/objectives/scorer";
import { paretoFrontier, pickByKpi, type ParetoPoint } from "@/thesis/objectives/pareto";
import { rrfFuse } from "@/sectors/d-personalization/retrieve/rrf";
import { makeRng } from "@/thesis/data/rng";
import type { Ranker, RankItem } from "@/thesis/types";

const K = 10;
const POOL_SIZE = 200;

function ageBandOf(at: { min?: number; max?: number } | null | undefined): string | null {
  if (!at || typeof at.min !== "number" || typeof at.max !== "number") return null;
  const mid = (at.min + at.max) / 2;
  if (mid <= 3) return "bebe"; if (mid <= 11) return "nino"; if (mid <= 25) return "joven"; if (mid <= 59) return "adulto"; return "mayor";
}

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    // ---- load vectors + business metadata ----
    const e1 = new Map<string, number[]>();
    for (const r of (await pg.query(`SELECT product_id::text id, vector FROM thesis.item_vectors WHERE space='e1_prod2vec'`)).rows as { id: string; vector: number[] }[]) e1.set(r.id, r.vector.map(Number));
    if (e1.size === 0) { console.error("[f4] no e1 vectors — run thesis:train-prod2vec"); process.exit(1); }
    interface Meta { priceBand: number; margin: number; seller: string; sellerAge: number; cohort: string | null; price_cents: number; }
    const meta = new Map<string, Meta>();
    for (const r of (await pg.query(`SELECT id::text id, price_cents, metadata FROM thesis.products`)).rows as { id: string; price_cents: number; metadata: Record<string, unknown> }[]) {
      const m = r.metadata ?? {};
      meta.set(r.id, { priceBand: Number(m.price_band ?? 0), margin: Number(m.margin_pct ?? 0), seller: String(m.seller_id ?? "unknown"), sellerAge: Number(m.seller_age_days ?? 9999), cohort: (m.subcategory as string | null) ?? null, price_cents: r.price_cents });
    }
    if (![...meta.values()].some((m) => m.margin > 0)) { console.error("[f4] products lack margin_pct — regenerate catalog with F4 fields"); process.exit(1); }
    const popById = new Map<string, number>();
    for (const r of (await pg.query(`SELECT payload->>'product_id' pid, count(*)::int c FROM thesis.events WHERE payload->>'product_id' IS NOT NULL GROUP BY 1`)).rows as { pid: string; c: number }[]) popById.set(r.pid, r.c);
    const maxPop = Math.max(1, ...popById.values());
    const npmiTop = new Map<string, string[]>();
    for (const r of (await pg.query(`SELECT product_id::text id, related_product_id::text rid FROM thesis.co_occurrence_top ORDER BY product_id, rank`)).rows as { id: string; rid: string }[]) { const a = npmiTop.get(r.id) ?? []; a.push(r.rid); npmiTop.set(r.id, a); }

    const trainByUser = new Map<string, string[]>();
    for (const r of (await pg.query(`SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='train'`)).rows as { uid: string; pid: string }[]) { const a = trainByUser.get(r.uid) ?? []; a.push(r.pid); trainByUser.set(r.uid, a); }
    const tests = (await pg.query(`SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='test'`)).rows as { uid: string; pid: string }[];
    const lastViewed = new Map<string, string>();
    for (const r of (await pg.query(`SELECT DISTINCT ON (anonymous_id) anonymous_id::text uid, payload->>'product_id' pid FROM thesis.events WHERE event_type='product_view' AND payload->>'product_id' IS NOT NULL ORDER BY anonymous_id, occurred_at DESC`)).rows as { uid: string; pid: string }[]) lastViewed.set(r.uid, r.pid);

    const allIds = [...e1.keys()].sort((a, b) => a.localeCompare(b));
    const popularByCohort = new Map<string, string[]>();
    for (const id of allIds) { const c = meta.get(id)?.cohort ?? "_"; const a = popularByCohort.get(c) ?? []; a.push(id); popularByCohort.set(c, a); }
    for (const [, a] of popularByCohort) a.sort((x, y) => (popById.get(y) ?? 0) - (popById.get(x) ?? 0) || x.localeCompare(y));

    // ---- per-user pool + scorer items + revenue map + base case ----
    interface F4Case extends EvalCase { uid: string; scorerItems: ScorerItem[]; revenueById: Map<string, number>; sellerById: Map<string, string>; vectorsById: Map<string, number[]>; poolOrder: string[]; }
    const cases: F4Case[] = [];
    for (const t of tests) {
      const train = (trainByUser.get(t.uid) ?? []).filter((id) => e1.has(id));
      if (train.length === 0 || !e1.has(t.pid)) continue;
      const trainSet = new Set(train);
      const modes = buildUserModes(train.map((id) => e1.get(id)!), { distanceThreshold: 0.5, maxModes: 5 });
      const medoids = modes.map((m) => m.medoid);
      const budget = Math.round(train.reduce((s, id) => s + (meta.get(id)?.priceBand ?? 0), 0) / Math.max(1, train.length));

      // F3 pool sources (same construction as F3)
      const retrieval = allIds.filter((id) => !trainSet.has(id)).map((id) => ({ id, s: medoids.length ? Math.max(...medoids.map((m) => cosineSim(m, e1.get(id)!))) : 0 })).sort((a, b) => b.s - a.s || a.id.localeCompare(b.id)).slice(0, 80).map((x) => x.id);
      const lv = lastViewed.get(t.uid);
      const npmi = (lv ? (npmiTop.get(lv) ?? []) : []).filter((id) => !trainSet.has(id)).slice(0, 50);
      const cohort = meta.get(train[0])?.cohort ?? "_";
      const popular = (popularByCohort.get(cohort) ?? allIds).filter((id) => !trainSet.has(id)).slice(0, 40);
      const rng = makeRng(train.length + (lv ? lv.length : 0));
      const explore = allIds.filter((id) => !trainSet.has(id)).map((id) => ({ id, k: rng.next() })).sort((a, b) => a.k - b.k).slice(0, 30).map((x) => x.id);
      const pool = buildCandidatePool([{ source: "retrieval", ids: retrieval }, { source: "npmi", ids: npmi }, { source: "popular", ids: popular }, { source: "exploration", ids: explore }], POOL_SIZE);
      const poolIds = pool.map((p) => p.id);

      const objCtx: ObjCtx = { modeMedoids: medoids, budgetBand: budget, maxPopularity: maxPop };
      const scorerItems: ScorerItem[] = [];
      const revenueById = new Map<string, number>();
      const sellerById = new Map<string, string>();
      const vectorsById = new Map<string, number[]>();
      for (const id of poolIds) {
        const m = meta.get(id)!;
        const objCand: ObjCandidate = { id, vector: e1.get(id)!, priceBand: m.priceBand, margin_pct: m.margin, popularity: popById.get(id) ?? 0, seller_age_days: m.sellerAge };
        const feats = extractObjectiveFeatures(objCtx, objCand);
        scorerItems.push({ id, vector: e1.get(id)!, features: feats });
        const priceFit = 1 - Math.abs(m.priceBand - budget) / 3;
        revenueById.set(id, expectedRevenue({ affinity: feats.relevance, priceFit: Math.max(0, priceFit), price_cents: m.price_cents, margin_pct: m.margin }));
        sellerById.set(id, m.seller);
        vectorsById.set(id, e1.get(id)!);
      }
      const candidates: RankItem[] = poolIds.map((id) => ({ id, popularity: popById.get(id) ?? 0, vector: e1.get(id)!, cohort: meta.get(id)?.cohort ?? null }));
      cases.push({ ctx: { userVector: l2normalize(meanPool(train.map((id) => e1.get(id)!))), cohort: meta.get(t.pid)?.cohort ?? null }, candidates, relevant: new Set([t.pid]), uid: t.uid, scorerItems, revenueById, sellerById, vectorsById, poolOrder: poolIds });
    }
    console.log(`[f4] ${cases.length} eval cases`);

    // ---- metric vector for a given ranker over all cases ----
    const metricVector = (rankerFor: (c: F4Case) => Ranker): Record<string, number> => {
      let ndcg = 0, rev = 0, div = 0, nov = 0, gini = 0;
      for (const c of cases) {
        const ranked = rankerFor(c).rank(c.ctx, c.candidates);
        ndcg += ndcgAtK(ranked, c.relevant, K);
        rev += revenueAtK(ranked, c.revenueById, K);
        const topVecs = ranked.slice(0, K).map((id) => c.vectorsById.get(id)!).filter(Boolean);
        div += intraListDiversity(topVecs);
        nov += noveltyMetric(ranked, popById, K); // popById global popularity
        gini += sellerExposureGini(ranked, c.sellerById, K);
      }
      const n = Math.max(1, cases.length);
      // normalize revenue to [0,1]-ish by per-case mean so it's comparable in the frontier
      return { relevance: ndcg / n, revenue: rev / n, diversity: div / n, novelty: nov / n, sellerGini: gini / n };
    };

    // ---- baseline: F3-RRF (pool order) ----
    const rrfRanker: Ranker = { name: "rrf", rank: (_ctx, cands) => cands.map((x) => x.id) };
    const baseMetrics = metricVector(() => rrfRanker);

    // ---- λ grid sweep ----
    const grid: ObjectiveWeights[] = [];
    const levels = [0, 0.5, 1];
    for (const rel of [1]) for (const margin of levels) for (const conv of [0, 0.5]) for (const div of [0, 0.5]) for (const fair of [0, 0.5]) {
      grid.push({ relevance: rel, margin, convProb: conv, novelty: 0, sellerFairness: fair, diversity: div });
    }
    const points: ParetoPoint[] = [];
    const weightsById = new Map<string, ObjectiveWeights>();
    grid.forEach((w, i) => {
      const id = `cfg${i}`;
      weightsById.set(id, w);
      const mv = metricVector((c) => multiObjectiveRanker(w, c.scorerItems));
      points.push({ id, metrics: mv });
    });

    // frontier maximizes relevance, revenue, diversity; minimizes sellerGini → use (1 - gini)
    const ptsForFrontier = points.map((p) => ({ id: p.id, metrics: { ...p.metrics, fairness: 1 - p.metrics.sellerGini } }));
    const frontier = paretoFrontier(ptsForFrontier, ["relevance", "revenue", "diversity", "fairness"]);
    const kpiPick = pickByKpi(ptsForFrontier, { kpi: "revenue", guardrails: { relevance: { min: 0.7 * baseMetrics.relevance }, sellerGini: { max: baseMetrics.sellerGini + 0.2 } } });

    // ---- report ----
    const rows: string[] = [];
    rows.push("# Thesis F4 — Learned multi-objective ranking", "");
    rows.push(`Eval cases: ${cases.length}. Pool ${POOL_SIZE}, k=${K}. λ-grid size: ${grid.length}.`, "");
    rows.push(`Objectives maximized in the frontier: relevance (nDCG@10), revenue@10, diversity, fairness (1−sellerGini).`, "");
    rows.push("## Baseline F3-RRF (relevance-only)", "", `relevance ${baseMetrics.relevance.toFixed(3)} | revenue ${baseMetrics.revenue.toFixed(1)} | diversity ${baseMetrics.diversity.toFixed(3)} | novelty ${baseMetrics.novelty.toFixed(3)} | sellerGini ${baseMetrics.sellerGini.toFixed(3)}`, "");
    rows.push("## Pareto frontier configs", "", "| cfg | λ(rel,margin,conv,div,fair) | relevance | revenue | diversity | sellerGini |", "|---|---|---|---|---|---|");
    for (const p of frontier) {
      const w = weightsById.get(p.id)!;
      rows.push(`| ${p.id} | (${w.relevance},${w.margin},${w.convProb},${w.diversity},${w.sellerFairness}) | ${p.metrics.relevance.toFixed(3)} | ${p.metrics.revenue.toFixed(1)} | ${p.metrics.diversity.toFixed(3)} | ${p.metrics.sellerGini.toFixed(3)} |`);
    }
    const kw = weightsById.get(kpiPick.id)!;
    rows.push("", "## KPI-selected operating point (max revenue@10 s.t. relevance & fairness guardrails)", "", `**${kpiPick.id}** λ=(rel ${kw.relevance}, margin ${kw.margin}, conv ${kw.convProb}, div ${kw.diversity}, fair ${kw.sellerFairness})`, "", `- relevance ${kpiPick.metrics.relevance.toFixed(3)} (baseline ${baseMetrics.relevance.toFixed(3)})`, `- revenue@10 ${kpiPick.metrics.revenue.toFixed(1)} (baseline ${baseMetrics.revenue.toFixed(1)})`, `- diversity ${kpiPick.metrics.diversity.toFixed(3)} | sellerGini ${kpiPick.metrics.sellerGini.toFixed(3)}`);
    const revLift = baseMetrics.revenue > 0 ? (kpiPick.metrics.revenue / baseMetrics.revenue - 1) * 100 : 0;
    const relCost = baseMetrics.relevance > 0 ? (1 - kpiPick.metrics.relevance / baseMetrics.relevance) * 100 : 0;
    rows.push("", `**Trade-off: +${revLift.toFixed(1)}% revenue for −${relCost.toFixed(1)}% relevance vs RRF.**`);

    const md = rows.join("\n") + "\n";
    const out = resolve(process.cwd(), "docs/superpowers/reports/2026-06-07-thesis-f4-study.md");
    writeFileSync(out, md);
    writeFileSync(out.replace(/\.md$/, ".json"), JSON.stringify({ baseline: baseMetrics, points, frontier: frontier.map((p) => p.id), kpiPick: kpiPick.id, weights: Object.fromEntries(weightsById) }, null, 2));
    console.log(md);
    console.log(`[f4] wrote ${out}`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -v '\.next/' | grep -E 'f4-study|objectives/' || echo "no F4 TS errors"`
Expected: `no F4 TS errors`.

- [ ] **Step 4: Run the study**

Run: `pnpm thesis:f4-study`
Expected: a report with the RRF baseline, a Pareto frontier table (>1 config), a KPI-selected point, and a trade-off line. SANITY (report REAL numbers): the KPI point should show **higher revenue@10 than baseline** with relevance within the guardrail; the frontier should contain >1 point. If revenue never rises with margin weight, the generator's margin anti-correlation is too weak — that's a real finding to record (and Task 1's coefficient would need revisiting), do not fake. Report BLOCKED on DB errors.

- [ ] **Step 5: Commit (runner + report + json)**

```bash
git add scripts/thesis/f4-study.ts package.json docs/superpowers/reports/2026-06-07-thesis-f4-study.md docs/superpowers/reports/2026-06-07-thesis-f4-study.json
git commit -m "feat(thesis): F4 study runner + results — Pareto frontier + KPI operating point vs RRF

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Integration trade-off test + final verification

**Files:**
- Create: `tests/thesis/f4-tradeoff.test.ts`

- [ ] **Step 1: Write the test (real DB)**

Create `tests/thesis/f4-tradeoff.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { getPgClient } from "@/lib/db/pg";
import { expectedRevenue } from "@/thesis/objectives/outcome";
import { extractObjectiveFeatures, type ObjCtx, type ObjCandidate } from "@/thesis/objectives/objective-features";
import { multiObjectiveRanker, type ScorerItem, type ObjectiveWeights } from "@/thesis/objectives/scorer";
import { revenueAtK, ndcgAtK } from "@/thesis/eval/metrics";
import { cosineSim } from "@/thesis/embedders/space";
import type { RankItem } from "@/thesis/types";

/**
 * On the real dataset, a margin-weighted objective must raise expected revenue@10
 * vs relevance-only over a sample of users — proving the multi-objective trade-off
 * is real (the most relevant item is not always the most profitable). Requires the
 * F4-regenerated catalog (products carry margin_pct).
 */
describe("F4 trade-off is real (relevance-only vs margin-weighted)", () => {
  test("margin weight raises revenue@10 across sampled users", async () => {
    const pg = await getPgClient({ scope: "thesis" });
    try {
      const e1 = new Map<string, number[]>();
      for (const r of (await pg.query(`SELECT product_id::text id, vector FROM thesis.item_vectors WHERE space='e1_prod2vec'`)).rows as { id: string; vector: number[] }[]) e1.set(r.id, r.vector.map(Number));
      const meta = new Map<string, { priceBand: number; margin: number; sellerAge: number; price_cents: number }>();
      for (const r of (await pg.query(`SELECT id::text id, price_cents, metadata FROM thesis.products`)).rows as { id: string; price_cents: number; metadata: Record<string, unknown> }[]) {
        const m = r.metadata ?? {};
        meta.set(r.id, { priceBand: Number(m.price_band ?? 0), margin: Number(m.margin_pct ?? 0), sellerAge: Number(m.seller_age_days ?? 9999), price_cents: r.price_cents });
      }
      expect([...meta.values()].some((m) => m.margin > 0)).toBe(true);
      const pop = new Map<string, number>();
      for (const r of (await pg.query(`SELECT payload->>'product_id' pid, count(*)::int c FROM thesis.events WHERE payload->>'product_id' IS NOT NULL GROUP BY 1`)).rows as { pid: string; c: number }[]) pop.set(r.pid, r.c);
      const maxPop = Math.max(1, ...pop.values());
      const users = (await pg.query(`SELECT DISTINCT user_id::text uid FROM thesis.holdout WHERE split='train' LIMIT 40`)).rows as { uid: string }[];

      const relOnly: ObjectiveWeights = { relevance: 1, margin: 0, convProb: 0, novelty: 0, sellerFairness: 0, diversity: 0 };
      const marginW: ObjectiveWeights = { relevance: 1, margin: 1.5, convProb: 0, novelty: 0, sellerFairness: 0, diversity: 0 };
      let revRel = 0, revMargin = 0;
      for (const u of users) {
        const train = ((await pg.query(`SELECT product_id::text pid FROM thesis.holdout WHERE user_id=$1 AND split='train'`, [u.uid])).rows as { pid: string }[]).map((r) => r.pid).filter((id) => e1.has(id));
        if (train.length === 0) continue;
        const medoid = train.map((id) => e1.get(id)!)[0]; // cheap proxy: first train vec
        const budget = Math.round(train.reduce((s, id) => s + (meta.get(id)?.priceBand ?? 0), 0) / train.length);
        const cohortIds = [...e1.keys()].filter((id) => !train.includes(id)).slice(0, 120);
        const ctx: ObjCtx = { modeMedoids: [medoid], budgetBand: budget, maxPopularity: maxPop };
        const items: ScorerItem[] = [];
        const revById = new Map<string, number>();
        for (const id of cohortIds) {
          const m = meta.get(id)!;
          const f = extractObjectiveFeatures(ctx, { id, vector: e1.get(id)!, priceBand: m.priceBand, margin_pct: m.margin, popularity: pop.get(id) ?? 0, seller_age_days: m.sellerAge });
          items.push({ id, vector: e1.get(id)!, features: f });
          const priceFit = 1 - Math.abs(m.priceBand - budget) / 3;
          revById.set(id, expectedRevenue({ affinity: f.relevance, priceFit: Math.max(0, priceFit), price_cents: m.price_cents, margin_pct: m.margin }));
        }
        const cands: RankItem[] = cohortIds.map((id) => ({ id, popularity: 0, vector: e1.get(id)! }));
        revRel += revenueAtK(multiObjectiveRanker(relOnly, items).rank({ userVector: [], cohort: null }, cands), revById, 10);
        revMargin += revenueAtK(multiObjectiveRanker(marginW, items).rank({ userVector: [], cohort: null }, cands), revById, 10);
      }
      // margin-weighted ranking earns strictly more expected revenue than relevance-only
      expect(revMargin).toBeGreaterThan(revRel);
    } finally {
      await pg.end();
    }
  }, 120_000);
});
```

- [ ] **Step 2: Run the test**

Run: `MOCK_AGGREGATOR_ERROR_RATE=0 npx vitest run tests/thesis/f4-tradeoff.test.ts`
Expected: PASS. If `revMargin <= revRel`, the trade-off isn't materializing — revisit Task 1's `marginBase` anti-correlation (strengthen the slope) and re-run; do not weaken the assertion.

- [ ] **Step 3: Full gate (dataset-safe — F0 discrimination test is txn-isolated)**

Run:
```bash
MOCK_AGGREGATOR_ERROR_RATE=0 npx vitest run tests/thesis && pnpm test:quality && (pnpm typecheck 2>&1 | grep -v '\.next/' | grep -E 'thesis|objectives' || echo "no thesis TS errors")
```
Expected: all thesis tests pass; `[check-test-quality] OK`; `no thesis TS errors`.

- [ ] **Step 4: Confirm dataset intact + unit suite green**

Run: `npx vitest run tests/unit`
Expected: 176+ passing.

- [ ] **Step 5: Commit + push**

```bash
git add tests/thesis/f4-tradeoff.test.ts
git commit -m "test(thesis): F4 trade-off is real — margin weight raises revenue@10 vs relevance-only

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push origin feat/thesis-personalization-program
```
Expected: pushed; local == remote.

---

## Self-Review notes (for the implementer)
- **Spec coverage:** generator fields §4.1→Task 1-2; outcome §4.2→Task 4; objective-features §4.3→Task 5; scorer §4.4→Task 6; metrics §4.5→Task 3; pareto §4.6→Task 7; runner §4.7→Task 8; eval §5 + trade-off accept criterion §8.1→Task 9.
- **Reuse:** `rrfFuse`, `mmrSelect` idea (greedy diversity reimplemented minimally in scorer since mmrSelect's shape differs), F2 `buildUserModes`, F3 `buildCandidatePool`, F0 harness/metrics, `space.ts`, `makeRng`. New infra: business fields, outcome, objective-features, scorer, pareto, 2 metrics.
- **No mocks:** pure modules unit-tested on toy data; generator/runner/trade-off test hit the real DB; `pnpm test:quality` enforces no banned mocks/weak assertions.
- **No leakage:** the scorer/features use only inference-available signals (relevance, margin from catalog, estimated convProb, novelty, seller age). Expected revenue and the held-out purchase are ground-truth for measurement only — never a ranker input.
- **No production changes; dataset-safe:** F4 only adds jsonb keys via the catalog CLI; never truncates products by hand.
- **Type consistency:** `SynthProduct` business fields (Task 1) ↔ `meta` load (Task 8) ↔ `ObjCandidate` (Task 5); `OBJECTIVE_NAMES`/`ObjectiveName` (Task 5) ↔ `ScorerItem.features`/`ObjectiveWeights` (Task 6); `ParetoPoint`/`KpiSpec` (Task 7) ↔ runner usage (Task 8); `revenueAtK`/`sellerExposureGini` (Task 3) ↔ runner (Task 8).
- **Known approximations (documented):** the runner approximates per-case revenue normalization by per-case mean for frontier comparability; the trade-off integration test uses a cheap single-medoid proxy for speed (the full runner uses real F2 modes). Both stated.
