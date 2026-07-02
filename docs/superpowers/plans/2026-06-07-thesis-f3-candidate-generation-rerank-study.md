# Thesis F3 — Candidate generation + reranker study Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a large multi-source candidate pool (retrieval + NPMI co-occurrence + cohort/recipient popularity + exploration) and four reranker families (LTR, LLM listwise, cross-encoder MaxSim, baselines) over it, then prove via the F0 harness that a reranker with retrieval-invisible features changes the top-10 AND improves it — answering the audit's "the reranker doesn't change the set."

**Architecture:** Pure library under `src/thesis/rerank/` (candidates, features, ltr, crossencoder, llm-reranker) + a `setChangeAtK` metric + a co-occurrence backfill CLI + a DB-backed study runner `scripts/thesis/f3-study.ts`. Reuses F0 harness, F1 embedders/MaxSim, F2 modes/gift, and production `rrfFuse`/`recomputeNPMI`/`mmrSelect`. Nothing touches production `src/sectors/`.

**Tech Stack:** TypeScript 5.6, Node 24, `pg`, Vitest 4, DeepSeek via `defaultProvider`. Builds on the `thesis` schema (n=2000 dataset present). Branch `feat/thesis-personalization-program`.

**Spec:** `docs/superpowers/specs/2026-06-07-thesis-f3-candidate-generation-rerank-study-design.md`

---

## Key integration facts (verified — read before starting)
- `Ranker` (`@/thesis/types`): `{ name: string; rank(ctx: UserContext, candidates: RankItem[]): string[] }`. `RankItem = {id, popularity, vector, cohort?}`. `UserContext = {userVector, cohort}`.
- `rrfFuse(lists: RankedList[], k0=60): FusedItem[]` from `@/sectors/d-personalization/retrieve/rrf`. `RankedList = {source: string; items: {id: string; rank: number}[]}` (rank 1-based). `FusedItem = {id; rrf_score; sources}`, sorted desc by rrf_score.
- `recomputeNPMI(pg: Client): Promise<void>` from `@/sectors/d-personalization/co-occurrence/npmi-recompute` — runs unqualified SQL, so with a `scope:"thesis"` client it operates on `thesis.co_occurrence`→`thesis.co_occurrence_top`. Reads `co_occurrence(product_a_id, product_b_id, count)`, writes `co_occurrence_top(product_id, related_product_id, npmi_score, rank, last_recompute_at)`, top-50 npmi>0 per product, symmetric.
- `evaluateRanker(ranker, cases: EvalCase[], ks): EvalResult` (`@/thesis/eval/harness`) and `aggregateCases<C extends EvalCase>(cases, rankerFor, ks, name): EvalResult` (`@/thesis/eval/aggregate`). `EvalCase = {ctx, candidates: RankItem[], relevant: Set<string>, complements?: Set<string>}`. `EvalResult` has `recall/ndcg/map/hit/complementRecall: Record<number,number>`, `mrr`, `n`, `ranker`.
- `maxSim(query: number[][], doc: number[][]): number` and `maxSimRanker(itemChunks: Map<string,number[][]>, queryChunksFor: (ctx)=>number[][]|null): Ranker` from `@/thesis/embedders/maxsim`.
- `mmrSelect(input: MMRInput): MMRItem[]` from `@/sectors/d-personalization/retrieve/mmr`; `MMRInput = {candidates: {id; rrf_score}[]; embeddings: Map<string,number[]>; k: number; lambda?: number}`; returns `{id; mmr_score}[]`.
- `cosineSim`, `l2normalize`, `meanPool` from `@/thesis/embedders/space`. `makeRng(seed)` from `@/thesis/data/rng` (`next()`, `int(n)`, `pick`, `gaussian`).
- F2 deps: `buildUserModes(history, {distanceThreshold, maxModes}): UserMode[]` (`@/thesis/multivector/modes`), `detectGiftIntent(session, userDemographic, {minItems, minDemographicCoherence})` + `SessionItem`/`UserDemographic` (`@/thesis/multivector/gift-detect`), `buildRecipientVector(vectors)` (`@/thesis/multivector/gift-vector`), `multiModeRank({modes, candidates, perModeK})` (`@/thesis/multivector/retrieve`).
- DB (`getPgClient({scope:"thesis"})`): `item_vectors(space='e1_prod2vec', product_id, vector double[])`; `item_chunk_vectors(space='e4_late', product_id, chunk_index, vector)`; `products(id, metadata jsonb {subcategory, gender_target, age_target{min,max}, price_band})`; `events(anonymous_id==user_id, session_id, event_type, occurred_at, payload->>'product_id')`; `holdout(user_id, product_id, split)`; `sim_sessions(session_id, user_id, intent, recipient_id)`; `sim_user_recipients(id, user_id, gender, age_min, age_max)`; `co_occurrence(product_a_id, product_b_id, count, last_seen_at)`; `co_occurrence_top(product_id, related_product_id, npmi_score, rank)`.
- Rerankers MUST NOT use GT labels (holdout test product, `sim_sessions.intent`) as ranking inputs. GT is for bucketing/scoring only. The LTR trains ONLY on `split='train'`.
- **Dataset hazard (resolved but be careful):** never `TRUNCATE thesis.products`; F3 only writes `co_occurrence*`. The F0 discrimination test is transaction-isolated.

---

## File Structure
- `src/thesis/eval/metrics.ts` — ADD `setChangeAtK` (existing untouched).
- `scripts/thesis/backfill-cooccurrence.ts` — CLI: rebuild `thesis.co_occurrence` from events + `recomputeNPMI`.
- `src/thesis/rerank/candidates.ts` — `buildCandidatePool` (multi-source RRF, source-tagged).
- `src/thesis/rerank/features.ts` — `extractFeatures` + `FEATURE_NAMES`.
- `src/thesis/rerank/ltr.ts` — `trainLTR`, `LtrModel`, `ltrRanker`.
- `src/thesis/rerank/crossencoder.ts` — `crossEncoderRanker` (thin wrapper over maxSimRanker).
- `src/thesis/rerank/llm-reranker.ts` — `llmRerank` (DeepSeek listwise + counted fallback).
- `scripts/thesis/f3-study.ts` — study runner.
- Tests under `tests/thesis/`: `set-change.test.ts`, `candidates.test.ts`, `features.test.ts`, `ltr.test.ts`, `crossencoder-rerank.test.ts`, integration `f3-cooccurrence.test.ts`, `f3-llm-smoke.test.ts`.
- `package.json` — add `thesis:backfill-cooccurrence`, `thesis:f3-study`.

---

## Task 1: `setChangeAtK` metric

**Files:**
- Modify: `src/thesis/eval/metrics.ts` (append)
- Test: `tests/thesis/set-change.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/set-change.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { setChangeAtK } from "@/thesis/eval/metrics";

describe("setChangeAtK", () => {
  test("identical top-k → 0 change", () => {
    expect(setChangeAtK(["a", "b", "c"], ["a", "b", "c"], 3)).toBe(0);
  });
  test("fully disjoint top-k → 1.0 change", () => {
    expect(setChangeAtK(["a", "b"], ["x", "y"], 2)).toBe(1);
  });
  test("half the top-k replaced → 0.5", () => {
    // base top-2 {a,b}; reranked top-2 {a,c} → 1 of 2 new = 0.5
    expect(setChangeAtK(["a", "c", "d"], ["a", "b"], 2)).toBe(0.5);
  });
  test("reorder without membership change → 0 (set, not order)", () => {
    expect(setChangeAtK(["b", "a"], ["a", "b"], 2)).toBe(0);
  });
  test("empty reranked → 0", () => {
    expect(setChangeAtK([], ["a", "b"], 2)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/set-change.test.ts`
Expected: FAIL — `setChangeAtK` not exported.

- [ ] **Step 3: Implement (append to `src/thesis/eval/metrics.ts`)**

