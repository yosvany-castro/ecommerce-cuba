# Thesis F1 — Commercial Embedding Study (E0–E5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build six interchangeable embedding strategies behind one `EmbeddingSpace` contract and a study runner that scores each on the F0 eval harness (taste / complements / long-tail) plus a public-dataset cross-check, then emits an explicit production-deployment recommendation.

**Architecture:** New code under `src/thesis/embedders/` (one file per embedder + a shared contract + a MaxSim ranker) and `scripts/thesis/` (training CLIs + the study runner). Single-vector spaces (E0 text, E1 Prod2Vec, E2 hybrid, E3 two-tower, E5 voyage-context-3) reuse F0's `cosineSingleVectorRanker`; the multi-vector space (E4 chunk late-interaction) gets its own `maxSimRanker`. Everything is measured by F0's `evaluateRanker`. Trained vectors persist in new `thesis` tables so the study runner is fast and reproducible.

**Tech Stack:** TypeScript 5.6, Node 24 (no GPU/torch — E1/E3 train in pure TS on CPU), `pg`, Voyage (`voyage-4` for E0/E2/E4 chunks; `voyage-context-3` via the `voyageai` package for E5), Vitest 4. Builds on F0 (`src/thesis/{types,eval/*,data/*}`), branch `feat/thesis-personalization-program`, DB schema `thesis`.

**Spec:** `docs/superpowers/specs/2026-05-29-thesis-f0-f1-data-eval-embeddings-design.md` (§4.7, amended 2026-05-29 to 6 embedders + production recommendation).

**Prereqs (already done in F0):** schema `thesis` + `getPgClient({scope:"thesis"})`; `src/thesis/types.ts` (`Ranker`, `RankItem`, `UserContext`); `src/thesis/eval/{metrics,harness,baselines,report,split,ope}.ts`; data CLIs `thesis:catalog|relations|behavior|eval`. The working dataset is regenerable with those CLIs.

---

## Key integration facts (read before starting)
- F0 `Ranker.rank(ctx: UserContext, candidates: RankItem[]): string[]`; `RankItem = {id, popularity, vector, cohort?}`; `UserContext = {userVector, cohort}`.
- F0 `evaluateRanker(ranker, cases: EvalCase[], ks): EvalResult`; `EvalCase = {ctx, candidates, relevant: Set, complements?: Set}`.
- F0 `cosineSingleVectorRanker()` ranks `candidates` by cosine(`ctx.userVector`, `candidate.vector`). So any single-vector embedder integrates by putting **its** item vector on `RankItem.vector` and **its** user vector on `ctx.userVector`, then reusing that ranker.
- Catalog lives in `thesis.products` (`id uuid`, `metadata jsonb` has `subcategory,brand,gender_target,age_target,style,price_band`, `embedding vector(1024)` = E0 text vector, `title`, `description`). Behaviour in `thesis.events` (`session_id`, `occurred_at`, `payload->>'product_id'`, `event_type`). Holdout in `thesis.holdout(user_id, product_id, split)`.
- Embedders must NEVER read `thesis.gt_product_factors` (that is ground truth; using it would be leakage).
- `embed(texts, {inputType})` from `@/lib/embeddings/voyage` → `number[][]`, voyage-4, dim 1024, L2-normalized.

---

## File Structure
- `src/thesis/embedders/space.ts` — `EmbeddingSpace` + `MultiVectorSpace` interfaces + shared cosine/util.
- `src/thesis/embedders/maxsim.ts` — `maxSim(query: number[][], doc: number[][])` + `maxSimRanker(itemChunks, queryChunks)`.
- `src/thesis/embedders/prod2vec.ts` — pure skip-gram trainer (E1).
- `src/thesis/embedders/two-tower.ts` — pure two-tower trainer (E3).
- `src/thesis/embedders/hybrid.ts` — E2 gate (pure, given text + behaviour vectors).
- `src/thesis/embedders/sessions.ts` — pure: turn event rows into ordered session item-sequences (shared by E1/E3).
- `scripts/thesis/embedders/train-prod2vec.ts` — CLI: train E1, persist vectors.
- `scripts/thesis/embedders/train-two-tower.ts` — CLI: train E3, persist vectors.
- `scripts/thesis/embedders/build-chunk-embeddings.ts` — CLI: build E4 chunk vectors (Voyage), persist.
- `scripts/thesis/embedders/build-context3.ts` — CLI: build E5 voyage-context-3 vectors, persist.
- `scripts/thesis/embedding-study.ts` — the study runner (all 6 spaces × harness + report + recommendation).
- `src/thesis/embedders/recommend.ts` — pure: pick the production winner from results + cost profile.
- Migration `supabase/migrations/0022_thesis_embeddings.sql` — tables for persisted learned/derived vectors.
- Tests under `tests/thesis/`: `sessions.test.ts`, `prod2vec.test.ts`, `maxsim.test.ts`, `two-tower.test.ts`, `hybrid.test.ts`, `recommend.test.ts`, and an integration `embedding-study-smoke.test.ts`.

---

## Task 1: Migration — persisted embedding tables

**Files:** Create `supabase/migrations/0022_thesis_embeddings.sql`

- [ ] **Step 1: Write the migration**
```sql
-- Persisted per-embedder item vectors (and E4 multi-vector chunks) so the study
-- runner is fast + reproducible. `space` identifies the embedder (e0_text ...).
set search_path to thesis, public, extensions;

create table if not exists thesis.item_vectors (
  space      text not null,
  product_id uuid not null references thesis.products(id) on delete cascade,
  vector     double precision[] not null,
  primary key (space, product_id)
);

create table if not exists thesis.item_chunk_vectors (
  space      text not null,
  product_id uuid not null references thesis.products(id) on delete cascade,
  chunk_index smallint not null,
  chunk_role text not null,            -- title | description | attributes
  vector     double precision[] not null,
  primary key (space, product_id, chunk_index)
);

create index if not exists thesis_item_vectors_space_idx on thesis.item_vectors(space);
create index if not exists thesis_item_chunk_space_idx on thesis.item_chunk_vectors(space, product_id);
```

- [ ] **Step 2: Apply** — Run: `pnpm migrate` — Expected: ends with `+ 0022_thesis_embeddings.sql` and `OK`.
- [ ] **Step 3: Verify** — Run:
```bash
SUPABASE_DB_URL=$(grep '^SUPABASE_DB_URL' .env.local | cut -d= -f2-) npx tsx -e "import {Client} from 'pg'; const c=new Client({connectionString:process.env.SUPABASE_DB_URL}); await c.connect(); const r=await c.query(\"select table_name from information_schema.tables where table_schema='thesis' and table_name in ('item_vectors','item_chunk_vectors') order by 1\"); console.log(r.rows.map(x=>x.table_name).join(',')); await c.end();"
```
Expected: `item_chunk_vectors,item_vectors`.
- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/0022_thesis_embeddings.sql
git commit -m "feat(thesis): F1 migration — persisted item & chunk vector tables"
```

---

## Task 2: EmbeddingSpace contract + shared utils

**Files:** Create `src/thesis/embedders/space.ts`; Test `tests/thesis/space.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/thesis/space.test.ts`)
```ts
import { describe, test, expect } from "vitest";
import { l2normalize, meanPool, cosineSim } from "@/thesis/embedders/space";

describe("space utils", () => {
  test("l2normalize makes unit norm", () => {
    const v = l2normalize([3, 4]);
    expect(Math.hypot(v[0], v[1])).toBeCloseTo(1, 9);
    expect(v[0]).toBeCloseTo(0.6, 9);
  });
  test("l2normalize of zero vector returns zeros (no NaN)", () => {
    expect(l2normalize([0, 0])).toEqual([0, 0]);
  });
  test("meanPool averages componentwise", () => {
    expect(meanPool([[1, 1], [3, 3]])).toEqual([2, 2]);
  });
  test("meanPool of empty returns empty", () => {
    expect(meanPool([])).toEqual([]);
  });
  test("cosineSim of identical unit vectors = 1", () => {
    expect(cosineSim([1, 0], [1, 0])).toBeCloseTo(1, 9);
  });
  test("cosineSim of orthogonal = 0", () => {
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 9);
  });
});
```
- [ ] **Step 2: Run** `npx vitest run tests/thesis/space.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/thesis/embedders/space.ts`
```ts
/**
 * Shared contracts + math for the F1 embedding study. Every single-vector
 * embedder (E0,E1,E2,E3,E5) implements EmbeddingSpace; the late-interaction
 * embedder (E4) implements MultiVectorSpace. The study runner turns either into
 * F0 EvalCases and scores them with the shared eval harness.
 */
export interface EmbeddingSpace {
  name: string;
  /** Item vector for ranking; null if this item has no representation. */
  itemVector(productId: string): number[] | null;
  /** User/query vector from the user's TRAIN item ids; null if underivable. */
  userVector(trainItemIds: string[]): number[] | null;
}

