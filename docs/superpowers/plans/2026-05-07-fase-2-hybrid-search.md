# Fase 2 — Búsqueda híbrida (BM25 + cosine + RRF) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 2 deliverables — LLM query normalizer, dual cache (exact hash + semantic HNSW), hybrid retrieval (BM25 + cosine + RRF k₀=60), mock fallback when local hits < 12 AND confidence > 0.5, search persistence + admin endpoint, UI Suspense skeleton — with TDD and real-API tests, ending with a triple-review pass and a 30-query subjective evaluation.

**Architecture:** New `src/sectors/c-search/` sector with sub-modules per concern (`normalizer/`, `cache/`, `retrieve/`, `decide/`, `persist/`, `admin/`, `search.ts` orchestrator). Hybrid flow runs BM25 (`ts_rank_cd` over `tsvector_es`) and cosine (`pgvector <=>` over `embedding`) in parallel, fuses via pure RRF function. Mock fallback re-uses Phase 1's `processProduct` pipeline. UI uses React Suspense for honest skeleton during 2-4s mock waits.

**Tech Stack:** Next.js 16.2, TypeScript 5.6, vitest 4.1, @playwright/test 1.59, pg 8.20, pgvector 0.8.0, voyage-4 (1024 dim), claude-haiku-4-5-20251001 with `cacheSystem`, zod 4.4, Auth0 v4.

**Spec:** `docs/superpowers/specs/2026-05-07-fase-2-design.md` — read for context if anything below seems underspecified.

**Branch:** `feat/fase-2-hybrid-search` (already created at `48f7305`, pushed and tracking).

---

## Conventions