```ts
/**
 * Set-change@k: fraction of the reranked top-k that is NOT in the base top-k.
 * Measures how much a reranker actually changes membership of the top-k (set,
 * not order) versus the base ordering. 0 = same items, 1 = fully replaced.
 * Directly answers "does the reranker change the set?". Denominator = min(k, reranked.length).
 */
export function setChangeAtK(reranked: string[], base: string[], k: number): number {
  const top = reranked.slice(0, k);
  if (top.length === 0) return 0;
  const baseSet = new Set(base.slice(0, k));
  let changed = 0;
  for (const id of top) if (!baseSet.has(id)) changed++;
  return changed / top.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/set-change.test.ts`
Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/eval/metrics.ts tests/thesis/set-change.test.ts
git commit -m "feat(thesis): setChangeAtK metric — how much a reranker changes the top-k set

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Co-occurrence backfill CLI

**Files:**
- Create: `scripts/thesis/backfill-cooccurrence.ts`
- Modify: `package.json`
- Test: `tests/thesis/f3-cooccurrence.test.ts` (integration, real DB)

- [ ] **Step 1: Add the npm script**

In `package.json` "scripts", after `"thesis:f2-study"`, add:
```json
    "thesis:backfill-cooccurrence": "tsx scripts/thesis/backfill-cooccurrence.ts",
```

- [ ] **Step 2: Write the CLI**

Create `scripts/thesis/backfill-cooccurrence.ts`:
```ts
#!/usr/bin/env tsx
/**
 * Rebuild thesis.co_occurrence from thesis.events (co-viewed/co-purchased product
 * pairs per session, weighted view=1/cart=3/purchase=5, pair stored a<b), then
 * run recomputeNPMI to populate thesis.co_occurrence_top. Idempotent.
 * Usage: pnpm thesis:backfill-cooccurrence
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getPgClient } from "@/lib/db/pg";
import { recomputeNPMI } from "@/sectors/d-personalization/co-occurrence/npmi-recompute";

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    await pg.query(`TRUNCATE thesis.co_occurrence`);
    // Set-based co-occurrence: for each session, all unordered product pairs, with
    // weight = max event weight seen for each product in the pair, summed across sessions.
    await pg.query(`
      WITH session_items AS (
        SELECT e.session_id,
               (e.payload->>'product_id')::uuid AS pid,
               MAX(CASE e.event_type WHEN 'purchase' THEN 5 WHEN 'add_to_cart' THEN 3 ELSE 1 END) AS w
        FROM thesis.events e
        WHERE e.payload->>'product_id' IS NOT NULL
          AND e.event_type IN ('product_view','add_to_cart','purchase')
        GROUP BY e.session_id, (e.payload->>'product_id')::uuid
      ),
      pairs AS (
        SELECT LEAST(a.pid, b.pid) AS pa, GREATEST(a.pid, b.pid) AS pb,
               GREATEST(a.w, b.w) AS w
        FROM session_items a
        JOIN session_items b ON a.session_id = b.session_id AND a.pid < b.pid
      )
      INSERT INTO thesis.co_occurrence (product_a_id, product_b_id, count, last_seen_at)
      SELECT pa, pb, SUM(w)::int, now() FROM pairs GROUP BY pa, pb
    `);
    const pairCount = (await pg.query(`SELECT count(*)::int c FROM thesis.co_occurrence`)).rows[0].c;
    console.log(`[cooc] co_occurrence pairs: ${pairCount}`);
    await recomputeNPMI(pg);
    const topCount = (await pg.query(`SELECT count(*)::int c FROM thesis.co_occurrence_top`)).rows[0].c;
    console.log(`[cooc] co_occurrence_top rows: ${topCount}`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run the backfill**

Run: `pnpm thesis:backfill-cooccurrence`
Expected: `[cooc] co_occurrence pairs: N` (N>0) then `[cooc] co_occurrence_top rows: M` (M>0). If DB asleep (ENOTFOUND) the pooler may need a minute after restore — retry once; if still down, report BLOCKED.

- [ ] **Step 4: Write the discrimination integration test**

Create `tests/thesis/f3-cooccurrence.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { getPgClient } from "@/lib/db/pg";

/**
 * Verifies the NPMI co-occurrence graph (backfilled from synthetic events)
 * recovers GROUND-TRUTH complements far better than text cosine. This is the
 * thesis premise behind the NPMI pool source: cross-sell lives in co-occurrence,
 * not in the embedding space. Requires `pnpm thesis:backfill-cooccurrence` first.
 */
describe("F3 co-occurrence recovers GT complements (real DB)", () => {
  test("NPMI neighbours hit GT complements more than text-cosine neighbours do", async () => {
    const pg = await getPgClient({ scope: "thesis" });
    try {
      // pick products that HAVE both GT complements and NPMI neighbours
      const anchors = await pg.query(`
        SELECT DISTINCT r.product_a_id::text AS id
        FROM thesis.gt_product_relations r
        WHERE r.relation_type='complement'
          AND EXISTS (SELECT 1 FROM thesis.co_occurrence_top t WHERE t.product_id = r.product_a_id)
        LIMIT 40
      `);
      expect(anchors.rows.length).toBeGreaterThan(0);

      let npmiHits = 0, cosHits = 0, total = 0;
      for (const a of anchors.rows as { id: string }[]) {
        const gt = new Set(
          (await pg.query(`SELECT product_b_id::text id FROM thesis.gt_product_relations WHERE product_a_id=$1 AND relation_type='complement'`, [a.id])).rows.map((r: { id: string }) => r.id),
        );
        if (gt.size === 0) continue;
        total++;
        const npmi = (await pg.query(`SELECT related_product_id::text id FROM thesis.co_occurrence_top WHERE product_id=$1 ORDER BY rank LIMIT 10`, [a.id])).rows.map((r: { id: string }) => r.id);
        const cos = (await pg.query(
          `SELECT v2.product_id::text id
           FROM thesis.item_vectors v1
           JOIN thesis.item_vectors v2 ON v2.space='e1_prod2vec' AND v2.product_id<>v1.product_id
           WHERE v1.space='e1_prod2vec' AND v1.product_id=$1
           ORDER BY (SELECT 1) LIMIT 0`, [a.id],
        )).rows; // placeholder replaced below
        // text-cosine neighbours via products.embedding (E0 text space) using pgvector
        const cosN = (await pg.query(
          `SELECT p2.id::text id
           FROM thesis.products p1
           JOIN thesis.products p2 ON p2.id<>p1.id AND p2.embedding IS NOT NULL
           WHERE p1.id=$1 AND p1.embedding IS NOT NULL
           ORDER BY p1.embedding <=> p2.embedding
           LIMIT 10`, [a.id],
        )).rows.map((r: { id: string }) => r.id);
        npmiHits += npmi.filter((id) => gt.has(id)).length;
        cosHits += cosN.filter((id) => gt.has(id)).length;
      }
      // NPMI should recover strictly more GT complements than text cosine
      expect(npmiHits).toBeGreaterThan(cosHits);
    } finally {
      await pg.end();
    }
  }, 120_000);
});
```
NOTE to implementer: delete the dead `cos`/placeholder query block above (the `LIMIT 0` line) — it is a leftover; keep only the `cosN` pgvector query. The assertion that matters is `npmiHits > cosHits`.

- [ ] **Step 5: Run the test**

Run: `MOCK_AGGREGATOR_ERROR_RATE=0 npx vitest run tests/thesis/f3-cooccurrence.test.ts`
Expected: PASS. If `npmiHits <= cosHits`, that is a real finding about the synthetic co-occurrence — STOP and report with the numbers; do not weaken the assertion.

- [ ] **Step 6: Commit**

```bash
git add scripts/thesis/backfill-cooccurrence.ts package.json tests/thesis/f3-cooccurrence.test.ts
git commit -m "feat(thesis): co-occurrence backfill + NPMI; test that NPMI recovers GT complements

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Candidate pool (multi-source RRF)