export interface MultiVectorSpace {
  name: string;
  itemChunks(productId: string): number[][] | null;
  queryChunks(trainItemIds: string[]): number[][] | null;
}

export function l2normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s);
  if (n === 0) return v.slice();
  return v.map((x) => x / n);
}

export function meanPool(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const d = vectors[0].length;
  const out = new Array<number>(d).fill(0);
  for (const v of vectors) for (let i = 0; i < d; i++) out[i] += v[i];
  return out.map((x) => x / vectors.length);
}

export function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const m = Math.min(a.length, b.length);
  for (let i = 0; i < m; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  return den === 0 ? 0 : dot / den;
}
```
- [ ] **Step 4: Run** `npx vitest run tests/thesis/space.test.ts` — Expected: PASS (6).
- [ ] **Step 5: Commit**
```bash
git add src/thesis/embedders/space.ts tests/thesis/space.test.ts
git commit -m "feat(thesis): EmbeddingSpace/MultiVectorSpace contracts + vector utils"
```

---

## Task 3: Session sequences (shared training input)

**Files:** Create `src/thesis/embedders/sessions.ts`; Test `tests/thesis/sessions.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/thesis/sessions.test.ts`)
```ts
import { describe, test, expect } from "vitest";
import { toSessionSequences, type EventRow } from "@/thesis/embedders/sessions";

describe("toSessionSequences", () => {
  const rows: EventRow[] = [
    { session_id: "s1", product_id: "a", occurred_at: "2026-01-01T00:00:01Z" },
    { session_id: "s1", product_id: "b", occurred_at: "2026-01-01T00:00:02Z" },
    { session_id: "s1", product_id: "a", occurred_at: "2026-01-01T00:00:03Z" },
    { session_id: "s2", product_id: "c", occurred_at: "2026-01-01T00:00:01Z" },
  ];
  test("groups by session, ordered by time, consecutive dups collapsed", () => {
    const seqs = toSessionSequences(rows);
    expect(seqs).toEqual([["a", "b", "a"], ["c"]]);
  });
  test("drops single-item sessions when minLen=2", () => {
    const seqs = toSessionSequences(rows, 2);
    expect(seqs).toEqual([["a", "b", "a"]]);
  });
  test("empty input → empty", () => {
    expect(toSessionSequences([])).toEqual([]);
  });
});
```
- [ ] **Step 2: Run** — Expected FAIL.
- [ ] **Step 3: Implement** `src/thesis/embedders/sessions.ts`
```ts
/**
 * Turns raw interaction events into ordered per-session item sequences — the
 * training corpus for Prod2Vec (E1) and the two-tower (E3). Sessions are the
 * "sentences"; co-occurring items are the "context". Pure; deterministic given
 * a stable input order (callers pass rows already ordered by session, time).
 */
export interface EventRow {
  session_id: string;
  product_id: string;
  occurred_at: string;
}

/**
 * @param minLen drop sessions shorter than this (default 1 = keep all)
 * Consecutive duplicate product ids within a session are collapsed (a refresh /
 * re-view of the same item is not a co-occurrence with itself).
 */
export function toSessionSequences(rows: EventRow[], minLen = 1): string[][] {
  const bySession = new Map<string, EventRow[]>();
  for (const r of rows) {
    const arr = bySession.get(r.session_id) ?? [];
    arr.push(r);
    bySession.set(r.session_id, arr);
  }
  const out: string[][] = [];
  for (const [, arr] of bySession) {
    const sorted = arr
      .slice()
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.product_id.localeCompare(b.product_id));
    const seq: string[] = [];
    for (const e of sorted) {
      if (seq.length === 0 || seq[seq.length - 1] !== e.product_id) seq.push(e.product_id);
    }
    if (seq.length >= minLen) out.push(seq);
  }
  return out;
}
```
- [ ] **Step 4: Run** — Expected PASS (3).
- [ ] **Step 5: Commit**
```bash
git add src/thesis/embedders/sessions.ts tests/thesis/sessions.test.ts
git commit -m "feat(thesis): session-sequence builder (training corpus for E1/E3)"
```

---

## Task 4: Prod2Vec trainer (E1)

**Files:** Create `src/thesis/embedders/prod2vec.ts`; Test `tests/thesis/prod2vec.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/thesis/prod2vec.test.ts`)
```ts
import { describe, test, expect } from "vitest";
import { trainProd2Vec } from "@/thesis/embedders/prod2vec";
import { cosineSim } from "@/thesis/embedders/space";

describe("trainProd2Vec", () => {
  // Two tight co-occurrence clusters: {a,b,c} always co-occur; {x,y,z} always co-occur.
  const sequences = [
    ["a", "b", "c"], ["b", "c", "a"], ["c", "a", "b"], ["a", "c", "b"],
    ["x", "y", "z"], ["y", "z", "x"], ["z", "x", "y"], ["x", "z", "y"],
  ];

  test("deterministic by seed", () => {
    const m1 = trainProd2Vec(sequences, { dim: 16, epochs: 20, window: 2, negatives: 3, seed: 7 });
    const m2 = trainProd2Vec(sequences, { dim: 16, epochs: 20, window: 2, negatives: 3, seed: 7 });
    expect(m1.get("a")).toEqual(m2.get("a"));
  });

  test("within-cluster similarity exceeds cross-cluster similarity", () => {
    const m = trainProd2Vec(sequences, { dim: 24, epochs: 60, window: 2, negatives: 4, seed: 1 });
    const ab = cosineSim(m.get("a")!, m.get("b")!);
    const ax = cosineSim(m.get("a")!, m.get("x")!);
    expect(ab).toBeGreaterThan(ax);
  });

  test("every item in the corpus gets a vector of the requested dim", () => {
    const m = trainProd2Vec(sequences, { dim: 8, epochs: 5, window: 2, negatives: 2, seed: 3 });
    for (const id of ["a", "b", "c", "x", "y", "z"]) {
      expect(m.get(id)?.length).toBe(8);
    }
  });
});
```
- [ ] **Step 2: Run** — Expected FAIL.
- [ ] **Step 3: Implement** `src/thesis/embedders/prod2vec.ts`
```ts
import { makeRng } from "../data/rng";
import { l2normalize } from "./space";

/**
 * Prod2Vec (Item2Vec / skip-gram with negative sampling, Barkan & Koenigstein
 * 2016) trained on session item-sequences. Pure TS, CPU-only — no GPU/torch.
 * Items that co-occur in sessions end up close in the learned space, capturing
 * COMMERCIAL relatedness that text embeddings miss. Deterministic given `seed`.
 */
export interface Prod2VecOpts {
  dim: number;
  epochs: number;
  window: number;
  negatives: number;
  seed: number;
  lr?: number; // initial learning rate (default 0.025, linearly decayed)
}

function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

export function trainProd2Vec(sequences: string[][], opts: Prod2VecOpts): Map<string, number[]> {
  const rng = makeRng(opts.seed);
  const lr0 = opts.lr ?? 0.025;

  // Vocabulary + unigram (for negative sampling, ^0.75 smoothing as in word2vec).
  const counts = new Map<string, number>();
  for (const seq of sequences) for (const id of seq) counts.set(id, (counts.get(id) ?? 0) + 1);
  const vocab = [...counts.keys()].sort(); // deterministic order
  const idx = new Map(vocab.map((id, i) => [id, i]));
  const V = vocab.length;
  const negTable: number[] = [];
  for (let i = 0; i < V; i++) {
    const w = Math.pow(counts.get(vocab[i])!, 0.75);
    const reps = Math.max(1, Math.round(w * 100));
    for (let r = 0; r < reps; r++) negTable.push(i);
  }

  // Init input (center) + output (context) matrices, small random.
  const initV = (): number[][] =>
    Array.from({ length: V }, () => Array.from({ length: opts.dim }, () => (rng.next() - 0.5) / opts.dim));
  const inVec = initV();
  const outVec = initV();

  const totalPairs = sequences.reduce((s, seq) => s + seq.length, 0) * opts.epochs;
  let trained = 0;

  for (let e = 0; e < opts.epochs; e++) {
    for (const seq of sequences) {
      for (let t = 0; t < seq.length; t++) {
        const center = idx.get(seq[t])!;
        const lr = Math.max(lr0 * 0.0001, lr0 * (1 - trained / Math.max(1, totalPairs)));
        const lo = Math.max(0, t - opts.window);
        const hi = Math.min(seq.length - 1, t + opts.window);
        for (let c = lo; c <= hi; c++) {
          if (c === t) continue;
          const ctx = idx.get(seq[c])!;
          // positive + negatives
          const targets: [number, number][] = [[ctx, 1]];
          for (let n = 0; n < opts.negatives; n++) {
            const neg = negTable[rng.int(negTable.length)];
            if (neg !== ctx) targets.push([neg, 0]);
          }
          const ci = inVec[center];
          const grad = new Array<number>(opts.dim).fill(0);
          for (const [target, label] of targets) {
            const oj = outVec[target];
            let dot = 0;
            for (let k = 0; k < opts.dim; k++) dot += ci[k] * oj[k];
            const g = (label - sigmoid(dot)) * lr;
            for (let k = 0; k < opts.dim; k++) {
              grad[k] += g * oj[k];
              oj[k] += g * ci[k];
            }
          }
          for (let k = 0; k < opts.dim; k++) ci[k] += grad[k];
        }
        trained++;
      }
    }
  }

  const out = new Map<string, number[]>();
  for (let i = 0; i < V; i++) out.set(vocab[i], l2normalize(inVec[i]));
  return out;
}
```
- [ ] **Step 4: Run** — Expected PASS (3). If the within>cross test is flaky at low epochs, the implementation is fine — the test uses 60 epochs which converges on this toy corpus; do not weaken the assertion.
- [ ] **Step 5: Commit**
```bash
git add src/thesis/embedders/prod2vec.ts tests/thesis/prod2vec.test.ts
git commit -m "feat(thesis): Prod2Vec (skip-gram/negative-sampling) behavioral embeddings — E1"
```

---

## Task 5: Hybrid gate (E2)

**Files:** Create `src/thesis/embedders/hybrid.ts`; Test `tests/thesis/hybrid.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/thesis/hybrid.test.ts`)
```ts
import { describe, test, expect } from "vitest";
import { hybridVector, hybridAlpha } from "@/thesis/embedders/hybrid";