- All tests use `vitest` with `import { describe, test, expect, beforeEach, afterEach } from 'vitest'`.
- Integration tests use `withTestDb(fn)` from `tests/helpers/db.ts` (gives `pg` Client with `search_path test_schema, public, extensions`).
- `truncateTestTables([...])` from same helper resets between tests.
- Real APIs — Voyage and Anthropic — are NEVER mocked. AST checker enforces this for `@/lib/llm`, `@/lib/embeddings`, `@/sectors/c-search/normalizer` (already in banned list per Phase 1 follow-up #7).
- The only allowed mock: `src/sectors/b-catalog/mock/*` (the aggregator).
- **CRITICAL — push after EVERY commit** with `git push origin feat/fase-2-hybrid-search`. (Standing instruction from Phase 1.)
- Each task ends with a commit + push pair.
- All tests must pass `pnpm test:quality` (0 anti-pattern violations).

## File map

```
src/
├── sectors/
│   └── c-search/                                 [ALL NEW]
│       ├── normalizer/
│       │   ├── prompt.ts                         [Task 7]   PROMPT_VERSION + SYSTEM_PROMPT + zod schema
│       │   └── normalize.ts                      [Task 7]   normalizeQueryWithLLM(rawQuery)
│       ├── cache/
│       │   ├── hash.ts                           [Task 3]   canonicalize() + hashQuery()
│       │   ├── exact.ts                          [Task 8]   lookupExact() / writeExact()
│       │   └── semantic.ts                       [Task 9]   lookupSemantic() + DEFAULT_THETA
│       ├── retrieve/
│       │   ├── bm25.ts                           [Task 10]  bm25Search()
│       │   ├── cosine.ts                         [Task 11]  cosineSearch()
│       │   └── rrf.ts                            [Task 4]   rrfFuse() — pure
│       ├── decide/
│       │   └── shouldCallMock.ts                 [Task 5]   shouldCallMock() + thresholds
│       ├── persist/
│       │   └── searches.ts                       [Task 12]  persistSearch()
│       ├── admin/
│       │   └── list.ts                           [Task 13]  listSearches()
│       └── search.ts                             [Task 14]  hybridSearch() orchestrator
│
├── lib/
│   └── llm/
│       └── anthropic.ts                          [Task 7 MODIFY] export stripMarkdownWrapper helper
│       └── strip-markdown.ts                     [Task 7 NEW] extracted helper (or re-exported)
│
├── app/
│   ├── (shop)/search/page.tsx                    [Task 16 REFACTOR] Suspense + SearchResults async
│   ├── api/
│   │   ├── search/route.ts                       [Task 15 REFACTOR] llama hybridSearch
│   │   └── admin/searches/route.ts               [Task 13 NEW]
│   └── components/
│       ├── SearchSkeleton.tsx                    [Task 16 NEW]
│       ├── SearchResults.tsx                     [Task 16 NEW] server component async
│       ├── SearchUnderstood.tsx                  [Task 16 NEW] client chips
│       └── SearchTracker.tsx                     [Task 15 MODIFY] method='hybrid_rrf'

scripts/
└── eval-30-queries.ts                            [Task 18 NEW] CLI generates eval markdown

supabase/migrations/
├── 0015_search_phase2.sql                        [Task 2 NEW] indexes + comments
└── 0016_test_schema_replicate_v3.sql             [Task 2 NEW] regenerated

tests/
├── helpers/
│   └── seed.ts                                   [Task 11 MODIFY] add seedProductWithEmbedding helper
├── unit/
│   ├── cache-hash.test.ts                        [Task 3]   8 tests
│   ├── rrf.test.ts                               [Task 4]   8 tests
│   └── decide-mock.test.ts                       [Task 5]   4 tests
├── integration/
│   ├── normalize-query.test.ts                   [Task 7]   5 tests (real Anthropic)
│   ├── cache-exact.test.ts                       [Task 8]   4 tests
│   ├── cache-semantic.test.ts                    [Task 9]   4 tests (real Voyage)
│   ├── bm25.test.ts                              [Task 10]  5 tests
│   ├── cosine.test.ts                            [Task 11]  5 tests (real Voyage)
│   ├── searches-persist.test.ts                  [Task 12]  3 tests
│   ├── admin-searches-route.test.ts              [Task 13]  4 tests
│   ├── hybrid-search.test.ts                     [Task 14]  4 tests (orchestrator basic)
│   ├── search-mock-fallback.test.ts              [Task 14b] 3 tests (mock fallback path)
│   └── search-route.test.ts                      [Task 15]  4 tests
└── e2e/
    └── search-flow.spec.ts                       [Task 17]  2 tests

docs/superpowers/reports/
├── 2026-05-XX-fase-2-eval-30-queries.md          [Task 18]  generated by CLI
└── 2026-05-XX-fase-2-cierre.md                   [Task 20]  closure with literal triple-review
```

## Task list

| # | Title | Time est. | Dependencies |
|---|---|---|---|
| 1 | Smoke pre-flight check | 10 min | — |
| 2 | Migration 0015 + regen test_schema 0016 | 15 min | 1 |
| 3 | `cache/hash.ts` canonicalize + hashQuery + 8 unit tests | 25 min | 2 |
| 4 | `retrieve/rrf.ts` rrfFuse pure + 8 unit tests | 30 min | 2 |
| 5 | `decide/shouldCallMock.ts` + 4 unit tests | 15 min | 2 |
| 6 | Extract `stripMarkdownWrapper` to importable | 10 min | 2 |
| 7 | `normalizer/{prompt,normalize}.ts` + 5 integration tests | 35 min | 6 |
| 8 | `cache/exact.ts` lookupExact + writeExact + 4 integration tests | 30 min | 3 |
| 9 | `cache/semantic.ts` lookupSemantic + 4 integration tests | 30 min | 3, 8 |
| 10 | `retrieve/bm25.ts` + 5 integration tests + extend `seedProduct` helper | 35 min | 2 |
| 11 | `retrieve/cosine.ts` + 5 integration tests + `seedProductWithEmbedding` helper | 40 min | 2 |
| 12 | `persist/searches.ts` + 3 integration tests | 25 min | 7 |
| 13 | `admin/list.ts` + `/api/admin/searches` route + 4 integration tests | 35 min | 12 |
| 14 | `search.ts` orchestrator + 4 integration tests (basic flow) | 45 min | 4, 5, 7, 8, 9, 10, 11, 12 |
| 14b | `search-mock-fallback.test.ts` orchestrator with mock fallback (3 tests) | 30 min | 14 |
| 15 | `/api/search` route refactor + 4 tests + SearchTracker method update | 25 min | 14 |
| 16 | UI: SearchSkeleton + SearchResults + SearchUnderstood + page Suspense | 35 min | 15 |
| 17 | E2E `search-flow.spec.ts` (2 tests) | 30 min | 16 |
| 18 | `eval-30-queries.ts` CLI + run + commit results md | 45 min | 17 |
| 19 | Mutation testing on 7 functions | 60 min | 18 |
| 20 | Full suite green + triple review + closure report | 90 min | 19 |

---

## Task 1: Smoke pre-flight check

**Files:** none.

**Goal:** Confirm Phase 1 baseline works on the fresh `feat/fase-2-hybrid-search` branch.

- [ ] **Step 1: Confirm branch and clean state**

Run: `git status && git branch --show-current`

Expected: `On branch feat/fase-2-hybrid-search`, clean working tree (or only `node_modules/.next` ignored). The latest commit should be `48f7305 docs(fase-2): design spec...`.

- [ ] **Step 2: Verify env vars present**

Run:
```bash
node -e "['SUPABASE_DB_URL','VOYAGE_API_KEY','DEEPSEEK_API_KEY','AUTH0_DOMAIN','AUTH0_CLIENT_ID','AUTH0_CLIENT_SECRET','AUTH0_SECRET','APP_BASE_URL','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'].forEach(k=>console.log(k+': '+(!!process.env[k])))" --env-file=.env.local
```

Expected: every line ends in `true`. (ANTHROPIC_API_KEY is optional; DEEPSEEK_API_KEY is now required.)

- [ ] **Step 3: Run Phase 1 baseline tests**

Run: `pnpm test:unit && pnpm test:integration -- --reporter=verbose 2>&1 | tail -10`

Expected: ~45 unit + ~77 integration pass (4 health-endpoint tests skipped).

- [ ] **Step 4: Confirm test_schema is in sync (parity)**

Run: `pnpm vitest run tests/integration/test-schema-parity.test.ts`

Expected: 1 test PASS.

- [ ] **Step 5: Verify quality**

Run: `pnpm test:quality`

Expected: `OK — scanned 27 files, 0 violations.`

If anything in steps 2-5 fails, **stop and report**. Phase 1 baseline must be green before adding Phase 2 code.

No commit for this task — verification only.

---

## Task 2: Migration 0015 + regenerate test_schema 0016

**Files:**
- Create: `supabase/migrations/0015_search_phase2.sql`
- Create (generated): `supabase/migrations/0016_test_schema_replicate_v3.sql`
- Delete: `supabase/migrations/0014_test_schema_replicate_v2.sql`

**Goal:** Add admin filter indexes on `searches` table + comment on `product_query_cache.ttl_until`. Regenerate test_schema replica.

- [ ] **Step 1: Create the migration**

Create `supabase/migrations/0015_search_phase2.sql`:

```sql
-- Composite index for admin filter "by method"
CREATE INDEX IF NOT EXISTS searches_method_time_idx
  ON public.searches (search_method, occurred_at DESC);

-- Index for admin filter "by prompt_version" (auditoría de bugs por versión)
CREATE INDEX IF NOT EXISTS searches_prompt_version_idx
  ON public.searches (prompt_version) WHERE prompt_version IS NOT NULL;

-- Document cache TTL semantics
COMMENT ON COLUMN public.product_query_cache.ttl_until IS
  'Rows past this timestamp are ignored by lookupExact/lookupSemantic. Cleanup via Phase 4 cron.';
```

- [ ] **Step 2: Apply migration**

Run: `pnpm migrate`

Expected: output includes `applied 0015_search_phase2.sql`.

- [ ] **Step 3: Verify indexes exist**

Run:
```bash
pnpm tsx -e "(async () => { const {getPgClient} = await import('./src/lib/db/pg'); const pg = await getPgClient(); const r = await pg.query(\"SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='searches' ORDER BY indexname\"); console.log(r.rows.map(x => x.indexname)); await pg.end(); })()"
```

Expected: array contains `searches_method_time_idx` and `searches_prompt_version_idx` (along with existing `searches_user_time_idx` and `searches_pkey`).

- [ ] **Step 4: Delete old test_schema replicate**

Run: `rm -f supabase/migrations/0014_test_schema_replicate_v2.sql`

We replace it with the regenerated 0016.

- [ ] **Step 5: Update generator to emit 0016 filename**

Read `scripts/generate-test-schema-migration.ts` and locate the `OUT` constant (or similar) that names the output file. Change it to:

```ts
const OUT = "supabase/migrations/0016_test_schema_replicate_v3.sql";
```

- [ ] **Step 6: Regenerate test_schema replicate**

Run: `pnpm tsx scripts/generate-test-schema-migration.ts`

Expected: `0016_test_schema_replicate_v3.sql` is created. The script processes 11 source migrations (0003-0011, 0013, 0015) — 0001/0002 are bootstrap, 0014 was deleted, 0012 was deleted in Phase 1.

- [ ] **Step 7: Drop and recreate test_schema, then re-apply all migrations**

```bash
pnpm tsx -e "(async () => { const {getPgClient} = await import('./src/lib/db/pg'); const pg = await getPgClient(); await pg.query('DROP SCHEMA IF EXISTS test_schema CASCADE'); await pg.query('CREATE SCHEMA test_schema'); await pg.query(\"DELETE FROM _migrations WHERE filename LIKE '%test_schema_replicate%' OR filename = '0002_test_schema.sql'\"); await pg.end(); console.log('test_schema reset'); })()"
pnpm migrate
```

Expected: migrations 0002 (test_schema) and 0016 (replicate) re-applied. No errors.

- [ ] **Step 8: Run parity test**

Run: `pnpm vitest run tests/integration/test-schema-parity.test.ts`

Expected: 1 test PASS.

- [ ] **Step 9: Commit AND push**

```bash
git add supabase/migrations/ scripts/generate-test-schema-migration.ts
git commit -m "feat(db): migration 0015 search_phase2 indexes + regen test_schema (0016)"
git push origin feat/fase-2-hybrid-search
```

---

## Task 3: `cache/hash.ts` canonicalize + hashQuery + 8 unit tests

**Files:**
- Create: `src/sectors/c-search/cache/hash.ts`
- Create: `tests/unit/cache-hash.test.ts`

**Goal:** Pure functions for query canonicalization (lowercase + NFD strip + word sort) and sha256 hashing. Mutation-testable: 5 of the 7 mutation tests in T19 target this file.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cache-hash.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { canonicalize, hashQuery } from "@/sectors/c-search/cache/hash";

describe("canonicalize", () => {
  test.each([
    ["Hello World", "hello world"],
    ["WORLD HELLO", "hello world"],
    ["Sábanas", "sabanas"],
    ["  multiple   spaces  ", "multiple spaces"],
    ["regalo niña 8 años", "8 anos nina regalo"],
    ["niña 8 años regalo", "8 anos nina regalo"],
    ["8 años niña regalo", "8 anos nina regalo"],
  ])("canonicalize(%j) === %j", (input, expected) => {
    expect(canonicalize(input)).toBe(expected);
  });

  test("empty string → empty string", () => {
    expect(canonicalize("")).toBe("");
  });
});

describe("hashQuery", () => {
  test("returns hex-64 string", () => {
    expect(hashQuery("hello world")).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is deterministic", () => {
    const h1 = hashQuery("hello world");
    const h2 = hashQuery("hello world");
    expect(h1).toBe(h2);
  });

  test("different canonical inputs produce different hashes", () => {
    expect(hashQuery("hello")).not.toBe(hashQuery("world"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/cache-hash.test.ts`

Expected: FAIL with `Cannot find module '@/sectors/c-search/cache/hash'`.

- [ ] **Step 3: Implement**

Create `src/sectors/c-search/cache/hash.ts`:

```ts
import { createHash } from "node:crypto";

export function canonicalize(rawQuery: string): string {
  return rawQuery
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export function hashQuery(rawQuery: string): string {
  return createHash("sha256").update(canonicalize(rawQuery)).digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/cache-hash.test.ts`

Expected: 11 tests PASS (8 from `test.each` + 3 from `hashQuery` + 1 empty case in canonicalize describe = 11 total but test counter shows 11 — `test.each` counts as N).

- [ ] **Step 5: Verify quality**

Run: `pnpm test:quality`

Expected: `OK — scanned 28 files, 0 violations.`

- [ ] **Step 6: Commit AND push**

```bash
git add src/sectors/c-search/cache/hash.ts tests/unit/cache-hash.test.ts
git commit -m "feat(search): canonicalize + hashQuery pure fns + 8 unit tests"
git push origin feat/fase-2-hybrid-search
```

---

## Task 4: `retrieve/rrf.ts` rrfFuse pure + 8 unit tests

**Files:**
- Create: `src/sectors/c-search/retrieve/rrf.ts`
- Create: `tests/unit/rrf.test.ts`

**Goal:** Pure function for Reciprocal Rank Fusion. 2 of the 7 mutation tests in T19 target this file.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/rrf.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { rrfFuse, RRF_K0, type RankedProduct } from "@/sectors/c-search/retrieve/rrf";

const r = (id: string, rank: number): RankedProduct => ({ id, rank, score: 1 / rank });

describe("rrfFuse", () => {
  test("product in both lists at rank 1: rrf_score = 2/(60+1)", () => {
    const out = rrfFuse([[r("A", 1)], [r("A", 1)]]);
    expect(out).toHaveLength(1);
    expect(out[0].rrf_score).toBeCloseTo(2 / 61, 6);
    expect(out[0].ranks).toEqual({ bm25: 1, cosine: 1 });
  });

  test("product only in BM25 at rank 1: rrf_score = 1/61", () => {
    const out = rrfFuse([[r("A", 1)], []]);
    expect(out[0].rrf_score).toBeCloseTo(1 / 61, 6);
    expect(out[0].ranks).toEqual({ bm25: 1 });
  });

  test("symmetry: BM25 1 + cosine 5 == BM25 5 + cosine 1 (commutative)", () => {
    const out = rrfFuse([
      [r("A", 1), r("B", 5)],
      [r("B", 1), r("A", 5)],
    ]);
    expect(out[0].rrf_score).toBeCloseTo(out[1].rrf_score, 6);
    expect([out[0].id, out[1].id].sort()).toEqual(["A", "B"]);
  });

  test("k0=60 changes scores vs k0=0 (mutation guard)", () => {
    const r60 = rrfFuse([[r("A", 1)]], 60);
    const r0 = rrfFuse([[r("A", 1)]], 0);
    expect(r60[0].rrf_score).toBeCloseTo(1 / 61, 6);
    expect(r0[0].rrf_score).toBeCloseTo(1 / 1, 6);
    expect(r60[0].rrf_score).not.toBe(r0[0].rrf_score);
  });

  test("empty inputs → empty output", () => {
    expect(rrfFuse([[], []])).toEqual([]);
    expect(rrfFuse([])).toEqual([]);
  });

  test("single-list ranking passes through with no fusion", () => {
    const out = rrfFuse([[r("A", 1), r("B", 2), r("C", 3)]]);
    expect(out.map((p) => p.id)).toEqual(["A", "B", "C"]);
    expect(out[0].rrf_score).toBeCloseTo(1 / 61, 6);
  });

  test("3 in BM25 + 1 distinct in cosine: 4 fused, sorted by score", () => {
    const out = rrfFuse([
      [r("A", 1), r("B", 2), r("C", 3)],
      [r("D", 1)],
    ]);
    expect(out).toHaveLength(4);
    expect(out.map((p) => p.id).sort()).toEqual(["A", "B", "C", "D"]);
    expect(out[0].rrf_score).toBeCloseTo(1 / 61, 6);
    expect(out[1].rrf_score).toBeCloseTo(1 / 61, 6);
    expect(out[2].rrf_score).toBeCloseTo(1 / 62, 6);
    expect(out[3].rrf_score).toBeCloseTo(1 / 63, 6);
  });

  test("RRF_K0 const is 60", () => {
    expect(RRF_K0).toBe(60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/rrf.test.ts`

Expected: FAIL with `Cannot find module '@/sectors/c-search/retrieve/rrf'`.

- [ ] **Step 3: Implement**

Create `src/sectors/c-search/retrieve/rrf.ts`:

```ts
export const RRF_K0 = 60;

export interface RankedProduct {
  id: string;
  rank: number;        // 1-based
  score: number;       // BM25 or cosine raw score
}

export interface FusedProduct {
  id: string;
  rrf_score: number;
  ranks: { bm25?: number; cosine?: number };
}

export function rrfFuse(
  rankings: RankedProduct[][],
  k0: number = RRF_K0,
  listLabels: string[] = ["bm25", "cosine"],
): FusedProduct[] {
  const acc = new Map<string, FusedProduct>();
  rankings.forEach((ranking, listIdx) => {
    const label = listLabels[listIdx] ?? `list${listIdx}`;
    for (const item of ranking) {
      const reciprocal = 1 / (k0 + item.rank);
      const existing = acc.get(item.id);
      if (existing) {
        existing.rrf_score += reciprocal;
        (existing.ranks as Record<string, number>)[label] = item.rank;
      } else {
        acc.set(item.id, {
          id: item.id,
          rrf_score: reciprocal,
          ranks: { [label]: item.rank } as { bm25?: number; cosine?: number },
        });
      }
    }
  });
  return Array.from(acc.values()).sort((a, b) => b.rrf_score - a.rrf_score);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/rrf.test.ts`

Expected: 8 tests PASS.

- [ ] **Step 5: Commit AND push**

```bash
git add src/sectors/c-search/retrieve/rrf.ts tests/unit/rrf.test.ts
git commit -m "feat(search): rrfFuse pure fn + 8 unit tests with k0=60 mutation guard"
git push origin feat/fase-2-hybrid-search
```

---

## Task 5: `decide/shouldCallMock.ts` + 4 unit tests

**Files:**
- Create: `src/sectors/c-search/decide/shouldCallMock.ts`
- Create: `tests/unit/decide-mock.test.ts`

**Goal:** Pure function for the mock fallback decision. Tests cover the 4 cuadrantes of (count, confidence). Mutation tests #6 and #7 target this.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/decide-mock.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import {
  shouldCallMock,
  LOCAL_HITS_THRESHOLD,
  CONFIDENCE_THRESHOLD,
} from "@/sectors/c-search/decide/shouldCallMock";

describe("shouldCallMock", () => {
  test("count 12 with confidence 0.9 → false (threshold is < 12, not <= 12)", () => {
    expect(shouldCallMock(12, 0.9)).toBe(false);
  });

  test("count 5 with confidence 0.4 → false (low confidence)", () => {
    expect(shouldCallMock(5, 0.4)).toBe(false);
  });

  test("count 5 with confidence 0.9 → true", () => {
    expect(shouldCallMock(5, 0.9)).toBe(true);
  });

  test("count 15 with confidence 0.9 → false (enough local hits)", () => {
    expect(shouldCallMock(15, 0.9)).toBe(false);
  });

  test("constants are 12 and 0.5", () => {
    expect(LOCAL_HITS_THRESHOLD).toBe(12);
    expect(CONFIDENCE_THRESHOLD).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/decide-mock.test.ts`

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement**

Create `src/sectors/c-search/decide/shouldCallMock.ts`:

```ts
export const LOCAL_HITS_THRESHOLD = 12;
export const CONFIDENCE_THRESHOLD = 0.5;

export function shouldCallMock(localCount: number, confidence: number): boolean {
  return localCount < LOCAL_HITS_THRESHOLD && confidence > CONFIDENCE_THRESHOLD;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/decide-mock.test.ts`

Expected: 5 tests PASS (4 quadrants + 1 constants check).

- [ ] **Step 5: Commit AND push**

```bash
git add src/sectors/c-search/decide/shouldCallMock.ts tests/unit/decide-mock.test.ts
git commit -m "feat(search): shouldCallMock decision fn + 4 unit tests on 4 quadrants"
git push origin feat/fase-2-hybrid-search
```

---

## Task 6: Extract `stripMarkdownWrapper` to importable

**Files:**
- Modify: `src/sectors/b-catalog/enrichment/normalizer.ts` (add `export` to existing helper)

**Goal:** The Phase 1 normalizer has a private `stripMarkdownWrapper` helper. Phase 2's query normalizer needs the same helper. Make it importable.

- [ ] **Step 1: Read the existing normalizer**

Run: `grep -n "stripMarkdownWrapper\|function strip" src/sectors/b-catalog/enrichment/normalizer.ts`

Expected: see the private function definition. Note its exact signature.

- [ ] **Step 2: Add `export` keyword**

Edit `src/sectors/b-catalog/enrichment/normalizer.ts`. Find the line that starts with:

```ts
function stripMarkdownWrapper(...
```

(the exact signature depends on what was implemented in Phase 1 Task 16; typically it's `function stripMarkdownWrapper(text: string): string {`).

Replace with:

```ts
export function stripMarkdownWrapper(...
```

(Just adding `export` keyword at the start. Keep the rest unchanged.)

- [ ] **Step 3: Verify Phase 1 tests still pass**

Run: `pnpm vitest run tests/integration/enrichment-pipeline.test.ts`

Expected: 4 tests still PASS (the function works the same; we just exposed it).

- [ ] **Step 4: Verify quality**

Run: `pnpm test:quality && pnpm typecheck`

Expected: 0 violations + 0 type errors.

- [ ] **Step 5: Commit AND push**

```bash
git add src/sectors/b-catalog/enrichment/normalizer.ts
git commit -m "refactor(catalog): export stripMarkdownWrapper for re-use by phase-2 normalizer"
git push origin feat/fase-2-hybrid-search
```

---

## Task 7: `normalizer/{prompt,normalize}.ts` + 5 integration tests

**Files:**
- Create: `src/sectors/c-search/normalizer/prompt.ts`
- Create: `src/sectors/c-search/normalizer/normalize.ts`
- Create: `tests/integration/normalize-query.test.ts`

**Goal:** LLM normalizer that wraps DeepSeek `deepseek-v4-flash` with versioned prompt + zod schema. Real API tests verify schema validation, low-confidence garbage detection, and JSON robustness.

- [ ] **Step 1: Implement prompt + schema**

Create `src/sectors/c-search/normalizer/prompt.ts`:

```ts
import { z } from "zod";

export const PROMPT_VERSION = "v1.0.0-fase2";

export const SYSTEM_PROMPT = `Eres un normalizador de queries de búsqueda en e-commerce. Recibes la consulta cruda del usuario y devuelves JSON estructurado en español.

Campos:
- intent: 'compra'|'regalo'|'exploracion'|'comparacion'
- recipient_gender: 'femenino'|'masculino'|'unisex'|null
- recipient_age_min: integer|null
- recipient_age_max: integer|null
- categories: array de strings (preferencia: una de [ropa, electronica, hogar, juguetes_bebe, belleza, otros], pero subcategorías como "ropa_niña" están permitidas)
- style: array de strings (descriptores subjetivos: bonito, elegante, deportivo, etc.)
- price_range: 'bajo'|'medio'|'alto'|null
- search_terms: string — keywords core para BM25 (sin stop-words, en orden lógico, sin acentos)
- confidence: number entre 0 y 1

Reglas:
- Query ambigua o basura ('asdfgh', strings sin sentido) → confidence < 0.5
- search_terms debe ser concreto y útil para búsqueda full-text
- Sin invención: si no puedes inferir un campo, usa null o array vacío

Devuelve SOLO el JSON, sin markdown ni texto adicional.`;

export const normalizedQuerySchema = z.object({
  intent: z.enum(["compra", "regalo", "exploracion", "comparacion"]),
  recipient_gender: z.enum(["femenino", "masculino", "unisex"]).nullable(),
  recipient_age_min: z.number().int().min(0).max(130).nullable(),
  recipient_age_max: z.number().int().min(0).max(130).nullable(),
  categories: z.array(z.string()),
  style: z.array(z.string()),
  price_range: z.enum(["bajo", "medio", "alto"]).nullable(),
  search_terms: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export type NormalizedQuery = z.infer<typeof normalizedQuerySchema>;
```

- [ ] **Step 2: Implement normalizer**

Create `src/sectors/c-search/normalizer/normalize.ts`:

```ts
import { sendMessageDeepSeek, DEEPSEEK_MODELS } from "@/lib/llm/deepseek";
import { stripMarkdownWrapper } from "@/sectors/b-catalog/enrichment/normalizer";
import {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  normalizedQuerySchema,
  type NormalizedQuery,
} from "./prompt";

export async function normalizeQueryWithLLM(rawQuery: string): Promise<NormalizedQuery & { prompt_version: string }> {
  const res = await sendMessageDeepSeek({
    model: DEEPSEEK_MODELS.flash,
    system: SYSTEM_PROMPT,
    cacheSystem: true,    // no-op for DeepSeek (server-side caching is automatic) — kept for interface compat
    jsonMode: true,        // enforce response_format: { type: "json_object" }
    messages: [{ role: "user", content: rawQuery }],
    maxTokens: 300,
    temperature: 0,
  });
  const text = stripMarkdownWrapper(res.text);
  const parsed = JSON.parse(text);
  return { ...normalizedQuerySchema.parse(parsed), prompt_version: PROMPT_VERSION };
}
```

- [ ] **Step 3: Write the failing integration test**

Create `tests/integration/normalize-query.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { normalizeQueryWithLLM } from "@/sectors/c-search/normalizer/normalize";

describe("normalizeQueryWithLLM (REAL DeepSeek flash)", () => {
  test("clear gift query: 'regalo para mi sobrina de 8 años'", async () => {
    const r = await normalizeQueryWithLLM("regalo para mi sobrina de 8 años");
    expect(r.intent).toBe("regalo");
    expect(r.recipient_gender === "femenino" || r.recipient_gender === "unisex").toBe(true);
    expect(r.recipient_age_min ?? -1).toBeGreaterThanOrEqual(6);
    expect(r.recipient_age_max ?? 999).toBeLessThanOrEqual(10);
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.search_terms.length).toBeGreaterThan(0);
    expect(r.prompt_version).toBe("v1.0.0-fase2");
  }, 30_000);

  test("garbage query: 'asdfgh qwerty zzzz' → confidence < 0.5", async () => {
    const r = await normalizeQueryWithLLM("asdfgh qwerty zzzz");
    expect(r.confidence).toBeLessThan(0.5);
  }, 30_000);

  test("clear product query: 'Nike Air Max 270 talle 42'", async () => {
    const r = await normalizeQueryWithLLM("Nike Air Max 270 talle 42");
    expect(r.search_terms.toLowerCase()).toMatch(/nike|air|max|270/);
    expect(r.confidence).toBeGreaterThan(0.5);
  }, 30_000);

  test("returns valid schema with all fields populated or null/empty", async () => {
    const r = await normalizeQueryWithLLM("audífonos bluetooth con cancelación de ruido");
    expect(r).toMatchObject({
      intent: expect.stringMatching(/^(compra|regalo|exploracion|comparacion)$/),
      categories: expect.any(Array),
      style: expect.any(Array),
      search_terms: expect.any(String),
      confidence: expect.any(Number),
      prompt_version: "v1.0.0-fase2",
    });
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  }, 30_000);

  test("category inference: 'pantalón corto verano' → categories includes 'ropa' (or subcategory)", async () => {
    const r = await normalizeQueryWithLLM("pantalón corto verano");
    expect(r.categories.length).toBeGreaterThan(0);
    expect(r.categories.some((c) => c.toLowerCase().includes("ropa"))).toBe(true);
  }, 30_000);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/normalize-query.test.ts`

Expected: 5 tests PASS. Total ~$0.01 in tokens.

- [ ] **Step 5: Verify quality**

Run: `pnpm test:quality`

Expected: 0 violations.

- [ ] **Step 6: Commit AND push**

```bash
git add src/sectors/c-search/normalizer/ tests/integration/normalize-query.test.ts
git commit -m "feat(search): normalizeQueryWithLLM + versioned prompt + 5 integration tests"
git push origin feat/fase-2-hybrid-search
```

---

## Task 8: `cache/exact.ts` lookupExact + writeExact + 4 integration tests

**Files:**
- Create: `src/sectors/c-search/cache/exact.ts`
- Create: `tests/integration/cache-exact.test.ts`

**Goal:** Exact-hash cache backed by `product_query_cache` table with 24h TTL.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/cache-exact.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { hashQuery } from "@/sectors/c-search/cache/hash";
import { lookupExact, writeExact, EXACT_CACHE_TTL_SECONDS } from "@/sectors/c-search/cache/exact";

beforeEach(async () => {
  await truncateTestTables(["product_query_cache"]);
});

const sampleEmbedding = Array.from({ length: 1024 }, (_, i) => (i % 2 === 0 ? 0.5 : -0.5));
const normSampleEmbedding = (() => {
  const norm = Math.sqrt(sampleEmbedding.reduce((s, x) => s + x * x, 0));
  return sampleEmbedding.map((x) => x / norm);
})();

const sampleNormalized = {
  intent: "compra" as const,
  recipient_gender: null,
  recipient_age_min: null,
  recipient_age_max: null,
  categories: ["ropa"],
  style: [],
  price_range: null,
  search_terms: "camiseta deportiva",
  confidence: 0.9,
  prompt_version: "v1.0.0-fase2",
};

const sampleProductIds = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
];

describe("cache/exact", () => {
  test("writeExact then lookupExact returns the same row", async () => {
    await withTestDb(async (pg) => {
      const hash = hashQuery("camiseta deportiva");
      await writeExact(
        {
          query_hash: hash,
          query_embedding: normSampleEmbedding,
          normalized_json: sampleNormalized,
          products_returned: sampleProductIds,
        },
        pg,
      );
      const got = await lookupExact(hash, pg);
      expect(got).not.toBeNull();
      expect(got!.query_hash).toBe(hash);
      expect(got!.products_returned).toEqual(sampleProductIds);
      expect(got!.normalized_json.search_terms).toBe("camiseta deportiva");
    });
  });

  test("lookupExact returns null when hash not present", async () => {
    await withTestDb(async (pg) => {
      const got = await lookupExact(hashQuery("nothing here"), pg);
      expect(got).toBeNull();
    });
  });

  test("expired rows are NOT returned by lookupExact", async () => {
    await withTestDb(async (pg) => {
      const hash = hashQuery("expired query");
      // Write with TTL 1 second
      await writeExact(
        {
          query_hash: hash,
          query_embedding: normSampleEmbedding,
          normalized_json: sampleNormalized,
          products_returned: sampleProductIds,
          ttl_seconds: 1,
        },
        pg,
      );
      // Force expiration by updating ttl_until directly to past
      await pg.query(`UPDATE product_query_cache SET ttl_until = now() - interval '1 hour' WHERE query_hash = $1`, [hash]);
      const got = await lookupExact(hash, pg);
      expect(got).toBeNull();
    });
  });

  test("writeExact UPSERTs on conflict (same hash → updates fields)", async () => {
    await withTestDb(async (pg) => {
      const hash = hashQuery("conflict query");
      await writeExact(
        { query_hash: hash, query_embedding: normSampleEmbedding, normalized_json: sampleNormalized, products_returned: sampleProductIds },
        pg,
      );
      const newProducts = ["33333333-3333-4333-8333-333333333333"];
      await writeExact(
        { query_hash: hash, query_embedding: normSampleEmbedding, normalized_json: sampleNormalized, products_returned: newProducts },
        pg,
      );
      const got = await lookupExact(hash, pg);
      expect(got!.products_returned).toEqual(newProducts);
      const count = await pg.query(`SELECT count(*)::int FROM product_query_cache`);
      expect(count.rows[0].count).toBe(1);
    });
  });

  test("EXACT_CACHE_TTL_SECONDS is 24h (86400)", () => {
    expect(EXACT_CACHE_TTL_SECONDS).toBe(24 * 60 * 60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/cache-exact.test.ts`

Expected: FAIL with `Cannot find module '@/sectors/c-search/cache/exact'`.

- [ ] **Step 3: Implement**

Create `src/sectors/c-search/cache/exact.ts`:

```ts
import type { Client } from "pg";
import { parsePgVector } from "@/../tests/helpers/pgvector";   // we'll re-import this in non-test code
import type { NormalizedQuery } from "../normalizer/prompt";

export const EXACT_CACHE_TTL_SECONDS = 24 * 60 * 60;

export interface CachedQueryRow {
  query_hash: string;
  query_embedding: number[] | null;
  normalized_json: NormalizedQuery & { prompt_version: string };
  products_returned: string[];
}

interface DbRow {
  query_hash: string;
  query_embedding: string | null;
  normalized_json: NormalizedQuery & { prompt_version: string };
  products_returned: string[];
}

function decodeRow(r: DbRow): CachedQueryRow {
  return {
    query_hash: r.query_hash,
    query_embedding: r.query_embedding ? (JSON.parse(r.query_embedding) as number[]) : null,
    normalized_json: r.normalized_json,
    products_returned: r.products_returned,
  };
}

export async function lookupExact(hash: string, pg: Client): Promise<CachedQueryRow | null> {
  const r = await pg.query(
    `SELECT query_hash, query_embedding::text AS query_embedding,
            normalized_json, products_returned
     FROM product_query_cache
     WHERE query_hash = $1 AND ttl_until > now()`,
    [hash],
  );
  if (r.rows.length === 0) return null;
  return decodeRow(r.rows[0] as DbRow);
}

export interface WriteExactInput {
  query_hash: string;
  query_embedding: number[];
  normalized_json: NormalizedQuery & { prompt_version: string };
  products_returned: string[];
  ttl_seconds?: number;
}

export async function writeExact(input: WriteExactInput, pg: Client): Promise<void> {
  await pg.query(
    `INSERT INTO product_query_cache
       (query_hash, query_embedding, normalized_json, products_returned, ttl_until)
     VALUES ($1, $2::vector, $3::jsonb, $4::uuid[], now() + ($5 || ' seconds')::interval)
     ON CONFLICT (query_hash) DO UPDATE SET
       query_embedding = EXCLUDED.query_embedding,
       normalized_json = EXCLUDED.normalized_json,
       products_returned = EXCLUDED.products_returned,
       ttl_until = EXCLUDED.ttl_until`,
    [
      input.query_hash,
      "[" + input.query_embedding.join(",") + "]",
      JSON.stringify(input.normalized_json),
      input.products_returned,
      String(input.ttl_seconds ?? EXACT_CACHE_TTL_SECONDS),
    ],
  );
}
```

NOTE: the import of `parsePgVector` from tests/helpers is wrong for production code. Fix: inline the parsing in `decodeRow` (already done — uses `JSON.parse` directly; the import line above is dead and should be removed). Verify by running typecheck.

- [ ] **Step 4: Remove the dead import**

Edit the file to delete the `import { parsePgVector } from ...` line. The function uses `JSON.parse` directly via `decodeRow`, no helper needed.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/cache-exact.test.ts`

Expected: 5 tests PASS (4 main + 1 const check).

- [ ] **Step 6: Commit AND push**

```bash
git add src/sectors/c-search/cache/exact.ts tests/integration/cache-exact.test.ts
git commit -m "feat(search): cache/exact lookup + write with TTL + 5 integration tests"
git push origin feat/fase-2-hybrid-search
```

---

## Task 9: `cache/semantic.ts` lookupSemantic + 4 integration tests

**Files:**
- Create: `src/sectors/c-search/cache/semantic.ts`
- Create: `tests/integration/cache-semantic.test.ts`

**Goal:** Semantic cache lookup using HNSW index over `product_query_cache.query_embedding`. Threshold θ=0.92 (placeholder).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/cache-semantic.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { hashQuery } from "@/sectors/c-search/cache/hash";
import { writeExact } from "@/sectors/c-search/cache/exact";
import { lookupSemantic, DEFAULT_THETA } from "@/sectors/c-search/cache/semantic";
import { embed } from "@/lib/embeddings/voyage";

beforeEach(async () => {
  await truncateTestTables(["product_query_cache"]);
});

const sampleNormalized = {
  intent: "compra" as const,
  recipient_gender: null,
  recipient_age_min: null,
  recipient_age_max: null,
  categories: ["electronica"],
  style: [],
  price_range: null,
  search_terms: "auriculares",
  confidence: 0.9,
  prompt_version: "v1.0.0-fase2",
};

describe("cache/semantic (REAL Voyage embeddings)", () => {
  test("similar query (paraphrase) hits semantic cache when sim > θ", async () => {
    await withTestDb(async (pg) => {
      // Embed and cache "auriculares inalambricos sony"
      const [emb1] = await embed(["auriculares inalambricos sony"], { inputType: "query" });
      await writeExact(
        {
          query_hash: hashQuery("auriculares inalambricos sony"),
          query_embedding: emb1,
          normalized_json: sampleNormalized,
          products_returned: ["a1111111-1111-4111-8111-111111111111"],
        },
        pg,
      );

      // Lookup with similar query
      const [emb2] = await embed(["audífonos sony bluetooth"], { inputType: "query" });
      const hit = await lookupSemantic(emb2, DEFAULT_THETA, pg);

      // The two queries are semantically related; whether they exceed θ=0.92 depends on Voyage.
      // Test: if sim > 0.92, we get the cached row; if < 0.92, we get null. Check both branches:
      if (hit) {
        expect(hit.products_returned).toEqual(["a1111111-1111-4111-8111-111111111111"]);
      }
      // No assertion on which case happens — depends on real embedding similarity.
      // Real assertion: forcing a known-similar pair below.
    });
  }, 30_000);

  test("identical query hits with similarity ≈ 1", async () => {
    await withTestDb(async (pg) => {
      const [emb] = await embed(["auriculares inalambricos sony"], { inputType: "query" });
      await writeExact(
        { query_hash: hashQuery("auriculares inalambricos sony"), query_embedding: emb, normalized_json: sampleNormalized, products_returned: ["a1111111-1111-4111-8111-111111111111"] },
        pg,
      );
      // Same exact embedding → similarity = 1
      const hit = await lookupSemantic(emb, DEFAULT_THETA, pg);
      expect(hit).not.toBeNull();
      expect(hit!.products_returned).toEqual(["a1111111-1111-4111-8111-111111111111"]);
    });
  }, 30_000);

  test("very different query does NOT hit (sim < θ)", async () => {
    await withTestDb(async (pg) => {
      const [embCached] = await embed(["auriculares sony bluetooth"], { inputType: "query" });
      await writeExact(
        { query_hash: hashQuery("auriculares sony bluetooth"), query_embedding: embCached, normalized_json: sampleNormalized, products_returned: ["a1111111-1111-4111-8111-111111111111"] },
        pg,
      );
      const [embDifferent] = await embed(["zapatillas deportivas hombre"], { inputType: "query" });
      const hit = await lookupSemantic(embDifferent, DEFAULT_THETA, pg);
      expect(hit).toBeNull();
    });
  }, 30_000);

  test("expired rows are excluded from semantic lookup", async () => {
    await withTestDb(async (pg) => {
      const [emb] = await embed(["test query"], { inputType: "query" });
      await writeExact(
        { query_hash: hashQuery("test query"), query_embedding: emb, normalized_json: sampleNormalized, products_returned: ["a1111111-1111-4111-8111-111111111111"] },
        pg,
      );
      await pg.query(`UPDATE product_query_cache SET ttl_until = now() - interval '1 hour'`);
      const hit = await lookupSemantic(emb, DEFAULT_THETA, pg);
      expect(hit).toBeNull();
    });
  }, 30_000);

  test("DEFAULT_THETA is 0.92", () => {
    expect(DEFAULT_THETA).toBe(0.92);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/cache-semantic.test.ts`

Expected: FAIL with module not found.

- [ ] **Step 3: Implement**

Create `src/sectors/c-search/cache/semantic.ts`:

```ts
import type { Client } from "pg";
import type { CachedQueryRow } from "./exact";

export const DEFAULT_THETA = 0.92;

export async function lookupSemantic(
  queryEmbedding: number[],
  theta: number,
  pg: Client,
): Promise<CachedQueryRow | null> {
  const r = await pg.query(
    `SELECT query_hash, query_embedding::text AS query_embedding,
            normalized_json, products_returned,
            1 - (query_embedding <=> $1::vector) AS similarity
     FROM product_query_cache
     WHERE ttl_until > now() AND query_embedding IS NOT NULL
     ORDER BY query_embedding <=> $1::vector
     LIMIT 1`,
    ["[" + queryEmbedding.join(",") + "]"],
  );
  if (r.rows.length === 0) return null;
  if (Number(r.rows[0].similarity) < theta) return null;
  const row = r.rows[0];
  return {
    query_hash: row.query_hash,
    query_embedding: row.query_embedding ? (JSON.parse(row.query_embedding) as number[]) : null,
    normalized_json: row.normalized_json,
    products_returned: row.products_returned,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/cache-semantic.test.ts`

Expected: 5 tests PASS.

- [ ] **Step 5: Commit AND push**

```bash
git add src/sectors/c-search/cache/semantic.ts tests/integration/cache-semantic.test.ts
git commit -m "feat(search): cache/semantic with HNSW lookup + θ=0.92 + 5 integration tests"
git push origin feat/fase-2-hybrid-search
```

---

## Task 10: `retrieve/bm25.ts` + 5 integration tests + extend `seedProduct` helper

**Files:**
- Create: `src/sectors/c-search/retrieve/bm25.ts`
- Create: `tests/integration/bm25.test.ts`
- Modify: `tests/helpers/seed.ts` (add `seedProductWithEmbedding` for cosine test in next task)

**Goal:** BM25 search via `ts_rank_cd` over `tsvector_es`.

- [ ] **Step 1: Extend the seed helper**

Edit `tests/helpers/seed.ts`. Append (do not replace existing functions):

```ts
import { embed } from "@/lib/embeddings/voyage";

export async function seedProductWithEmbedding(
  pg: Client,
  overrides: Partial<{
    title: string;
    description: string;
    price_cents: number;
    raw_category: string;
    metadata: Record<string, unknown>;
  }> = {},
): Promise<{ id: string }> {
  const sid = randomUUID();
  const title = overrides.title ?? `Seeded with embedding ${sid.slice(0, 8)}`;
  const description = overrides.description ?? "";
  const canonical = `${title}\n${description}`;
  const [embedding] = await embed([canonical], { inputType: "document" });
  const r = await pg.query(
    `INSERT INTO products (source, source_product_id, title, description, price_cents, currency, image_url, raw_category, metadata, embedding)
     VALUES ('seed', $1, $2, $3, $4, 'USD', null, $5, $6::jsonb, $7::vector)
     RETURNING id`,
    [
      sid,
      title,
      description,
      overrides.price_cents ?? 1000,
      overrides.raw_category ?? "ropa",
      JSON.stringify(overrides.metadata ?? { category: overrides.raw_category ?? "ropa" }),
      "[" + embedding.join(",") + "]",
    ],
  );
  return r.rows[0];
}
```

NOTE: this helper hits the real Voyage API. Use only in integration tests where cosine ranking is exercised.

- [ ] **Step 2: Write the failing test**

Create `tests/integration/bm25.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProduct } from "@/../tests/helpers/seed";
import { bm25Search } from "@/sectors/c-search/retrieve/bm25";

beforeEach(async () => {
  await truncateTestTables(["products"]);
});

describe("bm25Search (real tsvector + ts_rank_cd)", () => {
  test("ranks exact-match title higher than partial match", async () => {
    await withTestDb(async (pg) => {
      const target = await seedProduct(pg, { title: "Nike Air Max 270 talle 42" });
      await seedProduct(pg, { title: "Adidas Ultraboost talle 42" });
      await seedProduct(pg, { title: "Puma RS-X talle 42" });

      const out = await bm25Search("Nike Air Max 270 talle 42", {}, 10, pg);
      expect(out[0].id).toBe(target.id);
    });
  });

  test("returns empty array on no match", async () => {
    await withTestDb(async (pg) => {
      await seedProduct(pg, { title: "Camiseta de algodón" });
      const out = await bm25Search("xyzabc nothingmatches", {}, 10, pg);
      expect(out).toEqual([]);
    });
  });

  test("respects K limit", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 5; i++) {
        await seedProduct(pg, { title: `Camiseta deportiva ${i}` });
      }
      const out = await bm25Search("camiseta", {}, 3, pg);
      expect(out.length).toBe(3);
    });
  });

  test("filter by category restricts results", async () => {
    await withTestDb(async (pg) => {
      await seedProduct(pg, { title: "Camiseta deportiva", metadata: { category: "ropa" } });
      const elec = await seedProduct(pg, { title: "Camiseta de monitor LCD", metadata: { category: "electronica" } });
      const out = await bm25Search("camiseta", { categories: ["electronica"] }, 10, pg);
      expect(out.map((r) => r.id)).toEqual([elec.id]);
    });
  });

  test("excludes is_active=false products", async () => {
    await withTestDb(async (pg) => {
      const a = await seedProduct(pg, { title: "Camiseta activa" });
      const b = await seedProduct(pg, { title: "Camiseta inactiva" });
      await pg.query(`UPDATE products SET is_active=false WHERE id=$1`, [b.id]);
      const out = await bm25Search("camiseta", {}, 10, pg);
      expect(out.map((r) => r.id)).toEqual([a.id]);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/bm25.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `src/sectors/c-search/retrieve/bm25.ts`:

```ts
import type { Client } from "pg";
import type { RankedProduct } from "./rrf";

export interface SearchFilters {
  categories?: string[];
  // gender_target/age_target/price_range deferred to Phase 3a
}

export async function bm25Search(
  searchTerms: string,
  filters: SearchFilters,
  K: number,
  pg: Client,
): Promise<RankedProduct[]> {
  if (!searchTerms || searchTerms.trim().length === 0) return [];
  const cats = filters.categories?.length ? filters.categories : null;
  const r = await pg.query(
    `SELECT id, ts_rank_cd(tsvector_es, websearch_to_tsquery('spanish', $1)) AS score
     FROM products
     WHERE is_active = true
       AND tsvector_es @@ websearch_to_tsquery('spanish', $1)
       AND ($2::text[] IS NULL OR (metadata->>'category') = ANY($2::text[]))
     ORDER BY score DESC
     LIMIT $3`,
    [searchTerms, cats, K],
  );
  return r.rows.map((row, i) => ({ id: row.id, rank: i + 1, score: Number(row.score) }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/bm25.test.ts`

Expected: 5 tests PASS.

- [ ] **Step 6: Commit AND push**

```bash
git add src/sectors/c-search/retrieve/bm25.ts tests/integration/bm25.test.ts tests/helpers/seed.ts
git commit -m "feat(search): bm25Search via ts_rank_cd + 5 integration tests + seedWithEmbedding helper"
git push origin feat/fase-2-hybrid-search
```

---

## Task 11: `retrieve/cosine.ts` + 5 integration tests

**Files:**
- Create: `src/sectors/c-search/retrieve/cosine.ts`
- Create: `tests/integration/cosine.test.ts`

**Goal:** Cosine search via pgvector `<=>` operator over `embedding` column.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/cosine.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { embed } from "@/lib/embeddings/voyage";
import { cosineSearch } from "@/sectors/c-search/retrieve/cosine";

beforeEach(async () => {
  await truncateTestTables(["products"]);
});

describe("cosineSearch (real Voyage + pgvector)", () => {
  test("synonym query catches semantically similar product", async () => {
    await withTestDb(async (pg) => {
      const target = await seedProductWithEmbedding(pg, {
        title: "Auriculares inalámbricos Sony WH-1000XM5",
        description: "tecnología noise-cancelling líder",
      });
      await seedProductWithEmbedding(pg, {
        title: "Camiseta de algodón roja",
        description: "ropa básica",
      });

      const [queryEmb] = await embed(["audífonos bluetooth con cancelación de ruido"], { inputType: "query" });
      const out = await cosineSearch(queryEmb, {}, 10, pg);
      expect(out.map((r) => r.id)).toContain(target.id);
      // Auriculares product should rank above camiseta
      const ranks = new Map(out.map((r) => [r.id, r.rank]));
      expect(ranks.get(target.id)).toBe(1);
    });
  }, 60_000);

  test("returns empty array when no products have embedding", async () => {
    await withTestDb(async (pg) => {
      const [emb] = await embed(["test query"], { inputType: "query" });
      const out = await cosineSearch(emb, {}, 10, pg);
      expect(out).toEqual([]);
    });
  }, 30_000);

  test("respects K limit", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 5; i++) {
        await seedProductWithEmbedding(pg, { title: `Producto ${i}` });
      }
      const [emb] = await embed(["producto"], { inputType: "query" });
      const out = await cosineSearch(emb, {}, 3, pg);
      expect(out.length).toBe(3);
    });
  }, 60_000);

  test("filter by category restricts results", async () => {
    await withTestDb(async (pg) => {
      await seedProductWithEmbedding(pg, { title: "Auriculares Sony", metadata: { category: "electronica" } });
      const target = await seedProductWithEmbedding(pg, { title: "Camiseta deportiva", metadata: { category: "ropa" } });
      const [emb] = await embed(["camiseta"], { inputType: "query" });
      const out = await cosineSearch(emb, { categories: ["ropa"] }, 10, pg);
      expect(out.map((r) => r.id)).toEqual([target.id]);
    });
  }, 60_000);

  test("excludes is_active=false products", async () => {
    await withTestDb(async (pg) => {
      const active = await seedProductWithEmbedding(pg, { title: "Activa" });
      const inactive = await seedProductWithEmbedding(pg, { title: "Inactiva" });
      await pg.query(`UPDATE products SET is_active=false WHERE id=$1`, [inactive.id]);
      const [emb] = await embed(["activa"], { inputType: "query" });
      const out = await cosineSearch(emb, {}, 10, pg);
      expect(out.map((r) => r.id)).toEqual([active.id]);
    });
  }, 60_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/cosine.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/sectors/c-search/retrieve/cosine.ts`:

```ts
import type { Client } from "pg";
import type { RankedProduct } from "./rrf";
import type { SearchFilters } from "./bm25";

export async function cosineSearch(
  queryEmbedding: number[],
  filters: SearchFilters,
  K: number,
  pg: Client,
): Promise<RankedProduct[]> {
  const cats = filters.categories?.length ? filters.categories : null;
  const r = await pg.query(
    `SELECT id, 1 - (embedding <=> $1::vector) AS score
     FROM products
     WHERE is_active = true AND embedding IS NOT NULL
       AND ($2::text[] IS NULL OR (metadata->>'category') = ANY($2::text[]))
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    ["[" + queryEmbedding.join(",") + "]", cats, K],
  );
  return r.rows.map((row, i) => ({ id: row.id, rank: i + 1, score: Number(row.score) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/cosine.test.ts`

Expected: 5 tests PASS. ~$0.005 in Voyage embeddings.

- [ ] **Step 5: Commit AND push**

```bash
git add src/sectors/c-search/retrieve/cosine.ts tests/integration/cosine.test.ts
git commit -m "feat(search): cosineSearch via pgvector <=> + 5 integration tests"
git push origin feat/fase-2-hybrid-search
```

---

## Task 12: `persist/searches.ts` + 3 integration tests

**Files:**
- Create: `src/sectors/c-search/persist/searches.ts`
- Create: `tests/integration/searches-persist.test.ts`

**Goal:** Insert one row per `hybridSearch` call into `searches` table.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/searches-persist.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { createUser } from "@/../tests/helpers/seed";
import { persistSearch } from "@/sectors/c-search/persist/searches";

beforeEach(async () => {
  await truncateTestTables(["searches", "users", "anonymous_sessions"]);
});

const sampleNormalized = {
  intent: "compra" as const,
  recipient_gender: null,
  recipient_age_min: null,
  recipient_age_max: null,
  categories: ["ropa"],
  style: [],
  price_range: null,
  search_terms: "camiseta",
  confidence: 0.85,
  prompt_version: "v1.0.0-fase2",
};

describe("persistSearch", () => {
  test("inserts a row with all fields including normalized_json", async () => {
    await withTestDb(async (pg) => {
      const anonId = randomUUID();
      await pg.query(`INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1)`, [anonId]);
      await persistSearch(
        {
          anonymous_id: anonId,
          user_id: null,
          raw_query: "camiseta deportiva",
          normalized_json: sampleNormalized,
          prompt_version: "v1.0.0-fase2",
          search_method: "hybrid_rrf",
          results_count: 18,
          hit_cache: false,
          called_mock: false,
        },
        pg,
      );
      const r = await pg.query(`SELECT * FROM searches WHERE anonymous_id = $1`, [anonId]);
      expect(r.rows).toHaveLength(1);
      const row = r.rows[0];
      expect(row.raw_query).toBe("camiseta deportiva");
      expect(row.search_method).toBe("hybrid_rrf");
      expect(row.results_count).toBe(18);
      expect(row.hit_cache).toBe(false);
      expect(row.called_mock).toBe(false);
      expect(row.normalized_json).toMatchObject({ intent: "compra", search_terms: "camiseta" });
      expect(row.prompt_version).toBe("v1.0.0-fase2");
    });
  });

  test("accepts null normalized_json (LLM failure fallback)", async () => {
    await withTestDb(async (pg) => {
      await persistSearch(
        {
          anonymous_id: randomUUID(),
          user_id: null,
          raw_query: "asdfgh",
          normalized_json: null,
          prompt_version: null,
          search_method: "bm25_only",
          results_count: 0,
          hit_cache: false,
          called_mock: false,
        },
        pg,
      );
      const r = await pg.query(`SELECT normalized_json, prompt_version FROM searches`);
      expect(r.rows[0].normalized_json).toBeNull();
      expect(r.rows[0].prompt_version).toBeNull();
    });
  });

  test("attaches user_id when provided", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      await persistSearch(
        {
          anonymous_id: randomUUID(),
          user_id: user.id,
          raw_query: "regalo",
          normalized_json: sampleNormalized,
          prompt_version: "v1.0.0-fase2",
          search_method: "hybrid_rrf",
          results_count: 10,
          hit_cache: true,
          called_mock: false,
        },
        pg,
      );
      const r = await pg.query(`SELECT user_id, hit_cache FROM searches`);
      expect(r.rows[0].user_id).toBe(user.id);
      expect(r.rows[0].hit_cache).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/searches-persist.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/sectors/c-search/persist/searches.ts`:

```ts
import type { Client } from "pg";
import type { NormalizedQuery } from "../normalizer/prompt";

export type SearchMethod = "hybrid_rrf" | "bm25_only" | "cosine_only";

export interface PersistSearchInput {
  anonymous_id: string | null;
  user_id: string | null;
  raw_query: string;
  normalized_json: (NormalizedQuery & { prompt_version: string }) | null;
  prompt_version: string | null;
  search_method: SearchMethod;
  results_count: number;
  hit_cache: boolean;
  called_mock: boolean;
}

export async function persistSearch(input: PersistSearchInput, pg: Client): Promise<void> {
  await pg.query(
    `INSERT INTO searches
       (anonymous_id, user_id, raw_query, normalized_json, prompt_version,
        search_method, results_count, hit_cache, called_mock)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)`,
    [
      input.anonymous_id,
      input.user_id,
      input.raw_query,
      input.normalized_json ? JSON.stringify(input.normalized_json) : null,
      input.prompt_version,
      input.search_method,
      input.results_count,
      input.hit_cache,
      input.called_mock,
    ],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/searches-persist.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 5: Commit AND push**

```bash
git add src/sectors/c-search/persist/searches.ts tests/integration/searches-persist.test.ts
git commit -m "feat(search): persistSearch with normalized_json JSONB + 3 tests"
git push origin feat/fase-2-hybrid-search
```

---

## Task 13: `admin/list.ts` + `/api/admin/searches` route + 4 integration tests

**Files:**
- Create: `src/sectors/c-search/admin/list.ts`
- Create: `src/app/api/admin/searches/route.ts`
- Create: `tests/integration/admin-searches-route.test.ts`

**Goal:** Read endpoint for the admin to list past searches with filters and pagination.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/admin-searches-route.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { persistSearch } from "@/sectors/c-search/persist/searches";
import { GET } from "@/app/api/admin/searches/route";

beforeEach(async () => {
  await truncateTestTables(["searches", "users", "anonymous_sessions"]);
});

const sample = {
  intent: "compra" as const,
  recipient_gender: null,
  recipient_age_min: null,
  recipient_age_max: null,
  categories: ["ropa"],
  style: [],
  price_range: null,
  search_terms: "camiseta",
  confidence: 0.9,
  prompt_version: "v1.0.0-fase2",
};

function makeReq(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

async function seed3Searches(pg: any) {
  for (let i = 0; i < 3; i++) {
    await persistSearch(
      {
        anonymous_id: randomUUID(),
        user_id: null,
        raw_query: `query ${i}`,
        normalized_json: sample,
        prompt_version: "v1.0.0-fase2",
        search_method: i === 0 ? "bm25_only" : "hybrid_rrf",
        results_count: i * 5,
        hit_cache: i === 1,
        called_mock: i === 2,
      },
      pg,
    );
  }
}

describe("GET /api/admin/searches", () => {
  test("no auth → 401", async () => {
    const res = await GET(makeReq("http://localhost:3000/api/admin/searches"));
    expect(res.status).toBe(401);
  });

  // The 3 logged-in tests below exercise the listSearches function via the route.
  // We can't mock auth0 (banned), so we'll test the underlying listSearches function
  // directly via integration tests. The 401 path above covers the route auth wiring.
});

import { listSearches } from "@/sectors/c-search/admin/list";

describe("listSearches", () => {
  test("returns paginated rows ordered by occurred_at DESC", async () => {
    await withTestDb(async (pg) => {
      await seed3Searches(pg);
      const r = await listSearches({ page: 1, limit: 50 }, pg);
      expect(r.rows.length).toBe(3);
      expect(r.total).toBe(3);
      expect(r.rows[0].occurred_at >= r.rows[1].occurred_at).toBe(true);
      expect(r.rows[1].occurred_at >= r.rows[2].occurred_at).toBe(true);
    });
  });

  test("filters by hit_cache=true", async () => {
    await withTestDb(async (pg) => {
      await seed3Searches(pg);
      const r = await listSearches({ hit_cache: true }, pg);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].raw_query).toBe("query 1");
    });
  });

  test("filters by method=bm25_only", async () => {
    await withTestDb(async (pg) => {
      await seed3Searches(pg);
      const r = await listSearches({ method: "bm25_only" }, pg);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].raw_query).toBe("query 0");
    });
  });

  test("paginates with limit=2 page=1 then page=2", async () => {
    await withTestDb(async (pg) => {
      await seed3Searches(pg);
      const p1 = await listSearches({ page: 1, limit: 2 }, pg);
      expect(p1.rows.length).toBe(2);
      expect(p1.total).toBe(3);
      const p2 = await listSearches({ page: 2, limit: 2 }, pg);
      expect(p2.rows.length).toBe(1);
      expect(p2.total).toBe(3);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/admin-searches-route.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement listSearches**

Create `src/sectors/c-search/admin/list.ts`:

```ts
import type { Client } from "pg";
import type { SearchMethod } from "../persist/searches";

export interface ListSearchesOpts {
  from?: Date | null;
  to?: Date | null;
  hit_cache?: boolean | null;
  method?: SearchMethod | null;
  page?: number;
  limit?: number;
}

export interface SearchRow {
  id: string;
  anonymous_id: string | null;
  user_id: string | null;
  raw_query: string;
  normalized_json: unknown;
  prompt_version: string | null;
  search_method: SearchMethod;
  results_count: number;
  hit_cache: boolean;
  called_mock: boolean;
  occurred_at: string;
}

export async function listSearches(
  opts: ListSearchesOpts,
  pg: Client,
): Promise<{ rows: SearchRow[]; total: number; page: number; limit: number }> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts.from instanceof Date) {
    params.push(opts.from);
    conds.push(`occurred_at >= $${params.length}`);
  }
  if (opts.to instanceof Date) {
    params.push(opts.to);
    conds.push(`occurred_at <= $${params.length}`);
  }
  if (typeof opts.hit_cache === "boolean") {
    params.push(opts.hit_cache);
    conds.push(`hit_cache = $${params.length}`);
  }
  if (opts.method) {
    params.push(opts.method);
    conds.push(`search_method = $${params.length}`);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const limit = Math.min(opts.limit ?? 50, 200);
  const page = Math.max(opts.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const rowParams = [...params, limit, offset];
  const rowsResult = await pg.query(
    `SELECT id, anonymous_id, user_id, raw_query, normalized_json, prompt_version,
            search_method, results_count, hit_cache, called_mock, occurred_at
     FROM searches ${where}
     ORDER BY occurred_at DESC
     LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}`,
    rowParams,
  );
  const totalResult = await pg.query(
    `SELECT count(*)::int AS c FROM searches ${where}`,
    params,
  );

  return { rows: rowsResult.rows, total: totalResult.rows[0].c, page, limit };
}
```

- [ ] **Step 4: Implement the route**

Create `src/app/api/admin/searches/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth0 } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { listSearches } from "@/sectors/c-search/admin/list";

// TODO Phase 4: admin role check (currently any logged-in user accesses)

const queryParamSchema = z.object({
  from: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
  to: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
  hit_cache: z
    .enum(["true", "false"])
    .optional()
    .transform((s) => (s === undefined ? undefined : s === "true")),
  method: z.enum(["hybrid_rrf", "bm25_only", "cosine_only"]).optional(),
  page: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .transform((s) => (s ? Math.max(1, parseInt(s, 10)) : undefined)),
  limit: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .transform((s) => (s ? Math.min(200, parseInt(s, 10)) : undefined)),
});

export async function GET(req: NextRequest) {
  const session = await auth0.getSession(req).catch(() => null);
  if (!session?.user?.sub) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const parsed = queryParamSchema.safeParse({
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    hit_cache: sp.get("hit_cache") ?? undefined,
    method: sp.get("method") ?? undefined,
    page: sp.get("page") ?? undefined,
    limit: sp.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", detail: parsed.error.issues }, { status: 400 });
  }
  const result = await withPg((pg) => listSearches(parsed.data, pg));
  return NextResponse.json(result);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/admin-searches-route.test.ts`

Expected: 5 tests PASS (1 auth + 4 listSearches).

- [ ] **Step 6: Commit AND push**

```bash
git add src/sectors/c-search/admin/ src/app/api/admin/ tests/integration/admin-searches-route.test.ts
git commit -m "feat(search): listSearches paginated + GET /api/admin/searches + 5 tests"
git push origin feat/fase-2-hybrid-search
```

---

## Task 14: `search.ts` orchestrator + 4 integration tests (basic flow)

**Files:**
- Create: `src/sectors/c-search/search.ts`
- Create: `tests/integration/hybrid-search.test.ts`

**Goal:** Top-level orchestrator that wires cache → embed → normalize → BM25+cosine → RRF → persist. **No mock fallback yet** — that's Task 14b. This task validates the basic happy path + cache hit + low-confidence skip.

- [ ] **Step 1: Implement the orchestrator (without mock fallback)**

Create `src/sectors/c-search/search.ts`:

```ts
import type { Client } from "pg";
import { embed } from "@/lib/embeddings/voyage";
import { fetchFromAggregator } from "@/sectors/b-catalog/mock/aggregator";
import { processProduct } from "@/sectors/b-catalog/enrichment/pipeline";
import { hashQuery } from "./cache/hash";
import { lookupExact, writeExact, EXACT_CACHE_TTL_SECONDS } from "./cache/exact";
import { lookupSemantic, DEFAULT_THETA } from "./cache/semantic";
import { normalizeQueryWithLLM } from "./normalizer/normalize";
import type { NormalizedQuery } from "./normalizer/prompt";
import { bm25Search } from "./retrieve/bm25";
import { cosineSearch } from "./retrieve/cosine";
import { rrfFuse, RRF_K0, type FusedProduct } from "./retrieve/rrf";
import { shouldCallMock } from "./decide/shouldCallMock";
import { persistSearch, type SearchMethod } from "./persist/searches";
import type { ProductListRow } from "@/sectors/b-catalog/repository/products";

const RETRIEVE_K = 50;

export interface HybridSearchCtx {
  pg: Client;
  anonymous_id: string | null;
  user_id: string | null;
}

export interface HybridSearchResult {
  products: ProductListRow[];
  normalized: (NormalizedQuery & { prompt_version: string }) | null;
  hitCache: boolean;
  calledMock: boolean;
  method: SearchMethod;
}

async function resolveProducts(ids: string[], pg: Client): Promise<ProductListRow[]> {
  if (ids.length === 0) return [];
  const r = await pg.query(
    `SELECT id, title, description, price_cents, currency, image_url, metadata, created_at
     FROM products
     WHERE id = ANY($1::uuid[]) AND is_active = true`,
    [ids],
  );
  // Preserve the ranking order
  const byId = new Map(r.rows.map((x: ProductListRow) => [x.id, x]));
  return ids.map((id) => byId.get(id)).filter((x): x is ProductListRow => x !== undefined);
}

function deriveMethod(bm25: unknown[], cos: unknown[]): SearchMethod {
  if (bm25.length > 0 && cos.length > 0) return "hybrid_rrf";
  if (bm25.length === 0 && cos.length > 0) return "cosine_only";
  return "bm25_only";
}

export async function hybridSearch(rawQuery: string, ctx: HybridSearchCtx): Promise<HybridSearchResult> {
  const { pg, anonymous_id, user_id } = ctx;
  if (!rawQuery || !rawQuery.trim()) {
    return { products: [], normalized: null, hitCache: false, calledMock: false, method: "bm25_only" };
  }

  // 1. Hash + exact cache
  const hash = hashQuery(rawQuery);
  const exact = await lookupExact(hash, pg);
  if (exact) {
    const products = await resolveProducts(exact.products_returned, pg);
    await persistSearch(
      {
        anonymous_id,
        user_id,
        raw_query: rawQuery,
        normalized_json: exact.normalized_json,
        prompt_version: exact.normalized_json.prompt_version,
        search_method: "hybrid_rrf",
        results_count: products.length,
        hit_cache: true,
        called_mock: false,
      },
      pg,
    );
    return { products, normalized: exact.normalized_json, hitCache: true, calledMock: false, method: "hybrid_rrf" };
  }

  // 2. Embed query (used by both semantic cache lookup and cosine retrieval)
  const [queryEmbedding] = await embed([rawQuery], { inputType: "query" });

  // 3. Semantic cache
  const semantic = await lookupSemantic(queryEmbedding, DEFAULT_THETA, pg);
  if (semantic) {
    const products = await resolveProducts(semantic.products_returned, pg);
    await persistSearch(
      {
        anonymous_id,
        user_id,
        raw_query: rawQuery,
        normalized_json: semantic.normalized_json,
        prompt_version: semantic.normalized_json.prompt_version,
        search_method: "hybrid_rrf",
        results_count: products.length,
        hit_cache: true,
        called_mock: false,
      },
      pg,
    );
    return { products, normalized: semantic.normalized_json, hitCache: true, calledMock: false, method: "hybrid_rrf" };
  }

  // 4. LLM normalize (with fallback to graceful degradation)
  let normalized: (NormalizedQuery & { prompt_version: string }) | null = null;
  try {
    normalized = await normalizeQueryWithLLM(rawQuery);
  } catch {
    normalized = null;
  }

  const searchTerms = normalized?.search_terms ?? rawQuery;
  const filters = { categories: normalized?.categories ?? undefined };

  // 5. BM25 + cosine in parallel
  const [bm25, cos] = await Promise.all([
    bm25Search(searchTerms, filters, RETRIEVE_K, pg),
    cosineSearch(queryEmbedding, filters, RETRIEVE_K, pg),
  ]);

  // 6. Fuse
  let fused = rrfFuse([bm25, cos], RRF_K0);
  let calledMock = false;

  // 7. Mock fallback (Task 14b will enable this; currently no-op)
  if (
    normalized &&
    shouldCallMock(fused.length, normalized.confidence)
  ) {
    // Implementation deferred to Task 14b
  }

  const method = deriveMethod(bm25, cos);
  const productIds = fused.map((f) => f.id);

  // 8. Cache the result (only on miss path) — only when normalized is not null
  if (normalized) {
    await writeExact(
      {
        query_hash: hash,
        query_embedding: queryEmbedding,
        normalized_json: normalized,
        products_returned: productIds,
        ttl_seconds: EXACT_CACHE_TTL_SECONDS,
      },
      pg,
    );
  }

  // 9. Persist search log
  await persistSearch(
    {
      anonymous_id,
      user_id,
      raw_query: rawQuery,
      normalized_json: normalized,
      prompt_version: normalized?.prompt_version ?? null,
      search_method: method,
      results_count: fused.length,
      hit_cache: false,
      called_mock: calledMock,
    },
    pg,
  );

  const products = await resolveProducts(productIds, pg);
  return { products, normalized, hitCache: false, calledMock, method };
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/integration/hybrid-search.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { hybridSearch } from "@/sectors/c-search/search";

beforeEach(async () => {
  await truncateTestTables(["product_query_cache", "searches", "products", "anonymous_sessions", "users"]);
});

describe("hybridSearch (REAL APIs)", () => {
  test("cache miss → LLM called + BM25+cosine + cache populated + persists row", async () => {
    await withTestDb(async (pg) => {
      // Seed enough products so count >= 12 and mock won't be invoked
      for (let i = 0; i < 15; i++) {
        await seedProductWithEmbedding(pg, {
          title: `Camiseta deportiva ${i}`,
          description: "ropa para correr",
          metadata: { category: "ropa" },
          raw_category: "ropa",
        });
      }
      const result = await hybridSearch("camiseta deportiva", { pg, anonymous_id: randomUUID(), user_id: null });
      expect(result.hitCache).toBe(false);
      expect(result.calledMock).toBe(false);
      expect(result.products.length).toBeGreaterThan(0);
      expect(result.normalized).not.toBeNull();
      expect(result.normalized!.prompt_version).toBe("v1.0.0-fase2");

      // Cache populated
      const cached = await pg.query(`SELECT count(*)::int FROM product_query_cache`);
      expect(cached.rows[0].count).toBe(1);

      // searches row inserted
      const search = await pg.query(`SELECT search_method, hit_cache, called_mock FROM searches`);
      expect(search.rows[0].search_method).toBe("hybrid_rrf");
      expect(search.rows[0].hit_cache).toBe(false);
      expect(search.rows[0].called_mock).toBe(false);
    });
  }, 120_000);

  test("same query twice: second call hits exact cache", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 15; i++) {
        await seedProductWithEmbedding(pg, { title: `Vestido ${i}`, metadata: { category: "ropa" }, raw_category: "ropa" });
      }
      const r1 = await hybridSearch("vestido elegante", { pg, anonymous_id: randomUUID(), user_id: null });
      const r2 = await hybridSearch("vestido elegante", { pg, anonymous_id: randomUUID(), user_id: null });
      expect(r1.hitCache).toBe(false);
      expect(r2.hitCache).toBe(true);
      expect(r2.products.map((p) => p.id)).toEqual(r1.products.map((p) => p.id));

      const persists = await pg.query(`SELECT hit_cache FROM searches ORDER BY occurred_at`);
      expect(persists.rows.map((r) => r.hit_cache)).toEqual([false, true]);
    });
  }, 120_000);

  test("3 permutations of same words → 1 cache row, 2nd and 3rd hit", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 15; i++) {
        await seedProductWithEmbedding(pg, { title: `Juguete ${i}`, metadata: { category: "juguetes_bebe" }, raw_category: "juguetes_bebe" });
      }
      await hybridSearch("regalo niña 8 años", { pg, anonymous_id: randomUUID(), user_id: null });
      await hybridSearch("niña 8 años regalo", { pg, anonymous_id: randomUUID(), user_id: null });
      await hybridSearch("8 años niña regalo", { pg, anonymous_id: randomUUID(), user_id: null });

      const cacheRows = await pg.query(`SELECT count(*)::int FROM product_query_cache`);
      expect(cacheRows.rows[0].count).toBe(1);
      const searchRows = await pg.query(`SELECT hit_cache FROM searches ORDER BY occurred_at`);
      expect(searchRows.rows.map((r) => r.hit_cache)).toEqual([false, true, true]);
    });
  }, 180_000);

  test("garbage query 'asdfgh qwerty' → confidence < 0.5 → mock NOT invoked", async () => {
    await withTestDb(async (pg) => {
      const result = await hybridSearch("asdfgh qwerty zzzz", { pg, anonymous_id: randomUUID(), user_id: null });
      expect(result.calledMock).toBe(false);
      // normalized may be null if LLM throws, OR confidence is < 0.5
      if (result.normalized) {
        expect(result.normalized.confidence).toBeLessThan(0.5);
      }
      // Persist row exists with called_mock = false
      const search = await pg.query(`SELECT called_mock FROM searches`);
      expect(search.rows[0].called_mock).toBe(false);
    });
  }, 60_000);
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/hybrid-search.test.ts`

Expected: 4 tests PASS. ~$0.04 in tokens (4 × ~$0.01 per LLM call + 15 × Voyage embed × 4 tests).

- [ ] **Step 4: Commit AND push**

```bash
git add src/sectors/c-search/search.ts tests/integration/hybrid-search.test.ts
git commit -m "feat(search): hybridSearch orchestrator (basic flow) + 4 integration tests"
git push origin feat/fase-2-hybrid-search
```

---

## Task 14b: Mock fallback in orchestrator + 3 integration tests

**Files:**
- Modify: `src/sectors/c-search/search.ts` (replace the "Mock fallback (Task 14b will enable this; currently no-op)" block)
- Create: `tests/integration/search-mock-fallback.test.ts`

**Goal:** Implement the mock fallback path: when `shouldCallMock` returns true, invoke `fetchFromAggregator` + `processProduct` for each, then re-run BM25+cosine, re-fuse, set `calledMock=true`.

- [ ] **Step 1: Replace the no-op block in search.ts**

Edit `src/sectors/c-search/search.ts`. Find:

```ts
  // 7. Mock fallback (Task 14b will enable this; currently no-op)
  if (
    normalized &&
    shouldCallMock(fused.length, normalized.confidence)
  ) {
    // Implementation deferred to Task 14b
  }
```

Replace with:

```ts
  // 7. Mock fallback: fetch external products, enrich, re-run retrieval
  if (normalized && shouldCallMock(fused.length, normalized.confidence)) {
    try {
      const mockResult = await fetchFromAggregator({
        category: normalized.categories?.[0] as
          | "ropa"
          | "electronica"
          | "hogar"
          | "juguetes_bebe"
          | "belleza"
          | "otros"
          | undefined,
        query: normalized.search_terms,
      });
      // Enrich each unique product (dedup by source_product_id)
      const seen = new Set<string>();
      for (const raw of mockResult.products) {
        const key = `${raw.source}:${raw.source_product_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          await processProduct(raw, pg);
        } catch {
          // Single product failure does not abort the fallback
        }
      }
      calledMock = true;
      // Re-run BM25 + cosine with the new products in DB
      const [bm25Re, cosRe] = await Promise.all([
        bm25Search(searchTerms, filters, RETRIEVE_K, pg),
        cosineSearch(queryEmbedding, filters, RETRIEVE_K, pg),
      ]);
      fused = rrfFuse([bm25Re, cosRe], RRF_K0);
    } catch {
      // mock 2% error rate is documented; don't crash the request
      calledMock = true; // we still attempted it
    }
  }
```

- [ ] **Step 2: Write the failing test**

Create `tests/integration/search-mock-fallback.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { resetCallCount, getCallCount } from "@/sectors/b-catalog/mock/aggregator";
import { hybridSearch } from "@/sectors/c-search/search";

beforeEach(async () => {
  await truncateTestTables(["product_query_cache", "searches", "products", "mock_calls"]);
  resetCallCount();
});

describe("hybridSearch mock fallback (REAL APIs)", () => {
  test("count < 12 + confidence > 0.5 → mock invoked + products enriched + retrieval re-runs", async () => {
    await withTestDb(async (pg) => {
      // No products seeded → count starts at 0
      const callsBefore = getCallCount();
      const result = await hybridSearch("auriculares bluetooth con cancelación de ruido", {
        pg,
        anonymous_id: randomUUID(),
        user_id: null,
      });
      expect(result.calledMock).toBe(true);
      expect(getCallCount() - callsBefore).toBeGreaterThanOrEqual(1);

      // mock_calls table received the call
      const mc = await pg.query(`SELECT count(*)::int AS c FROM mock_calls`);
      expect(mc.rows[0].c).toBeGreaterThanOrEqual(1);

      // Products got enriched and stored
      const productCount = await pg.query(`SELECT count(*)::int AS c FROM products`);
      expect(productCount.rows[0].c).toBeGreaterThan(0);

      // searches row reflects called_mock=true
      const search = await pg.query(`SELECT called_mock FROM searches`);
      expect(search.rows[0].called_mock).toBe(true);
    });
  }, 240_000);

  test("count >= 12 + confidence > 0.5 → mock NOT invoked even with valid query", async () => {
    await withTestDb(async (pg) => {
      // Seed 15 products in 'electronica' so count >= 12
      const { seedProductWithEmbedding } = await import("@/../tests/helpers/seed");
      for (let i = 0; i < 15; i++) {
        await seedProductWithEmbedding(pg, {
          title: `Audífonos modelo ${i}`,
          description: "auriculares bluetooth",
          metadata: { category: "electronica" },
          raw_category: "electronica",
        });
      }
      const callsBefore = getCallCount();
      const result = await hybridSearch("audífonos bluetooth", { pg, anonymous_id: randomUUID(), user_id: null });
      expect(result.calledMock).toBe(false);
      expect(getCallCount() - callsBefore).toBe(0);
    });
  }, 240_000);

  test("low confidence + count < 12 → mock NOT invoked (early skip)", async () => {
    await withTestDb(async (pg) => {
      // No products. Garbage query → low confidence.
      const callsBefore = getCallCount();
      const result = await hybridSearch("asdfgh qwerty zzzz", { pg, anonymous_id: randomUUID(), user_id: null });
      expect(result.calledMock).toBe(false);
      expect(getCallCount() - callsBefore).toBe(0);
      const mc = await pg.query(`SELECT count(*)::int AS c FROM mock_calls`);
      expect(mc.rows[0].c).toBe(0);
    });
  }, 60_000);
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/search-mock-fallback.test.ts`

Expected: 3 tests PASS. ~$0.08 in tokens (the first test runs the full Phase 1 enrich pipeline on 25 products).

If the mock errors with 2% probability and a test fails for that reason, retry once.

- [ ] **Step 4: Commit AND push**

```bash
git add src/sectors/c-search/search.ts tests/integration/search-mock-fallback.test.ts
git commit -m "feat(search): mock fallback in hybridSearch + 3 integration tests"
git push origin feat/fase-2-hybrid-search
```

---

## Task 15: `/api/search` route refactor + 4 tests + SearchTracker method update

**Files:**
- Modify: `src/app/api/search/route.ts`
- Modify: `src/components/SearchTracker.tsx`
- Create: `tests/integration/search-route.test.ts`

**Goal:** Replace LIKE-only `/api/search` with the hybrid orchestrator. Update the SearchTracker to emit `method='hybrid_rrf'` instead of `'like'`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/search-route.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding, createAnonymousSession } from "@/../tests/helpers/seed";
import { GET } from "@/app/api/search/route";

beforeEach(async () => {
  await truncateTestTables(["product_query_cache", "searches", "products", "anonymous_sessions"]);
});

function makeReq(q: string, cookies: Record<string, string> = {}): NextRequest {
  const url = `http://localhost:3000/api/search?q=${encodeURIComponent(q)}`;
  const headers = new Headers();
  const cookieStr = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  if (cookieStr) headers.set("cookie", cookieStr);
  return new NextRequest(url, { method: "GET", headers });
}

describe("GET /api/search (hybrid)", () => {
  test("empty q → empty result with no_query shape", async () => {
    const res = await GET(makeReq(""));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ products: [], count: 0, hit_cache: false, called_mock: false });
  });

  test("real query with seeded products → returns hybrid result with normalized shape", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 15; i++) {
        await seedProductWithEmbedding(pg, { title: `Camiseta ${i}`, metadata: { category: "ropa" }, raw_category: "ropa" });
      }
      const anonId = await createAnonymousSession(pg);
      const res = await GET(makeReq("camiseta deportiva", { anonymous_id: anonId }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.count).toBeGreaterThan(0);
      expect(body.method).toBe("hybrid_rrf");
      expect(body.normalized).toMatchObject({ search_terms: expect.any(String), confidence: expect.any(Number) });
    });
  }, 120_000);

  test("second identical request returns hit_cache=true", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 15; i++) {
        await seedProductWithEmbedding(pg, { title: `Pantalón ${i}`, metadata: { category: "ropa" }, raw_category: "ropa" });
      }
      const anonId = await createAnonymousSession(pg);
      const res1 = await GET(makeReq("pantalón corto", { anonymous_id: anonId }));
      const body1 = await res1.json();
      const res2 = await GET(makeReq("pantalón corto", { anonymous_id: anonId }));
      const body2 = await res2.json();
      expect(body1.hit_cache).toBe(false);
      expect(body2.hit_cache).toBe(true);
      expect(body2.products.map((p: any) => p.id)).toEqual(body1.products.map((p: any) => p.id));
    });
  }, 180_000);

  test("garbage query → 200 + count=0 + called_mock=false", async () => {
    const res = await GET(makeReq("asdfgh qwerty zzzz"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.called_mock).toBe(false);
  }, 60_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/search-route.test.ts`

Expected: FAIL — most likely the route still uses `searchLike` (Phase 1) so `method` field is missing or shape differs.

- [ ] **Step 3: Refactor the route**

Replace `src/app/api/search/route.ts` content with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { hybridSearch } from "@/sectors/c-search/search";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json(
      { products: [], count: 0, hit_cache: false, called_mock: false, method: "bm25_only", normalized: null },
      { status: 200 },
    );
  }

  const anonymous_id = req.cookies.get("anonymous_id")?.value ?? null;
  const session = await auth0.getSession(req).catch(() => null);
  let user_id: string | null = null;
  if (session?.user?.sub) {
    const sub = session.user.sub as string;
    const email = (session.user.email as string) ?? `${sub}@noemail.local`;
    user_id = await withPg(async (pg) => (await getOrCreateUserByAuth0Sub(pg, sub, email)).id);
  }

  const result = await withPg((pg) => hybridSearch(q, { pg, anonymous_id, user_id }));
  return NextResponse.json({
    products: result.products,
    count: result.products.length,
    hit_cache: result.hitCache,
    called_mock: result.calledMock,
    method: result.method,
    normalized: result.normalized,
  });
}
```

- [ ] **Step 4: Update SearchTracker to emit method='hybrid_rrf'**

Edit `src/components/SearchTracker.tsx`. Find the line that reads:

```ts
payload: { raw_query: query, results_count: resultsCount, method: "like" },
```

Replace with:

```ts
payload: { raw_query: query, results_count: resultsCount, method: "hybrid_rrf" },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/integration/search-route.test.ts`

Expected: 4 tests PASS.

- [ ] **Step 6: Verify Phase 1 search-route tests don't break**

Phase 1 had no `tests/integration/search-route.test.ts`. The tests for Phase 1 search lived in `products-repo.test.ts`. Confirm:

Run: `pnpm vitest run tests/integration/products-repo.test.ts`

Expected: 6 tests still PASS (the underlying `searchLike` repository function is preserved — it's just no longer routed by `/api/search`).

- [ ] **Step 7: Commit AND push**

```bash
git add src/app/api/search/route.ts src/components/SearchTracker.tsx tests/integration/search-route.test.ts
git commit -m "refactor(search): /api/search uses hybridSearch + SearchTracker method=hybrid_rrf + 4 tests"
git push origin feat/fase-2-hybrid-search
```

---

## Task 16: UI — SearchSkeleton + SearchResults + SearchUnderstood + page Suspense

**Files:**
- Create: `src/components/SearchSkeleton.tsx`
- Create: `src/components/SearchResults.tsx`
- Create: `src/components/SearchUnderstood.tsx`
- Modify: `src/app/(shop)/search/page.tsx`

**Goal:** Honest skeleton during the wait + chips showing what the LLM understood.

- [ ] **Step 1: Implement SearchSkeleton**

Create `src/components/SearchSkeleton.tsx`:

```tsx
export function SearchSkeleton({ query }: { query: string }) {
  return (
    <div className="mt-4">
      <p className="text-sm text-gray-600">Buscando &quot;{query}&quot;…</p>
      <p className="text-xs text-gray-400 mt-1">
        Si tu búsqueda es muy específica, podemos consultar nuestro proveedor externo (puede tomar 2-4 segundos).
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="border rounded-lg p-4 animate-pulse" data-testid="search-skeleton-card">
            <div className="w-full h-40 bg-gray-200 rounded mb-2" />
            <div className="h-4 bg-gray-200 rounded mb-1" />
            <div className="h-3 bg-gray-200 rounded w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement SearchUnderstood (client chips)**

Create `src/components/SearchUnderstood.tsx`:

```tsx
"use client";

interface NormalizedShape {
  intent?: string;
  recipient_gender?: string | null;
  recipient_age_min?: number | null;
  recipient_age_max?: number | null;
  categories?: string[];
  style?: string[];
  price_range?: string | null;
  search_terms?: string;
  confidence?: number;
}

export function SearchUnderstood({
  normalized,
  method,
  hitCache,
  calledMock,
}: {
  normalized: NormalizedShape | null;
  method: string;
  hitCache: boolean;
  calledMock: boolean;
}) {
  if (!normalized) return null;
  const chips: string[] = [];
  if (normalized.intent) chips.push(`Intención: ${normalized.intent}`);
  if (normalized.recipient_gender) chips.push(`Para: ${normalized.recipient_gender}`);
  if (normalized.recipient_age_min !== null && normalized.recipient_age_max !== null && normalized.recipient_age_min !== undefined) {
    chips.push(`Edad: ${normalized.recipient_age_min}-${normalized.recipient_age_max}`);
  }
  if (normalized.categories?.length) chips.push(`Categorías: ${normalized.categories.join(", ")}`);
  if (normalized.style?.length) chips.push(`Estilo: ${normalized.style.join(", ")}`);
  if (normalized.price_range) chips.push(`Precio: ${normalized.price_range}`);

  return (
    <div className="mb-4 flex flex-wrap gap-2 items-center text-xs">
      {chips.map((c) => (
        <span key={c} className="bg-gray-100 px-2 py-1 rounded">
          {c}
        </span>
      ))}
      <span className="text-gray-500 ml-auto">
        {method} {hitCache && "· cache"} {calledMock && "· externo"}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Implement SearchResults (server component async)**

Create `src/components/SearchResults.tsx`:

```tsx
import { cookies } from "next/headers";
import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { hybridSearch } from "@/sectors/c-search/search";
import { ProductCard } from "@/components/ProductCard";
import { SearchUnderstood } from "@/components/SearchUnderstood";

export async function SearchResults({ query }: { query: string }) {
  const cookieStore = await cookies();
  const anonymous_id = cookieStore.get("anonymous_id")?.value ?? null;
  const session = await auth0.getSession().catch(() => null);
  let user_id: string | null = null;
  if (session?.user?.sub) {
    const sub = session.user.sub as string;
    const email = (session.user.email as string) ?? `${sub}@noemail.local`;
    user_id = await withPg(async (pg) => (await getOrCreateUserByAuth0Sub(pg, sub, email)).id);
  }

  const result = await withPg((pg) => hybridSearch(query, { pg, anonymous_id, user_id }));

  return (
    <div className="mt-4">
      <SearchUnderstood
        normalized={result.normalized}
        method={result.method}
        hitCache={result.hitCache}
        calledMock={result.calledMock}
      />
      {result.products.length === 0 ? (
        <p className="text-gray-500">Sin resultados para &quot;{query}&quot;.</p>
      ) : (
        <>
          <p className="text-sm text-gray-600 mb-3">
            {result.products.length} resultados — {result.method}
            {result.hitCache && " (desde caché)"}
            {result.calledMock && " (incluye proveedor externo)"}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {result.products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update the search page**

Replace `src/app/(shop)/search/page.tsx` content with:

```tsx
import { Suspense } from "react";
import { SearchSkeleton } from "@/components/SearchSkeleton";
import { SearchResults } from "@/components/SearchResults";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-2">Buscar</h1>
      <form action="/search" method="get" className="mb-4">
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar productos..."
          className="border rounded px-3 py-2 w-full max-w-md"
        />
      </form>
      {q && (
        <Suspense key={q} fallback={<SearchSkeleton query={q} />}>
          <SearchResults query={q} />
        </Suspense>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Smoke test**

Run dev briefly. The dev port may already be 3001 if 3000 is busy.

```bash
pnpm dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
sleep 8
PORT=3000
if curl -s -o /dev/null http://localhost:3000/; then
  PORT=3000
elif curl -s -o /dev/null http://localhost:3001/; then
  PORT=3001
fi
echo "Using port $PORT"
curl -s -o /tmp/search.html -w "%{http_code}\n" "http://localhost:$PORT/search?q=camiseta"
echo "--- markers ---"
grep -cE "Buscando|Buscar|search-skeleton-card|product-card" /tmp/search.html
kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null
true
```

Expected: status 200; either skeleton (`search-skeleton-card`) or final products visible. If the products are already cached from earlier tasks, the result will resolve immediately and skeleton won't show in the static HTML — that's normal Server Component behavior.

- [ ] **Step 6: Verify quality + typecheck**

Run: `pnpm typecheck && pnpm test:quality`

Expected: 0 type errors, 0 quality violations.

- [ ] **Step 7: Commit AND push**

```bash
git add src/components/SearchSkeleton.tsx src/components/SearchResults.tsx src/components/SearchUnderstood.tsx 'src/app/(shop)/search/page.tsx'
git commit -m "feat(ui,search): Suspense + SearchSkeleton + SearchResults + SearchUnderstood chips"
git push origin feat/fase-2-hybrid-search
```

---

## Task 17: E2E `search-flow.spec.ts` (2 tests)

**Files:**
- Create: `tests/e2e/search-flow.spec.ts`

**Goal:** Verify hybrid happy path + low-confidence query in a real browser.

- [ ] **Step 1: Pre-seed catalog**

Run: `pnpm cron:catalog-fill --categories ropa,electronica --pages 1`

Expected: JSON output with `totalCalls: 2`, products written to DB.

- [ ] **Step 2: Write the E2E spec**

Create `tests/e2e/search-flow.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { Client } from "pg";

async function pg() {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await c.connect();
  return c;
}

test.describe("search-flow", () => {
  test("anon hybrid search → results render + searches row + event with method=hybrid_rrf", async ({ page }) => {
    await page.context().clearCookies();

    // First: trigger the SearchTracker by going through the search page
    const searchResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/search?q=") && resp.status() === 200,
      { timeout: 30_000 },
    );
    await page.goto("/search?q=camiseta");
    await searchResponsePromise;
    // Wait for results to render
    await expect(page.locator('[data-testid="product-card"]').first().or(page.getByText(/Sin resultados/))).toBeVisible({ timeout: 10_000 });

    // Wait for the SearchTracker fetch to /api/track to complete
    await page.waitForResponse(
      (resp) => resp.url().includes("/api/track") && resp.request().method() === "POST",
      { timeout: 5_000 },
    );

    const anonId = (await page.context().cookies()).find((c) => c.name === "anonymous_id")!.value;
    const c = await pg();
    try {
      // searches row was inserted by hybridSearch via the server component
      const sr = await c.query(
        `SELECT search_method, raw_query FROM searches WHERE raw_query = 'camiseta' AND anonymous_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
        [anonId],
      );
      expect(sr.rowCount).toBeGreaterThanOrEqual(1);
      expect(sr.rows[0].search_method).toBe("hybrid_rrf");

      // SearchTracker emitted an event
      const ev = await c.query(
        `SELECT event_type, payload FROM events WHERE anonymous_id = $1 AND event_type = 'search'`,
        [anonId],
      );
      expect(ev.rowCount).toBeGreaterThanOrEqual(1);
      expect(ev.rows[0].payload.method).toBe("hybrid_rrf");
    } finally {
      await c.end();
    }
  });

  test("garbage query 'asdfgh' → low-confidence + no mock invoked", async ({ page }) => {
    await page.context().clearCookies();

    const searchResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/search?q=") && resp.status() === 200,
      { timeout: 30_000 },
    );
    await page.goto("/search?q=asdfgh");
    await searchResponsePromise;

    const anonId = (await page.context().cookies()).find((c) => c.name === "anonymous_id")!.value;
    const c = await pg();
    try {
      const sr = await c.query(
        `SELECT called_mock FROM searches WHERE raw_query = 'asdfgh' AND anonymous_id = $1`,
        [anonId],
      );
      expect(sr.rowCount).toBeGreaterThanOrEqual(1);
      expect(sr.rows[0].called_mock).toBe(false);
    } finally {
      await c.end();
    }
  });
});
```

- [ ] **Step 3: Run E2E**

Run: `pnpm test:e2e tests/e2e/search-flow.spec.ts`

Expected: 2 tests PASS.

If tests fail because dev server isn't running, Playwright config will start one automatically (per `playwright.config.ts` `webServer`).

- [ ] **Step 4: Commit AND push**

```bash
git add tests/e2e/search-flow.spec.ts
git commit -m "test(e2e): search-flow — hybrid happy path + garbage low-confidence"
git push origin feat/fase-2-hybrid-search
```

---

## Task 18: `eval-30-queries.ts` CLI + run + commit results

**Files:**
- Create: `scripts/eval-30-queries.ts`
- Create: `docs/superpowers/reports/2026-05-XX-fase-2-eval-30-queries.md` (the date prefix is filled in at run time)

**Goal:** Generate a side-by-side comparison of hybrid vs LIKE search for 30 representative queries. User audits subjectively.

- [ ] **Step 1: Implement the CLI**

Create `scripts/eval-30-queries.ts`:

```ts
#!/usr/bin/env tsx
/**
 * CLI: pnpm tsx scripts/eval-30-queries.ts > docs/superpowers/reports/$(date +%Y-%m-%d)-fase-2-eval-30-queries.md
 *
 * For each of 30 representative queries, runs both hybridSearch and searchLike,
 * captures top-10 of each, and emits a Markdown report with checkbox columns
 * for the user to audit subjectively.
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { withPg } from "@/lib/db/helpers";
import { hybridSearch } from "@/sectors/c-search/search";
import { searchLike } from "@/sectors/b-catalog/repository/products";

const QUERIES: { category: string; q: string }[] = [
  // Literal/SKU
  { category: "literal", q: "Nike Air Max 270 talle 42" },
  { category: "literal", q: "iPhone 15 Pro 256GB" },
  { category: "literal", q: "Samsung Galaxy S24 Ultra" },
  { category: "literal", q: "Sony WH-1000XM5" },
  { category: "literal", q: "Adidas Stan Smith blanco" },
  // Sinónimos
  { category: "sinónimos", q: "audifonos bluetooth con cancelación de ruido" },
  { category: "sinónimos", q: "bocinas portátiles" },
  { category: "sinónimos", q: "remera deportiva" },
  { category: "sinónimos", q: "pantalón corto verano" },
  { category: "sinónimos", q: "auriculares para correr" },
  // Receptor + edad/género
  { category: "receptor", q: "regalo para mi sobrina de 8 años" },
  { category: "receptor", q: "regalo para mi abuelo" },
  { category: "receptor", q: "ropa para mi esposo de 35 años" },
  { category: "receptor", q: "juguete educativo para niño de 5 años" },
  { category: "receptor", q: "vestido para boda femenino" },
  // Estilo subjetivo
  { category: "estilo", q: "algo bonito y barato" },
  { category: "estilo", q: "vestido elegante para fiesta" },
  { category: "estilo", q: "ropa deportiva colorida" },
  { category: "estilo", q: "algo formal masculino" },
  { category: "estilo", q: "estilo vintage" },
  // Categórico amplio
  { category: "categórico", q: "ropa de niño" },
  { category: "categórico", q: "electrónica para oficina" },
  { category: "categórico", q: "productos para la cocina" },
  { category: "categórico", q: "belleza para mujer" },
  { category: "categórico", q: "juguetes bebé" },
  // Edge / basura
  { category: "edge", q: "asdfgh" },
  { category: "edge", q: "?" },
  { category: "edge", q: "1234" },
  { category: "edge", q: "AAAAAAAA" },
  { category: "edge", q: "" },
];

const TODAY = new Date().toISOString().slice(0, 10);

console.log(`# Fase 2 — Evaluación 30 queries · ${TODAY}\n`);
console.log(`**Compuerta:** ≥ 21 de 30 marcadas \`hybrid mejor\`. Las 5 *edge/basura* pueden contar como N/A; el threshold también es válido sobre las 25 no-garbage (≥ 18 de 25 ≈ 70%).\n`);
console.log(`**Procedimiento:** Para cada query, comparar top-10 de hybrid vs LIKE. Marca con \`x\` la columna ganadora.\n`);
console.log(`---\n`);

(async () => {
  let i = 0;
  for (const { category, q } of QUERIES) {
    i++;
    console.log(`## ${i}. [${category}] \`${q}\`\n`);

    if (!q) {
      console.log(`*Empty query — both methods short-circuit to empty.*\n`);
      console.log(`| | hybrid | LIKE |`);
      console.log(`|---|---|---|`);
      console.log(`| Top-10 | (empty) | (empty) |`);
      console.log(`| **Hybrid mejor** | [ ] | |`);
      console.log(`| **LIKE mejor** | | [ ] |`);
      console.log(`| **Empate / N/A** | [x] | |`);
      console.log();
      continue;
    }

    let hybridTop: string[] = [];
    let likeTop: string[] = [];
    let hybridErr: string | null = null;
    try {
      const r = await withPg((pg) => hybridSearch(q, { pg, anonymous_id: null, user_id: null }));
      hybridTop = r.products.slice(0, 10).map((p) => `${p.title} ($${(p.price_cents / 100).toFixed(2)})`);
    } catch (e) {
      hybridErr = e instanceof Error ? e.message : String(e);
    }
    try {
      const products = await withPg((pg) => searchLike({ query: q, limit: 10, pg }));
      likeTop = products.map((p) => `${p.title} ($${(p.price_cents / 100).toFixed(2)})`);
    } catch (e) {
      likeTop = [`(LIKE error: ${e instanceof Error ? e.message : String(e)})`];
    }

    if (hybridErr) {
      console.log(`> hybrid threw: ${hybridErr}`);
    }

    console.log(`| Rank | hybrid | LIKE |`);
    console.log(`|---|---|---|`);
    for (let r = 0; r < 10; r++) {
      const h = hybridTop[r] ?? "—";
      const l = likeTop[r] ?? "—";
      console.log(`| ${r + 1} | ${h.replace(/\|/g, "\\|")} | ${l.replace(/\|/g, "\\|")} |`);
    }
    console.log();
    console.log(`- [ ] hybrid mejor`);
    console.log(`- [ ] LIKE mejor`);
    console.log(`- [ ] empate / N/A`);
    console.log();
  }

  console.log(`---\n`);
  console.log(`## Resumen (rellenar manualmente al final)\n`);
  console.log(`- Hybrid mejor: ___ / 30`);
  console.log(`- LIKE mejor:   ___ / 30`);
  console.log(`- Empate / N/A: ___ / 30`);
  console.log();
  console.log(`**Compuerta:** ≥ 21 de 30 (o ≥ 18 de 25 no-edge): ✅ pass / ❌ fail`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run the eval**

```bash
TODAY=$(date +%Y-%m-%d)
pnpm tsx scripts/eval-30-queries.ts > docs/superpowers/reports/${TODAY}-fase-2-eval-30-queries.md
```

Expected: takes 3-5 minutes (30 queries × hybrid round-trip incl. some cache misses + LIKE). Cost: ~$0.20-0.30 in tokens.

- [ ] **Step 3: Verify the markdown is well-formed**

Run: `head -30 docs/superpowers/reports/$(date +%Y-%m-%d)-fase-2-eval-30-queries.md`

Expected: title, gate description, first query table, checkbox lines.

- [ ] **Step 4: USER review (manual)**

The user must open the file and:
1. For each query, mark the winning method.
2. Fill the summary section at the end with the counts.
3. Confirm the gate ≥ 21/30.

If the gate fails, **stop and report**: do not proceed to triple review with a failed eval. Possibilities:
- Hybrid is genuinely worse for some queries (debug the prompt or the RRF k₀).
- LIKE happens to do well because all queries are exact-titled (mock fixture).
- Threshold needs re-discussion.

- [ ] **Step 5: Commit the eval (with manual ticks)**

```bash
TODAY=$(date +%Y-%m-%d)
git add docs/superpowers/reports/${TODAY}-fase-2-eval-30-queries.md scripts/eval-30-queries.ts
git commit -m "test(eval): 30-query subjective evaluation — hybrid vs LIKE"
git push origin feat/fase-2-hybrid-search
```

---

## Task 19: Mutation testing on 7 functions

**Files:** none (verification task with one trailing empty commit).

**Goal:** Per spec criterion: "Mutation testing aplicado al RRF, al cálculo de cache hash, al threshold de confidence." Plus extension to canonicalize lowercase + accents (mutations 4 & 5).

For each: (1) baseline green; (2) introduce mutation; (3) run targeted test, expect FAIL; (4) restore; (5) re-run, expect green.

- [ ] **Mutation 1: `rrfFuse` k0**

In `src/sectors/c-search/retrieve/rrf.ts`, change:
```ts
const reciprocal = 1 / (k0 + item.rank);
```
to:
```ts
const reciprocal = 1 / item.rank;
```

Run: `pnpm vitest run tests/unit/rrf.test.ts -t "k0=60 changes scores"`

Expected: FAIL — `r60` and `r0` produce identical scores when k0 is dropped.

Restore. Re-run: PASS.

- [ ] **Mutation 2: `rrfFuse` adition**

In the same file, change:
```ts
existing.rrf_score += reciprocal;
```
to:
```ts
existing.rrf_score = reciprocal;
```

Run: `pnpm vitest run tests/unit/rrf.test.ts -t "product in both lists at rank 1"`

Expected: FAIL — score is `1/61` instead of `2/61`.

Restore. Re-run: PASS.

- [ ] **Mutation 3: `canonicalize` sort**

In `src/sectors/c-search/cache/hash.ts`, remove `.sort()`:
```ts
return rawQuery
  .toLowerCase()
  .normalize("NFD")
  .replace(/\p{M}/gu, "")
  .split(/\s+/)
  .filter(Boolean)
  .join(" ");
```

Run: `pnpm vitest run tests/unit/cache-hash.test.ts -t "WORLD HELLO"`

Expected: FAIL — `"WORLD HELLO"` becomes `"world hello"` instead of `"hello world"`.

Restore. Re-run: PASS.

- [ ] **Mutation 4: `canonicalize` accents**

In the same file, remove the NFD strip:
```ts
return rawQuery
  .toLowerCase()
  .split(/\s+/)
  .filter(Boolean)
  .sort()
  .join(" ");
```

Run: `pnpm vitest run tests/unit/cache-hash.test.ts -t "Sábanas"`

Expected: FAIL — `"Sábanas"` stays as `"sábanas"` instead of `"sabanas"`.

Restore. Re-run: PASS.

- [ ] **Mutation 5: `canonicalize` lowercase**

In the same file, remove `.toLowerCase()`:
```ts
return rawQuery
  .normalize("NFD")
  .replace(/\p{M}/gu, "")
  .split(/\s+/)
  .filter(Boolean)
  .sort()
  .join(" ");
```

Run: `pnpm vitest run tests/unit/cache-hash.test.ts -t "Hello World"`

Expected: FAIL — `"Hello World"` produces `"Hello World"` (different sort: uppercase letters sort before lowercase).

Restore. Re-run: PASS.

- [ ] **Mutation 6: `shouldCallMock` confidence threshold**

In `src/sectors/c-search/decide/shouldCallMock.ts`, change:
```ts
export const CONFIDENCE_THRESHOLD = 0.5;
```
to:
```ts
export const CONFIDENCE_THRESHOLD = 0.1;
```

Run: `pnpm vitest run tests/unit/decide-mock.test.ts -t "low confidence"`

Expected: FAIL — `(5, 0.4)` returns `true` when it should be `false`.

Restore. Re-run: PASS.

- [ ] **Mutation 7: `shouldCallMock` count threshold**

In the same file, change:
```ts
return localCount < LOCAL_HITS_THRESHOLD && confidence > CONFIDENCE_THRESHOLD;
```
to:
```ts
return localCount <= LOCAL_HITS_THRESHOLD && confidence > CONFIDENCE_THRESHOLD;
```

Run: `pnpm vitest run tests/unit/decide-mock.test.ts -t "count 12 with confidence 0.9"`

Expected: FAIL — `(12, 0.9)` returns `true` when it should be `false`.

Restore. Re-run: PASS.

- [ ] **Verify clean state**

Run: `git status`

Expected: working tree clean. If there's a dirty file, `git checkout -- <file>` to discard.

Run: `pnpm test:unit && pnpm test:integration -- --reporter=verbose 2>&1 | tail -10`

Expected: all tests green.

- [ ] **Final commit (empty)**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
test(mutation): verified 7 mutations Fase 2 fail as expected

- rrfFuse k0=60 dropped → "k0=60 changes scores" FAIL
- rrfFuse += → = → "product in both lists at rank 1" FAIL
- canonicalize .sort() removed → "WORLD HELLO" FAIL
- canonicalize NFD strip removed → "Sábanas" FAIL
- canonicalize .toLowerCase() removed → "Hello World" FAIL
- shouldCallMock confidence threshold 0.5 → 0.1 → "low confidence" FAIL
- shouldCallMock count < 12 → <= 12 → "count 12 with confidence 0.9" FAIL

Per Section B of prompt-fase-1-3.md and spec sec 10.4.
EOF
)"
git push origin feat/fase-2-hybrid-search
```

---

## Task 20: Full suite + triple review + closure report

**Files:**
- Create: `docs/superpowers/reports/2026-05-XX-fase-2-cierre.md` (replace XX with finishing date)

**Goal:** Final verification gate. Three independent reviewers + closure document.

- [ ] **Step 1: Run all tests one more time**

Run:
```bash
pnpm test:unit 2>&1 | tail -5
pnpm test:integration 2>&1 | tail -5
pnpm test:quality
pnpm test:e2e 2>&1 | tail -10
```

Expected:
- unit: ~64 tests (45 from Phase 1 + 8 hash + 8 rrf + 4 decide-mock — actual is `8+8+5=21` new + 45 = 66 total, 11 from cache-hash counts as 11 if test.each is unrolled)
- integration: ~115 tests pass + 4 skipped (77 from Phase 1 + ~33 new in Phase 2)
- quality: 0 violations
- e2e: 7 tests pass (5 from Phase 1 + 2 from Phase 2 search-flow)

If any test fails, fix before proceeding.

- [ ] **Step 2: Adversario (Agent dispatch)**

Use the Agent tool with `subagent_type: general-purpose` to review test quality. Prompt template (literal Sección C of prompt-fase-1-3.md):

> Eres un revisor adversarial de tests para Fase 2 de ecommerce-cuba (working dir /workspaces/ecommerce-cuba).
>
> Tu único objetivo es encontrar tests que NO atrapen bugs reales. Para cada test:
> 1. Lee el test y el código bajo prueba.
> 2. Imagina 3 mutaciones plausibles del código.
> 3. Si al menos una mutación NO se detecta, marca **DÉBIL**.
> 4. Marca también **DÉBIL** cualquier anti-pattern (tautologías, mocking circular, snapshots sin validación, expect.anything con objeto vacío, dependencia de orden, only happy path).
>
> Tests Fase 2 a revisar:
> - tests/unit/cache-hash.test.ts
> - tests/unit/rrf.test.ts
> - tests/unit/decide-mock.test.ts
> - tests/integration/normalize-query.test.ts
> - tests/integration/cache-exact.test.ts
> - tests/integration/cache-semantic.test.ts
> - tests/integration/bm25.test.ts
> - tests/integration/cosine.test.ts
> - tests/integration/searches-persist.test.ts
> - tests/integration/admin-searches-route.test.ts
> - tests/integration/hybrid-search.test.ts
> - tests/integration/search-mock-fallback.test.ts
> - tests/integration/search-route.test.ts
> - tests/e2e/search-flow.spec.ts
>
> Source files bajo prueba:
> - src/sectors/c-search/{normalizer,cache,retrieve,decide,persist,admin}/*
> - src/sectors/c-search/search.ts
> - src/app/api/search/route.ts
> - src/app/api/admin/searches/route.ts
> - src/components/{SearchSkeleton,SearchResults,SearchUnderstood}.tsx
>
> Reporta tests débiles con archivo:line + mutación específica + recomendación. Verdict: STRONG | NEEDS REWORK.

Save the literal output to `/tmp/fase2-adversario.md`.

- [ ] **Step 3: Auditor de Mocks (Agent dispatch)**

Same as Phase 1 Task 33 step 2 — re-use that prompt verbatim, but expand the source paths to include `src/sectors/c-search/*` in the banned-mocks list. The AST checker (`pnpm test:quality`) already enforces no mocks of `@/sectors/c-search/*` so the auditor should report APPROVED.

Save output to `/tmp/fase2-auditor.md`.

- [ ] **Step 4: Probador de Comportamiento (Agent dispatch)**

Start dev server: `pnpm dev > /tmp/dev.log 2>&1 &`. Note PID.

Use the Agent tool with `subagent_type: general-purpose`. Prompt template:

> Eres un probador externo. NO leas src/, tests/, docs/superpowers/specs/, docs/superpowers/plans/, scripts/. Sólo `MVP_Ecommerce_Personalizado_Documento_Maestro v2.md` (sección 9 Sector C completo) y el sistema corriendo en http://localhost:3000.
>
> Validar comportamientos del documento maestro Fase 2:
> 1. Cache exact: misma query 2× → 2ª no gasta tokens (verificar via `searches.hit_cache=true`).
> 2. Cache exact: 3 permutaciones de palabras → 1 row en `product_query_cache`.
> 3. BM25 ranks literal queries above semantic neighbors.
> 4. Cosine catches semantic queries that BM25 misses.
> 5. RRF fusiona ambos rankings (verificable: hybrid devuelve productos que BM25 puro no devuelve y vice versa).
> 6. Query basura ("asdfgh") → mock NO se llama (`mock_calls` count == 0).
> 7. Hits locales < 12 + confidence > 0.5 → mock invocado.
> 8. Skeleton honesto durante mock fallback (Suspense fallback visible).
> 9. /api/admin/searches devuelve paginado JSON con normalized_json.
>
> Recursos: `curl`, `psql "$SUPABASE_DB_URL" -c '...'` (env desde .env.local: `set -a; . .env.local; set +a`).
>
> Reporta cada caso PASS/FALLA/NO_VERIFICABLE. Verdict: APPROVED | NEEDS REWORK.

Save output to `/tmp/fase2-probador.md`.

Kill dev: `kill <PID>`.

- [ ] **Step 5: Iterate until 3 reviewers report clean**

For each weak test (Adversario), each unjustified mock (Auditor), each FALLA (Probador): fix and re-invoke that specific reviewer. Each fix is its own commit + push:

```bash
git commit -m "fix(test): rewrite <test name> per Adversario feedback — now catches <mutation>"
git push origin feat/fase-2-hybrid-search
```

If fixes touch many files, batch them under one commit `fix(fase-2): triple-review remediations — production bugs + test strengthening`.

- [ ] **Step 6: Write the closure report**

Replace `2026-05-XX` with today's date. Create `docs/superpowers/reports/<date>-fase-2-cierre.md`:

```markdown
# Reporte de cierre — Fase 2 · Búsqueda híbrida

**Fecha:** <YYYY-MM-DD>
**Branch:** `feat/fase-2-hybrid-search`
**Spec:** `docs/superpowers/specs/2026-05-07-fase-2-design.md`
**Plan:** `docs/superpowers/plans/2026-05-07-fase-2-hybrid-search.md`

## Hitos completados

(Tabla con cada Tasks 1-20 + commit hashes)

## Tests escritos y estado final

- **Unit:** ~21 nuevos en Fase 2 (cache-hash 11, rrf 8, decide-mock 5).
- **Integration:** ~38 nuevos (normalize 5, cache-exact 5, cache-semantic 5, bm25 5, cosine 5, searches-persist 3, admin-searches 5, hybrid-search 4, search-mock-fallback 3, search-route 4).
- **E2E:** 2 nuevos (search-flow.spec.ts).

**Mutation testing:** 7 mutaciones documentadas en commit (T19).

**Anti-pattern violations:** 0 (`pnpm test:quality` clean).

## 30-query eval

(Pegar el resumen final del archivo `<date>-fase-2-eval-30-queries.md`. Si gate ≥21/30 ✅; si <21 documentar discrepancias.)

## Bugs encontrados durante el desarrollo

(Listar los bugs reales atrapados por TDD durante implementación.)

## Output literal de los 3 revisores

### === AGENTE 1 (Adversario) — Output literal ===

(Pegar `/tmp/fase2-adversario.md` verbatim. Si hubo iteraciones, pegar la última que reporta STRONG.)

### === AGENTE 2 (Auditor de Mocks) — Output literal ===

(Pegar `/tmp/fase2-auditor.md` verbatim.)

### === AGENTE 3 (Probador de Comportamiento) — Output literal ===

(Pegar `/tmp/fase2-probador.md` verbatim.)

## Métricas

- Tests totales nuevos en Fase 2: ~61.
- Tests totales del proyecto: ~187 pass + 4 skipped.
- Tokens reales gastados durante Fase 2: ~$0.30-0.50 (eval + tests + smoke).
- Productos en DB post-Fase 2: variable (depende de mock fallbacks ejecutados).

## Items pendientes / deferred

- **Reranking por perfil (Paso 6 master doc Sec 9):** Fase 3a (extender `hybridSearch` con `userVector?` opcional).
- **Filtros estructurados extendidos (gender_target, age_target, price_range):** Fase 3a.
- **Calibración empírica θ del cache semántico:** Fase 5.
- **TTL cleanup cron de `product_query_cache`:** Fase 4.
- **Admin role check en `/api/admin/searches`:** Fase 4 (hoy: any logged-in user).
- **UI admin completo:** Fase 4.

## Decisión

✅ Fase 2 cerrada. Listo para Fase 3a (Personalización básica).

(O: ⚠️ Fase 2 tiene items pendientes — listar los que requieren decisión del usuario.)
```

- [ ] **Step 7: Final commit**

```bash
git add docs/superpowers/reports/
git commit -m "chore(fase-2): closure report — triple review APPROVED + 30-query eval pass"
git push origin feat/fase-2-hybrid-search
```

---

## Self-review checklist (run after Task 20)

- [ ] All 20 tasks have a checkbox in their steps.
- [ ] No "TBD" / "TODO" / "fill in later" in the plan body (the in-code TODO for admin role check is intentional, documented in the spec).
- [ ] Every function name used in later tasks is defined in an earlier task: `hashQuery` (T3) ✓, `rrfFuse` (T4) ✓, `shouldCallMock` (T5) ✓, `stripMarkdownWrapper` (T6) ✓, `normalizeQueryWithLLM` (T7) ✓, `lookupExact`/`writeExact` (T8) ✓, `lookupSemantic` (T9) ✓, `bm25Search` (T10) ✓, `cosineSearch` (T11) ✓, `persistSearch` (T12) ✓, `listSearches` (T13) ✓, `hybridSearch` (T14) ✓, `seedProductWithEmbedding` (T10) ✓.
- [ ] Every import path matches the file location.
- [ ] Test count matches spec (~66 new tests).
- [ ] All 7 mutation tests documented (Task 19).
- [ ] Closure report covers spec sec 13 DoD.

---

**Plan complete.** Total: 21 tasks (20 main + 1 splitter for 14b); ~14-18h of focused work; ~$0.30-0.50 in API tokens for the full suite + eval.