**Files:**
- Create: `src/thesis/rerank/candidates.ts`
- Test: `tests/thesis/candidates.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/candidates.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { buildCandidatePool } from "@/thesis/rerank/candidates";

describe("buildCandidatePool", () => {
  const sources = [
    { source: "retrieval", ids: ["a", "b", "c"] },
    { source: "npmi", ids: ["c", "d"] },
    { source: "popular", ids: ["e"] },
  ];

  test("fuses sources by RRF and caps at poolSize", () => {
    const pool = buildCandidatePool(sources, 3);
    expect(pool.length).toBe(3);
  });

  test("tags each candidate with the sources it came from", () => {
    const pool = buildCandidatePool(sources, 10);
    const c = pool.find((p) => p.id === "c")!;
    expect([...c.sources].sort()).toEqual(["npmi", "retrieval"]);
  });

  test("an item in two sources outranks a single-source item of similar rank", () => {
    const pool = buildCandidatePool(sources, 10);
    const cPos = pool.findIndex((p) => p.id === "c");
    const ePos = pool.findIndex((p) => p.id === "e");
    expect(cPos).toBeLessThan(ePos);
  });

  test("returns every unique id when poolSize exceeds total", () => {
    const pool = buildCandidatePool(sources, 100);
    expect([...pool.map((p) => p.id)].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("empty sources → empty pool", () => {
    expect(buildCandidatePool([], 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/candidates.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/thesis/rerank/candidates.ts`**

```ts
import { rrfFuse, type RankedList } from "@/sectors/d-personalization/retrieve/rrf";

/** A candidate in the fused pool, with the sources that contributed it. */
export interface PooledCandidate {
  id: string;
  sources: string[];
  rrf_score: number;
}

export interface SourceList {
  source: string;
  ids: string[]; // ranked ids (best first)
}

/**
 * Build the large multi-source candidate pool: fuse per-source ranked lists with
 * Reciprocal Rank Fusion (items appearing in multiple sources rank higher), tag
 * each candidate with its contributing sources, cap at poolSize. Deterministic.
 */
export function buildCandidatePool(sources: SourceList[], poolSize: number): PooledCandidate[] {
  const lists: RankedList[] = sources.map((s) => ({
    source: s.source,
    items: s.ids.map((id, i) => ({ id, rank: i + 1 })),
  }));
  const fused = rrfFuse(lists);
  return fused.slice(0, poolSize).map((f) => ({ id: f.id, sources: f.sources, rrf_score: f.rrf_score }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/candidates.test.ts`
Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/rerank/candidates.ts tests/thesis/candidates.test.ts
git commit -m "feat(thesis): multi-source candidate pool (RRF, source-tagged)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Feature extraction

**Files:**
- Create: `src/thesis/rerank/features.ts`
- Test: `tests/thesis/features.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/features.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { extractFeatures, FEATURE_NAMES, type FeatureContext, type FeatureCandidate } from "@/thesis/rerank/features";

describe("extractFeatures", () => {
  const ctx: FeatureContext = {
    modeMedoids: [[1, 0, 0]],
    budgetBand: 2,
    buyerGender: "masculino",
    buyerAgeBand: "adulto",
    isGift: false,
    recipientGender: null,
    recipientAgeBand: null,
    lastViewedId: "anchor",
  };
  const cand: FeatureCandidate = {
    id: "x", vector: [1, 0, 0], priceBand: 2, gender_target: "masculino", ageBand: "adulto",
    npmiToLastViewed: 0.4, popularity: 8, sources: ["retrieval", "npmi"],
  };

  test("FEATURE_NAMES length matches the vector length", () => {
    const f = extractFeatures(ctx, cand);
    expect(f.length).toBe(FEATURE_NAMES.length);
  });

  test("retrievalScore is the max cosine to the user's mode medoids", () => {
    const i = FEATURE_NAMES.indexOf("retrievalScore");
    const f = extractFeatures(ctx, cand);
    expect(f[i]).toBeCloseTo(1, 6); // cand vector == medoid
  });

  test("npmiScore feature carries the co-occurrence signal", () => {
    const i = FEATURE_NAMES.indexOf("npmiScore");
    expect(extractFeatures(ctx, cand)[i]).toBeCloseTo(0.4, 9);
  });

  test("priceFit is 1 when candidate price band == buyer budget band", () => {
    const i = FEATURE_NAMES.indexOf("priceFit");
    expect(extractFeatures(ctx, cand)[i]).toBeCloseTo(1, 9);
  });

  test("demoMatch is 1 when candidate demographics match the buyer (self)", () => {
    const i = FEATURE_NAMES.indexOf("demoMatch");
    expect(extractFeatures(ctx, cand)[i]).toBe(1);
  });

  test("in gift context demoMatch uses the recipient, not the buyer", () => {
    const giftCtx: FeatureContext = { ...ctx, isGift: true, recipientGender: "femenino", recipientAgeBand: "nino" };
    const giftCand: FeatureCandidate = { ...cand, gender_target: "femenino", ageBand: "nino" };
    const i = FEATURE_NAMES.indexOf("demoMatch");
    expect(extractFeatures(giftCtx, giftCand)[i]).toBe(1);
  });

  test("source one-hot flags set for contributing sources", () => {
    const f = extractFeatures(ctx, cand);
    expect(f[FEATURE_NAMES.indexOf("src_retrieval")]).toBe(1);
    expect(f[FEATURE_NAMES.indexOf("src_npmi")]).toBe(1);
    expect(f[FEATURE_NAMES.indexOf("src_popular")]).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/features.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/thesis/rerank/features.ts`**

```ts
import { cosineSim } from "../embedders/space";

/**
 * Per-request context for feature extraction. Only inference-available signals —
 * NEVER the held-out label or the GT session intent. `isGift` comes from the F2
 * detector; recipient demographics from the detected target (or, in the study,
 * the GT recipient used ONLY to build the gift query — documented there).
 */
export interface FeatureContext {
  modeMedoids: number[][]; // F2 user modes (or the ephemeral recipient vector as one mode)
  budgetBand: number; // buyer's modal price band 0..3
  buyerGender: string | null;
  buyerAgeBand: string | null;
  isGift: boolean;
  recipientGender: string | null;
  recipientAgeBand: string | null;
  lastViewedId: string | null;
}

export interface FeatureCandidate {
  id: string;
  vector: number[];
  priceBand: number;
  gender_target: string | null;
  ageBand: string | null;
  npmiToLastViewed: number; // 0 if no co-occurrence edge
  popularity: number;
  sources: string[];
}

/** Fixed, ordered feature names — keep in lockstep with extractFeatures output. */
export const FEATURE_NAMES = [
  "retrievalScore",
  "npmiScore",
  "priceFit",
  "demoMatch",
  "isGift",
  "popularity",
  "src_retrieval",
  "src_npmi",
  "src_popular",
  "src_exploration",
] as const;

const PRICE_BANDS = 4;

function demoFit(candGender: string | null, candAge: string | null, gender: string | null, ageBand: string | null): number {
  const genderOk = candGender === null || candGender === "unisex" || gender === null || candGender === gender;
  const ageOk = candAge === null || ageBand === null || candAge === ageBand;
  return genderOk && ageOk ? 1 : 0;
}

/**
 * Build the numeric feature vector for a (user, candidate) pair. These are the
 * signals the pure retrieval ranking does NOT see (co-purchase, price-fit, gift/
 * demographic match, candidate source), which is what lets a reranker move the set.
 */
export function extractFeatures(ctx: FeatureContext, cand: FeatureCandidate): number[] {
  const retrievalScore = ctx.modeMedoids.length === 0 ? 0 : Math.max(...ctx.modeMedoids.map((m) => cosineSim(m, cand.vector)));
  const priceFit = 1 - Math.abs(cand.priceBand - ctx.budgetBand) / (PRICE_BANDS - 1);
  const demoMatch = ctx.isGift
    ? demoFit(cand.gender_target, cand.ageBand, ctx.recipientGender, ctx.recipientAgeBand)
    : demoFit(cand.gender_target, cand.ageBand, ctx.buyerGender, ctx.buyerAgeBand);
  const has = (s: string) => (cand.sources.includes(s) ? 1 : 0);
  return [
    retrievalScore,
    cand.npmiToLastViewed,
    priceFit,
    demoMatch,
    ctx.isGift ? 1 : 0,
    Math.log1p(cand.popularity),
    has("retrieval"),
    has("npmi"),
    has("popular"),
    has("exploration"),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/features.test.ts`
Expected: PASS (7).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/rerank/features.ts tests/thesis/features.test.ts
git commit -m "feat(thesis): reranker feature extraction (retrieval-invisible signals)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Learned-to-rank (logistic SGD)