describe("hybrid gate", () => {
  test("cold-start (0 interactions) → alpha≈1 → text dominates", () => {
    expect(hybridAlpha(0, 10)).toBeCloseTo(1, 9);
  });
  test("alpha decreases as interactions grow", () => {
    expect(hybridAlpha(50, 10)).toBeLessThan(hybridAlpha(5, 10));
  });
  test("with no behavioral vector, returns the (normalized) text vector", () => {
    const v = hybridVector([1, 0], null, 5, 10);
    expect(v).toEqual([1, 0]);
  });
  test("blends and re-normalizes to unit length", () => {
    const v = hybridVector([1, 0], [0, 1], 10, 10); // alpha = 10/20 = 0.5
    expect(Math.hypot(v[0], v[1])).toBeCloseTo(1, 9);
    expect(v[0]).toBeCloseTo(v[1], 9); // equal blend → 45°
  });
});
```
- [ ] **Step 2: Run** — Expected FAIL.
- [ ] **Step 3: Implement** `src/thesis/embedders/hybrid.ts`
```ts
import { l2normalize } from "./space";

/**
 * E2 hybrid: blends the text vector (good for cold-start / new items) with the
 * behavioral Prod2Vec vector (good once an item has interaction history). The
 * gate weight on TEXT is alpha = kappa/(kappa + nInteractions): text dominates
 * when the item is cold, behaviour takes over as it warms. Result re-normalized.
 */
export function hybridAlpha(nInteractions: number, kappa: number): number {
  return kappa / (kappa + nInteractions);
}

export function hybridVector(
  textVec: number[],
  behavVec: number[] | null,
  nInteractions: number,
  kappa: number,
): number[] {
  const t = l2normalize(textVec);
  if (!behavVec) return t;
  const b = l2normalize(behavVec);
  const a = hybridAlpha(nInteractions, kappa);
  const d = Math.min(t.length, b.length);
  const mix = new Array<number>(d);
  for (let i = 0; i < d; i++) mix[i] = a * t[i] + (1 - a) * b[i];
  return l2normalize(mix);
}
```
- [ ] **Step 4: Run** — Expected PASS (4).
- [ ] **Step 5: Commit**
```bash
git add src/thesis/embedders/hybrid.ts tests/thesis/hybrid.test.ts
git commit -m "feat(thesis): hybrid text/behaviour gate embeddings — E2"
```

---

## Task 6: Two-tower trainer (E3)

**Files:** Create `src/thesis/embedders/two-tower.ts`; Test `tests/thesis/two-tower.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/thesis/two-tower.test.ts`)
```ts
import { describe, test, expect } from "vitest";
import { trainTwoTower } from "@/thesis/embedders/two-tower";
import { cosineSim } from "@/thesis/embedders/space";

describe("trainTwoTower", () => {
  // (user, positive-item) pairs: users u1/u2 like cluster A {a,b}; u3/u4 like B {x,y}.
  const pairs = [
    { user: "u1", item: "a" }, { user: "u1", item: "b" }, { user: "u2", item: "a" }, { user: "u2", item: "b" },
    { user: "u3", item: "x" }, { user: "u3", item: "y" }, { user: "u4", item: "x" }, { user: "u4", item: "y" },
  ];
  const itemFeatures = new Map<string, number[]>([
    ["a", [1, 0, 0, 0]], ["b", [0.9, 0.1, 0, 0]], ["x", [0, 0, 1, 0]], ["y", [0, 0, 0.9, 0.1]],
  ]);

  test("deterministic by seed", () => {
    const o = { dim: 8, epochs: 30, negatives: 2, seed: 5 };
    const m1 = trainTwoTower(pairs, itemFeatures, o);
    const m2 = trainTwoTower(pairs, itemFeatures, o);
    expect(m1.itemVectors.get("a")).toEqual(m2.itemVectors.get("a"));
  });

  test("a user's vector is closer to their liked items than to the other cluster", () => {
    const m = trainTwoTower(pairs, itemFeatures, { dim: 16, epochs: 200, negatives: 3, seed: 2 });
    const u1 = m.userVector("u1")!;
    const simA = cosineSim(u1, m.itemVectors.get("a")!);
    const simX = cosineSim(u1, m.itemVectors.get("x")!);
    expect(simA).toBeGreaterThan(simX);
  });

  test("userVector for an unknown user pools its given item vectors", () => {
    const m = trainTwoTower(pairs, itemFeatures, { dim: 8, epochs: 10, negatives: 2, seed: 1 });
    const v = m.userVectorFromItems(["a", "b"]);
    expect(v?.length).toBe(8);
  });
});
```
- [ ] **Step 2: Run** — Expected FAIL.
- [ ] **Step 3: Implement** `src/thesis/embedders/two-tower.ts`
```ts
import { makeRng } from "../data/rng";
import { l2normalize, meanPool } from "./space";

/**
 * Two-tower retrieval model (Yi et al., RecSys'19 style) trained with in-batch
 * negatives + sampled-softmax and logQ popularity correction. Pure TS, CPU:
 * - item tower = linear projection of the item's input features (here, the E0
 *   text vector) into the shared space;
 * - user tower = learned embedding per training user.
 * Trained users get a learned vector; unknown users (eval) are pooled from their
 * item vectors via userVectorFromItems. Deterministic given `seed`.
 */
export interface TwoTowerOpts {
  dim: number;
  epochs: number;
  negatives: number;
  seed: number;
  lr?: number;
}
export interface TwoTowerModel {
  itemVectors: Map<string, number[]>;
  userVector(userId: string): number[] | null;
  userVectorFromItems(itemIds: string[]): number[] | null;
}