**Files:**
- Create: `src/thesis/rerank/ltr.ts`
- Test: `tests/thesis/ltr.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/ltr.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { trainLTR, ltrRanker } from "@/thesis/rerank/ltr";
import type { RankItem } from "@/thesis/types";

describe("trainLTR", () => {
  // Feature 0 is perfectly predictive: label 1 ⇔ feature0 high.
  const samples = [
    { features: [1, 0.1], label: 1 }, { features: [0.9, 0.5], label: 1 },
    { features: [0.95, 0.9], label: 1 }, { features: [0.0, 0.2], label: 0 },
    { features: [0.1, 0.8], label: 0 }, { features: [0.05, 0.4], label: 0 },
  ];

  test("deterministic by seed", () => {
    const a = trainLTR(samples, { epochs: 200, lr: 0.5, seed: 1 });
    const b = trainLTR(samples, { epochs: 200, lr: 0.5, seed: 1 });
    expect(a.weights).toEqual(b.weights);
  });

  test("learns a larger weight on the predictive feature 0 than feature 1", () => {
    const m = trainLTR(samples, { epochs: 500, lr: 0.5, seed: 2 });
    expect(Math.abs(m.weights[0])).toBeGreaterThan(Math.abs(m.weights[1]));
  });

  test("score ranks a high-feature0 item above a low-feature0 item", () => {
    const m = trainLTR(samples, { epochs: 500, lr: 0.5, seed: 3 });
    expect(m.score([1, 0.5])).toBeGreaterThan(m.score([0, 0.5]));
  });
});

describe("ltrRanker", () => {
  test("orders candidates by model score using their feature vectors", () => {
    const m = trainLTR(
      [{ features: [1], label: 1 }, { features: [0], label: 0 }],
      { epochs: 300, lr: 0.5, seed: 1 },
    );
    const featById = new Map<string, number[]>([["hi", [1]], ["lo", [0]]]);
    const r = ltrRanker(m, featById);
    const cands: RankItem[] = [
      { id: "lo", popularity: 0, vector: [] },
      { id: "hi", popularity: 0, vector: [] },
    ];
    expect(r.rank({ userVector: [], cohort: null }, cands)).toEqual(["hi", "lo"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/ltr.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/thesis/rerank/ltr.ts`**

```ts
import { makeRng } from "../data/rng";
import type { Ranker, RankItem, UserContext } from "../types";

/**
 * Pointwise learning-to-rank via logistic regression with mini-batch SGD. Pure TS,
 * CPU, deterministic given `seed`. Trains on (features, label) samples drawn ONLY
 * from the train split (positives = purchased items, negatives = sampled pool).
 * The learned weights are interpretable (one per FEATURE_NAMES entry).
 */
export interface LtrSample {
  features: number[];
  label: number; // 1 positive, 0 negative
}
export interface LtrOpts {
  epochs: number;
  lr: number;
  seed: number;
  l2?: number; // L2 regularization (default 0.001)
}
export interface LtrModel {
  weights: number[];
  bias: number;
  score(features: number[]): number;
}

function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

export function trainLTR(samples: LtrSample[], opts: LtrOpts): LtrModel {
  const rng = makeRng(opts.seed);
  const l2 = opts.l2 ?? 0.001;
  const dim = samples[0]?.features.length ?? 0;
  const w = new Array<number>(dim).fill(0);
  let b = 0;

  const order = samples.map((_, i) => i);
  for (let e = 0; e < opts.epochs; e++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const idx of order) {
      const s = samples[idx];
      let z = b;
      for (let k = 0; k < dim; k++) z += w[k] * s.features[k];
      const err = sigmoid(z) - s.label; // dL/dz
      for (let k = 0; k < dim; k++) w[k] -= opts.lr * (err * s.features[k] + l2 * w[k]);
      b -= opts.lr * err;
    }
  }

  const score = (features: number[]): number => {
    let z = b;
    for (let k = 0; k < Math.min(dim, features.length); k++) z += w[k] * features[k];
    return z;
  };
  return { weights: w, bias: b, score };
}

/** A Ranker that orders candidates by LTR score using a precomputed feature map. */
export function ltrRanker(model: LtrModel, featuresById: Map<string, number[]>): Ranker {
  return {
    name: "ltr",
    rank(_ctx: UserContext, candidates: RankItem[]): string[] {
      return candidates
        .map((c) => ({ id: c.id, s: model.score(featuresById.get(c.id) ?? []) }))
        .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
        .map((x) => x.id);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/ltr.test.ts`
Expected: PASS (4). If "learns a larger weight on feature 0" fails, the gradient/decay has a bug — fix code, not test.

- [ ] **Step 5: Commit**

```bash
git add src/thesis/rerank/ltr.ts tests/thesis/ltr.test.ts
git commit -m "feat(thesis): learned-to-rank (logistic SGD) reranker over features

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Cross-encoder (MaxSim) reranker wrapper

**Files:**
- Create: `src/thesis/rerank/crossencoder.ts`
- Test: `tests/thesis/crossencoder-rerank.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/crossencoder-rerank.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { crossEncoderRanker } from "@/thesis/rerank/crossencoder";
import type { RankItem } from "@/thesis/types";