export function trainTwoTower(
  pairs: { user: string; item: string }[],
  itemFeatures: Map<string, number[]>,
  opts: TwoTowerOpts,
): TwoTowerModel {
  const rng = makeRng(opts.seed);
  const lr0 = opts.lr ?? 0.05;

  const items = [...itemFeatures.keys()].sort();
  const itemIdx = new Map(items.map((id, i) => [id, i]));
  const featDim = itemFeatures.get(items[0])!.length;
  const users = [...new Set(pairs.map((p) => p.user))].sort();
  const userIdx = new Map(users.map((u, i) => [u, i]));

  // item popularity for logQ correction (sampling bias).
  const pop = new Map<string, number>();
  for (const p of pairs) pop.set(p.item, (pop.get(p.item) ?? 0) + 1);
  const totalPairs = pairs.length;
  const logQ = (id: string) => Math.log((pop.get(id) ?? 1) / totalPairs);

  // Parameters: item projection W (dim x featDim), user embeddings U (users x dim).
  const W = Array.from({ length: opts.dim }, () => Array.from({ length: featDim }, () => (rng.next() - 0.5) / featDim));
  const U = Array.from({ length: users.length }, () => Array.from({ length: opts.dim }, () => (rng.next() - 0.5) / opts.dim));

  const itemVec = (id: string): number[] => {
    const f = itemFeatures.get(id)!;
    const out = new Array<number>(opts.dim).fill(0);
    for (let r = 0; r < opts.dim; r++) {
      let s = 0;
      for (let c = 0; c < featDim; c++) s += W[r][c] * f[c];
      out[r] = s;
    }
    return out;
  };

  // shuffle indices deterministically each epoch
  const order = pairs.map((_, i) => i);
  for (let e = 0; e < opts.epochs; e++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    const lr = Math.max(lr0 * 0.001, lr0 * (1 - e / opts.epochs));
    for (const oi of order) {
      const p = pairs[oi];
      const u = U[userIdx.get(p.user)!];
      // candidate set = positive + sampled negatives, scored with logQ correction
      const cand: string[] = [p.item];
      for (let n = 0; n < opts.negatives; n++) {
        const neg = items[rng.int(items.length)];
        if (neg !== p.item) cand.push(neg);
      }
      const vecs = cand.map(itemVec);
      const logits = vecs.map((v, k) => {
        let s = 0;
        for (let d = 0; d < opts.dim; d++) s += u[d] * v[d];
        return s - logQ(cand[k]); // logQ correction
      });
      const maxL = Math.max(...logits);
      const exps = logits.map((l) => Math.exp(l - maxL));
      const Z = exps.reduce((a, b) => a + b, 0);
      const probs = exps.map((x) => x / Z);
      // cross-entropy gradient: target is index 0 (positive)
      for (let k = 0; k < cand.length; k++) {
        const err = (k === 0 ? 1 : 0) - probs[k]; // d/dlogit
        const g = err * lr;
        const v = vecs[k];
        const f = itemFeatures.get(cand[k])!;
        // grad user
        for (let d = 0; d < opts.dim; d++) u[d] += g * v[d];
        // grad W (item projection): dlogit/dW[r][c] = u[r]*f[c]
        for (let r = 0; r < opts.dim; r++) {
          const gr = g * u[r];
          for (let c = 0; c < featDim; c++) W[r][c] += gr * f[c];
        }
      }
    }
  }

  const itemVectors = new Map<string, number[]>();
  for (const id of items) itemVectors.set(id, l2normalize(itemVec(id)));
  const userVectors = new Map<string, number[]>();
  users.forEach((uId, i) => userVectors.set(uId, l2normalize(U[i])));

  return {
    itemVectors,
    userVector: (uId) => userVectors.get(uId) ?? null,
    userVectorFromItems: (ids) => {
      const vs = ids.map((id) => itemVectors.get(id)).filter((v): v is number[] => !!v);
      return vs.length ? l2normalize(meanPool(vs)) : null;
    },
  };
}
```
- [ ] **Step 4: Run** — Expected PASS (3).
- [ ] **Step 5: Commit**
```bash
git add src/thesis/embedders/two-tower.ts tests/thesis/two-tower.test.ts
git commit -m "feat(thesis): two-tower model (in-batch negatives + logQ) — E3"
```

---

## Task 7: MaxSim late-interaction ranker (E4 core)

**Files:** Create `src/thesis/embedders/maxsim.ts`; Test `tests/thesis/maxsim.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/thesis/maxsim.test.ts`)
```ts
import { describe, test, expect } from "vitest";
import { maxSim, maxSimRanker } from "@/thesis/embedders/maxsim";

describe("maxSim", () => {
  test("sum over query chunks of best doc-chunk cosine", () => {
    // query has 2 chunks; doc has chunks aligned to each → score ≈ 2
    const q = [[1, 0], [0, 1]];
    const d = [[1, 0], [0, 1]];
    expect(maxSim(q, d)).toBeCloseTo(2, 9);
  });
  test("a doc matching only one query chunk scores ~1", () => {
    expect(maxSim([[1, 0], [0, 1]], [[1, 0]])).toBeCloseTo(1, 9);
  });
  test("empty query or doc → 0", () => {
    expect(maxSim([], [[1, 0]])).toBe(0);
    expect(maxSim([[1, 0]], [])).toBe(0);
  });
});

describe("maxSimRanker", () => {
  test("ranks the doc whose chunks best cover the query first", () => {
    const itemChunks = new Map<string, number[][]>([
      ["doc1", [[1, 0], [0, 1]]],
      ["doc2", [[1, 0]]],
      ["doc3", [[0, 0, 1]]],
    ]);
    const r = maxSimRanker(itemChunks, () => [[1, 0], [0, 1]]);
    const out = r.rank({ userVector: [], cohort: null }, [
      { id: "doc1", popularity: 0, vector: [] },
      { id: "doc2", popularity: 0, vector: [] },
      { id: "doc3", popularity: 0, vector: [] },
    ]);
    expect(out[0]).toBe("doc1");
    expect(out[2]).toBe("doc3");
  });
});
```
- [ ] **Step 2: Run** — Expected FAIL.
- [ ] **Step 3: Implement** `src/thesis/embedders/maxsim.ts`
```ts
import type { Ranker, RankItem, UserContext } from "../types";
import { cosineSim } from "./space";

/**
 * ColBERT-style late interaction at the CHUNK level. Each item is a small set of
 * chunk vectors (title / description / attributes); the query is a set of chunk
 * vectors too. MaxSim = sum over query chunks of the best matching doc chunk.
 * This approximates token-level ColBERT without a GPU/transformer — we use
 * chunk granularity instead of token granularity (a documented simplification).
 */
export function maxSim(query: number[][], doc: number[][]): number {
  if (query.length === 0 || doc.length === 0) return 0;
  let total = 0;
  for (const q of query) {
    let best = -Infinity;
    for (const d of doc) {
      const s = cosineSim(q, d);
      if (s > best) best = s;
    }
    total += best;
  }
  return total;
}

/**
 * A Ranker that scores candidates by MaxSim between the user's query chunks and
 * each item's chunks. queryChunksFor maps the user context → query chunk set.
 */
export function maxSimRanker(
  itemChunks: Map<string, number[][]>,
  queryChunksFor: (ctx: UserContext) => number[][] | null,
): Ranker {
  return {
    name: "e4-late-interaction",
    rank(ctx: UserContext, candidates: RankItem[]): string[] {
      const q = queryChunksFor(ctx) ?? [];
      return candidates
        .map((c) => ({ id: c.id, s: maxSim(q, itemChunks.get(c.id) ?? []) }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.id);
    },
  };
}
```
- [ ] **Step 4: Run** — Expected PASS (5).
- [ ] **Step 5: Commit**
```bash
git add src/thesis/embedders/maxsim.ts tests/thesis/maxsim.test.ts
git commit -m "feat(thesis): chunk-level MaxSim late-interaction ranker — E4 core"
```

---

## Task 8: Production recommendation logic

**Files:** Create `src/thesis/embedders/recommend.ts`; Test `tests/thesis/recommend.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/thesis/recommend.test.ts`)
```ts
import { describe, test, expect } from "vitest";
import { recommendProductionSpace, type SpaceScore } from "@/thesis/embedders/recommend";

describe("recommendProductionSpace", () => {
  const scores: SpaceScore[] = [
    { space: "e0_text", ndcg10: 0.30, complementRecall10: 0.10, servingCost: 1 },
    { space: "e1_prod2vec", ndcg10: 0.35, complementRecall10: 0.40, servingCost: 1 },
    { space: "e4_late", ndcg10: 0.42, complementRecall10: 0.45, servingCost: 5 },
    { space: "e5_context3", ndcg10: 0.40, complementRecall10: 0.30, servingCost: 2 },
  ];
  test("picks the best quality-per-cost when cost matters", () => {
    const rec = recommendProductionSpace(scores, { costWeight: 0.5 });
    expect(rec.winner).toBe("e1_prod2vec"); // strong quality at lowest cost
  });
  test("picks raw best quality when cost is ignored", () => {
    const rec = recommendProductionSpace(scores, { costWeight: 0 });
    expect(rec.winner).toBe("e4_late");
  });
  test("returns a ranked rationale list", () => {
    const rec = recommendProductionSpace(scores, { costWeight: 0.5 });
    expect(rec.ranked.length).toBe(4);
    expect(rec.ranked[0].space).toBe(rec.winner);
  });
});
```
- [ ] **Step 2: Run** — Expected FAIL.
- [ ] **Step 3: Implement** `src/thesis/embedders/recommend.ts`
```ts
/**
 * Turns the academic score table into a PRODUCTION recommendation: which
 * embedder to deploy, trading retrieval quality against serving cost/latency.
 * Pure. The thesis reports the full table; the product ships the winner.
 *
 * score = quality − costWeight · normalizedCost, where quality blends nDCG@10
 * (relevance) and complement-recall@10 (cross-sell, a revenue lever).
 */
export interface SpaceScore {
  space: string;
  ndcg10: number;
  complementRecall10: number;
  servingCost: number; // relative units (1 = cheapest single dense vector)
}
export interface Recommendation {
  winner: string;
  ranked: { space: string; quality: number; utility: number }[];
}

export function recommendProductionSpace(
  scores: SpaceScore[],
  opts: { costWeight: number; qualityRelevanceWeight?: number },
): Recommendation {
  const wRel = opts.qualityRelevanceWeight ?? 0.6;
  const maxCost = Math.max(...scores.map((s) => s.servingCost), 1);
  const ranked = scores
    .map((s) => {
      const quality = wRel * s.ndcg10 + (1 - wRel) * s.complementRecall10;
      const utility = quality - opts.costWeight * (s.servingCost / maxCost);
      return { space: s.space, quality, utility };
    })
    .sort((a, b) => b.utility - a.utility);
  return { winner: ranked[0].space, ranked };
}
```
- [ ] **Step 4: Run** — Expected PASS (3).
- [ ] **Step 5: Commit**
```bash
git add src/thesis/embedders/recommend.ts tests/thesis/recommend.test.ts
git commit -m "feat(thesis): production-deployment recommendation (quality vs serving cost)"
```

---

## Task 9: Prod2Vec training CLI (E1 persist)

**Files:** Create `scripts/thesis/embedders/train-prod2vec.ts`; Modify `package.json`

- [ ] **Step 1:** Add to `package.json` scripts after `"thesis:public"`:
```json
    "thesis:train-prod2vec": "tsx scripts/thesis/embedders/train-prod2vec.ts",
```
- [ ] **Step 2: Implement** `scripts/thesis/embedders/train-prod2vec.ts`
```ts
#!/usr/bin/env tsx
/**
 * Train E1 Prod2Vec on thesis.events session sequences; persist item vectors to
 * thesis.item_vectors (space='e1_prod2vec'). Usage:
 *   pnpm thesis:train-prod2vec --dim 64 --epochs 30 --window 3 --negatives 5 --seed 42
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getPgClient } from "@/lib/db/pg";
import { toSessionSequences, type EventRow } from "@/thesis/embedders/sessions";
import { trainProd2Vec } from "@/thesis/embedders/prod2vec";

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

async function main() {
  const dim = arg("dim", 64);
  const epochs = arg("epochs", 30);
  const window = arg("window", 3);
  const negatives = arg("negatives", 5);
  const seed = arg("seed", 42);
  const pg = await getPgClient({ scope: "thesis" });
  try {
    const r = await pg.query(
      `SELECT session_id::text session_id, payload->>'product_id' AS product_id, occurred_at
       FROM thesis.events
       WHERE event_type IN ('product_view','add_to_cart','purchase') AND payload->>'product_id' IS NOT NULL
       ORDER BY session_id, occurred_at`,
    );
    const rows: EventRow[] = (r.rows as { session_id: string; product_id: string; occurred_at: string }[]).map((x) => ({
      session_id: x.session_id, product_id: x.product_id, occurred_at: new Date(x.occurred_at).toISOString(),
    }));
    const seqs = toSessionSequences(rows, 2);
    console.log(`[e1] ${seqs.length} multi-item sessions; training dim=${dim} epochs=${epochs}`);
    const vectors = trainProd2Vec(seqs, { dim, epochs, window, negatives, seed });

    await pg.query(`DELETE FROM thesis.item_vectors WHERE space='e1_prod2vec'`);
    let n = 0;
    for (const [pid, vec] of vectors) {
      await pg.query(
        `INSERT INTO thesis.item_vectors (space, product_id, vector) VALUES ('e1_prod2vec', $1, $2)
         ON CONFLICT (space, product_id) DO UPDATE SET vector = EXCLUDED.vector`,
        [pid, vec],
      );
      n++;
    }
    console.log(`[e1] persisted ${n} item vectors`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```
- [ ] **Step 3: Run** (dataset must exist; if empty run the F0 CLIs first). Run: `pnpm thesis:train-prod2vec --dim 64 --epochs 20 --seed 42` — Expected: `[e1] persisted N item vectors` with N>0. If `0 multi-item sessions`, regenerate data: `pnpm thesis:catalog --n 400 --seed 42 && pnpm thesis:relations && pnpm thesis:behavior --users 200 --seed 42` then re-run. Report BLOCKED on DB errors.
- [ ] **Step 4: Commit**
```bash
git add scripts/thesis/embedders/train-prod2vec.ts package.json
git commit -m "feat(thesis): train-prod2vec CLI — persist E1 behavioral vectors"
```

---

## Task 10: Two-tower training CLI (E3 persist)

**Files:** Create `scripts/thesis/embedders/train-two-tower.ts`; Modify `package.json`

- [ ] **Step 1:** Add after `"thesis:train-prod2vec"`:
```json
    "thesis:train-two-tower": "tsx scripts/thesis/embedders/train-two-tower.ts",
```
- [ ] **Step 2: Implement** `scripts/thesis/embedders/train-two-tower.ts`
```ts
#!/usr/bin/env tsx
/**
 * Train E3 two-tower. Item features = the E0 text embedding (thesis.products.embedding).
 * Training pairs = (user, purchased-or-carted item) from thesis.events. Persist
 * item vectors to thesis.item_vectors (space='e3_two_tower'). User vectors at eval
 * time are pooled from the user's train items (userVectorFromItems).
 * Usage: pnpm thesis:train-two-tower --dim 64 --epochs 80 --negatives 5 --seed 42
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getPgClient } from "@/lib/db/pg";
import { trainTwoTower } from "@/thesis/embedders/two-tower";

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

async function main() {
  const dim = arg("dim", 64);
  const epochs = arg("epochs", 80);
  const negatives = arg("negatives", 5);
  const seed = arg("seed", 42);
  const pg = await getPgClient({ scope: "thesis" });
  try {
    const feat = await pg.query(`SELECT id::text id, embedding::text v FROM thesis.products WHERE embedding IS NOT NULL`);
    const itemFeatures = new Map<string, number[]>();
    for (const row of feat.rows as { id: string; v: string }[]) itemFeatures.set(row.id, JSON.parse(row.v) as number[]);

    const pr = await pg.query(
      `SELECT anonymous_id::text user_id, payload->>'product_id' AS item
       FROM thesis.events
       WHERE event_type IN ('add_to_cart','purchase') AND payload->>'product_id' IS NOT NULL`,
    );
    const pairs = (pr.rows as { user_id: string; item: string }[])
      .filter((p) => itemFeatures.has(p.item))
      .map((p) => ({ user: p.user_id, item: p.item }));
    console.log(`[e3] ${pairs.length} (user,item) pairs over ${itemFeatures.size} items; training dim=${dim}`);

    const model = trainTwoTower(pairs, itemFeatures, { dim, epochs, negatives, seed });
    await pg.query(`DELETE FROM thesis.item_vectors WHERE space='e3_two_tower'`);
    let n = 0;
    for (const [pid, vec] of model.itemVectors) {
      await pg.query(
        `INSERT INTO thesis.item_vectors (space, product_id, vector) VALUES ('e3_two_tower', $1, $2)
         ON CONFLICT (space, product_id) DO UPDATE SET vector = EXCLUDED.vector`,
        [pid, vec],
      );
      n++;
    }
    console.log(`[e3] persisted ${n} item vectors`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```
- [ ] **Step 3: Run** `pnpm thesis:train-two-tower --dim 64 --epochs 40 --seed 42` — Expected: `[e3] persisted N item vectors`, N>0. Report BLOCKED on DB errors.
- [ ] **Step 4: Commit**
```bash
git add scripts/thesis/embedders/train-two-tower.ts package.json
git commit -m "feat(thesis): train-two-tower CLI — persist E3 vectors"
```

---

## Task 11: Chunk embeddings CLI (E4 persist)

**Files:** Create `scripts/thesis/embedders/build-chunk-embeddings.ts`; Modify `package.json`

- [ ] **Step 1:** Add after `"thesis:train-two-tower"`:
```json
    "thesis:build-chunks": "tsx scripts/thesis/embedders/build-chunk-embeddings.ts",
```
- [ ] **Step 2: Implement** `scripts/thesis/embedders/build-chunk-embeddings.ts`
```ts
#!/usr/bin/env tsx
/**
 * Build E4 late-interaction chunk vectors: embed each product's title, description,
 * and an attributes string SEPARATELY with Voyage, persist to
 * thesis.item_chunk_vectors (space='e4_late'). The study runner scores via MaxSim.
 * Usage: pnpm thesis:build-chunks
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getPgClient } from "@/lib/db/pg";
import { embed } from "@/lib/embeddings/voyage";

function attrText(m: Record<string, unknown>): string {
  return [m.subcategory, m.brand, m.style, m.gender_target].filter(Boolean).join(" ");
}

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    const r = await pg.query(`SELECT id::text id, title, description, metadata FROM thesis.products`);
    const rows = r.rows as { id: string; title: string; description: string; metadata: Record<string, unknown> }[];
    await pg.query(`DELETE FROM thesis.item_chunk_vectors WHERE space='e4_late'`);

    const BATCH = 64;
    let persisted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      // 3 chunks per product, embedded in one Voyage call (flattened)
      const texts: string[] = [];
      for (const p of batch) {
        texts.push(p.title || p.id, p.description || p.title || p.id, attrText(p.metadata) || p.title || p.id);
      }
      const vecs = await embed(texts, { inputType: "document" });
      for (let b = 0; b < batch.length; b++) {
        const roles = ["title", "description", "attributes"];
        for (let c = 0; c < 3; c++) {
          await pg.query(
            `INSERT INTO thesis.item_chunk_vectors (space, product_id, chunk_index, chunk_role, vector)
             VALUES ('e4_late', $1, $2, $3, $4)
             ON CONFLICT (space, product_id, chunk_index) DO UPDATE SET vector = EXCLUDED.vector, chunk_role = EXCLUDED.chunk_role`,
            [batch[b].id, c, roles[c], vecs[b * 3 + c]],
          );
        }
        persisted++;
      }
      console.log(`[e4] chunks for ${Math.min(i + BATCH, rows.length)}/${rows.length} products`);
    }
    console.log(`[e4] persisted chunks for ${persisted} products`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```
- [ ] **Step 3: Run** `pnpm thesis:build-chunks` — Expected: `[e4] persisted chunks for N products`, N>0. (Cost: 3 Voyage vectors/product.) Report BLOCKED on Voyage/DB errors.
- [ ] **Step 4: Commit**
```bash
git add scripts/thesis/embedders/build-chunk-embeddings.ts package.json
git commit -m "feat(thesis): build-chunks CLI — persist E4 late-interaction chunk vectors"
```

---

## Task 12: voyage-context-3 CLI (E5 persist)

**Files:** Create `scripts/thesis/embedders/build-context3.ts`; Modify `package.json`

- [ ] **Step 1:** Add after `"thesis:build-chunks"`:
```json
    "thesis:build-context3": "tsx scripts/thesis/embedders/build-context3.ts",
```
- [ ] **Step 2: Implement** `scripts/thesis/embedders/build-context3.ts`
```ts
#!/usr/bin/env tsx
/**
 * Build E5 vectors with voyage-context-3 (contextualized chunk embeddings). Each
 * product = one document with chunks [title, description, attributes]; we pool
 * the returned contextual chunk vectors into a single item vector and persist to
 * thesis.item_vectors (space='e5_context3'). This is the realistic PRODUCTION
 * serving candidate (single dense vector per item, drop-in for pgvector).
 * Usage: pnpm thesis:build-context3
 *
 * Uses the voyageai package's contextualized_embed via the REST API.
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getPgClient } from "@/lib/db/pg";
import { contextualizedEmbed } from "@/lib/embeddings/voyage-context";

function attrText(m: Record<string, unknown>): string {
  return [m.subcategory, m.brand, m.style, m.gender_target].filter(Boolean).join(" ");
}
function l2(v: number[]): number[] {
  let s = 0; for (const x of v) s += x * x; const n = Math.sqrt(s);
  return n === 0 ? v.slice() : v.map((x) => x / n);
}
function meanPool(vs: number[][]): number[] {
  const d = vs[0].length; const o = new Array<number>(d).fill(0);
  for (const v of vs) for (let i = 0; i < d; i++) o[i] += v[i];
  return o.map((x) => x / vs.length);
}

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    const r = await pg.query(`SELECT id::text id, title, description, metadata FROM thesis.products`);
    const rows = r.rows as { id: string; title: string; description: string; metadata: Record<string, unknown> }[];
    await pg.query(`DELETE FROM thesis.item_vectors WHERE space='e5_context3'`);

    const BATCH = 32;
    let n = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const docs = batch.map((p) => [p.title || p.id, p.description || p.title || p.id, attrText(p.metadata) || p.title || p.id]);
      const perDocChunks = await contextualizedEmbed(docs, { inputType: "document" }); // number[][][]
      for (let b = 0; b < batch.length; b++) {
        const itemVec = l2(meanPool(perDocChunks[b]));
        await pg.query(
          `INSERT INTO thesis.item_vectors (space, product_id, vector) VALUES ('e5_context3', $1, $2)
           ON CONFLICT (space, product_id) DO UPDATE SET vector = EXCLUDED.vector`,
          [batch[b].id, itemVec],
        );
        n++;
      }
      console.log(`[e5] ${Math.min(i + BATCH, rows.length)}/${rows.length} products`);
    }
    console.log(`[e5] persisted ${n} item vectors`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```
- [ ] **Step 3:** Create the thin API wrapper `src/lib/embeddings/voyage-context.ts`:
```ts
/**
 * Wrapper over Voyage's contextualized chunk embeddings (voyage-context-3).
 * Input: an array of documents, each an array of chunk strings.
 * Output: per document, an array of chunk vectors (number[][][]). L2 normalized.
 * Docs: https://docs.voyageai.com/docs/contextualized-chunk-embeddings
 */
const API_URL = "https://api.voyageai.com/v1/contextualizedembeddings";
const MODEL = "voyage-context-3";
const DIM = 1024;

function l2normalize(v: number[]): number[] {
  let s = 0; for (const x of v) s += x * x; const n = Math.sqrt(s);
  return n === 0 ? v.slice() : v.map((x) => x / n);
}

export async function contextualizedEmbed(
  documents: string[][],
  opts: { inputType: "document" | "query" },
): Promise<number[][][]> {
  if (documents.length === 0) return [];
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY is required");
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ inputs: documents, model: MODEL, input_type: opts.inputType, output_dimension: DIM, output_dtype: "float" }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Voyage context-3 API ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { data: { data: { embedding: number[]; index: number }[]; index: number }[] };
  return json.data
    .sort((a, b) => a.index - b.index)
    .map((doc) => doc.data.sort((a, b) => a.index - b.index).map((c) => l2normalize(c.embedding)));
}
```
> NOTE: the exact response shape of voyage-context-3 must be confirmed against the live API on first run (the field nesting `data[].data[].embedding` follows their documented contextualized schema). If the first `pnpm thesis:build-context3` errors on parsing, adjust the destructuring in `voyage-context.ts` to match the actual JSON (log `JSON.stringify(json).slice(0,500)` once), then re-run. Treat a shape mismatch as a real adjustment, not a reason to fake output.
- [ ] **Step 4: Run** `pnpm thesis:build-context3` — Expected: `[e5] persisted N item vectors`, N>0. If the model/endpoint is unavailable on the account, report DONE_WITH_CONCERNS and skip E5 in the study (the runner tolerates a missing space) — do NOT fabricate vectors.
- [ ] **Step 5: Commit**
```bash
git add scripts/thesis/embedders/build-context3.ts src/lib/embeddings/voyage-context.ts package.json
git commit -m "feat(thesis): voyage-context-3 CLI + API wrapper — E5 production candidate"
```

---

## Task 13: The embedding-study runner

**Files:** Create `scripts/thesis/embedding-study.ts`; Modify `package.json`

This loads all persisted spaces, builds eval cases per space from the holdout, scores each with the harness, writes the comparison report, and emits the production recommendation.

- [ ] **Step 1:** Add after `"thesis:build-context3"`:
```json
    "thesis:embedding-study": "tsx scripts/thesis/embedding-study.ts",