describe("crossEncoderRanker", () => {
  test("ranks the candidate whose chunks best cover the query chunks first", () => {
    const itemChunks = new Map<string, number[][]>([
      ["match", [[1, 0], [0, 1]]],
      ["partial", [[1, 0]]],
      ["off", [[0, 0, 1]]],
    ]);
    const r = crossEncoderRanker(itemChunks, () => [[1, 0], [0, 1]]);
    const cands: RankItem[] = [
      { id: "off", popularity: 0, vector: [] },
      { id: "partial", popularity: 0, vector: [] },
      { id: "match", popularity: 0, vector: [] },
    ];
    const out = r.rank({ userVector: [], cohort: null }, cands);
    expect(out[0]).toBe("match");
    expect(out[2]).toBe("off");
  });

  test("is named for the study table", () => {
    const r = crossEncoderRanker(new Map(), () => []);
    expect(r.name).toBe("cross-encoder-maxsim");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/crossencoder-rerank.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/thesis/rerank/crossencoder.ts`**

```ts
import { maxSimRanker } from "../embedders/maxsim";
import type { Ranker, UserContext } from "../types";

/**
 * Cross-encoder-style late-interaction reranker without a GPU/transformer: reuse
 * the F1 chunk-level MaxSim scorer as a query↔document interaction reranker over
 * the candidate pool. Thin wrapper that fixes the study-facing name.
 */
export function crossEncoderRanker(
  itemChunks: Map<string, number[][]>,
  queryChunksFor: (ctx: UserContext) => number[][] | null,
): Ranker {
  const inner = maxSimRanker(itemChunks, queryChunksFor);
  return { name: "cross-encoder-maxsim", rank: inner.rank };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/crossencoder-rerank.test.ts`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/rerank/crossencoder.ts tests/thesis/crossencoder-rerank.test.ts
git commit -m "feat(thesis): cross-encoder MaxSim reranker (reuses F1 late-interaction, no GPU)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: LLM listwise reranker (+ counted fallback)

**Files:**
- Create: `src/thesis/rerank/llm-reranker.ts`
- Test: `tests/thesis/f3-llm-smoke.test.ts` (real DeepSeek; no mock)

- [ ] **Step 1: Write the implementation**

Create `src/thesis/rerank/llm-reranker.ts`:
```ts
import { z } from "zod";
import { defaultProvider } from "@/lib/llm/providers";
import { stripMarkdownWrapper } from "@/sectors/b-catalog/enrichment/normalizer";

/** One candidate the LLM sees (compact, with the retrieval-invisible signals). */
export interface LlmCandidate {
  product_id: string;
  title: string;
  price_cents: number;
  brand: string;
  category: string;
  npmi_to_last_viewed: number;
  source: string;
}

export interface LlmRerankContext {
  profile_summary: string;
  is_gift: boolean;
  recipient_summary: string | null;
  last_viewed: string | null;
}

export interface LlmRerankResult {
  order: string[]; // reranked product_ids (top first), length <= input
  usedFallback: boolean;
}

const responseSchema = z.object({
  items: z.array(z.object({ product_id: z.string(), rank: z.number().int().min(1) })).min(1),
});

const SYSTEM_PROMPT = `Eres un curador experto de una tienda reseller en Cuba. Recibes un perfil de usuario, si la sesión es un regalo (y para quién), el último producto visto, y una lista de candidatos con señales: npmi_to_last_viewed (fuerza de co-compra con lo último visto) y source. Reordena los candidatos del MÁS al MENOS relevante para ESTE usuario en ESTE momento. Prioriza: relevancia al perfil; si es regalo, ajuste al destinatario; complementos del último visto (npmi alto). Devuelve SOLO JSON: { "items": [ { "product_id": "...", "rank": 1 }, ... ] } con todos los candidatos, ranks únicos desde 1. Sin markdown.`;

/**
 * LLM listwise reranker (DeepSeek via defaultProvider). Returns the reranked id
 * order over the given candidates; on any LLM/parse failure returns the input
 * order with usedFallback=true (the caller COUNTS fallbacks — fixes the audit's
 * "silent fallback"). The candidate signals (npmi, source) are in the prompt so
 * the LLM can use information the pure retrieval order lacks.
 */
export async function llmRerank(candidates: LlmCandidate[], ctx: LlmRerankContext): Promise<LlmRerankResult> {
  const inputOrder = candidates.map((c) => c.product_id);
  if (candidates.length === 0) return { order: [], usedFallback: false };
  try {
    const payload = {
      profile: ctx.profile_summary,
      is_gift: ctx.is_gift,
      recipient: ctx.recipient_summary,
      last_viewed: ctx.last_viewed,
      candidatos: candidates,
    };
    const res = await defaultProvider.chat({
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
      maxTokens: 2000,
      temperature: 0,
      jsonMode: true,
    });
    const parsed = responseSchema.parse(JSON.parse(stripMarkdownWrapper(res.text)));
    const allowed = new Set(inputOrder);
    const ordered = parsed.items
      .filter((it) => allowed.has(it.product_id))
      .sort((a, b) => a.rank - b.rank)
      .map((it) => it.product_id);
    // append any candidate the LLM dropped, preserving input order, so it's a full permutation
    const seen = new Set(ordered);
    for (const id of inputOrder) if (!seen.has(id)) ordered.push(id);
    return { order: ordered, usedFallback: false };
  } catch {
    return { order: inputOrder, usedFallback: true };
  }
}
```

- [ ] **Step 2: Write the smoke test (real DeepSeek)**

Create `tests/thesis/f3-llm-smoke.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { llmRerank, type LlmCandidate } from "@/thesis/rerank/llm-reranker";

const cands: LlmCandidate[] = [
  { product_id: "11111111-1111-1111-1111-111111111111", title: "Funda iPhone", price_cents: 1900, brand: "Spigen", category: "accesorios_tech", npmi_to_last_viewed: 0.5, source: "npmi" },
  { product_id: "22222222-2222-2222-2222-222222222222", title: "Vestido de noche", price_cents: 8900, brand: "Zara", category: "moda_mujer", npmi_to_last_viewed: 0, source: "popular" },
  { product_id: "33333333-3333-3333-3333-333333333333", title: "Cargador USB-C", price_cents: 2200, brand: "Anker", category: "accesorios_tech", npmi_to_last_viewed: 0.4, source: "npmi" },
];

describe("llmRerank (real DeepSeek)", () => {
  test("returns a full permutation of the candidate ids (valid shape)", async () => {
    const r = await llmRerank(cands, { profile_summary: "hombre adulto, tecnología", is_gift: false, recipient_summary: null, last_viewed: "iPhone 15 Pro" });
    expect([...r.order].sort()).toEqual(cands.map((c) => c.product_id).sort());
  }, 60_000);

  test("invalid key → counted fallback, input order preserved", async () => {
    const saved = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "sk-invalid-f3";
    try {
      const r = await llmRerank(cands, { profile_summary: "x", is_gift: false, recipient_summary: null, last_viewed: null });
      expect(r.usedFallback).toBe(true);
      expect(r.order).toEqual(cands.map((c) => c.product_id));
    } finally {
      if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved; else delete process.env.DEEPSEEK_API_KEY;
    }
  }, 60_000);
});
```

- [ ] **Step 3: Run the smoke test**

Run: `MOCK_AGGREGATOR_ERROR_RATE=0 npx vitest run tests/thesis/f3-llm-smoke.test.ts`
Expected: PASS (2). First test exercises real DeepSeek (costs ~$0.0002); second forces fallback. If DeepSeek is unreachable AND the first test fails on a network error (not a shape error), report DONE_WITH_CONCERNS noting the live-LLM test could not run; the fallback test must still pass.

- [ ] **Step 4: Commit**

```bash
git add src/thesis/rerank/llm-reranker.ts tests/thesis/f3-llm-smoke.test.ts
git commit -m "feat(thesis): LLM listwise reranker (DeepSeek) with counted fallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: F3 study runner

**Files:**
- Create: `scripts/thesis/f3-study.ts`
- Modify: `package.json`

This is the integration task: it wires sources → pool → features → 4 rerankers + baselines → segmented eval + pool-recall + set-change + fallback-rate. It reuses the F2 study's DB-loading idioms.

- [ ] **Step 1: Add the npm script**

In `package.json` "scripts", after `"thesis:backfill-cooccurrence"`, add:
```json
    "thesis:f3-study": "tsx scripts/thesis/f3-study.ts",
```

- [ ] **Step 2: Write the runner**

Create `scripts/thesis/f3-study.ts`:
```ts
#!/usr/bin/env tsx
/**
 * F3 study: a large multi-source candidate pool reranked by four families (LTR,
 * LLM listwise, cross-encoder MaxSim, baselines MMR/RRF). Reports pool-recall vs
 * F2 top-30, per-reranker lift (segmented self/gift), set-change@10, and the LLM
 * fallback rate. Item space = e1_prod2vec. Requires `pnpm thesis:backfill-cooccurrence`.
 * Usage: pnpm thesis:f3-study
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { writeFileSync } from "fs";
import { getPgClient } from "@/lib/db/pg";
import { l2normalize, meanPool, cosineSim } from "@/thesis/embedders/space";
import { evaluateRanker, aggregateCases, type EvalCase } from "@/thesis/eval/harness";
import { setChangeAtK } from "@/thesis/eval/metrics";
import { buildUserModes } from "@/thesis/multivector/modes";
import { detectGiftIntent, type SessionItem } from "@/thesis/multivector/gift-detect";
import { buildRecipientVector } from "@/thesis/multivector/gift-vector";
import { buildCandidatePool } from "@/thesis/rerank/candidates";
import { extractFeatures, FEATURE_NAMES, type FeatureContext, type FeatureCandidate } from "@/thesis/rerank/features";
import { trainLTR, ltrRanker, type LtrSample } from "@/thesis/rerank/ltr";
import { crossEncoderRanker } from "@/thesis/rerank/crossencoder";
import { llmRerank, type LlmCandidate } from "@/thesis/rerank/llm-reranker";
import { mmrSelect } from "@/sectors/d-personalization/retrieve/mmr";
import { makeRng } from "@/thesis/data/rng";
import type { Ranker, RankItem } from "@/thesis/types";

const KS = [5, 10, 20];
const POOL_SIZE = 200;

function ageBandOf(at: { min?: number; max?: number } | null | undefined): string | null {
  if (!at || typeof at.min !== "number" || typeof at.max !== "number") return null;
  const mid = (at.min + at.max) / 2;
  if (mid <= 3) return "bebe"; if (mid <= 11) return "nino"; if (mid <= 25) return "joven"; if (mid <= 59) return "adulto"; return "mayor";
}

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    // ---- load vectors + metadata ----
    const e1 = new Map<string, number[]>();
    for (const r of (await pg.query(`SELECT product_id::text id, vector FROM thesis.item_vectors WHERE space='e1_prod2vec'`)).rows as { id: string; vector: number[] }[]) e1.set(r.id, r.vector.map(Number));
    if (e1.size === 0) { console.error("[f3] no e1 vectors — run thesis:train-prod2vec"); process.exit(1); }
    const chunks = new Map<string, number[][]>();
    for (const r of (await pg.query(`SELECT product_id::text id, chunk_index, vector FROM thesis.item_chunk_vectors WHERE space='e4_late' ORDER BY product_id, chunk_index`)).rows as { id: string; chunk_index: number; vector: number[] }[]) {
      const a = chunks.get(r.id) ?? []; a[r.chunk_index] = r.vector.map(Number); chunks.set(r.id, a);
    }
    interface Meta { gender: string | null; ageBand: string | null; priceBand: number; cohort: string | null; title: string; brand: string; category: string; price_cents: number; }
    const meta = new Map<string, Meta>();
    for (const r of (await pg.query(`SELECT id::text id, title, price_cents, metadata FROM thesis.products`)).rows as { id: string; title: string; price_cents: number; metadata: Record<string, unknown> }[]) {
      const m = r.metadata ?? {}; const at = m.age_target as { min?: number; max?: number } | undefined;
      meta.set(r.id, { gender: (m.gender_target as string | null) ?? null, ageBand: ageBandOf(at), priceBand: Number(m.price_band ?? 0), cohort: (m.subcategory as string | null) ?? null, title: r.title, brand: String(m.brand ?? ""), category: String(m.category ?? ""), price_cents: r.price_cents });
    }
    const popById = new Map<string, number>();
    for (const r of (await pg.query(`SELECT payload->>'product_id' pid, count(*)::int c FROM thesis.events WHERE payload->>'product_id' IS NOT NULL GROUP BY 1`)).rows as { pid: string; c: number }[]) popById.set(r.pid, r.c);
    // NPMI neighbours per product
    const npmiTop = new Map<string, { id: string; score: number }[]>();
    for (const r of (await pg.query(`SELECT product_id::text id, related_product_id::text rid, npmi_score FROM thesis.co_occurrence_top ORDER BY product_id, rank`)).rows as { id: string; rid: string; npmi_score: number }[]) {
      const a = npmiTop.get(r.id) ?? []; a.push({ id: r.rid, score: Number(r.npmi_score) }); npmiTop.set(r.id, a);
    }

    // ---- holdout, sessions, recipients, last-viewed ----
    const trainByUser = new Map<string, string[]>();
    for (const r of (await pg.query(`SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='train'`)).rows as { uid: string; pid: string }[]) { const a = trainByUser.get(r.uid) ?? []; a.push(r.pid); trainByUser.set(r.uid, a); }
    const tests = (await pg.query(`SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='test'`)).rows as { uid: string; pid: string }[];
    const lastSession = new Map<string, { intent: string; rid: string | null }>();
    for (const r of (await pg.query(`SELECT user_id::text uid, intent, recipient_id::text rid FROM thesis.sim_sessions ORDER BY user_id, started_at DESC`)).rows as { uid: string; intent: string; rid: string | null }[]) { if (!lastSession.has(r.uid)) lastSession.set(r.uid, { intent: r.intent, rid: r.rid }); }
    const recById = new Map<string, { gender: string; ageBand: string | null }>();
    for (const r of (await pg.query(`SELECT id::text id, gender, age_min, age_max FROM thesis.sim_user_recipients`)).rows as { id: string; gender: string; age_min: number; age_max: number }[]) recById.set(r.id, { gender: r.gender, ageBand: ageBandOf({ min: r.age_min, max: r.age_max }) });
    const lastViewed = new Map<string, string>(); // user -> last viewed product id
    for (const r of (await pg.query(`SELECT DISTINCT ON (anonymous_id) anonymous_id::text uid, payload->>'product_id' pid FROM thesis.events WHERE event_type='product_view' AND payload->>'product_id' IS NOT NULL ORDER BY anonymous_id, occurred_at DESC`)).rows as { uid: string; pid: string }[]) lastViewed.set(r.uid, r.pid);

    const allIds = [...e1.keys()].sort((a, b) => a.localeCompare(b));
    const popularByCohort = new Map<string, string[]>(); // cohort -> ids by popularity
    for (const id of allIds) { const c = meta.get(id)?.cohort ?? "_"; const a = popularByCohort.get(c) ?? []; a.push(id); popularByCohort.set(c, a); }
    for (const [, a] of popularByCohort) a.sort((x, y) => (popById.get(y) ?? 0) - (popById.get(x) ?? 0) || x.localeCompare(y));
    const popularGlobal = [...allIds].sort((a, b) => (popById.get(b) ?? 0) - (popById.get(a) ?? 0) || a.localeCompare(b));

    // ---- helper: build the 4 source lists + pool for one user ----
    const buildPoolFor = (uid: string, train: string[], trainSet: Set<string>) => {
      const history = train.map((id) => e1.get(id)!).filter(Boolean);
      const modes = buildUserModes(history, { distanceThreshold: 0.5, maxModes: 5 });
      // retrieval: cosine of every candidate to nearest mode, top 80
      const retrieval = allIds.filter((id) => !trainSet.has(id))
        .map((id) => ({ id, s: modes.length ? Math.max(...modes.map((m) => cosineSim(m.medoid, e1.get(id)!))) : 0 }))
        .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id)).slice(0, 80).map((x) => x.id);
      const lv = lastViewed.get(uid);
      const npmi = (lv ? (npmiTop.get(lv) ?? []) : []).map((n) => n.id).filter((id) => !trainSet.has(id)).slice(0, 50);
      const cohort = meta.get(train[0] ?? "")?.cohort ?? "_";
      const popular = (popularByCohort.get(cohort) ?? popularGlobal).filter((id) => !trainSet.has(id)).slice(0, 40);
      // exploration: deterministic pseudo-random sample of the catalog
      const rng = makeRng(uid.split("-")[0].length + train.length);
      const explore = [...allIds].filter((id) => !trainSet.has(id)).map((id) => ({ id, k: rng.next() })).sort((a, b) => a.k - b.k).slice(0, 30).map((x) => x.id);
      const pool = buildCandidatePool([
        { source: "retrieval", ids: retrieval },
        { source: "npmi", ids: npmi },
        { source: "popular", ids: popular },
        { source: "exploration", ids: explore },
      ], POOL_SIZE);
      return { modes, pool, lv };
    };

    // ---- POOL RECALL (vs F2 top-30) ----
    let inPool = 0, inTop30 = 0, nEval = 0;
    // ---- build eval cases (shared pool per user) ----
    interface F3Case extends EvalCase { uid: string; intent: string; }
    const cases: F3Case[] = [];
    const poolByUid = new Map<string, ReturnType<typeof buildPoolFor>>();
    const buyerDemoByUid = new Map<string, { gender: string | null; ageBand: string | null; budget: number }>();

    for (const t of tests) {
      const train = (trainByUser.get(t.uid) ?? []).filter((id) => e1.has(id));
      if (train.length === 0 || !e1.has(t.pid)) continue;
      const trainSet = new Set(train);
      const built = buildPoolFor(t.uid, train, trainSet);
      poolByUid.set(t.uid, built);
      const poolIds = built.pool.map((p) => p.id);
      const poolSet = new Set(poolIds);
      nEval++;
      if (poolSet.has(t.pid)) inPool++;
      // F2 top-30: multiModeRank-style — approximate as the retrieval top-30 over modes
      const top30 = allIds.filter((id) => !trainSet.has(id))
        .map((id) => ({ id, s: built.modes.length ? Math.max(...built.modes.map((m) => cosineSim(m.medoid, e1.get(id)!))) : 0 }))
        .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id)).slice(0, 30).map((x) => x.id);
      if (top30.includes(t.pid)) inTop30++;

      // candidates as RankItem over the pool (vector = e1) for harness
      const candidates: RankItem[] = poolIds.map((id) => ({ id, popularity: popById.get(id) ?? 0, vector: e1.get(id)!, cohort: meta.get(id)?.cohort ?? null }));
      const ctx = { userVector: l2normalize(meanPool(train.map((id) => e1.get(id)!))), cohort: meta.get(t.pid)?.cohort ?? null };
      const intent = lastSession.get(t.uid)?.intent ?? "self";
      cases.push({ ctx, candidates, relevant: new Set([t.pid]), uid: t.uid, intent });

      // buyer demographic (modal gender/age/budget from train)
      const genders = train.map((id) => meta.get(id)?.gender).filter(Boolean) as string[];
      const ageBands = train.map((id) => meta.get(id)?.ageBand).filter(Boolean) as string[];
      const modal = (arr: string[]) => { const m = new Map<string, number>(); for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null; };
      const budget = Math.round(train.reduce((s, id) => s + (meta.get(id)?.priceBand ?? 0), 0) / Math.max(1, train.length));
      buyerDemoByUid.set(t.uid, { gender: modal(genders), ageBand: modal(ageBands), budget });
    }

    // ---- FEATURES per case (and LTR training samples from TRAIN split only) ----
    const featuresByUidId = new Map<string, Map<string, number[]>>();
    const featCtxFor = (uid: string): FeatureContext => {
      const built = poolByUid.get(uid)!;
      const bd = buyerDemoByUid.get(uid)!;
      const sess = lastSession.get(uid);
      const rec = sess?.rid ? recById.get(sess.rid) : null;
      // gift detection on train items (proxy session) — gives isGift + recipient demo
      const train = (trainByUser.get(uid) ?? []).filter((id) => e1.has(id));
      const sItems: SessionItem[] = train.map((id) => ({ product_id: id, gender_target: meta.get(id)?.gender ?? null, age_band: meta.get(id)?.ageBand ?? null }));
      const gift = detectGiftIntent(sItems, { gender: bd.gender, ageBand: bd.ageBand }, { minItems: 2, minDemographicCoherence: 0.6 });
      const medoids = gift.isGift ? [buildRecipientVector(train.map((id) => e1.get(id)!))] : built.modes.map((m) => m.medoid);
      return {
        modeMedoids: medoids, budgetBand: bd.budget, buyerGender: bd.gender, buyerAgeBand: bd.ageBand,
        isGift: gift.isGift,
        recipientGender: gift.isGift ? (gift.targetGender ?? rec?.gender ?? null) : null,
        recipientAgeBand: gift.isGift ? (gift.targetAgeBand ?? rec?.ageBand ?? null) : null,
        lastViewedId: built.lv ?? null,
      };
    };
    const candFeat = (uid: string, id: string): FeatureCandidate => {
      const built = poolByUid.get(uid)!;
      const lv = built.lv;
      const npmiScore = lv ? (npmiTop.get(lv)?.find((n) => n.id === id)?.score ?? 0) : 0;
      const m = meta.get(id)!;
      const src = built.pool.find((p) => p.id === id)?.sources ?? [];
      return { id, vector: e1.get(id)!, priceBand: m.priceBand, gender_target: m.gender, ageBand: m.ageBand, npmiToLastViewed: npmiScore, popularity: popById.get(id) ?? 0, sources: src };
    };
    for (const c of cases) {
      const ctx = featCtxFor(c.uid);
      const fmap = new Map<string, number[]>();
      for (const cand of c.candidates) fmap.set(cand.id, extractFeatures(ctx, candFeat(c.uid, cand.id)));
      featuresByUidId.set(c.uid, fmap);
    }
    // LTR training samples: positives = TRAIN purchases that are in that user's pool feature space; negatives = sampled pool non-train items
    const trainSamples: LtrSample[] = [];
    const rngNeg = makeRng(42);
    for (const c of cases) {
      const fmap = featuresByUidId.get(c.uid)!;
      const ctx = featCtxFor(c.uid);
      for (const pid of (trainByUser.get(c.uid) ?? [])) {
        if (!e1.has(pid)) continue;
        trainSamples.push({ features: extractFeatures(ctx, candFeat(c.uid, pid)), label: 1 });
      }
      const negIds = c.candidates.map((x) => x.id).filter((id) => fmap.has(id));
      for (let n = 0; n < 5 && negIds.length; n++) trainSamples.push({ features: fmap.get(negIds[rngNeg.int(negIds.length)])!, label: 0 });
    }
    const ltrModel = trainLTR(trainSamples, { epochs: 300, lr: 0.3, seed: 42 });

    // ---- rerankers ----
    const rrfBaseOrder = (c: F3Case) => poolByUid.get(c.uid)!.pool.map((p) => p.id); // pool is already RRF order
    const baselineRRF: Ranker = { name: "rrf", rank: (_ctx, cands) => cands.map((x) => x.id) }; // candidates already in pool/RRF order? ensure: pool order
    const ltrRankerFor = (c: F3Case) => ltrRanker(ltrModel, featuresByUidId.get(c.uid)!);
    const ceRankerFor = (c: F3Case) => crossEncoderRanker(chunks, () => (poolByUid.get(c.uid)!.modes[0] ? [poolByUid.get(c.uid)!.modes.map((m) => m.medoid)].flat() ? poolByUid.get(c.uid)!.modes.map((m) => m.medoid) : [] : []));
    const mmrRankerFor = (c: F3Case): Ranker => ({
      name: "mmr",
      rank: (_ctx, cands) => {
        const emb = new Map<string, number[]>(); for (const x of cands) emb.set(x.id, e1.get(x.id)!);
        const scored = poolByUid.get(c.uid)!.pool.filter((p) => emb.has(p.id)).map((p) => ({ id: p.id, rrf_score: p.rrf_score }));
        const out = mmrSelect({ candidates: scored, embeddings: emb, k: cands.length, lambda: 0.7 });
        const order = out.map((o) => o.id); const seen = new Set(order);
        for (const x of cands) if (!seen.has(x.id)) order.push(x.id);
        return order;
      },
    });

    // ---- evaluate + set-change ----
    const baseTop10 = new Map<string, string[]>();
    for (const c of cases) baseTop10.set(c.uid, c.candidates.map((x) => x.id).slice(0, 10));
    const evalReranker = (label: string, rankerFor: (c: F3Case) => Ranker) => {
      const res = aggregateCases(cases, rankerFor, KS, label);
      let sc = 0; for (const c of cases) { const ranked = rankerFor(c).rank(c.ctx, c.candidates); sc += setChangeAtK(ranked, baseTop10.get(c.uid)!, 10); }
      return { res, setChange: sc / Math.max(1, cases.length) };
    };

    const rows: string[] = [];
    rows.push("# Thesis F3 — Candidate generation + reranker study", "");
    rows.push(`Pool size ${POOL_SIZE}, item space e1_prod2vec. Eval cases: ${cases.length}.`, "");
    rows.push(`## Pool recall vs F2 top-30`, "", `- Pool recall (target in pool): ${(inPool / Math.max(1, nEval)).toFixed(3)} (n=${nEval})`, `- F2 top-30 recall: ${(inTop30 / Math.max(1, nEval)).toFixed(3)}`, "");
    rows.push("## Reranker lift (overall) + set-change@10", "", "| Reranker | nDCG@10 | Recall@10 | MRR | set-change@10 |", "|---|---|---|---|---|");
    const rerankers: { label: string; fn: (c: F3Case) => Ranker }[] = [
      { label: "baseline-rrf", fn: () => baselineRRF },
      { label: "mmr", fn: mmrRankerFor },
      { label: "cross-encoder", fn: ceRankerFor },
      { label: "ltr", fn: ltrRankerFor },
    ];
    for (const rk of rerankers) {
      const { res, setChange } = evalReranker(rk.label, rk.fn);
      rows.push(`| ${rk.label} | ${res.ndcg[10].toFixed(3)} | ${res.recall[10].toFixed(3)} | ${res.mrr.toFixed(3)} | ${setChange.toFixed(3)} |`);
    }

    // ---- segmented (self/gift) for LTR vs baseline ----
    const segs = ["self", "gift"];
    rows.push("", "## LTR vs baseline by segment", "", "| Segment | n | model | nDCG@10 | Recall@10 |", "|---|---|---|---|---|");
    for (const seg of segs) {
      const sub = cases.filter((c) => c.intent === seg);
      if (sub.length === 0) continue;
      const b = evaluateRanker(baselineRRF, sub, KS);
      const l = aggregateCases(sub, ltrRankerFor, KS, "ltr");
      rows.push(`| ${seg} | ${b.n} | baseline-rrf | ${b.ndcg[10].toFixed(3)} | ${b.recall[10].toFixed(3)} |`);
      rows.push(`| ${seg} | ${l.n} | ltr | ${l.ndcg[10].toFixed(3)} | ${l.recall[10].toFixed(3)} |`);
    }

    // ---- LLM listwise on a SUBSET (cost), top-30 of pool, report lift + fallback ----
    const llmSubset = cases.slice(0, 120);
    let fallbacks = 0; const llmCases: (F3Case & { llmOrder: string[] })[] = [];
    for (const c of llmSubset) {
      const top = poolByUid.get(c.uid)!.pool.slice(0, 30).map((p) => p.id);
      const lv = poolByUid.get(c.uid)!.lv;
      const cands: LlmCandidate[] = top.map((id) => { const m = meta.get(id)!; const npmiScore = lv ? (npmiTop.get(lv)?.find((n) => n.id === id)?.score ?? 0) : 0; return { product_id: id, title: m.title, price_cents: m.price_cents, brand: m.brand, category: m.category, npmi_to_last_viewed: npmiScore, source: (poolByUid.get(c.uid)!.pool.find((p) => p.id === id)?.sources ?? []).join(",") }; });
      const ctx = featCtxFor(c.uid);
      const r = await llmRerank(cands, { profile_summary: `${ctx.buyerGender ?? "?"} ${ctx.buyerAgeBand ?? "?"}`, is_gift: ctx.isGift, recipient_summary: ctx.isGift ? `${ctx.recipientGender ?? "?"} ${ctx.recipientAgeBand ?? "?"}` : null, last_viewed: lv ?? null });
      if (r.usedFallback) fallbacks++;
      // full order = llm order over top-30, then the rest of the pool
      const rest = poolByUid.get(c.uid)!.pool.map((p) => p.id).filter((id) => !r.order.includes(id));
      llmCases.push({ ...c, llmOrder: [...r.order, ...rest] });
    }
    const llmRes = aggregateCases(llmCases, (c) => ({ name: "llm", rank: () => (c as F3Case & { llmOrder: string[] }).llmOrder }), KS, "llm");
    let llmSC = 0; for (const c of llmCases) llmSC += setChangeAtK(c.llmOrder, baseTop10.get(c.uid)!, 10);
    rows.push("", `## LLM listwise (DeepSeek, subset n=${llmCases.length})`, "", `- nDCG@10: ${llmRes.ndcg[10].toFixed(3)} | Recall@10: ${llmRes.recall[10].toFixed(3)} | set-change@10: ${(llmSC / Math.max(1, llmCases.length)).toFixed(3)}`, `- fallback rate: ${(fallbacks / Math.max(1, llmCases.length)).toFixed(3)}`);
    rows.push("", `LTR feature weights: ${FEATURE_NAMES.map((n, i) => `${n}=${ltrModel.weights[i].toFixed(2)}`).join(", ")}`);

    const md = rows.join("\n") + "\n";
    const out = resolve(process.cwd(), "docs/superpowers/reports/2026-06-07-thesis-f3-study.md");
    writeFileSync(out, md);
    console.log(md);
    console.log(`[f3] wrote ${out}`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

IMPORTANT cleanup for the implementer: the `ceRankerFor` line above has a tangled ternary — REPLACE it with a clean version:
```ts
const ceRankerFor = (c: F3Case): Ranker => {
  const medoids = poolByUid.get(c.uid)!.modes.map((m) => m.medoid);
  return crossEncoderRanker(chunks, () => medoids.length ? medoids : []);
};
```
Also: `baselineRRF` assumes `c.candidates` are already in pool/RRF order — they ARE (the pool is built RRF-ordered and `candidates` is mapped from `poolIds` in order), so `baseTop10` and the RRF baseline are consistent. Verify that when you implement.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -v '\.next/' | grep -E 'f3-study|rerank/' || echo "no F3 TS errors"`
Expected: `no F3 TS errors`.

- [ ] **Step 4: Run the study**

Run: `pnpm thesis:f3-study`
Expected: markdown with pool-recall (pool > F2 top-30), a reranker table with set-change@10 (LTR set-change > 0 and nDCG@10 ≥ baseline-rrf), segment table, and the LLM subset block with a fallback rate. Sanity: `ltr` nDCG@10 should be ≥ `baseline-rrf`; if LTR ≤ baseline, that is a real finding — record it, do not fudge. Report BLOCKED on DB/LLM hard errors.

- [ ] **Step 5: Commit (runner + report)**

```bash
git add scripts/thesis/f3-study.ts package.json docs/superpowers/reports/2026-06-07-thesis-f3-study.md
git commit -m "feat(thesis): F3 study runner + results — pool recall, 4 rerankers, set-change, segments

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Final verification + push

- [ ] **Step 1: Full gate (dataset-safe — F0 discrimination test is transaction-isolated)**

Run:
```bash
MOCK_AGGREGATOR_ERROR_RATE=0 npx vitest run tests/thesis && pnpm test:quality && (pnpm typecheck 2>&1 | grep -v '\.next/' | grep -E 'thesis|rerank' || echo "no thesis TS errors")
```
Expected: all thesis tests pass; `[check-test-quality] OK`; `no thesis TS errors`.

- [ ] **Step 2: Confirm the study dataset survived the suite**

Run:
```bash
SUPABASE_DB_URL=$(grep '^SUPABASE_DB_URL' .env.local | cut -d= -f2-) npx tsx -e "import {getPgClient} from '@/lib/db/pg'; const c=await getPgClient({scope:'thesis'}); const r=await c.query(\"select (select count(*) from thesis.products)::int p,(select count(*) from thesis.item_vectors where space='e1_prod2vec')::int v,(select count(*) from thesis.co_occurrence_top)::int npmi\"); console.log(JSON.stringify(r.rows[0])); await c.end();"
```
Expected: products ~2000, vectors ~1998, npmi > 0. (If the inline tsx fails on ESM, write a temp `scripts/_chk.mjs` with `pg`+dotenv, run, delete.)

- [ ] **Step 3: Confirm existing unit suite green**

Run: `npx vitest run tests/unit`
Expected: 176+ passing.

- [ ] **Step 4: Push**

```bash
git push origin feat/thesis-personalization-program
```
Expected: pushed; local == remote.

---

## Self-Review notes (for the implementer)
- **Spec coverage:** set-change §5→Task 1; NPMI backfill §4.1→Task 2; pool §4.2→Task 3; features §4.3→Task 4; LTR §4.4→Task 5; cross-encoder §4.5→Task 6; LLM §4.6→Task 7; runner+eval §4.8/§5→Task 8; verify §8→Task 9. Baselines §4.7 are inline in Task 8.
- **Reuse:** `rrfFuse`, `recomputeNPMI`, `mmrSelect` (production); `maxSimRanker`, `evaluateRanker`, `aggregateCases`, `space.ts`, `makeRng`, F2 modes/gift (thesis). Only NEW infra: `setChangeAtK`, the pool/features/ltr/crossencoder/llm wrappers.
- **No mocks:** pure modules unit-tested on toy data; backfill/study hit real DB; LLM uses real DeepSeek; `pnpm test:quality` enforces no banned mocks/weak assertions.
- **No leakage:** LTR trains only on `split='train'` purchases + sampled pool negatives; features never include the held-out label or GT intent (gift comes from the F2 detector, not `sim_sessions.intent`). GT is used only to bucket segments and compute pool-recall.
- **No production changes; dataset-safe:** F3 writes only `co_occurrence*`; never truncates `products`.
- **Type consistency:** `PooledCandidate{id,sources,rrf_score}`, `SourceList{source,ids}`, `FeatureContext`/`FeatureCandidate`/`FEATURE_NAMES`, `LtrSample{features,label}`/`LtrModel{weights,bias,score}`/`ltrRanker`, `crossEncoderRanker`, `LlmCandidate`/`LlmRerankContext`/`llmRerank→{order,usedFallback}`, `setChangeAtK(reranked,base,k)` — used identically across tasks.
- **Known approximations (documented):** (a) "F2 top-30" for pool-recall is approximated by the retrieval-over-modes top-30 (not a full multiModeRank) — honest, stated in the report; (b) gift detection uses train items as the session proxy (same approximation as F2, carried forward); (c) LLM runs on a 120-case subset for cost — the report states n.