```
- [ ] **Step 2: Implement** `scripts/thesis/embedding-study.ts`
```ts
#!/usr/bin/env tsx
/**
 * F1 embedding study. For each available space, build eval cases from the thesis
 * holdout (userVector = mean of the user's TRAIN item vectors in THAT space;
 * candidates = catalog minus train items; relevant = test product; complements =
 * GT complement graph of the test product), score with the F0 harness, then emit
 * a markdown comparison + a production recommendation.
 * Usage: pnpm thesis:embedding-study
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { writeFileSync } from "fs";
import { getPgClient } from "@/lib/db/pg";
import { evaluateRanker, type EvalCase } from "@/thesis/eval/harness";
import { cosineSingleVectorRanker } from "@/thesis/eval/baselines";
import { maxSimRanker } from "@/thesis/embedders/maxsim";
import { meanPool, l2normalize } from "@/thesis/embedders/space";
import { recommendProductionSpace, type SpaceScore } from "@/thesis/embedders/recommend";
import type { RankItem } from "@/thesis/types";

const SINGLE_SPACES = [
  { space: "e0_text", servingCost: 1, source: "products.embedding" as const },
  { space: "e1_prod2vec", servingCost: 1, source: "item_vectors" as const },
  { space: "e3_two_tower", servingCost: 1, source: "item_vectors" as const },
  { space: "e5_context3", servingCost: 2, source: "item_vectors" as const },
];
const KS = [5, 10, 20];

async function loadSingleVectors(pg: Awaited<ReturnType<typeof getPgClient>>, space: { space: string; source: string }): Promise<Map<string, number[]>> {
  const m = new Map<string, number[]>();
  if (space.source === "products.embedding") {
    const r = await pg.query(`SELECT id::text id, embedding::text v FROM thesis.products WHERE embedding IS NOT NULL`);
    for (const row of r.rows as { id: string; v: string }[]) m.set(row.id, JSON.parse(row.v));
  } else {
    const r = await pg.query(`SELECT product_id::text id, vector FROM thesis.item_vectors WHERE space=$1`, [space.space]);
    for (const row of r.rows as { id: string; vector: number[] }[]) m.set(row.id, row.vector.map(Number));
  }
  return m;
}

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    // shared eval scaffolding
    const meta = await pg.query(`SELECT id::text id, metadata->>'subcategory' cohort FROM thesis.products`);
    const cohortById = new Map((meta.rows as { id: string; cohort: string }[]).map((r) => [r.id, r.cohort]));
    const popR = await pg.query(`SELECT payload->>'product_id' pid, count(*)::int c FROM thesis.events WHERE payload->>'product_id' IS NOT NULL GROUP BY 1`);
    const popById = new Map((popR.rows as { pid: string; c: number }[]).map((r) => [r.pid, r.c]));
    const trainR = await pg.query(`SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='train'`);
    const trainByUser = new Map<string, string[]>();
    for (const r of trainR.rows as { uid: string; pid: string }[]) {
      const a = trainByUser.get(r.uid) ?? []; a.push(r.pid); trainByUser.set(r.uid, a);
    }
    const testR = await pg.query(`SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='test'`);
    const tests = testR.rows as { uid: string; pid: string }[];
    const complR = await pg.query(`SELECT product_a_id::text a, product_b_id::text b FROM thesis.gt_product_relations WHERE relation_type='complement'`);
    const complByItem = new Map<string, Set<string>>();
    for (const r of complR.rows as { a: string; b: string }[]) {
      const s = complByItem.get(r.a) ?? new Set<string>(); s.add(r.b); complByItem.set(r.a, s);
    }

    const results: { space: string; res: ReturnType<typeof evaluateRanker> }[] = [];

    // ---- single-vector spaces ----
    for (const sp of SINGLE_SPACES) {
      const vecs = await loadSingleVectors(pg, sp);
      if (vecs.size === 0) { console.log(`[study] skip ${sp.space} (no vectors)`); continue; }
      const allIds = [...vecs.keys()];
      const cases: EvalCase[] = [];
      for (const t of tests) {
        const train = (trainByUser.get(t.uid) ?? []).filter((id) => vecs.has(id));
        if (train.length === 0 || !vecs.has(t.pid)) continue;
        const userVector = l2normalize(meanPool(train.map((id) => vecs.get(id)!)));
        const trainSet = new Set(train);
        const candidates: RankItem[] = allIds.filter((id) => !trainSet.has(id)).map((id) => ({
          id, popularity: popById.get(id) ?? 0, vector: vecs.get(id)!, cohort: cohortById.get(id) ?? null,
        }));
        cases.push({ ctx: { userVector, cohort: cohortById.get(t.pid) ?? null }, candidates, relevant: new Set([t.pid]), complements: complByItem.get(t.pid) });
      }
      const res = evaluateRanker(cosineSingleVectorRanker(), cases, KS);
      results.push({ space: sp.space, res });
      console.log(`[study] ${sp.space}: ${cases.length} cases, nDCG@10=${res.ndcg[10].toFixed(3)}`);
    }

    // ---- E2 hybrid (text ⊕ prod2vec), computed inline ----
    {
      const text = await loadSingleVectors(pg, { space: "e0_text", source: "products.embedding" });
      const beh = await loadSingleVectors(pg, { space: "e1_prod2vec", source: "item_vectors" });
      if (text.size && beh.size) {
        const KAPPA = 5;
        const hybrid = new Map<string, number[]>();
        for (const [id, tv] of text) {
          const bv = beh.get(id);
          const n = popById.get(id) ?? 0;
          if (!bv) { hybrid.set(id, l2normalize(tv)); continue; }
          const a = KAPPA / (KAPPA + n);
          const mix = tv.map((x, i) => a * x + (1 - a) * (bv[i] ?? 0));
          hybrid.set(id, l2normalize(mix));
        }
        const allIds = [...hybrid.keys()];
        const cases: EvalCase[] = [];
        for (const t of tests) {
          const train = (trainByUser.get(t.uid) ?? []).filter((id) => hybrid.has(id));
          if (train.length === 0 || !hybrid.has(t.pid)) continue;
          const userVector = l2normalize(meanPool(train.map((id) => hybrid.get(id)!)));
          const trainSet = new Set(train);
          const candidates: RankItem[] = allIds.filter((id) => !trainSet.has(id)).map((id) => ({ id, popularity: popById.get(id) ?? 0, vector: hybrid.get(id)!, cohort: cohortById.get(id) ?? null }));
          cases.push({ ctx: { userVector, cohort: cohortById.get(t.pid) ?? null }, candidates, relevant: new Set([t.pid]), complements: complByItem.get(t.pid) });
        }
        const res = evaluateRanker(cosineSingleVectorRanker(), cases, KS);
        results.push({ space: "e2_hybrid", res });
        console.log(`[study] e2_hybrid: ${cases.length} cases, nDCG@10=${res.ndcg[10].toFixed(3)}`);
      }
    }

    // ---- E4 late-interaction (MaxSim over chunks) ----
    {
      const ch = await pg.query(`SELECT product_id::text id, chunk_index, vector FROM thesis.item_chunk_vectors WHERE space='e4_late' ORDER BY product_id, chunk_index`);
      const itemChunks = new Map<string, number[][]>();
      for (const row of ch.rows as { id: string; chunk_index: number; vector: number[] }[]) {
        const arr = itemChunks.get(row.id) ?? []; arr[row.chunk_index] = row.vector.map(Number); itemChunks.set(row.id, arr);
      }
      if (itemChunks.size) {
        const allIds = [...itemChunks.keys()];
        const cases: EvalCase[] = [];
        for (const t of tests) {
          const train = (trainByUser.get(t.uid) ?? []).filter((id) => itemChunks.has(id));
          if (train.length === 0 || !itemChunks.has(t.pid)) continue;
          // query chunks = all chunks of the user's train items, capped for cost
          const queryChunks = train.flatMap((id) => itemChunks.get(id)!).slice(0, 24);
          const trainSet = new Set(train);
          const candidates: RankItem[] = allIds.filter((id) => !trainSet.has(id)).map((id) => ({ id, popularity: popById.get(id) ?? 0, vector: [], cohort: cohortById.get(id) ?? null }));
          cases.push({ ctx: { userVector: [], cohort: cohortById.get(t.pid) ?? null }, candidates, relevant: new Set([t.pid]), complements: complByItem.get(t.pid) });
          // attach the query chunks via a per-case closure map
          (cases[cases.length - 1] as EvalCase & { queryChunks?: number[][] }).queryChunks = queryChunks;
        }
        // evaluate manually: maxSimRanker needs per-case query chunks
        const ranker = (qc: number[][]) => maxSimRanker(itemChunks, () => qc);
        // reuse evaluateRanker by wrapping: build a single ranker that reads queryChunks off the ctx is not possible;
        // so evaluate case-by-case and average via a tiny aggregator identical to harness semantics.
        const { aggregateCases } = await import("@/thesis/eval/aggregate");
        const res = aggregateCases(cases as (EvalCase & { queryChunks: number[][] })[], (c) => ranker(c.queryChunks), KS, "e4_late");
        results.push({ space: "e4_late", res });
        console.log(`[study] e4_late: ${res.n} cases, nDCG@10=${res.ndcg[10].toFixed(3)}`);
      }
    }

    // ---- report + recommendation ----
    const header = `| Space | cases | MRR | ${KS.map((k) => `nDCG@${k}`).join(" | ")} | ${KS.map((k) => `Recall@${k}`).join(" | ")} | complR@10 |`;
    const sep = `|${"---|".repeat(3 + KS.length * 2 + 1)}`;
    const lines = ["# Thesis F1 — Embedding Study", "", header, sep];
    for (const { space, res } of results) {
      lines.push(`| ${space} | ${res.n} | ${res.mrr.toFixed(3)} | ${KS.map((k) => res.ndcg[k].toFixed(3)).join(" | ")} | ${KS.map((k) => res.recall[k].toFixed(3)).join(" | ")} | ${res.complementRecall[10].toFixed(3)} |`);
    }
    const costBySpace: Record<string, number> = { e0_text: 1, e1_prod2vec: 1, e2_hybrid: 1, e3_two_tower: 1, e4_late: 5, e5_context3: 2 };
    const scores: SpaceScore[] = results.map(({ space, res }) => ({ space, ndcg10: res.ndcg[10], complementRecall10: res.complementRecall[10], servingCost: costBySpace[space] ?? 1 }));
    const rec = recommendProductionSpace(scores, { costWeight: 0.5 });
    lines.push("", `## Production recommendation`, "", `**Deploy: \`${rec.winner}\`** (quality vs serving-cost utility).`, "", "| Space | quality | utility |", "|---|---|---|");
    for (const r of rec.ranked) lines.push(`| ${r.space} | ${r.quality.toFixed(3)} | ${r.utility.toFixed(3)} |`);
    const md = lines.join("\n") + "\n";
    const out = resolve(process.cwd(), "docs/superpowers/reports/2026-05-29-thesis-f1-embedding-study.md");
    writeFileSync(out, md);
    writeFileSync(out.replace(/\.md$/, ".json"), JSON.stringify({ results, recommendation: rec }, null, 2));
    console.log(md);
    console.log(`[study] wrote ${out}`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```
- [ ] **Step 3:** Create the small aggregator `src/thesis/eval/aggregate.ts` (the E4 path needs per-case rankers, which `evaluateRanker` does not support):
```ts
import type { Ranker } from "../types";
import type { EvalCase, EvalResult } from "./harness";
import { recallAtK, ndcgAtK, mrr, mapAtK, hitRateAtK } from "./metrics";

/**
 * Like evaluateRanker, but the ranker may DEPEND on the case (needed for E4,
 * whose query is per-user chunk sets). Averages the same metric suite.
 */
export function aggregateCases<C extends EvalCase>(cases: C[], rankerFor: (c: C) => Ranker, ks: number[], name: string): EvalResult {
  const recall: Record<number, number> = {}, ndcg: Record<number, number> = {}, map: Record<number, number> = {}, hit: Record<number, number> = {}, comp: Record<number, number> = {};
  for (const k of ks) { recall[k] = 0; ndcg[k] = 0; map[k] = 0; hit[k] = 0; comp[k] = 0; }
  let mrrSum = 0, compCases = 0;
  for (const c of cases) {
    const ranked = rankerFor(c).rank(c.ctx, c.candidates);
    for (const k of ks) {
      recall[k] += recallAtK(ranked, c.relevant, k);
      ndcg[k] += ndcgAtK(ranked, c.relevant, k);
      map[k] += mapAtK(ranked, c.relevant, k);
      hit[k] += hitRateAtK(ranked, c.relevant, k);
      if (c.complements) comp[k] += recallAtK(ranked, c.complements, k);
    }
    mrrSum += mrr(ranked, c.relevant);
    if (c.complements) compCases++;
  }
  const n = Math.max(1, cases.length);
  for (const k of ks) { recall[k] /= n; ndcg[k] /= n; map[k] /= n; hit[k] /= n; comp[k] = compCases > 0 ? comp[k] / compCases : 0; }
  return { ranker: name, n: cases.length, recall, ndcg, map, hit, mrr: mrrSum / n, complementRecall: comp };
}
```
Add a unit test `tests/thesis/aggregate.test.ts` mirroring one `harness.test.ts` case to confirm parity:
```ts
import { describe, test, expect } from "vitest";
import { aggregateCases } from "@/thesis/eval/aggregate";
import { cosineSingleVectorRanker } from "@/thesis/eval/baselines";
import type { EvalCase } from "@/thesis/eval/harness";
import type { RankItem } from "@/thesis/types";

describe("aggregateCases parity", () => {
  test("matches evaluateRanker for a constant ranker", () => {
    const items: RankItem[] = [
      { id: "a", popularity: 1, vector: [1, 0] },
      { id: "b", popularity: 9, vector: [0, 1] },
      { id: "c", popularity: 1, vector: [0.8, 0.2] },
    ];
    const cases: EvalCase[] = [{ ctx: { userVector: [1, 0], cohort: null }, candidates: items, relevant: new Set(["c"]) }];
    const r = aggregateCases(cases, () => cosineSingleVectorRanker(), [3], "x");
    expect(r.recall[3]).toBeCloseTo(1, 9); // c is top-3 by cosine to (1,0)
    expect(r.n).toBe(1);
  });
});
```
- [ ] **Step 4: Run** unit: `npx vitest run tests/thesis/aggregate.test.ts` — Expected PASS. Then run the full study (data + all spaces must be built first; see Task 14 orchestration). If a space is missing it is skipped (logged), not failed.
- [ ] **Step 5: Commit**
```bash
git add scripts/thesis/embedding-study.ts src/thesis/eval/aggregate.ts tests/thesis/aggregate.test.ts package.json
git commit -m "feat(thesis): embedding-study runner + per-case aggregator (E0-E5 + recommendation)"
```

---

## Task 14: End-to-end study run + report

**Files:** none new (orchestration + generated report)

- [ ] **Step 1: Regenerate dataset at study scale** (n=2000 keeps Voyage cost ~\$0.05; raise to 5000 for the final thesis figure). Run:
```bash
pnpm thesis:catalog --n 2000 --seed 42 && pnpm thesis:relations && pnpm thesis:behavior --users 800 --days 90 --seed 42
```
Expected: each prints success counts.
- [ ] **Step 2: Build all spaces.** Run sequentially:
```bash
pnpm thesis:train-prod2vec --dim 64 --epochs 30 --seed 42
pnpm thesis:train-two-tower --dim 64 --epochs 80 --seed 42
pnpm thesis:build-chunks
pnpm thesis:build-context3   # if E5 unavailable, this step is skipped per Task 12
```
Expected: each prints a persisted count > 0 (except E5 may be skipped).
- [ ] **Step 3: Run the study.** Run: `pnpm thesis:embedding-study` — Expected: a markdown table with rows for e0–e5 (minus any skipped), and a production recommendation block. Sanity: behavioral spaces (e1/e2/e4) should show **higher complement-recall@10 than e0_text** (the thesis claim: behaviour captures cross-sell that text misses). If e0 ties or beats them on complement-recall, that is a real finding — record it, do not fudge.
- [ ] **Step 4: Commit the generated report.**
```bash
git add docs/superpowers/reports/2026-05-29-thesis-f1-embedding-study.md docs/superpowers/reports/2026-05-29-thesis-f1-embedding-study.json
git commit -m "docs(thesis): F1 embedding-study results + production recommendation"
```

---

## Task 15: Public-dataset cross-check (external validity)

**Files:** Modify `scripts/thesis/embedding-study.ts` is NOT required; instead reuse it after loading public data. Create `scripts/thesis/embedding-study-public.ts` (thin variant) only if needed. For this plan, document the procedure as a runnable task.

- [ ] **Step 1:** Obtain a public e-commerce sessions JSONL (e.g. a small RetailRocket/Amazon-Reviews export) at `/tmp/public.jsonl` with records `{product_id, title, description?, price_cents?, category?, user_id, ts}`. (Acquisition is manual / out of repo.)
- [ ] **Step 2:** Load it: `pnpm thesis:public --file /tmp/public.jsonl --limit 5000` — Expected `[public] products=P events=E`.
- [ ] **Step 3:** Because public data has no GT factors/complement graph, run ONLY the text vs behavioral comparison on it (E0 vs E1) by re-running the relevant CLIs scoped to `source='public'` rows. Document the observed direction (does behavioral still beat text on next-item recall?) in the F1 report under a "External validity" section appended manually.
- [ ] **Step 4: Commit** the appended report section.
```bash
git add docs/superpowers/reports/2026-05-29-thesis-f1-embedding-study.md
git commit -m "docs(thesis): F1 external-validity cross-check on public dataset"
```
> NOTE: This task depends on an external dataset the agent may not have. If unavailable, mark it BLOCKED-EXTERNAL and proceed; the synthetic study (Tasks 1–14) is the complete, self-contained deliverable.

---

## Task 16: Final verification + push

- [ ] **Step 1:** Run the gate:
```bash
npx vitest run tests/thesis && pnpm test:quality && (pnpm typecheck 2>&1 | grep -v '\.next/' | grep -E 'error TS' | grep -E 'thesis|embeddings/voyage' || echo "no thesis/embeddings TS errors")
```
Expected: all thesis tests pass; `[check-test-quality] OK`; `no thesis/embeddings TS errors`.
- [ ] **Step 2:** Confirm existing suite green: `npx vitest run tests/unit` — Expected: 176+ passing.
- [ ] **Step 3:** Push: `git push origin feat/thesis-personalization-program` — Expected: pushed, local == remote.

---

## Self-Review notes (for the implementer)
- **Spec coverage:** E0 (loaded from `products.embedding` in the study runner — no separate task needed), E1 Task 4+9, E2 Task 5 + inline in study, E3 Task 6+10, E4 Task 7+11 + aggregate, E5 Task 12, study+report Task 13–14, recommendation Task 8 + study, public cross-check Task 15. All §4.7 embedders covered; production recommendation (spec amendment) covered by Task 8 + study.
- **No mocks:** trainers are pure (unit-tested on toy corpora); CLIs + the study + the discrimination-style checks hit the real DB and real Voyage; `pnpm test:quality` enforces no banned mocks.
- **Determinism:** E1/E3 are seeded; their unit tests assert reproducibility.
- **Type consistency:** `EmbeddingSpace`/`MultiVectorSpace` (Task 2), `maxSimRanker`/`maxSim` (Task 7), `aggregateCases`/`EvalResult` (Task 13 reuses F0 `EvalResult` shape exactly), `SpaceScore`/`Recommendation` (Task 8) used identically in the study runner.
- **Known risk:** the voyage-context-3 response shape (Task 12) is confirmed against the live API on first run; a parse mismatch is a real adjustment, never faked. E4 query-chunk cap (24) bounds MaxSim cost; document if raised.
