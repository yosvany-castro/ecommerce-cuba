# Fase 1 — E-commerce básico + tracking · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 1 deliverables — tracking infrastructure (Sector A), catalog enrichment + cron (Sector B), basic shop UI (home, detail, search-LIKE, cart, checkout) — with TDD and real-API tests, ending with a triple-review pass.

**Architecture:** Next.js 16 App Router + Postgres (Supabase) + Voyage embeddings + Anthropic Haiku for normalization. Middleware injects `anonymous_id` (1y cookie) + `session_id` (30 min sliding). Events go to `events` table via `POST /api/track` with idempotency by `client_event_id`. Cart is hybrid: `cart_items` table for logged-in users + localStorage scoped by `anonymous_id` for anon, merged on signup. Cron is a CLI script that calls the mock aggregator and runs each product through LLM normalize + Voyage embed + UPSERT. Search in this phase is plain `ILIKE`.

**Tech Stack:** Next.js 16.2, TypeScript 5.6, vitest 4.1, @playwright/test 1.59, pg 8.20, @supabase/supabase-js 2.105, voyage-4 (1024 dim), claude-haiku-4-5-20251001, zod (to be added), Auth0 v4 (already wired).

**Spec:** `docs/superpowers/specs/2026-05-07-fase-1-design.md` — read for context if anything below seems underspecified.

**Branch:** `feat/fase-1-tracking-catalog` (already created at `6d5ceb2`).

---

## Conventions

- All tests use `vitest` with `import { describe, test, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'`.
- Integration tests use `withTestDb(fn)` (existing helper, gives `pg` Client with `search_path test_schema, public`).
- App code uses `withPg(fn)` (NEW helper, scope `public`) — to be created in Task 5.
- `truncateTestTables(['events','products',...])` is the standard reset between tests (existing helper).
- Real-API tests against Voyage and Anthropic are gated only by env vars being present; **never mock these clients** (AST checker enforces).
- The only allowed mock is `src/sectors/b-catalog/mock/*`.
- Each task ends with a commit. Use clear `feat`/`fix`/`refactor`/`test`/`chore`/`docs` prefixes.

## File map (created or modified across all tasks)

```
src/
├── lib/
│   ├── config/index.ts                              [Task 5 NEW]
│   ├── db/
│   │   ├── helpers.ts                               [Task 5 NEW]
│   │   └── supabase.ts                              [Task 2 REFACTOR]
│   ├── auth/index.ts                                [Task 14 MODIFY: getOrCreateUserByAuth0Sub]
│   └── time/clock.ts                                (existing)
├── sectors/
│   ├── a-tracking/
│   │   ├── identity.ts                              [Task 9-10]
│   │   ├── events/
│   │   │   ├── schema.ts                            [Task 7]
│   │   │   ├── insert.ts                            [Task 8]
│   │   │   └── merge.ts                             [Task 13]
│   ├── b-catalog/
│   │   ├── enrichment/
│   │   │   ├── canonical.ts                         [Task 15]
│   │   │   ├── prompt.ts                            [Task 16]
│   │   │   ├── normalizer.ts                        [Task 16]
│   │   │   └── pipeline.ts                          [Task 17]
│   │   ├── cron/catalog-fill.ts                     [Task 18]
│   │   └── repository/products.ts                   [Task 20]
├── app/
│   ├── layout.tsx                                   [Task 30 MODIFY]
│   ├── (shop)/
│   │   ├── page.tsx                                 [Task 21]
│   │   ├── products/[id]/page.tsx                   [Task 23]
│   │   ├── search/page.tsx                          [Task 24]
│   │   ├── cart/page.tsx                            [Task 28]
│   │   └── checkout/{page.tsx,success/page.tsx}     [Task 29]
│   └── api/
│       ├── track/route.ts                           [Task 12]
│       ├── identity/merge/route.ts                  [Task 14]
│       ├── cart/{route.ts,merge/route.ts}           [Task 26-27]
│       ├── checkout/route.ts                        [Task 29]
│       └── search/route.ts                          [Task 24 — used by client tracker]
├── components/
│   ├── ProductCard.tsx                              [Task 22]
│   ├── ProductTracker.tsx                           [Task 23]
│   ├── SearchTracker.tsx                            [Task 24]
│   ├── CartProvider.tsx                             [Task 25]
│   └── IdentityMergeOnLogin.tsx                     [Task 30]
└── middleware.ts                                    [Task 11 MODIFY]

scripts/
├── cron-catalog-fill.ts                             [Task 19]
├── generate-test-schema-migration.ts                [Task 4 MODIFY]
└── check-test-quality.ts                            [Task 3 MODIFY]

supabase/migrations/
├── 0013_cart_items.sql                              [Task 6]
└── 0014_test_schema_replicate_v2.sql                [Task 6 generated]

tests/
├── helpers/
│   ├── wait.ts                                      [Task 7]
│   ├── seed.ts                                      [Task 8]
│   └── pgvector.ts                                  [Task 17]
├── unit/
│   ├── events-schema.test.ts                        [Task 7]
│   ├── canonical-text.test.ts                       [Task 15]
│   └── config.test.ts                               [Task 5]
├── integration/
│   ├── identity.test.ts                             [Task 9-10]
│   ├── insert-event.test.ts                         [Task 8]
│   ├── track-endpoint.test.ts                       [Task 12]
│   ├── identity-merge.test.ts                       [Task 13]
│   ├── identity-merge-route.test.ts                 [Task 14]
│   ├── enrichment-pipeline.test.ts                  [Task 17]
│   ├── cron-catalog-fill.test.ts                    [Task 18]
│   ├── products-repo.test.ts                        [Task 20]
│   ├── cart-api.test.ts                             [Task 26]
│   ├── cart-merge.test.ts                           [Task 27]
│   └── checkout.test.ts                             [Task 29]
└── e2e/
    ├── tracking-flow.spec.ts                        [Task 30]
    └── shopping-flow.spec.ts                        [Task 32]

package.json                                         [Task 5,19 add deps + cron script]
```

## Task list

| # | Title | Time est. | Dependencies |
|---|---|---|---|
| 1 | Smoke pre-flight check | 10 min | — |
| 2 | Refactor `getSupabaseClient` to lazy factory (#5) | 15 min | 1 |
| 3 | Extend AST checker for service wrappers (#7) | 30 min | 1 |
| 4 | Dynamic regex range in `generate-test-schema-migration.ts` (#2) | 15 min | 1 |
| 5 | Add `lib/config` zod + `lib/db/helpers.ts` `withPg` | 25 min | 1, install zod |
| 6 | Migration 0013 cart_items + regen test_schema | 20 min | 4, 5 |
| 7 | Event schema (zod) + unit tests | 35 min | 5 |
| 8 | `insertEvent` + integration tests | 40 min | 7 |
| 9 | `ensureAnonymousId` + integration tests | 30 min | 8 |
| 10 | `ensureSession` + integration tests | 35 min | 9 |
| 11 | Wire identity into `src/middleware.ts` | 20 min | 10 |
| 12 | `POST /api/track` + integration tests | 50 min | 11 |
| 13 | `mergeIdentities` + integration tests | 30 min | 8 |
| 14 | `POST /api/identity/merge` + tests + auth helper | 35 min | 13 |
| 15 | `buildCanonicalText` + unit tests | 20 min | 5 |
| 16 | `normalizeWithLLM` + prompt | 30 min | 5 |
| 17 | `processProduct` pipeline + integration tests | 60 min | 15, 16, helpers |
| 18 | `runCatalogFill` + integration tests | 45 min | 17 |
| 19 | CLI `scripts/cron-catalog-fill.ts` + npm script | 15 min | 18 |
| 20 | Products repository + integration tests | 30 min | 5 |
| 21 | Home page (server component grid) | 20 min | 20 |
| 22 | `ProductCard` component | 15 min | 21 |
| 23 | Product detail page + `ProductTracker` | 35 min | 22, 12 |
| 24 | Search page + `SearchTracker` + route | 30 min | 22 |
| 25 | `CartProvider` hook (anon localStorage / logged API) | 35 min | 12 |
| 26 | Cart API routes (GET/PUT) + tests | 40 min | 6, 8 |
| 27 | Cart merge route + tests | 30 min | 26 |
| 28 | Cart page UI | 25 min | 25, 26 |
| 29 | Checkout page + route + tests | 50 min | 25 |
| 30 | `IdentityMergeOnLogin` in root layout + E2E tracking-flow | 45 min | 14, 27 |
| 31 | Mutation testing on 5 critical functions | 60 min | 30 |
| 32 | Full suite green (unit + integration + E2E shopping-flow) | 30 min | 31 |
| 33 | Triple review (Adversario, Auditor, Probador) + closure report | 90 min | 32 |

---

## Task 1: Smoke pre-flight check

**Files:** none (read-only verification).

**Goal:** Confirm Phase 0 deliverables are still functional before building on top.

- [ ] **Step 1: Verify env vars present (no values printed)**

Run:
```bash
node -e "['SUPABASE_DB_URL','VOYAGE_API_KEY','ANTHROPIC_API_KEY','AUTH0_DOMAIN','AUTH0_CLIENT_ID','AUTH0_CLIENT_SECRET','AUTH0_SECRET','APP_BASE_URL','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'].forEach(k=>console.log(k+': '+(!!process.env[k])))" --env-file=.env.local
```

Expected: every line ends in `true`.

- [ ] **Step 2: Verify pg + pgvector extension + table count**

Run:
```bash
pnpm tsx -e "
import { getPgClient } from '@/lib/db/pg';
const pg = await getPgClient({ scope: 'public' });
const ext = await pg.query(\"SELECT extname, extversion FROM pg_extension WHERE extname='vector'\");
const tables = await pg.query(\"SELECT count(*)::int FROM pg_tables WHERE schemaname='public'\");
const dim = await pg.query(\"SELECT atttypmod FROM pg_attribute WHERE attrelid='public.products'::regclass AND attname='embedding'\");
console.log('vector ext:', ext.rows[0]);
console.log('public tables:', tables.rows[0].count);
console.log('products.embedding typmod (dim):', dim.rows[0].atttypmod);
await pg.end();
"
```

Expected:
- `vector ext: { extname: 'vector', extversion: '0.8.0' }` (or compatible)
- `public tables: 19` (18 spec + `_migrations`)
- `products.embedding typmod (dim): 1024`

- [ ] **Step 3: Verify Voyage embedding dim matches column**

Run:
```bash
pnpm tsx -e "
import { embed, EMBEDDING_DIM } from '@/lib/embeddings/voyage';
const [v] = await embed(['hola mundo'], { inputType: 'document' });
console.log('voyage dim:', v.length, 'expected:', EMBEDDING_DIM);
const norm = Math.sqrt(v.reduce((s,x)=>s+x*x,0));
console.log('voyage norm:', norm.toFixed(6));
"
```

Expected: `voyage dim: 1024 expected: 1024`, `voyage norm: 1.000000`.

- [ ] **Step 4: Verify Anthropic API**

Run:
```bash
pnpm tsx -e "
import { sendMessage, MODELS } from '@/lib/llm/anthropic';
const r = await sendMessage({ model: MODELS.haiku, system: 'Reply with the single word OK.', messages: [{role:'user', content:'ping'}], maxTokens: 10 });
console.log('anthropic text:', JSON.stringify(r.text));
console.log('anthropic usage:', r.usage);
"
```

Expected: `anthropic text: "OK"` (or similar) and usage with input_tokens > 0, output_tokens > 0.

- [ ] **Step 5: Verify Auth0 reachable**

Run:
```bash
pnpm dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
sleep 6
curl -i -s http://localhost:3000/profile | head -5
kill $DEV_PID 2>/dev/null
```

Expected: `HTTP/1.1 307 Temporary Redirect` with `location:` to `/auth/login` (Auth0 universal redirect).

- [ ] **Step 6: Verify mock aggregator returns 25 products**

Run:
```bash
pnpm tsx -e "
import { fetchFromAggregator, getCallCount, resetCallCount } from '@/sectors/b-catalog/mock/aggregator';
resetCallCount();
const r = await fetchFromAggregator({ category: 'electronica' });
console.log('count:', r.products.length, 'cost_cents:', r.cost_cents, 'callCount:', getCallCount());
"
```

Expected: `count: 25 cost_cents: 4 callCount: 1`.

- [ ] **Step 7: Run existing test suite to confirm Phase 0 baseline still green**

Run: `pnpm test:unit && pnpm test:integration -- --reporter=verbose 2>&1 | tail -30 && pnpm test:quality`

Expected: all unit (15) + integration (33) tests pass; `OK — scanned 11 files, 0 violations.`

If anything in Steps 1-7 fails, **stop and report**. Do not proceed.

- [ ] **Step 8: Commit smoke report (if you wrote one)**

No file changes from this task — skip commit.

---

## Task 2: Refactor `getSupabaseClient` to lazy factory (Phase 0 follow-up #5)

**Files:**
- Modify: `src/lib/db/supabase.ts`

**Goal:** Eliminate module-level throws so importing this file in tests doesn't break when env vars are absent.

- [ ] **Step 1: Read existing implementation**

Run: `cat src/lib/db/supabase.ts`

You should see a top-level `if (!url || !anonKey) throw ...` — this is what we're moving inside the factory.

- [ ] **Step 2: Rewrite the file**

Replace the entire content of `src/lib/db/supabase.ts` with:

```ts
/**
 * Supabase JS client for app code (server components, route handlers).
 * For test_schema access in integration tests, prefer getPgClient() — the REST
 * API only exposes schemas configured in the Supabase dashboard, while pg client
 * goes direct to Postgres and respects any schema in search_path.
 *
 * Lazy factory — env vars are validated only when a client is actually requested.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Scope = "public" | "test";

export function getSupabaseClient(opts: { scope?: Scope; admin?: boolean } = {}): SupabaseClient {
  const { scope = "public", admin = false } = opts;

  if (scope === "test") {
    throw new Error(
      "getSupabaseClient({ scope: 'test' }) is not supported: the Supabase REST API " +
      "only exposes schemas configured in the dashboard (public by default). " +
      "For integration tests against test_schema, use getPgClient({ scope: 'test' }) instead."
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase env vars missing (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)");
  }
  if (admin && !serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY required for admin client");
  }

  const key = admin ? serviceKey! : anonKey;
  return createClient(url, key, {
    db: { schema: "public" },
    auth: { persistSession: false },
  });
}
```

- [ ] **Step 3: Verify nothing else assumed module-level throws**

Run: `grep -rn "from .*lib/db/supabase" src tests scripts`

Expected: every consumer should call `getSupabaseClient()` (a function), not a module-level constant. Confirm no breakages.

- [ ] **Step 4: Run integration tests that touch supabase**

Run: `pnpm vitest run tests/integration/db.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/supabase.ts
git commit -m "refactor(db): lazy supabase factory — no module-level throws (#5)"
```

---

## Task 3: Extend AST checker for service wrappers (Phase 0 follow-up #7)

**Files:**
- Modify: `scripts/check-test-quality.ts`

**Goal:** When new service files appear under `src/sectors/{a-tracking,b-catalog/enrichment,b-catalog/cron,b-catalog/repository}/`, the AST checker must reject `vi.mock` calls targeting them too.

- [ ] **Step 1: Read current banned-list logic**

Run: `sed -n '78,95p' scripts/check-test-quality.ts`

You'll see the current `banned` array hardcoded with `@/lib/db|llm|embeddings|auth`.

- [ ] **Step 2: Replace banned-list with broader patterns**

Edit `scripts/check-test-quality.ts`. Find:

```ts
        // Rule 3, 4: prohibited mocks
        if (callText === "vi.mock" || callText === "jest.mock") {
          const arg = node.getArguments()[0]?.getText() ?? "";
          const allowed = arg.includes("sectors/b-catalog/mock");
          // Allow "fake timers" via vi.useFakeTimers (different call shape)
          if (!allowed) {
            const banned = ["@/lib/db", "@/lib/llm", "@/lib/embeddings", "@/lib/auth"];
            if (banned.some((b) => arg.includes(b))) {
              record("R3-prohibited-mock", node, filePath);
            }
          }
        }
```

Replace with:

```ts
        // Rule 3, 4: prohibited mocks
        if (callText === "vi.mock" || callText === "jest.mock") {
          const arg = node.getArguments()[0]?.getText() ?? "";
          const allowed = arg.includes("sectors/b-catalog/mock");
          if (!allowed) {
            // Banned: any module that wraps a real external dep we want exercised in tests.
            const bannedPrefixes = [
              "@/lib/db", "@/lib/llm", "@/lib/embeddings", "@/lib/auth",
              "@/sectors/a-tracking",       // identity, events, merge
              "@/sectors/b-catalog/enrichment",
              "@/sectors/b-catalog/cron",
              "@/sectors/b-catalog/repository",
            ];
            const bannedBareModules = ["pg", "@supabase/supabase-js", "@anthropic-ai/sdk", "@auth0/nextjs-auth0"];
            if (
              bannedPrefixes.some((b) => arg.includes(b)) ||
              bannedBareModules.some((b) => arg === `"${b}"` || arg === `'${b}'`)
            ) {
              record("R3-prohibited-mock", node, filePath);
            }
          }
        }
```

- [ ] **Step 3: Run the checker against existing tests (sanity)**

Run: `pnpm test:quality`

Expected: `OK — scanned 11 files, 0 violations.` (Existing tests don't mock anything banned.)

- [ ] **Step 4: Negative-test the rule manually (no commit)**

Create a temp file `tests/integration/_pq.test.ts` (with leading underscore so it's a real .test.ts but easy to spot):

```ts
import { test } from 'vitest';
import { vi } from 'vitest';
vi.mock('@/sectors/a-tracking/identity');
test('temp', () => {});
```

Run: `pnpm test:quality`

Expected: exits non-zero with output containing `R3-prohibited-mock`.

Delete the temp file: `rm tests/integration/_pq.test.ts`.

Run again: `pnpm test:quality` → `OK`.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-test-quality.ts
git commit -m "chore(test-quality): scale AST checker to sector wrappers + raw deps (#7)"
```

---

## Task 4: Dynamic regex range in `generate-test-schema-migration.ts` (Phase 0 follow-up #2)

**Files:**
- Modify: `scripts/generate-test-schema-migration.ts`

**Goal:** Stop hardcoding `0003-0011`. Detect dynamically all table-level migrations except `0001`/`0002` (extensions / test_schema bootstrap) and the test_schema replicate migration itself.

- [ ] **Step 1: Read current regex**

Run: `cat scripts/generate-test-schema-migration.ts`

Look for the part that filters input migrations by filename.

- [ ] **Step 2: Replace the filter**

Find the line that reads migrations and filters by hardcoded numeric range. Replace with logic that:
- Includes any `NNNN_*.sql` migration where `NNNN >= 3` AND filename does NOT include `test_schema_replicate`.

Concretely, find the existing filter (probably similar to `/^00(0[3-9]|1[01])_/` or a hardcoded range) and replace with:

```ts
function isTableMigration(filename: string): boolean {
  const m = filename.match(/^(\d{4})_(.+)\.sql$/);
  if (!m) return false;
  const num = parseInt(m[1], 10);
  if (num < 3) return false;                              // 0001 extensions, 0002 test_schema
  if (m[2].includes("test_schema_replicate")) return false; // skip self
  return true;
}
```

Then in the loop that iterates files, replace the regex-based skip with `if (!isTableMigration(file)) continue;`.

- [ ] **Step 3: Regenerate to verify (without committing)**

Run: `pnpm tsx scripts/generate-test-schema-migration.ts`

Expected: produces `supabase/migrations/0012_test_schema_replicate.sql` (or higher index if Task 6 has run) identical to current except for any non-deterministic ordering quirks.

If output differs unexpectedly, diff with `git diff supabase/migrations/0012_test_schema_replicate.sql` and reconcile.

- [ ] **Step 4: Run parity test**

Run: `pnpm vitest run tests/integration/test-schema-parity.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-test-schema-migration.ts supabase/migrations/0012_test_schema_replicate.sql
git commit -m "chore(test-schema): dynamic migration range detection (#2)"
```

(If `0012_test_schema_replicate.sql` is byte-identical, drop it from the commit — `git status` will show.)

---

## Task 5: Add `lib/config` (zod) + `lib/db/helpers.ts` `withPg`

**Files:**
- Install: `zod` as runtime dep
- Create: `src/lib/config/index.ts`
- Create: `src/lib/db/helpers.ts`
- Create: `tests/unit/config.test.ts`
- Modify: `package.json` (auto by `pnpm add`)

**Goal:** Centralize env-var access with type validation. Provide a `withPg(fn)` helper for app code.

- [ ] **Step 1: Install zod**

Run: `pnpm add zod`

Expected: `zod` appears in `package.json` `dependencies`. Confirm with `grep zod package.json`.

- [ ] **Step 2: Write the unit test for config (failing)**

Create `tests/unit/config.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { loadConfig } from "@/lib/config";

describe("config", () => {
  test("rejects missing required keys with descriptive error", () => {
    const env = { NODE_ENV: "test" } as Record<string, string | undefined>;
    expect(() => loadConfig(env)).toThrow(/SUPABASE_DB_URL/);
  });

  test("accepts complete env and returns typed shape", () => {
    const env = {
      SUPABASE_DB_URL: "postgres://x",
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      ANTHROPIC_API_KEY: "sk-ant-test",
      VOYAGE_API_KEY: "pa-test",
      AUTH0_DOMAIN: "x.auth0.com",
      AUTH0_CLIENT_ID: "cid",
      AUTH0_CLIENT_SECRET: "csec",
      AUTH0_SECRET: "thirty-two-bytes-of-random-chars",
      APP_BASE_URL: "http://localhost:3000",
    };
    const cfg = loadConfig(env);
    expect(cfg.SUPABASE_DB_URL).toBe("postgres://x");
    expect(cfg.APP_BASE_URL).toBe("http://localhost:3000");
  });

  test("optional SUPABASE_SERVICE_ROLE_KEY is allowed missing", () => {
    const env = {
      SUPABASE_DB_URL: "postgres://x",
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      ANTHROPIC_API_KEY: "sk-ant-test",
      VOYAGE_API_KEY: "pa-test",
      AUTH0_DOMAIN: "x.auth0.com",
      AUTH0_CLIENT_ID: "cid",
      AUTH0_CLIENT_SECRET: "csec",
      AUTH0_SECRET: "thirty-two-bytes-of-random-chars",
      APP_BASE_URL: "http://localhost:3000",
    };
    expect(loadConfig(env).SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test (expect FAIL — module not found)**

Run: `pnpm vitest run tests/unit/config.test.ts`

Expected: FAIL with `Cannot find module '@/lib/config'` or similar.

- [ ] **Step 4: Implement `lib/config/index.ts`**

Create `src/lib/config/index.ts`:

```ts
import { z } from "zod";

const ConfigSchema = z.object({
  SUPABASE_DB_URL: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1),
  VOYAGE_API_KEY: z.string().min(1),
  AUTH0_DOMAIN: z.string().min(1),
  AUTH0_CLIENT_ID: z.string().min(1),
  AUTH0_CLIENT_SECRET: z.string().min(1),
  AUTH0_SECRET: z.string().min(1),
  APP_BASE_URL: z.string().url(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid config: ${missing}`);
  }
  return parsed.data;
}

let _cached: Config | null = null;
export function config(): Config {
  if (_cached) return _cached;
  _cached = loadConfig();
  return _cached;
}
```

- [ ] **Step 5: Run test (expect PASS)**

Run: `pnpm vitest run tests/unit/config.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 6: Create `withPg` helper**

Create `src/lib/db/helpers.ts`:

```ts
import { Client } from "pg";
import { getPgClient } from "./pg";
import type { Scope } from "./supabase";

/**
 * Run `fn` with a fresh pg connection (scope = 'public' by default).
 * The connection is closed when `fn` resolves or throws.
 *
 * For long-running operations sharing a connection (e.g. cron pipeline),
 * pass an existing Client directly to the consumer instead of nesting `withPg`.
 */
export async function withPg<T>(
  fn: (pg: Client) => Promise<T>,
  opts: { scope?: Scope } = {},
): Promise<T> {
  const pg = await getPgClient({ scope: opts.scope ?? "public" });
  try {
    return await fn(pg);
  } finally {
    await pg.end();
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/config src/lib/db/helpers.ts tests/unit/config.test.ts
git commit -m "feat(config): zod-validated env loader + withPg helper"
```

---

## Task 6: Migration 0013 cart_items + regenerate test_schema

**Files:**
- Create: `supabase/migrations/0013_cart_items.sql`
- Create (generated): `supabase/migrations/0014_test_schema_replicate_v2.sql`
- Existing: `supabase/migrations/0012_test_schema_replicate.sql` will be deleted (replaced by 0014)

**Goal:** Apply the cart_items migration and regenerate the test_schema replicate so parity holds.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/0013_cart_items.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.cart_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity    integer NOT NULL CHECK (quantity > 0),
  added_at    timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cart_items_user_product_unique UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS cart_items_user_idx ON public.cart_items (user_id);
```

- [ ] **Step 2: Apply migrations**

Run: `pnpm migrate`

Expected: output ends with `applied 0013_cart_items.sql` (or similar success line).

- [ ] **Step 3: Verify table exists**

Run: `pnpm tsx -e "import {getPgClient} from '@/lib/db/pg'; const pg = await getPgClient(); const r = await pg.query(\"SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_name='cart_items'\"); console.log(r.rows[0]); await pg.end();"`

Expected: `{ count: 1 }`.

- [ ] **Step 4: Delete old test_schema replicate (if it exists)**

Run: `rm -f supabase/migrations/0012_test_schema_replicate.sql`

We replace it with the regenerated 0014 (next step).

- [ ] **Step 5: Regenerate test_schema replicate**

Run: `pnpm tsx scripts/generate-test-schema-migration.ts`

Expected: creates `supabase/migrations/0014_test_schema_replicate_v2.sql` (or whatever the next index is). If the script writes a fixed name, rename to `0014_test_schema_replicate_v2.sql` if needed.

If the script's output filename pattern is hardcoded, modify the script to emit `0014_test_schema_replicate_v2.sql`. (Allowed: this is a one-off rename for the new index.)

- [ ] **Step 6: Apply the regenerated migration**

Run: `pnpm migrate`

Expected: `applied 0014_test_schema_replicate_v2.sql`.

- [ ] **Step 7: Run parity test**

Run: `pnpm vitest run tests/integration/test-schema-parity.test.ts`

Expected: PASS — the test_schema now mirrors public including `cart_items`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): migration 0013 cart_items + regen test_schema (0014)"
```

---

## Task 7: Event schema (zod) + unit tests + `wait` helper

**Files:**
- Create: `src/sectors/a-tracking/events/schema.ts`
- Create: `tests/unit/events-schema.test.ts`
- Create: `tests/helpers/wait.ts`

**Goal:** Strict zod schema for the 12 event types. Unit tests prove valid payloads pass and invalid ones reject — for every type.

- [ ] **Step 1: Create the test file (failing)**

Create `tests/unit/events-schema.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { eventInputSchema, validatePayload, EVENT_TYPES, type EventType } from "@/sectors/a-tracking/events/schema";

const validId = "11111111-1111-1111-1111-111111111111";
const orderId = "22222222-2222-2222-2222-222222222222";
const validIso = "2026-05-07T10:00:00.000Z";

const validCases: Record<EventType, unknown> = {
  product_view:    { product_id: validId, source: "home" },
  add_to_cart:     { product_id: validId, quantity: 2 },
  remove_from_cart:{ product_id: validId, quantity: 1 },
  add_to_wishlist: { product_id: validId },
  purchase:        { order_id: orderId, product_ids: [validId], total_cents: 1500 },
  search:          { raw_query: "zapatillas", results_count: 12, method: "like" },
  product_dwell:   { product_id: validId, dwell_ms: 35000 },
  category_click:  { category: "ropa" },
  filter_applied:  { filter_type: "price", filter_value: "low" },
  page_view:       { path: "/products/123" },
  session_start:   {},
  session_end:     { duration_ms: 60000 },
};

describe("eventInputSchema (envelope)", () => {
  test("accepts valid envelope", () => {
    const r = eventInputSchema.parse({
      event_type: "page_view",
      occurred_at: validIso,
      payload: { path: "/" },
    });
    expect(r.event_type).toBe("page_view");
    expect(r.client_event_id).toBeUndefined();
  });

  test("rejects unknown event_type", () => {
    expect(() => eventInputSchema.parse({
      event_type: "fake_event",
      occurred_at: validIso,
      payload: {},
    })).toThrow();
  });

  test("rejects malformed occurred_at", () => {
    expect(() => eventInputSchema.parse({
      event_type: "page_view",
      occurred_at: "2026/05/07",
      payload: { path: "/" },
    })).toThrow();
  });

  test("accepts optional client_event_id (uuid)", () => {
    const r = eventInputSchema.parse({
      client_event_id: validId,
      event_type: "page_view",
      occurred_at: validIso,
      payload: { path: "/" },
    });
    expect(r.client_event_id).toBe(validId);
  });

  test("rejects non-uuid client_event_id", () => {
    expect(() => eventInputSchema.parse({
      client_event_id: "not-a-uuid",
      event_type: "page_view",
      occurred_at: validIso,
      payload: { path: "/" },
    })).toThrow();
  });
});

describe("validatePayload — happy path for every event_type", () => {
  test.each(EVENT_TYPES)("%s: valid payload parses", (eventType) => {
    const payload = validCases[eventType];
    expect(() => validatePayload(eventType, payload)).not.toThrow();
  });
});

describe("validatePayload — invalid payloads reject", () => {
  test("product_view: missing product_id rejected", () => {
    expect(() => validatePayload("product_view", { source: "home" })).toThrow();
  });
  test("product_view: invalid source rejected", () => {
    expect(() => validatePayload("product_view", { product_id: validId, source: "weird" })).toThrow();
  });
  test("add_to_cart: quantity 0 rejected", () => {
    expect(() => validatePayload("add_to_cart", { product_id: validId, quantity: 0 })).toThrow();
  });
  test("product_dwell: dwell_ms < 30000 rejected", () => {
    expect(() => validatePayload("product_dwell", { product_id: validId, dwell_ms: 29999 })).toThrow();
  });
  test("purchase: empty product_ids rejected", () => {
    expect(() => validatePayload("purchase", { order_id: orderId, product_ids: [], total_cents: 0 })).toThrow();
  });
  test("search: negative results_count rejected", () => {
    expect(() => validatePayload("search", { raw_query: "x", results_count: -1, method: "like" })).toThrow();
  });
  test("page_view: empty path rejected", () => {
    expect(() => validatePayload("page_view", { path: "" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test (expect FAIL — module not found)**

Run: `pnpm vitest run tests/unit/events-schema.test.ts`

Expected: FAIL with `Cannot find module '@/sectors/a-tracking/events/schema'`.

- [ ] **Step 3: Implement the schema**

Create `src/sectors/a-tracking/events/schema.ts`:

```ts
import { z } from "zod";

export const EVENT_TYPES = [
  "product_view",
  "add_to_cart",
  "remove_from_cart",
  "add_to_wishlist",
  "purchase",
  "search",
  "product_dwell",
  "category_click",
  "filter_applied",
  "page_view",
  "session_start",
  "session_end",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

const uuid = z.string().uuid();

export const PAYLOAD_SCHEMAS = {
  product_view: z.object({
    product_id: uuid,
    source: z.enum(["home", "category", "search", "direct"]),
  }),
  add_to_cart: z.object({ product_id: uuid, quantity: z.number().int().min(1) }),
  remove_from_cart: z.object({ product_id: uuid, quantity: z.number().int().min(1) }),
  add_to_wishlist: z.object({ product_id: uuid }),
  purchase: z.object({
    order_id: uuid,
    product_ids: z.array(uuid).min(1),
    total_cents: z.number().int().min(0),
  }),
  search: z.object({
    raw_query: z.string().min(1),
    results_count: z.number().int().min(0),
    method: z.enum(["like", "bm25_only", "cosine_only", "hybrid_rrf"]),
  }),
  product_dwell: z.object({
    product_id: uuid,
    dwell_ms: z.number().int().min(30000),
  }),
  category_click: z.object({ category: z.string().min(1) }),
  filter_applied: z.object({
    filter_type: z.string().min(1),
    filter_value: z.union([z.string(), z.number()]),
  }),
  page_view: z.object({ path: z.string().min(1) }),
  session_start: z.object({}).strict(),
  session_end: z.object({ duration_ms: z.number().int().min(0) }),
} as const satisfies Record<EventType, z.ZodTypeAny>;

export const eventInputSchema = z.object({
  client_event_id: uuid.optional(),
  event_type: z.enum(EVENT_TYPES),
  occurred_at: z.string().datetime(),
  payload: z.unknown(),
});

export type EventInput = z.infer<typeof eventInputSchema>;

export function validatePayload(eventType: EventType, payload: unknown) {
  return PAYLOAD_SCHEMAS[eventType].parse(payload);
}
```

- [ ] **Step 4: Run test (expect PASS)**

Run: `pnpm vitest run tests/unit/events-schema.test.ts`

Expected: all tests PASS (5 envelope + 12 happy-path each + 7 invalid = 24).

- [ ] **Step 5: Create `wait` helper for later integration tests**

Create `tests/helpers/wait.ts`:

```ts
export async function waitFor<T>(
  fn: () => Promise<T>,
  opts: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const timeout = opts.timeout ?? 2000;
  const interval = opts.interval ?? 50;
  const deadline = Date.now() + timeout;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, interval));
    }
  }
  throw lastErr ?? new Error("waitFor timeout");
}
```

- [ ] **Step 6: Verify test_quality still clean**

Run: `pnpm test:quality`

Expected: `OK — scanned 12 files, 0 violations.` (now 12 because we added `events-schema.test.ts`).

- [ ] **Step 7: Commit**

```bash
git add src/sectors/a-tracking/events/schema.ts tests/unit/events-schema.test.ts tests/helpers/wait.ts
git commit -m "feat(tracking): event schema with zod + unit tests for 12 event types"
```

---

## Task 8: `insertEvent` with idempotency + integration tests + `seed` helper

**Files:**
- Create: `src/sectors/a-tracking/events/insert.ts`
- Create: `tests/integration/insert-event.test.ts`
- Create: `tests/helpers/seed.ts`

**Goal:** `insertEvent(input, ctx)` writes a row in `events` and respects `ON CONFLICT (client_event_id) DO NOTHING` for idempotency.

- [ ] **Step 1: Create `tests/helpers/seed.ts`**

```ts
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

export async function createUser(
  pg: Client,
  overrides: Partial<{ auth0_sub: string; email: string; name: string }> = {},
): Promise<{ id: string; email: string }> {
  const email = overrides.email ?? `u-${randomUUID()}@test.local`;
  const auth0_sub = overrides.auth0_sub ?? `auth0|${randomUUID()}`;
  const r = await pg.query(
    `INSERT INTO users (auth0_sub, email, name) VALUES ($1, $2, $3) RETURNING id, email`,
    [auth0_sub, email, overrides.name ?? null],
  );
  return r.rows[0];
}

export async function createAnonymousSession(
  pg: Client,
  anonymousId?: string,
): Promise<string> {
  const id = anonymousId ?? randomUUID();
  await pg.query(
    `INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1) ON CONFLICT (anonymous_id) DO NOTHING`,
    [id],
  );
  return id;
}

export async function seedProduct(
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
  const r = await pg.query(
    `INSERT INTO products (source, source_product_id, title, description, price_cents, currency, image_url, raw_category, metadata)
     VALUES ('seed', $1, $2, $3, $4, 'USD', null, $5, $6::jsonb)
     RETURNING id`,
    [
      sid,
      overrides.title ?? `Seeded product ${sid.slice(0, 8)}`,
      overrides.description ?? "test description",
      overrides.price_cents ?? 1000,
      overrides.raw_category ?? "ropa",
      JSON.stringify(overrides.metadata ?? {}),
    ],
  );
  return r.rows[0];
}
```

- [ ] **Step 2: Write the failing integration test**

Create `tests/integration/insert-event.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { createUser, createAnonymousSession, seedProduct } from "@/../tests/helpers/seed";
import { insertEvent } from "@/sectors/a-tracking/events/insert";

beforeEach(async () => {
  await truncateTestTables(["events", "anonymous_sessions", "users", "products"]);
});

describe("insertEvent", () => {
  test("inserts a product_view event with all required columns populated", async () => {
    await withTestDb(async (pg) => {
      const product = await seedProduct(pg);
      const anonId = await createAnonymousSession(pg);
      const sessionId = randomUUID();
      const occurredAt = new Date().toISOString();

      const result = await insertEvent(
        {
          event_type: "product_view",
          occurred_at: occurredAt,
          payload: { product_id: product.id, source: "home" },
        },
        { pg, anonymous_id: anonId, session_id: sessionId, user_id: null },
      );

      expect(result.deduped).toBe(false);
      expect(result.event_id).toMatch(/^[0-9a-f-]{36}$/);

      const row = await pg.query(
        `SELECT anonymous_id, user_id, session_id, event_type, occurred_at, payload, client_event_id
         FROM events WHERE id = $1`,
        [result.event_id],
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0].anonymous_id).toBe(anonId);
      expect(row.rows[0].user_id).toBeNull();
      expect(row.rows[0].session_id).toBe(sessionId);
      expect(row.rows[0].event_type).toBe("product_view");
      expect(row.rows[0].payload).toEqual({ product_id: product.id, source: "home" });
      expect(row.rows[0].client_event_id).toBeNull();
    });
  });

  test("attaches user_id when ctx provides one", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      const anonId = await createAnonymousSession(pg);
      const result = await insertEvent(
        {
          event_type: "page_view",
          occurred_at: new Date().toISOString(),
          payload: { path: "/" },
        },
        { pg, anonymous_id: anonId, session_id: randomUUID(), user_id: user.id },
      );
      const row = await pg.query(`SELECT user_id FROM events WHERE id = $1`, [result.event_id]);
      expect(row.rows[0].user_id).toBe(user.id);
    });
  });

  test("idempotency: same client_event_id twice → 1 row, second result.deduped=true", async () => {
    await withTestDb(async (pg) => {
      const anonId = await createAnonymousSession(pg);
      const sessionId = randomUUID();
      const ceid = randomUUID();
      const input = {
        client_event_id: ceid,
        event_type: "page_view" as const,
        occurred_at: new Date().toISOString(),
        payload: { path: "/" },
      };
      const ctx = { pg, anonymous_id: anonId, session_id: sessionId, user_id: null };
      const r1 = await insertEvent(input, ctx);
      const r2 = await insertEvent(input, ctx);
      expect(r1.deduped).toBe(false);
      expect(r2.deduped).toBe(true);
      expect(r2.event_id).toBeNull();
      const count = await pg.query(`SELECT count(*)::int FROM events WHERE client_event_id = $1`, [ceid]);
      expect(count.rows[0].count).toBe(1);
    });
  });

  test("rejects payload that does not match the event_type schema", async () => {
    await withTestDb(async (pg) => {
      const anonId = await createAnonymousSession(pg);
      await expect(
        insertEvent(
          {
            event_type: "product_view",
            occurred_at: new Date().toISOString(),
            payload: { /* missing product_id and source */ },
          },
          { pg, anonymous_id: anonId, session_id: randomUUID(), user_id: null },
        ),
      ).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 3: Run test (expect FAIL — insertEvent not implemented)**

Run: `pnpm vitest run tests/integration/insert-event.test.ts`

Expected: FAIL with `Cannot find module '@/sectors/a-tracking/events/insert'`.

- [ ] **Step 4: Implement `insertEvent`**

Create `src/sectors/a-tracking/events/insert.ts`:

```ts
import type { Client } from "pg";
import { validatePayload, type EventInput, type EventType } from "./schema";

export interface InsertEventCtx {
  pg: Client;
  anonymous_id: string;
  session_id: string;
  user_id: string | null;
  source?: string | null;
}

export interface InsertEventResult {
  event_id: string | null;
  deduped: boolean;
}

export async function insertEvent(
  input: EventInput,
  ctx: InsertEventCtx,
): Promise<InsertEventResult> {
  // Validate payload against the schema for this event_type.
  const payload = validatePayload(input.event_type as EventType, input.payload);

  // Idempotent insert: ON CONFLICT (client_event_id) DO NOTHING — only effective when client_event_id is non-null.
  // Without client_event_id, inserts always succeed (duplicates allowed; that's a "best effort" event).
  const sql = `
    INSERT INTO events
      (client_event_id, anonymous_id, user_id, session_id, event_type, occurred_at, payload, source)
    VALUES
      ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb, $8)
    ON CONFLICT (client_event_id) WHERE client_event_id IS NOT NULL
    DO NOTHING
    RETURNING id
  `;
  const r = await ctx.pg.query(sql, [
    input.client_event_id ?? null,
    ctx.anonymous_id,
    ctx.user_id,
    ctx.session_id,
    input.event_type,
    input.occurred_at,
    JSON.stringify(payload),
    ctx.source ?? null,
  ]);
  if (r.rows.length === 0) {
    return { event_id: null, deduped: true };
  }
  return { event_id: r.rows[0].id, deduped: false };
}
```

- [ ] **Step 5: Run test (expect PASS)**

Run: `pnpm vitest run tests/integration/insert-event.test.ts`

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sectors/a-tracking/events/insert.ts tests/integration/insert-event.test.ts tests/helpers/seed.ts
git commit -m "feat(tracking): insertEvent with client_event_id idempotency + integration tests"
```

---

## Task 9: `ensureAnonymousId` middleware helper + integration tests

**Files:**
- Create: `src/sectors/a-tracking/identity.ts`
- Create: `tests/integration/identity.test.ts`

**Goal:** `ensureAnonymousId(req, res, pg)` reads the `anonymous_id` cookie if present, otherwise generates a new uuid, sets the cookie, upserts into `anonymous_sessions`, and returns the id.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/identity.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { ensureAnonymousId } from "@/sectors/a-tracking/identity";

beforeEach(async () => {
  await truncateTestTables(["anonymous_sessions", "events", "users"]);
});

function makeReq(cookies: Record<string, string> = {}, url = "http://localhost:3000/"): NextRequest {
  const headers = new Headers();
  const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (cookieStr) headers.set("cookie", cookieStr);
  return new NextRequest(url, { headers });
}

describe("ensureAnonymousId", () => {
  test("first visit: generates uuid + Set-Cookie + persists in anonymous_sessions", async () => {
    await withTestDb(async (pg) => {
      const req = makeReq();
      const res = NextResponse.next();

      const id = await ensureAnonymousId(req, res, pg);

      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      const setCookie = res.cookies.get("anonymous_id");
      expect(setCookie?.value).toBe(id);
      expect(setCookie?.httpOnly).toBeFalsy();   // cliente debe poder leerla
      expect(setCookie?.sameSite).toBe("lax");
      expect(setCookie?.secure).toBe(true);
      expect(setCookie?.maxAge).toBe(365 * 24 * 60 * 60);

      const row = await pg.query(`SELECT count(*)::int FROM anonymous_sessions WHERE anonymous_id = $1`, [id]);
      expect(row.rows[0].count).toBe(1);
    });
  });

  test("returning visit: existing cookie is preserved, last_seen_at advances", async () => {
    await withTestDb(async (pg) => {
      // Seed first visit
      const req1 = makeReq();
      const res1 = NextResponse.next();
      const id1 = await ensureAnonymousId(req1, res1, pg);
      const t1 = (await pg.query(`SELECT last_seen_at FROM anonymous_sessions WHERE anonymous_id=$1`, [id1])).rows[0].last_seen_at;

      await new Promise((r) => setTimeout(r, 30));

      // Second visit with cookie set
      const req2 = makeReq({ anonymous_id: id1 });
      const res2 = NextResponse.next();
      const id2 = await ensureAnonymousId(req2, res2, pg);
      expect(id2).toBe(id1);
      // No new Set-Cookie (cookie already valid)
      expect(res2.cookies.get("anonymous_id")).toBeUndefined();

      const t2 = (await pg.query(`SELECT last_seen_at FROM anonymous_sessions WHERE anonymous_id=$1`, [id1])).rows[0].last_seen_at;
      expect(new Date(t2).getTime()).toBeGreaterThan(new Date(t1).getTime());
    });
  });

  test("two distinct first visits produce two distinct uuids and two rows", async () => {
    await withTestDb(async (pg) => {
      const id1 = await ensureAnonymousId(makeReq(), NextResponse.next(), pg);
      const id2 = await ensureAnonymousId(makeReq(), NextResponse.next(), pg);
      expect(id1).not.toBe(id2);
      const r = await pg.query(`SELECT count(*)::int FROM anonymous_sessions`);
      expect(r.rows[0].count).toBe(2);
    });
  });

  test("malformed cookie value is replaced, not trusted", async () => {
    await withTestDb(async (pg) => {
      const req = makeReq({ anonymous_id: "not-a-uuid" });
      const res = NextResponse.next();
      const id = await ensureAnonymousId(req, res, pg);
      expect(id).not.toBe("not-a-uuid");
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      // Set-Cookie present (replacement issued)
      expect(res.cookies.get("anonymous_id")?.value).toBe(id);
    });
  });
});
```

- [ ] **Step 2: Run test (expect FAIL)**

Run: `pnpm vitest run tests/integration/identity.test.ts`

Expected: FAIL with `Cannot find module '@/sectors/a-tracking/identity'`.

- [ ] **Step 3: Implement `ensureAnonymousId`**

Create `src/sectors/a-tracking/identity.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import type { NextRequest, NextResponse } from "next/server";

const ANON_COOKIE = "anonymous_id";
const ANON_TTL_SECONDS = 365 * 24 * 60 * 60;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function ensureAnonymousId(
  req: NextRequest,
  res: NextResponse,
  pg: Client,
): Promise<string> {
  const existing = req.cookies.get(ANON_COOKIE)?.value;
  let id: string;
  let issuedNew = false;

  if (existing && UUID_REGEX.test(existing)) {
    id = existing;
  } else {
    id = randomUUID();
    issuedNew = true;
  }

  if (issuedNew) {
    res.cookies.set(ANON_COOKIE, id, {
      httpOnly: false,                     // client must be able to read for cart-scoping
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: ANON_TTL_SECONDS,
    });
  }

  // Upsert anonymous_session row (touches last_seen_at on every request).
  await pg.query(
    `INSERT INTO anonymous_sessions (anonymous_id, last_seen_at)
     VALUES ($1, now())
     ON CONFLICT (anonymous_id) DO UPDATE SET last_seen_at = now()`,
    [id],
  );

  return id;
}
```

- [ ] **Step 4: Run test (expect PASS)**

Run: `pnpm vitest run tests/integration/identity.test.ts`

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sectors/a-tracking/identity.ts tests/integration/identity.test.ts
git commit -m "feat(tracking): ensureAnonymousId middleware helper + integration tests"
```

---

## Task 10: `ensureSession` with sliding 30-min window + integration tests

**Files:**
- Modify: `src/sectors/a-tracking/identity.ts`
- Modify: `tests/integration/identity.test.ts` (add `describe("ensureSession", ...)`)

**Goal:** `ensureSession(req, res, pg, ctx)` returns the current session_id, generating a new one if absent or expired (>30 min since last activity). Emits `session_start` and `session_end` events on transitions. Sliding window: every call refreshes `last_activity` cookie.

- [ ] **Step 1: Add the failing tests**

Append to `tests/integration/identity.test.ts`:

```ts
import { ensureSession } from "@/sectors/a-tracking/identity";

describe("ensureSession", () => {
  test("first call generates session_id and emits session_start event", async () => {
    await withTestDb(async (pg) => {
      const req = makeReq();
      const res = NextResponse.next();
      const anonId = await ensureAnonymousId(req, res, pg);

      const sessionId = await ensureSession(req, res, pg, { anonymous_id: anonId, user_id: null });

      expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
      const cookie = res.cookies.get("session_id");
      expect(cookie?.value).toBe(sessionId);
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.maxAge).toBe(30 * 60);

      const events = await pg.query(
        `SELECT event_type, payload FROM events WHERE anonymous_id = $1 ORDER BY occurred_at`,
        [anonId],
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0].event_type).toBe("session_start");
      expect(events.rows[0].payload).toEqual({});
    });
  });

  test("returning within 30 min: same session_id, no new session_start", async () => {
    await withTestDb(async (pg) => {
      const req1 = makeReq();
      const res1 = NextResponse.next();
      const anonId = await ensureAnonymousId(req1, res1, pg);
      const sid = await ensureSession(req1, res1, pg, { anonymous_id: anonId, user_id: null });

      // Recent visit with both cookies set, last_activity = now
      const now = Math.floor(Date.now() / 1000);
      const req2 = makeReq({
        anonymous_id: anonId,
        session_id: sid,
        session_last_activity: String(now),
      });
      const res2 = NextResponse.next();
      const sid2 = await ensureSession(req2, res2, pg, { anonymous_id: anonId, user_id: null });
      expect(sid2).toBe(sid);

      const events = await pg.query(
        `SELECT count(*)::int AS c FROM events WHERE anonymous_id=$1 AND event_type='session_start'`,
        [anonId],
      );
      expect(events.rows[0].c).toBe(1);
    });
  });

  test("expired (>30 min idle): emits session_end for old + session_start for new + new session_id", async () => {
    await withTestDb(async (pg) => {
      const req1 = makeReq();
      const res1 = NextResponse.next();
      const anonId = await ensureAnonymousId(req1, res1, pg);
      const oldSid = await ensureSession(req1, res1, pg, { anonymous_id: anonId, user_id: null });

      // Simulate 31 min ago last_activity
      const stale = Math.floor(Date.now() / 1000) - 31 * 60;
      const req2 = makeReq({
        anonymous_id: anonId,
        session_id: oldSid,
        session_last_activity: String(stale),
      });
      const res2 = NextResponse.next();
      const newSid = await ensureSession(req2, res2, pg, { anonymous_id: anonId, user_id: null });
      expect(newSid).not.toBe(oldSid);

      const events = await pg.query(
        `SELECT event_type, session_id FROM events WHERE anonymous_id=$1 ORDER BY occurred_at`,
        [anonId],
      );
      expect(events.rows.map((r) => r.event_type)).toEqual(["session_start", "session_end", "session_start"]);
      // Old session_end carries the OLD session_id; new session_start carries the NEW one.
      expect(events.rows[1].session_id).toBe(oldSid);
      expect(events.rows[2].session_id).toBe(newSid);
    });
  });

  test("each call refreshes session_last_activity cookie (sliding window)", async () => {
    await withTestDb(async (pg) => {
      const req1 = makeReq();
      const res1 = NextResponse.next();
      const anonId = await ensureAnonymousId(req1, res1, pg);
      await ensureSession(req1, res1, pg, { anonymous_id: anonId, user_id: null });

      const cookie = res1.cookies.get("session_last_activity");
      expect(cookie).toBeDefined();
      expect(Number(cookie!.value)).toBeGreaterThan(Math.floor(Date.now() / 1000) - 5);
      expect(cookie!.maxAge).toBe(30 * 60);
    });
  });
});
```

- [ ] **Step 2: Run test (expect FAIL — function not exported)**

Run: `pnpm vitest run tests/integration/identity.test.ts -t "ensureSession"`

Expected: FAIL — `ensureSession is not a function` or import error.

- [ ] **Step 3: Implement `ensureSession`**

Append to `src/sectors/a-tracking/identity.ts`:

```ts
import { insertEvent } from "./events/insert";

const SESSION_COOKIE = "session_id";
const SESSION_LAST_ACTIVITY_COOKIE = "session_last_activity";
const SESSION_TIMEOUT_SECONDS = 30 * 60;

export interface SessionCtx {
  anonymous_id: string;
  user_id: string | null;
}

export async function ensureSession(
  req: NextRequest,
  res: NextResponse,
  pg: Client,
  ctx: SessionCtx,
): Promise<string> {
  const existingSid = req.cookies.get(SESSION_COOKIE)?.value;
  const lastActivityRaw = req.cookies.get(SESSION_LAST_ACTIVITY_COOKIE)?.value;
  const lastActivity = lastActivityRaw ? Number(lastActivityRaw) : 0;
  const nowSec = Math.floor(Date.now() / 1000);

  let sid: string;
  let issueNew = false;
  let expiredOld: { sid: string; lastActivity: number } | null = null;

  if (
    existingSid &&
    UUID_REGEX.test(existingSid) &&
    Number.isFinite(lastActivity) &&
    nowSec - lastActivity <= SESSION_TIMEOUT_SECONDS
  ) {
    sid = existingSid;
  } else {
    if (existingSid && UUID_REGEX.test(existingSid) && Number.isFinite(lastActivity) && lastActivity > 0) {
      expiredOld = { sid: existingSid, lastActivity };
    }
    sid = randomUUID();
    issueNew = true;
  }

  if (expiredOld) {
    const durationMs = (nowSec - expiredOld.lastActivity) * 1000;
    // session_end uses the OLD session_id; occurred_at = just before "now" so order is preserved.
    await insertEvent(
      {
        event_type: "session_end",
        occurred_at: new Date(Date.now() - 1).toISOString(),
        payload: { duration_ms: durationMs },
      },
      { pg, anonymous_id: ctx.anonymous_id, session_id: expiredOld.sid, user_id: ctx.user_id },
    );
  }

  if (issueNew) {
    res.cookies.set(SESSION_COOKIE, sid, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TIMEOUT_SECONDS,
    });
    await insertEvent(
      {
        event_type: "session_start",
        occurred_at: new Date().toISOString(),
        payload: {},
      },
      { pg, anonymous_id: ctx.anonymous_id, session_id: sid, user_id: ctx.user_id },
    );
  }

  // Sliding window: always refresh last_activity.
  res.cookies.set(SESSION_LAST_ACTIVITY_COOKIE, String(nowSec), {
    httpOnly: false,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TIMEOUT_SECONDS,
  });

  return sid;
}
```

- [ ] **Step 4: Run test (expect PASS)**

Run: `pnpm vitest run tests/integration/identity.test.ts`

Expected: all tests in file PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sectors/a-tracking/identity.ts tests/integration/identity.test.ts
git commit -m "feat(tracking): ensureSession with 30min sliding window + start/end events"
```

---

## Task 11: Wire identity middleware into `src/middleware.ts`

**Files:**
- Modify: `src/middleware.ts`

**Goal:** Make every non-asset request flow through `ensureAnonymousId` and `ensureSession` before Auth0.

- [ ] **Step 1: Read existing middleware**

Run: `cat src/middleware.ts`

You should see only `auth0.middleware(req)` and the matcher.

- [ ] **Step 2: Replace with the wired version**

Replace `src/middleware.ts` content with:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { auth0 } from "@/lib/auth";
import { ensureAnonymousId, ensureSession } from "@/sectors/a-tracking/identity";
import { getPgClient } from "@/lib/db/pg";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Identity layer: cookies + DB upserts on every request.
  const pg = await getPgClient({ scope: "public" });
  try {
    const anonymousId = await ensureAnonymousId(req, res, pg);
    // user_id is unknown at middleware time (Auth0 has not parsed yet) — pass null.
    // Identity merge happens later in /api/identity/merge.
    await ensureSession(req, res, pg, { anonymous_id: anonymousId, user_id: null });
  } finally {
    await pg.end();
  }

  // Auth0 wraps on top — attaches session if cookie present, doesn't enforce.
  const authRes = await auth0.middleware(req);
  // Merge cookies: copy any Set-Cookie from authRes onto our res.
  authRes.cookies.getAll().forEach((c) => res.cookies.set(c.name, c.value, c));
  // Preserve auth0 redirect (e.g. /auth/callback) if it set a status.
  if (authRes.status >= 300 && authRes.status < 400) {
    return authRes;
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/cron).*)"],
};
```

- [ ] **Step 3: Smoke-test the dev server**

Run:
```bash
pnpm dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
sleep 6
curl -s -i http://localhost:3000/ -c /tmp/cookies.txt | head -20
echo "--- cookies ---"
cat /tmp/cookies.txt
kill $DEV_PID 2>/dev/null
```

Expected: `Set-Cookie: anonymous_id=<uuid>; ...` and `Set-Cookie: session_id=<uuid>; ...` and `Set-Cookie: session_last_activity=<unix-ts>; ...` in the response headers.

- [ ] **Step 4: Verify DB rows**

Run:
```bash
pnpm tsx -e "
import { getPgClient } from '@/lib/db/pg';
const pg = await getPgClient();
const a = await pg.query('SELECT count(*)::int FROM anonymous_sessions');
const e = await pg.query('SELECT count(*)::int, event_type FROM events GROUP BY event_type');
console.log('anonymous_sessions:', a.rows[0].count);
console.log('events by type:', e.rows);
await pg.end();
"
```

Expected: `anonymous_sessions: >= 1`, events show at least one `session_start`.

- [ ] **Step 5: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(tracking): wire identity + session middleware ahead of auth0"
```

---

## Task 12: `POST /api/track` route + integration tests

**Files:**
- Create: `src/app/api/track/route.ts`
- Create: `tests/integration/track-endpoint.test.ts`

**Goal:** Server endpoint accepts well-formed events, persists them, dedupes by `client_event_id`, and rejects malformed payloads with 400.

- [ ] **Step 1: Write failing tests**

Create `tests/integration/track-endpoint.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { createAnonymousSession, seedProduct } from "@/../tests/helpers/seed";
import { POST } from "@/app/api/track/route";

beforeEach(async () => {
  await truncateTestTables(["events", "anonymous_sessions", "users", "products"]);
});

function makePostReq(body: unknown, cookies: Record<string, string> = {}): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (cookieStr) headers.set("cookie", cookieStr);
  return new NextRequest("http://localhost:3000/api/track", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/track", () => {
  test("happy path: persists product_view event with cookies as identity source", async () => {
    await withTestDb(async (pg) => {
      const product = await seedProduct(pg);
      const anonId = await createAnonymousSession(pg);
      const sessionId = randomUUID();
      const req = makePostReq(
        {
          event_type: "product_view",
          occurred_at: new Date().toISOString(),
          payload: { product_id: product.id, source: "home" },
        },
        { anonymous_id: anonId, session_id: sessionId },
      );

      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.event_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.deduped).toBe(false);

      const row = await pg.query(`SELECT * FROM events WHERE id=$1`, [body.event_id]);
      expect(row.rows[0].anonymous_id).toBe(anonId);
      expect(row.rows[0].session_id).toBe(sessionId);
      expect(row.rows[0].user_id).toBeNull();
    });
  });

  test("missing anonymous_id cookie → 400 no_identity", async () => {
    const req = makePostReq({
      event_type: "page_view",
      occurred_at: new Date().toISOString(),
      payload: { path: "/" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "no_identity" });
  });

  test("missing session_id cookie → 400 no_identity", async () => {
    const req = makePostReq(
      { event_type: "page_view", occurred_at: new Date().toISOString(), payload: { path: "/" } },
      { anonymous_id: randomUUID() },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("malformed envelope (unknown event_type) → 400 invalid_input", async () => {
    const req = makePostReq(
      {
        event_type: "fake_type",
        occurred_at: new Date().toISOString(),
        payload: {},
      },
      { anonymous_id: randomUUID(), session_id: randomUUID() },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_input");
  });

  test("malformed payload (mismatched shape) → 400 invalid_payload", async () => {
    await withTestDb(async (pg) => {
      const anonId = await createAnonymousSession(pg);
      const req = makePostReq(
        {
          event_type: "product_view",
          occurred_at: new Date().toISOString(),
          payload: { source: "home" /* product_id missing */ },
        },
        { anonymous_id: anonId, session_id: randomUUID() },
      );
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_payload");
    });
  });

  test("idempotency: same client_event_id twice → 200 both, second deduped:true", async () => {
    await withTestDb(async (pg) => {
      const product = await seedProduct(pg);
      const anonId = await createAnonymousSession(pg);
      const ceid = randomUUID();
      const body = {
        client_event_id: ceid,
        event_type: "product_view" as const,
        occurred_at: new Date().toISOString(),
        payload: { product_id: product.id, source: "home" },
      };
      const cookies = { anonymous_id: anonId, session_id: randomUUID() };
      const r1 = await POST(makePostReq(body, cookies));
      const r2 = await POST(makePostReq(body, cookies));
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect((await r1.json()).deduped).toBe(false);
      expect((await r2.json()).deduped).toBe(true);
      const c = await pg.query(`SELECT count(*)::int FROM events WHERE client_event_id=$1`, [ceid]);
      expect(c.rows[0].count).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run tests (expect FAIL — route not implemented)**

Run: `pnpm vitest run tests/integration/track-endpoint.test.ts`

Expected: FAIL — `Cannot find module '@/app/api/track/route'`.

- [ ] **Step 3: Implement the route**

Create `src/app/api/track/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { eventInputSchema } from "@/sectors/a-tracking/events/schema";
import { insertEvent } from "@/sectors/a-tracking/events/insert";
import { withPg } from "@/lib/db/helpers";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const anonymous_id = req.cookies.get("anonymous_id")?.value;
  const session_id = req.cookies.get("session_id")?.value;
  if (!anonymous_id || !UUID_REGEX.test(anonymous_id) || !session_id || !UUID_REGEX.test(session_id)) {
    return NextResponse.json({ error: "no_identity" }, { status: 400 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_input", detail: "body is not valid JSON" }, { status: 400 });
  }

  let envelope;
  try {
    envelope = eventInputSchema.parse(parsedBody);
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "invalid_input", detail: e.issues }, { status: 400 });
    }
    throw e;
  }

  // user_id resolution from Auth0 deferred to Task 14 — Phase 1 starting state: always null.
  // (When Task 14 lands, replace with: const session = await auth0.getSession(req); const user_id = session ? await getOrCreateUserByAuth0Sub(session.user.sub, session.user.email) : null;)
  const user_id: string | null = null;

  try {
    const result = await withPg((pg) =>
      insertEvent(envelope, { pg, anonymous_id, session_id, user_id }),
    );
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "invalid_payload", detail: e.issues }, { status: 400 });
    }
    throw e;
  }
}
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `pnpm vitest run tests/integration/track-endpoint.test.ts`

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/track/route.ts tests/integration/track-endpoint.test.ts
git commit -m "feat(track): POST /api/track endpoint + integration tests (6 cases)"
```

---

## Task 13: `mergeIdentities` + integration tests

**Files:**
- Create: `src/sectors/a-tracking/events/merge.ts`
- Create: `tests/integration/identity-merge.test.ts`

**Goal:** `mergeIdentities(anonymousId, userId, pg)` updates `anonymous_sessions.user_id` and `events.user_id` for that anon, only where `user_id IS NULL`. Idempotent; never overwrites events of other users.

- [ ] **Step 1: Write failing tests**

Create `tests/integration/identity-merge.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { createUser, createAnonymousSession, seedProduct } from "@/../tests/helpers/seed";
import { insertEvent } from "@/sectors/a-tracking/events/insert";
import { mergeIdentities } from "@/sectors/a-tracking/events/merge";

beforeEach(async () => {
  await truncateTestTables(["events", "anonymous_sessions", "users", "products"]);
});

describe("mergeIdentities", () => {
  test("associates all anonymous events to user_id and updates anonymous_sessions", async () => {
    await withTestDb(async (pg) => {
      const product = await seedProduct(pg);
      const anonId = await createAnonymousSession(pg);
      const sessionId = randomUUID();

      const events = [
        { event_type: "product_view" as const, payload: { product_id: product.id, source: "home" } },
        { event_type: "add_to_cart" as const, payload: { product_id: product.id, quantity: 1 } },
        { event_type: "page_view" as const, payload: { path: "/" } },
      ];
      for (const e of events) {
        await insertEvent(
          { ...e, occurred_at: new Date().toISOString() },
          { pg, anonymous_id: anonId, session_id: sessionId, user_id: null },
        );
      }

      const user = await createUser(pg);
      const result = await mergeIdentities(anonId, user.id, pg);
      expect(result.events_merged).toBe(3);

      const after = await pg.query(`SELECT user_id FROM events WHERE anonymous_id = $1`, [anonId]);
      expect(after.rows).toHaveLength(3);
      expect(after.rows.every((r: { user_id: string }) => r.user_id === user.id)).toBe(true);

      const sess = await pg.query(`SELECT user_id FROM anonymous_sessions WHERE anonymous_id = $1`, [anonId]);
      expect(sess.rows[0].user_id).toBe(user.id);
    });
  });

  test("idempotent: second call merges 0 additional events", async () => {
    await withTestDb(async (pg) => {
      const product = await seedProduct(pg);
      const anonId = await createAnonymousSession(pg);
      const sessionId = randomUUID();
      await insertEvent(
        { event_type: "product_view", occurred_at: new Date().toISOString(), payload: { product_id: product.id, source: "home" } },
        { pg, anonymous_id: anonId, session_id: sessionId, user_id: null },
      );
      const user = await createUser(pg);
      const r1 = await mergeIdentities(anonId, user.id, pg);
      const r2 = await mergeIdentities(anonId, user.id, pg);
      expect(r1.events_merged).toBe(1);
      expect(r2.events_merged).toBe(0);
    });
  });

  test("does NOT overwrite events of a DIFFERENT user (caches the WHERE user_id IS NULL guard)", async () => {
    await withTestDb(async (pg) => {
      const product = await seedProduct(pg);
      const userA = await createUser(pg, { email: "a@x.com" });
      const userB = await createUser(pg, { email: "b@x.com" });

      // Anon "1" with events that we'll associate to userA
      const anon1 = await createAnonymousSession(pg);
      await insertEvent(
        { event_type: "page_view", occurred_at: new Date().toISOString(), payload: { path: "/anon1" } },
        { pg, anonymous_id: anon1, session_id: randomUUID(), user_id: null },
      );
      await mergeIdentities(anon1, userA.id, pg);

      // Anon "2" with events that we'll associate to userB
      const anon2 = await createAnonymousSession(pg);
      await insertEvent(
        { event_type: "page_view", occurred_at: new Date().toISOString(), payload: { path: "/anon2" } },
        { pg, anonymous_id: anon2, session_id: randomUUID(), user_id: null },
      );
      await mergeIdentities(anon2, userB.id, pg);

      // Now imagine an attacker triggers mergeIdentities(anon1, userB) — should NOT touch
      // events of anon1 (already user_id=A, WHERE user_id IS NULL filters them out).
      const r = await mergeIdentities(anon1, userB.id, pg);
      expect(r.events_merged).toBe(0);

      const ev = await pg.query(`SELECT anonymous_id, user_id FROM events ORDER BY anonymous_id`);
      const byAnon = Object.fromEntries(ev.rows.map((r: { anonymous_id: string; user_id: string }) => [r.anonymous_id, r.user_id]));
      expect(byAnon[anon1]).toBe(userA.id);
      expect(byAnon[anon2]).toBe(userB.id);
    });
  });
});
```

- [ ] **Step 2: Run tests (expect FAIL)**

Run: `pnpm vitest run tests/integration/identity-merge.test.ts`

Expected: FAIL — `Cannot find module '@/sectors/a-tracking/events/merge'`.

- [ ] **Step 3: Implement `mergeIdentities`**

Create `src/sectors/a-tracking/events/merge.ts`:

```ts
import type { Client } from "pg";

export interface MergeResult {
  events_merged: number;
}

export async function mergeIdentities(
  anonymousId: string,
  userId: string,
  pg: Client,
): Promise<MergeResult> {
  await pg.query("BEGIN");
  try {
    await pg.query(
      `UPDATE anonymous_sessions SET user_id = $2
       WHERE anonymous_id = $1 AND user_id IS NULL`,
      [anonymousId, userId],
    );
    const r = await pg.query(
      `UPDATE events SET user_id = $2
       WHERE anonymous_id = $1 AND user_id IS NULL
       RETURNING id`,
      [anonymousId, userId],
    );
    await pg.query("COMMIT");
    return { events_merged: r.rowCount ?? 0 };
  } catch (e) {
    await pg.query("ROLLBACK");
    throw e;
  }
}
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `pnpm vitest run tests/integration/identity-merge.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sectors/a-tracking/events/merge.ts tests/integration/identity-merge.test.ts
git commit -m "feat(tracking): mergeIdentities with WHERE user_id IS NULL guard + tests"
```

---

## Task 14: `POST /api/identity/merge` route + auth helper + tests

**Files:**
- Modify: `src/lib/auth/index.ts` (add `getOrCreateUserByAuth0Sub`)
- Create: `src/app/api/identity/merge/route.ts`
- Create: `tests/integration/identity-merge-route.test.ts`
- Modify: `src/app/api/track/route.ts` (replace placeholder `user_id = null` with real Auth0 lookup)

**Goal:** Route for client to call post-login. Server reads Auth0 session, finds-or-creates a `users` row, and calls `mergeIdentities`.

- [ ] **Step 1: Add auth helper**

Append to `src/lib/auth/index.ts`:

```ts
import type { Client } from "pg";

/**
 * Looks up or creates a `users` row by `auth0_sub`. Returns the user id.
 * Idempotent: running twice with the same sub returns the same id.
 */
export async function getOrCreateUserByAuth0Sub(
  pg: Client,
  auth0Sub: string,
  email: string,
  name: string | null = null,
): Promise<{ id: string }> {
  const r = await pg.query(
    `INSERT INTO users (auth0_sub, email, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (auth0_sub) DO UPDATE SET email = EXCLUDED.email, name = COALESCE(EXCLUDED.name, users.name)
     RETURNING id`,
    [auth0Sub, email, name],
  );
  return { id: r.rows[0].id };
}
```

- [ ] **Step 2: Update `POST /api/track` to use Auth0 session**

Edit `src/app/api/track/route.ts`. Replace:

```ts
  // user_id resolution from Auth0 deferred to Task 14 — Phase 1 starting state: always null.
  // (When Task 14 lands, replace with: const session = await auth0.getSession(req); const user_id = session ? await getOrCreateUserByAuth0Sub(session.user.sub, session.user.email) : null;)
  const user_id: string | null = null;
```

with:

```ts
  // Resolve user_id from Auth0 session if logged in.
  let user_id: string | null = null;
  const auth0Session = await auth0.getSession(req).catch(() => null);
  if (auth0Session?.user?.sub) {
    const sub = auth0Session.user.sub as string;
    const email = (auth0Session.user.email as string) ?? `${sub}@noemail.local`;
    user_id = await withPg(async (pg) => (await getOrCreateUserByAuth0Sub(pg, sub, email, auth0Session.user.name as string | null)).id);
  }
```

Also add the imports at the top of the file:

```ts
import { auth0 } from "@/lib/auth";
import { getOrCreateUserByAuth0Sub } from "@/lib/auth";
```

(Combine into one line: `import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";`.)

- [ ] **Step 3: Write the failing test for the merge route**

Create `tests/integration/identity-merge-route.test.ts`:

```ts
import { describe, test, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { createAnonymousSession, seedProduct } from "@/../tests/helpers/seed";
import { insertEvent } from "@/sectors/a-tracking/events/insert";
import { POST } from "@/app/api/identity/merge/route";

beforeEach(async () => {
  await truncateTestTables(["events", "anonymous_sessions", "users", "products"]);
});

function makeReq(cookies: Record<string, string> = {}): NextRequest {
  const headers = new Headers();
  const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (cookieStr) headers.set("cookie", cookieStr);
  return new NextRequest("http://localhost:3000/api/identity/merge", {
    method: "POST",
    headers,
  });
}

// We use vitest's spy on the auth0 module's getSession via vi.mock — but auth0 module is BANNED.
// Instead: rely on the fact that route uses auth0.getSession; we cover the "no auth" path here
// (returns 401), and the "logged-in" path is covered indirectly by E2E (Task 30).
describe("POST /api/identity/merge — no Auth0 session", () => {
  test("no session cookie → 401", async () => {
    const res = await POST(makeReq({ anonymous_id: randomUUID() }));
    expect(res.status).toBe(401);
  });

  test("missing anonymous_id cookie → 400", async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
  });
});
```

(The "logged-in path" test belongs in E2E — Task 30 — because Auth0 is real and we never mock it.)

- [ ] **Step 4: Run test (expect FAIL — route not implemented)**

Run: `pnpm vitest run tests/integration/identity-merge-route.test.ts`

Expected: FAIL with module not found.

- [ ] **Step 5: Implement the route**

Create `src/app/api/identity/merge/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { mergeIdentities } from "@/sectors/a-tracking/events/merge";
import { withPg } from "@/lib/db/helpers";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const anonymous_id = req.cookies.get("anonymous_id")?.value;
  if (!anonymous_id || !UUID_REGEX.test(anonymous_id)) {
    return NextResponse.json({ error: "no_anonymous_id" }, { status: 400 });
  }

  const session = await auth0.getSession(req).catch(() => null);
  if (!session?.user?.sub) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const sub = session.user.sub as string;
  const email = (session.user.email as string) ?? `${sub}@noemail.local`;
  const name = (session.user.name as string | null) ?? null;

  const result = await withPg(async (pg) => {
    const user = await getOrCreateUserByAuth0Sub(pg, sub, email, name);
    const merge = await mergeIdentities(anonymous_id, user.id, pg);
    return { user_id: user.id, ...merge };
  });

  return NextResponse.json(result, { status: 200 });
}
```

- [ ] **Step 6: Run tests (expect PASS for the 2 cases)**

Run: `pnpm vitest run tests/integration/identity-merge-route.test.ts`

Expected: 2 tests PASS.

- [ ] **Step 7: Run all integration tests so we know we didn't break /api/track**

Run: `pnpm vitest run tests/integration/track-endpoint.test.ts`

Expected: 6 tests still PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth/index.ts src/app/api/identity/merge/route.ts src/app/api/track/route.ts tests/integration/identity-merge-route.test.ts
git commit -m "feat(track,auth): /api/identity/merge route + getOrCreateUserByAuth0Sub helper"
```

---

## Task 15: `buildCanonicalText` + unit tests

**Files:**
- Create: `src/sectors/b-catalog/enrichment/canonical.ts`
- Create: `tests/unit/canonical-text.test.ts`

**Goal:** Pure function building the canonical text used for embedding. Includes title + description + category/subcategory + keywords. Tested for deterministic structure and for the "description-omission" mutation regression.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/canonical-text.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { buildCanonicalText } from "@/sectors/b-catalog/enrichment/canonical";

const baseProduct = {
  id: "x",
  source: "amazon" as const,
  source_product_id: "1",
  title: "Auriculares inalámbricos",
  description: "Cancelación de ruido activa, batería 30h",
  image_url: "u",
  price_cents: 1000,
  brand: "B",
  raw_category: "electronica",
  attributes: {},
};

const baseMetadata = {
  category: "electronica" as const,
  subcategory: "audifonos",
  gender_target: null,
  age_target: { min: null, max: null },
  occasion: [],
  style: [],
  keywords: ["bluetooth", "ruido"],
  enrichment_status: "ok" as const,
  prompt_version: "v1.0.0-fase1",
};

describe("buildCanonicalText", () => {
  test("includes title, description, category+subcategory, and keywords joined", () => {
    const text = buildCanonicalText(baseProduct, baseMetadata);
    expect(text).toContain("Auriculares inalámbricos");
    expect(text).toContain("Cancelación de ruido activa, batería 30h");
    expect(text).toContain("electronica audifonos");
    expect(text).toContain("bluetooth");
    expect(text).toContain("ruido");
  });

  test("two products with same title but different descriptions produce different canonical texts", () => {
    const a = buildCanonicalText(
      { ...baseProduct, description: "Cancelación de ruido activa" },
      baseMetadata,
    );
    const b = buildCanonicalText(
      { ...baseProduct, description: "Sin cancelación de ruido" },
      baseMetadata,
    );
    expect(a).not.toBe(b);
  });

  test("missing subcategory: only category appears", () => {
    const text = buildCanonicalText(baseProduct, { ...baseMetadata, subcategory: null });
    expect(text).toContain("electronica");
    expect(text).not.toMatch(/electronica\s+null/);
  });
});
```

- [ ] **Step 2: Run test (expect FAIL)**

Run: `pnpm vitest run tests/unit/canonical-text.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/sectors/b-catalog/enrichment/canonical.ts`:

```ts
import type { MockProduct } from "@/sectors/b-catalog/mock/types";

export interface CanonicalMetadataShape {
  category: string;
  subcategory: string | null;
  keywords: string[];
}

export function buildCanonicalText(
  raw: MockProduct,
  metadata: CanonicalMetadataShape,
): string {
  const categoryLine = metadata.subcategory
    ? `${metadata.category} ${metadata.subcategory}`
    : metadata.category;
  const parts = [
    raw.title,
    raw.description,
    categoryLine,
    metadata.keywords.join(" "),
  ].filter((s) => s && s.trim().length > 0);
  return parts.join("\n");
}
```

- [ ] **Step 4: Run test (expect PASS)**

Run: `pnpm vitest run tests/unit/canonical-text.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sectors/b-catalog/enrichment/canonical.ts tests/unit/canonical-text.test.ts
git commit -m "feat(catalog): buildCanonicalText pure fn + 3 unit tests"
```

---

## Task 16: `normalizeWithLLM` + prompt versioned

**Files:**
- Create: `src/sectors/b-catalog/enrichment/prompt.ts`
- Create: `src/sectors/b-catalog/enrichment/normalizer.ts`

**Goal:** Wraps Anthropic Haiku with a versioned system prompt, parses the JSON response, validates against zod, returns metadata. On parse/validation failure: returns `enrichment_status='error'` so the pipeline can persist the product anyway.

- [ ] **Step 1: Implement the prompt + schema**

Create `src/sectors/b-catalog/enrichment/prompt.ts`:

```ts
import { z } from "zod";

export const PROMPT_VERSION = "v1.0.0-fase1";

export const SYSTEM_PROMPT = `Eres un normalizador de productos de e-commerce. Recibes un producto crudo (título, descripción, raw_category, marca y atributos) y devuelves JSON estructurado en español.

Campos obligatorios:
- category: una de [ropa, electronica, hogar, juguetes_bebe, belleza, otros]
- subcategory: string libre, específica (puede ser null si no se infiere)
- gender_target: 'femenino' | 'masculino' | 'unisex' | null
- age_target: { min: number|null, max: number|null }
- occasion: array de strings (ej: ['regalo','diario','formal'])
- style: array de strings (ej: ['casual','elegante'])
- keywords: array de hasta 8 keywords relevantes en español
- enrichment_status: siempre 'ok'

Si no puedes inferir un campo, usa null o array vacío. Devuelve SOLO el JSON, sin markdown ni texto adicional.`;

export const normalizedSchema = z.object({
  category: z.enum(["ropa", "electronica", "hogar", "juguetes_bebe", "belleza", "otros"]),
  subcategory: z.string().nullable(),
  gender_target: z.enum(["femenino", "masculino", "unisex"]).nullable(),
  age_target: z.object({
    min: z.number().int().nullable(),
    max: z.number().int().nullable(),
  }),
  occasion: z.array(z.string()),
  style: z.array(z.string()),
  keywords: z.array(z.string()).max(8),
  enrichment_status: z.literal("ok"),
});

export type NormalizedFromLLM = z.infer<typeof normalizedSchema>;
```

- [ ] **Step 2: Implement the normalizer**

Create `src/sectors/b-catalog/enrichment/normalizer.ts`:

```ts
import { sendMessage, MODELS } from "@/lib/llm/anthropic";
import type { MockProduct } from "@/sectors/b-catalog/mock/types";
import { PROMPT_VERSION, SYSTEM_PROMPT, normalizedSchema, type NormalizedFromLLM } from "./prompt";

export type EnrichmentStatus = "ok" | "error";

export interface NormalizedMetadata extends Omit<NormalizedFromLLM, "enrichment_status"> {
  enrichment_status: EnrichmentStatus;
  enrichment_error?: string;
  prompt_version: string;
}

export async function normalizeWithLLM(raw: MockProduct): Promise<NormalizedMetadata> {
  const userPayload = {
    title: raw.title,
    description: raw.description,
    raw_category: raw.raw_category,
    brand: raw.brand,
    attributes: raw.attributes,
  };

  let llmText = "";
  try {
    const res = await sendMessage({
      model: MODELS.haiku,
      system: SYSTEM_PROMPT,
      cacheSystem: true,
      messages: [{ role: "user", content: JSON.stringify(userPayload) }],
      maxTokens: 400,
      temperature: 0,
    });
    llmText = res.text;
    const parsed = JSON.parse(llmText);
    const valid = normalizedSchema.parse(parsed);
    return { ...valid, prompt_version: PROMPT_VERSION };
  } catch (e) {
    return {
      category: "otros",
      subcategory: raw.raw_category ?? null,
      gender_target: null,
      age_target: { min: null, max: null },
      occasion: [],
      style: [],
      keywords: [],
      enrichment_status: "error",
      enrichment_error: e instanceof Error ? e.message.slice(0, 200) : "unknown",
      prompt_version: PROMPT_VERSION,
    };
  }
}
```

- [ ] **Step 3: Quick smoke check (real LLM call)**

Run:
```bash
pnpm tsx -e "
import { fetchFromAggregator } from '@/sectors/b-catalog/mock/aggregator';
import { normalizeWithLLM } from '@/sectors/b-catalog/enrichment/normalizer';
const r = await fetchFromAggregator({ category: 'electronica' });
const m = await normalizeWithLLM(r.products[0]);
console.log(JSON.stringify(m, null, 2));
"
```

Expected: JSON with `category` ∈ enum, `enrichment_status: 'ok'`, `keywords` non-empty array.

- [ ] **Step 4: Commit**

```bash
git add src/sectors/b-catalog/enrichment/prompt.ts src/sectors/b-catalog/enrichment/normalizer.ts
git commit -m "feat(catalog): normalizeWithLLM + versioned system prompt + zod schema"
```

(Not adding a unit test for the normalizer because it's a thin wrapper over a real API; the contract is exercised end-to-end in Task 17's integration test.)

---

## Task 17: `processProduct` pipeline + integration tests + `pgvector` helper

**Files:**
- Create: `src/sectors/b-catalog/enrichment/pipeline.ts`
- Create: `tests/integration/enrichment-pipeline.test.ts`
- Create: `tests/helpers/pgvector.ts`

**Goal:** End-to-end: take a `MockProduct`, normalize via LLM, build canonical text, embed via Voyage, UPSERT into `products` with `metadata` JSONB and `embedding` vector. Verify dim, norm, dedupe, error tolerance.

- [ ] **Step 1: Create `pgvector` helper**

Create `tests/helpers/pgvector.ts`:

```ts
/**
 * Parses the text representation of a pgvector value, e.g. '[0.1,-0.2,...]'.
 * Returns null for null inputs.
 */
export function parsePgVector(input: unknown): number[] | null {
  if (input === null || input === undefined) return null;
  if (Array.isArray(input)) return input as number[];
  if (typeof input === "string") {
    return JSON.parse(input);
  }
  throw new Error(`Unexpected pgvector value type: ${typeof input}`);
}
```

- [ ] **Step 2: Write the failing integration test**

Create `tests/integration/enrichment-pipeline.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { fetchFromAggregator } from "@/sectors/b-catalog/mock/aggregator";
import { processProduct } from "@/sectors/b-catalog/enrichment/pipeline";
import { EMBEDDING_DIM } from "@/lib/embeddings/voyage";
import { parsePgVector } from "@/../tests/helpers/pgvector";

beforeEach(async () => {
  await truncateTestTables(["products"]);
});

const VALID_CATEGORIES = ["ropa", "electronica", "hogar", "juguetes_bebe", "belleza", "otros"];

describe("processProduct (REAL Anthropic + REAL Voyage + REAL Postgres)", () => {
  test("inserts a product with valid metadata, embedding norm=1, dim=1024", async () => {
    await withTestDb(async (pg) => {
      const r = await fetchFromAggregator({ category: "electronica" });
      const sample = r.products[0];

      const result = await processProduct(sample, pg);
      expect(result.inserted).toBe(true);
      expect(result.enrichmentStatus).toBe("ok");

      const stored = await pg.query(
        `SELECT metadata, embedding::text AS embedding_text FROM products WHERE id = $1`,
        [result.productId],
      );
      const md = stored.rows[0].metadata;
      expect(VALID_CATEGORIES).toContain(md.category);
      expect(Array.isArray(md.keywords)).toBe(true);
      expect(md.keywords.length).toBeGreaterThan(0);
      expect(md.keywords.length).toBeLessThanOrEqual(8);
      expect(md.prompt_version).toBe("v1.0.0-fase1");

      const emb = parsePgVector(stored.rows[0].embedding_text);
      expect(emb).not.toBeNull();
      expect(emb!.length).toBe(EMBEDDING_DIM);
      const norm = Math.sqrt(emb!.reduce((s, x) => s + x * x, 0));
      expect(Math.abs(norm - 1)).toBeLessThan(1e-5);
    });
  }, 30_000);

  test("dedupe: re-processing the same product updates last_refreshed_at, not row count", async () => {
    await withTestDb(async (pg) => {
      const r = await fetchFromAggregator({ category: "ropa" });
      const sample = r.products[0];

      const a = await processProduct(sample, pg);
      const t1 = (await pg.query(`SELECT last_refreshed_at FROM products WHERE id=$1`, [a.productId])).rows[0].last_refreshed_at;

      await new Promise((r) => setTimeout(r, 50));
      const b = await processProduct(sample, pg);
      expect(b.productId).toBe(a.productId);
      expect(b.inserted).toBe(false);

      const t2 = (await pg.query(`SELECT last_refreshed_at FROM products WHERE id=$1`, [a.productId])).rows[0].last_refreshed_at;
      expect(new Date(t2).getTime()).toBeGreaterThan(new Date(t1).getTime());

      const total = await pg.query(`SELECT count(*)::int FROM products`);
      expect(total.rows[0].count).toBe(1);
    });
  }, 60_000);

  test("two distinct products produce distinct embeddings (cosine < 0.99)", async () => {
    await withTestDb(async (pg) => {
      const r = await fetchFromAggregator({ category: "electronica" });
      // pick two non-equal products
      const a = r.products[0];
      const b = r.products.find((p) => p.source_product_id !== a.source_product_id)!;

      const ra = await processProduct(a, pg);
      const rb = await processProduct(b, pg);
      expect(ra.productId).not.toBe(rb.productId);

      const rows = await pg.query(
        `SELECT embedding::text AS e FROM products WHERE id = ANY($1)`,
        [[ra.productId, rb.productId]],
      );
      const [v1, v2] = rows.rows.map((r: { e: string }) => parsePgVector(r.e)!);
      const dot = v1.reduce((s, x, i) => s + x * v2[i], 0);
      // both unit norm → dot = cosine
      expect(dot).toBeLessThan(0.99);
    });
  }, 60_000);

  test("tsvector_es is auto-generated and non-empty", async () => {
    await withTestDb(async (pg) => {
      const r = await fetchFromAggregator({ category: "ropa" });
      const sample = r.products[0];
      const result = await processProduct(sample, pg);
      const row = await pg.query(
        `SELECT length(tsvector_es::text) AS ts_len FROM products WHERE id = $1`,
        [result.productId],
      );
      expect(row.rows[0].ts_len).toBeGreaterThan(0);
    });
  }, 30_000);
});
```

- [ ] **Step 3: Run test (expect FAIL — pipeline not implemented)**

Run: `pnpm vitest run tests/integration/enrichment-pipeline.test.ts`

Expected: FAIL — `Cannot find module '@/sectors/b-catalog/enrichment/pipeline'`.

- [ ] **Step 4: Implement the pipeline**

Create `src/sectors/b-catalog/enrichment/pipeline.ts`:

```ts
import type { Client } from "pg";
import type { MockProduct } from "@/sectors/b-catalog/mock/types";
import { embed } from "@/lib/embeddings/voyage";
import { normalizeWithLLM, type NormalizedMetadata } from "./normalizer";
import { buildCanonicalText } from "./canonical";

export interface ProcessResult {
  productId: string;
  inserted: boolean;
  enrichmentStatus: NormalizedMetadata["enrichment_status"];
}

export async function processProduct(
  raw: MockProduct,
  pg: Client,
): Promise<ProcessResult> {
  const metadata = await normalizeWithLLM(raw);
  const canonical = buildCanonicalText(raw, metadata);
  const [embedding] = await embed([canonical], { inputType: "document" });

  const r = await pg.query(
    `INSERT INTO products
      (source, source_product_id, title, description, price_cents, currency, image_url, raw_category, metadata, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::vector)
     ON CONFLICT (source, source_product_id) DO UPDATE SET
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       price_cents = EXCLUDED.price_cents,
       image_url = EXCLUDED.image_url,
       raw_category = EXCLUDED.raw_category,
       metadata = EXCLUDED.metadata,
       embedding = EXCLUDED.embedding,
       last_refreshed_at = now()
     RETURNING id, (xmax = 0) AS inserted`,
    [
      raw.source,
      raw.source_product_id,
      raw.title,
      raw.description,
      raw.price_cents,
      "USD",
      raw.image_url,
      raw.raw_category,
      JSON.stringify(metadata),
      `[${embedding.join(",")}]`,
    ],
  );

  return {
    productId: r.rows[0].id,
    inserted: r.rows[0].inserted,
    enrichmentStatus: metadata.enrichment_status,
  };
}
```

- [ ] **Step 5: Run test (expect PASS)**

Run: `pnpm vitest run tests/integration/enrichment-pipeline.test.ts`

Expected: 4 tests PASS. Each takes 5-10s (real APIs). Total ~30s.

- [ ] **Step 6: Commit**

```bash
git add src/sectors/b-catalog/enrichment/pipeline.ts tests/integration/enrichment-pipeline.test.ts tests/helpers/pgvector.ts
git commit -m "feat(catalog): processProduct pipeline (LLM + Voyage + UPSERT) + integration tests"
```

---

## Task 18: `runCatalogFill` + integration tests

**Files:**
- Create: `src/sectors/b-catalog/cron/catalog-fill.ts`
- Create: `tests/integration/cron-catalog-fill.test.ts`

**Goal:** Orchestrates: for each category × page, calls the mock, logs to `mock_calls`, then runs every product through `processProduct` with concurrency-3.

- [ ] **Step 1: Write failing tests**

Create `tests/integration/cron-catalog-fill.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { resetCallCount, getCallCount } from "@/sectors/b-catalog/mock/aggregator";
import { runCatalogFill } from "@/sectors/b-catalog/cron/catalog-fill";

beforeEach(async () => {
  await truncateTestTables(["products", "mock_calls"]);
  resetCallCount();
});

describe("runCatalogFill (REAL APIs)", () => {
  test("--pages 1 --categories ropa: 1 mock_calls row + up to 25 products + cost_cents=4", async () => {
    await withTestDb(async (pg) => {
      const r = await runCatalogFill({ categories: ["ropa"], pagesPerCategory: 1, concurrency: 3, pg });

      expect(r.totalCalls).toBe(1);
      // Mock can throw with 2% probability; if it errored, totalProducts=0 and was_error=true.
      if (r.errors.length === 0) {
        expect(r.totalProducts).toBe(25);
      } else {
        expect(r.totalProducts).toBe(0);
      }

      const calls = await pg.query(
        `SELECT simulated_cost_cents, response_size, was_error FROM mock_calls ORDER BY called_at`,
      );
      expect(calls.rows).toHaveLength(1);
      expect(calls.rows[0].simulated_cost_cents).toBe(4);
      const productCount = await pg.query(`SELECT count(*)::int FROM products`);
      expect(productCount.rows[0].count).toBe(r.totalProducts);
    });
  }, 120_000);

  test("re-running same category does not duplicate (UPSERT) — products count is bounded", async () => {
    await withTestDb(async (pg) => {
      const a = await runCatalogFill({ categories: ["ropa"], pagesPerCategory: 1, concurrency: 3, pg });
      const c1 = (await pg.query(`SELECT count(*)::int FROM products`)).rows[0].count;
      const b = await runCatalogFill({ categories: ["ropa"], pagesPerCategory: 1, concurrency: 3, pg });
      const c2 = (await pg.query(`SELECT count(*)::int FROM products`)).rows[0].count;

      // Both calls write to mock_calls (so 2 calls), but the mock samples WITH replacement from the same pool —
      // products may overlap and dedupe. c2 should be >= c1 but never grow by 25 if there are repeats.
      expect(c2).toBeGreaterThanOrEqual(c1);
      expect(c2).toBeLessThanOrEqual(50);

      const calls = await pg.query(`SELECT count(*)::int FROM mock_calls`);
      expect(calls.rows[0].count).toBe(2);

      // Both runs count toward totalCalls
      expect(a.totalCalls + b.totalCalls).toBe(2);
    });
  }, 240_000);
});
```

- [ ] **Step 2: Run test (expect FAIL)**

Run: `pnpm vitest run tests/integration/cron-catalog-fill.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `runCatalogFill`**

Create `src/sectors/b-catalog/cron/catalog-fill.ts`:

```ts
import type { Client } from "pg";
import { fetchFromAggregator } from "@/sectors/b-catalog/mock/aggregator";
import type { MockCategory } from "@/sectors/b-catalog/mock/types";
import { processProduct } from "@/sectors/b-catalog/enrichment/pipeline";

export interface RunResult {
  totalCalls: number;
  totalProducts: number;
  errors: { context: string; message: string }[];
}

export interface RunOptions {
  categories: MockCategory[];
  pagesPerCategory: number;
  concurrency?: number;
  pg: Client; // shared connection
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function runCatalogFill(opts: RunOptions): Promise<RunResult> {
  const concurrency = opts.concurrency ?? 3;
  const errors: RunResult["errors"] = [];
  let totalCalls = 0;
  let totalProducts = 0;

  for (const category of opts.categories) {
    for (let page = 1; page <= opts.pagesPerCategory; page++) {
      const t0 = Date.now();
      let result;
      try {
        result = await fetchFromAggregator({ category });
      } catch (e) {
        await opts.pg.query(
          `INSERT INTO mock_calls (params, response_size, simulated_cost_cents, latency_ms, was_error)
           VALUES ($1::jsonb, 0, 4, $2, true)`,
          [JSON.stringify({ category, page }), Date.now() - t0],
        );
        totalCalls++;
        errors.push({ context: `fetch ${category} page ${page}`, message: String(e) });
        continue;
      }

      await opts.pg.query(
        `INSERT INTO mock_calls (params, response_size, simulated_cost_cents, latency_ms, was_error)
         VALUES ($1::jsonb, $2, $3, $4, false)`,
        [
          JSON.stringify({ category, page }),
          result.products.length,
          result.cost_cents,
          Math.round(result.latency_ms),
        ],
      );
      totalCalls++;

      for (const batch of chunk(result.products, concurrency)) {
        const settled = await Promise.allSettled(batch.map((p) => processProduct(p, opts.pg)));
        settled.forEach((s, i) => {
          if (s.status === "fulfilled") totalProducts++;
          else errors.push({ context: `process ${batch[i].source_product_id}`, message: String(s.reason) });
        });
      }
    }
  }

  return { totalCalls, totalProducts, errors };
}
```

- [ ] **Step 4: Run test (expect PASS)**

Run: `pnpm vitest run tests/integration/cron-catalog-fill.test.ts`

Expected: 2 tests PASS. ~60-120s (25 products × 2-4s mock + LLM cache hits + Voyage). Token cost ~$0.06.

If the second test fails because the mock returned an error (2% chance), re-run.

- [ ] **Step 5: Commit**

```bash
git add src/sectors/b-catalog/cron/catalog-fill.ts tests/integration/cron-catalog-fill.test.ts
git commit -m "feat(catalog): runCatalogFill orchestrator + integration tests"
```

---

## Task 19: CLI `scripts/cron-catalog-fill.ts` + npm script

**Files:**
- Create: `scripts/cron-catalog-fill.ts`
- Modify: `package.json` (add `cron:catalog-fill` script)

**Goal:** Make `pnpm cron:catalog-fill --categories ropa --pages 1` work locally.

- [ ] **Step 1: Implement the CLI**

Create `scripts/cron-catalog-fill.ts`:

```ts
#!/usr/bin/env tsx
/**
 * CLI: pnpm cron:catalog-fill --categories ropa,electronica --pages 1 --concurrency 3
 */
import { parseArgs } from "node:util";
import { runCatalogFill } from "@/sectors/b-catalog/cron/catalog-fill";
import { withPg } from "@/lib/db/helpers";
import type { MockCategory } from "@/sectors/b-catalog/mock/types";

const ALL_CATEGORIES: MockCategory[] = ["ropa", "electronica", "hogar", "juguetes_bebe", "belleza", "otros"];

const { values } = parseArgs({
  options: {
    categories: { type: "string" },
    pages: { type: "string", default: "1" },
    concurrency: { type: "string", default: "3" },
  },
});

const requested = values.categories
  ? values.categories.split(",").map((s) => s.trim())
  : ALL_CATEGORIES;
const categories = requested.filter((c): c is MockCategory => ALL_CATEGORIES.includes(c as MockCategory));
if (categories.length !== requested.length) {
  console.error("Unknown category in:", requested);
  console.error("Allowed:", ALL_CATEGORIES.join(", "));
  process.exit(2);
}

const result = await withPg((pg) =>
  runCatalogFill({
    categories,
    pagesPerCategory: parseInt(values.pages!, 10),
    concurrency: parseInt(values.concurrency!, 10),
    pg,
  }),
);

console.log(JSON.stringify(result, null, 2));
process.exit(result.errors.length === 0 ? 0 : 1);
```

- [ ] **Step 2: Add the npm script**

Edit `package.json`. Inside `"scripts": { ... }` add:

```json
    "cron:catalog-fill": "tsx scripts/cron-catalog-fill.ts",
```

(Place it alphabetically after `"build"` for cleanliness.)

- [ ] **Step 3: Smoke run with 1 page of ropa**

Run: `pnpm cron:catalog-fill --categories ropa --pages 1`

Expected: JSON output with `totalCalls: 1`, `totalProducts: 25` (or 0 if mock error), `errors: []`.

- [ ] **Step 4: Verify products landed**

Run:
```bash
pnpm tsx -e "
import { getPgClient } from '@/lib/db/pg';
const pg = await getPgClient();
const r = await pg.query(\"SELECT count(*)::int FROM products WHERE source IN ('amazon','aliexpress','shein')\");
console.log('mock products:', r.rows[0].count);
await pg.end();
"
```

Expected: ≥ 25 (Phase 0 had 0 mock-sourced).

- [ ] **Step 5: Commit**

```bash
git add scripts/cron-catalog-fill.ts package.json
git commit -m "feat(cron): cron:catalog-fill CLI script + pnpm wiring"
```

---

## Task 20: Products repository + integration tests

**Files:**
- Create: `src/sectors/b-catalog/repository/products.ts`
- Create: `tests/integration/products-repo.test.ts`

**Goal:** Read-only access for the UI (home grid, detail, search).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/products-repo.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProduct } from "@/../tests/helpers/seed";
import { listByDate, getById, searchLike } from "@/sectors/b-catalog/repository/products";

beforeEach(async () => {
  await truncateTestTables(["products"]);
});

// helpers/seed uses the public schema (test_schema search_path) — listByDate etc. accept an optional pg param
// for tests so we can pin them to test_schema.

describe("products repository", () => {
  test("listByDate orders by created_at DESC", async () => {
    await withTestDb(async (pg) => {
      const a = await seedProduct(pg, { title: "First" });
      await new Promise((r) => setTimeout(r, 30));
      const b = await seedProduct(pg, { title: "Second" });
      await new Promise((r) => setTimeout(r, 30));
      const c = await seedProduct(pg, { title: "Third" });

      const rows = await listByDate({ limit: 10, pg });
      expect(rows.map((r) => r.id)).toEqual([c.id, b.id, a.id]);
    });
  });

  test("listByDate respects limit", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 5; i++) await seedProduct(pg, { title: `P${i}` });
      const rows = await listByDate({ limit: 2, pg });
      expect(rows).toHaveLength(2);
    });
  });

  test("getById returns the product or null", async () => {
    await withTestDb(async (pg) => {
      const a = await seedProduct(pg, { title: "Findable" });
      const found = await getById(a.id, pg);
      expect(found?.id).toBe(a.id);
      expect(found?.title).toBe("Findable");
      const missing = await getById("00000000-0000-0000-0000-000000000000", pg);
      expect(missing).toBeNull();
    });
  });

  test("searchLike matches title (ILIKE) — case-insensitive", async () => {
    await withTestDb(async (pg) => {
      const a = await seedProduct(pg, { title: "Auriculares Sony" });
      await seedProduct(pg, { title: "Camiseta de algodón" });
      const r = await searchLike({ query: "auriculares", pg });
      expect(r.map((p) => p.id)).toEqual([a.id]);
    });
  });

  test("searchLike matches description and returns empty array on no match", async () => {
    await withTestDb(async (pg) => {
      const a = await seedProduct(pg, { title: "Producto X", description: "tela impermeable" });
      const matched = await searchLike({ query: "impermeable", pg });
      expect(matched.map((p) => p.id)).toEqual([a.id]);
      const empty = await searchLike({ query: "no-existe-zzzz", pg });
      expect(empty).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run test (expect FAIL)**

Run: `pnpm vitest run tests/integration/products-repo.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the repo**

Create `src/sectors/b-catalog/repository/products.ts`:

```ts
import type { Client } from "pg";
import { withPg } from "@/lib/db/helpers";

export interface ProductListRow {
  id: string;
  title: string;
  description: string;
  price_cents: number;
  currency: string;
  image_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

async function exec<T>(pg: Client | undefined, fn: (pg: Client) => Promise<T>): Promise<T> {
  if (pg) return fn(pg);
  return withPg(fn);
}

export async function listByDate(opts: { limit?: number; offset?: number; pg?: Client } = {}): Promise<ProductListRow[]> {
  return exec(opts.pg, async (pg) => {
    const r = await pg.query(
      `SELECT id, title, description, price_cents, currency, image_url, metadata, created_at
       FROM products
       WHERE is_active = true
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [opts.limit ?? 20, opts.offset ?? 0],
    );
    return r.rows;
  });
}

export async function getById(id: string, pg?: Client): Promise<ProductListRow | null> {
  return exec(pg, async (pg) => {
    const r = await pg.query(
      `SELECT id, title, description, price_cents, currency, image_url, metadata, created_at
       FROM products
       WHERE id = $1 AND is_active = true`,
      [id],
    );
    return r.rows[0] ?? null;
  });
}

export async function searchLike(opts: { query: string; limit?: number; pg?: Client }): Promise<ProductListRow[]> {
  return exec(opts.pg, async (pg) => {
    const r = await pg.query(
      `SELECT id, title, description, price_cents, currency, image_url, metadata, created_at
       FROM products
       WHERE is_active = true
         AND (title ILIKE $1 OR description ILIKE $1)
       ORDER BY created_at DESC
       LIMIT $2`,
      [`%${opts.query}%`, opts.limit ?? 30],
    );
    return r.rows;
  });
}
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `pnpm vitest run tests/integration/products-repo.test.ts`

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sectors/b-catalog/repository/products.ts tests/integration/products-repo.test.ts
git commit -m "feat(catalog): products repository (listByDate, getById, searchLike) + tests"
```

---

## Task 21: Home page (server component grid)

**Files:**
- Create: `src/app/(shop)/layout.tsx` (just a thin wrapper for the shop group)
- Create: `src/app/(shop)/page.tsx`

**Goal:** Renders a grid of up to 20 products from `listByDate`. Empty state hints at `pnpm cron:catalog-fill`.

- [ ] **Step 1: Create the shop layout (currently a passthrough; will host CartProvider in Task 25)**

Create `src/app/(shop)/layout.tsx`:

```tsx
export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen">{children}</div>;
}
```

- [ ] **Step 2: Create home page**

Create `src/app/(shop)/page.tsx`:

```tsx
import Link from "next/link";
import { listByDate } from "@/sectors/b-catalog/repository/products";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const products = await listByDate({ limit: 20 });

  if (products.length === 0) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-bold mb-4">Catálogo</h1>
        <p className="text-gray-600">
          No hay productos todavía. En desarrollo, ejecuta:
          <code className="bg-gray-100 ml-2 px-2 py-1 rounded">pnpm cron:catalog-fill --pages 1</code>
        </p>
      </main>
    );
  }

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">Catálogo</h1>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {products.map((p) => (
          <Link key={p.id} href={`/products/${p.id}`} className="block border rounded-lg p-4 hover:shadow">
            {p.image_url ? (
              <img src={p.image_url} alt={p.title} className="w-full h-40 object-cover mb-2 rounded" />
            ) : (
              <div className="w-full h-40 bg-gray-100 rounded mb-2" />
            )}
            <h2 className="font-semibold text-sm line-clamp-2">{p.title}</h2>
            <p className="text-sm text-gray-500 mt-1">${(p.price_cents / 100).toFixed(2)}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
```

(Replaces the current `src/app/page.tsx`. The route group `(shop)` has the same path `/`, so the old `src/app/page.tsx` must be removed to avoid conflict.)

- [ ] **Step 3: Remove the old root page**

Run: `rm src/app/page.tsx`

- [ ] **Step 4: Smoke-test in browser**

Run:
```bash
pnpm dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
sleep 6
curl -s http://localhost:3000/ | grep -E "Catálogo|cron:catalog-fill|<a href" | head -5
kill $DEV_PID 2>/dev/null
```

Expected: HTML contains "Catálogo" and either an empty-state message OR `<a href="/products/...">` links if products exist from Task 19.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(shop\)/ src/app/page.tsx
git commit -m "feat(ui): home grid (listByDate) with empty-state hint"
```

---

## Task 22: `ProductCard` component

**Files:**
- Create: `src/components/ProductCard.tsx`
- Modify: `src/app/(shop)/page.tsx` (use the component)

**Goal:** Extract the card markup into a reusable component for home + search + cart.

- [ ] **Step 1: Create the component**

Create `src/components/ProductCard.tsx`:

```tsx
import Link from "next/link";

export interface ProductCardData {
  id: string;
  title: string;
  price_cents: number;
  image_url: string | null;
}

export function ProductCard({ product }: { product: ProductCardData }) {
  return (
    <Link
      href={`/products/${product.id}`}
      className="block border rounded-lg p-4 hover:shadow"
      data-testid="product-card"
    >
      {product.image_url ? (
        <img src={product.image_url} alt={product.title} className="w-full h-40 object-cover mb-2 rounded" />
      ) : (
        <div className="w-full h-40 bg-gray-100 rounded mb-2" />
      )}
      <h2 className="font-semibold text-sm line-clamp-2">{product.title}</h2>
      <p className="text-sm text-gray-500 mt-1">${(product.price_cents / 100).toFixed(2)}</p>
    </Link>
  );
}
```

- [ ] **Step 2: Use it in the home page**

Edit `src/app/(shop)/page.tsx`. Replace the inline `<Link>` block in the `.map(...)` with:

```tsx
import { ProductCard } from "@/components/ProductCard";
// ...
{products.map((p) => (
  <ProductCard key={p.id} product={p} />
))}
```

(Remove the now-unused `import Link from "next/link"` if it's no longer referenced.)

- [ ] **Step 3: Smoke check**

Run dev briefly and curl `/`. Expected: still renders, with `data-testid="product-card"` visible in HTML.

- [ ] **Step 4: Commit**

```bash
git add src/components/ProductCard.tsx src/app/\(shop\)/page.tsx
git commit -m "refactor(ui): extract ProductCard component"
```

---

## Task 23: Product detail page + `ProductTracker` (emits product_view + dwell)

**Files:**
- Create: `src/app/(shop)/products/[id]/page.tsx`
- Create: `src/components/ProductTracker.tsx`
- Create: `src/components/AddToCartButton.tsx` (placeholder — wired in Task 25)

**Goal:** Server component fetches the product. Client component emits `product_view` on mount and `product_dwell` after 30s. Add-to-cart button stub for now.

- [ ] **Step 1: Implement the detail server page**

Create `src/app/(shop)/products/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getById } from "@/sectors/b-catalog/repository/products";
import { ProductTracker } from "@/components/ProductTracker";
import { AddToCartButton } from "@/components/AddToCartButton";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getById(id);
  if (!product) return notFound();

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <ProductTracker productId={product.id} />
      <div className="grid md:grid-cols-2 gap-6">
        {product.image_url ? (
          <img src={product.image_url} alt={product.title} className="w-full rounded" />
        ) : (
          <div className="w-full h-80 bg-gray-100 rounded" />
        )}
        <div>
          <h1 className="text-2xl font-bold mb-2">{product.title}</h1>
          <p className="text-xl text-gray-700 mb-4">${(product.price_cents / 100).toFixed(2)}</p>
          <p className="text-gray-600 mb-6">{product.description}</p>
          <AddToCartButton productId={product.id} />
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Implement the tracker client component**

Create `src/components/ProductTracker.tsx`:

```tsx
"use client";
import { useEffect } from "react";

function inferSource(): "home" | "category" | "search" | "direct" {
  if (typeof document === "undefined") return "direct";
  const ref = document.referrer;
  if (!ref) return "direct";
  try {
    const url = new URL(ref);
    if (url.origin !== window.location.origin) return "direct";
    if (url.pathname === "/") return "home";
    if (url.pathname.startsWith("/search")) return "search";
    if (url.pathname.startsWith("/category")) return "category";
    return "direct";
  } catch {
    return "direct";
  }
}

async function trackEvent(body: Record<string, unknown>) {
  return fetch("/api/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
}

export function ProductTracker({ productId }: { productId: string }) {
  useEffect(() => {
    const start = Date.now();
    let dwellTimer: ReturnType<typeof setTimeout> | null = null;
    let dwellSent = false;

    void trackEvent({
      event_type: "product_view",
      occurred_at: new Date().toISOString(),
      payload: { product_id: productId, source: inferSource() },
    });

    dwellTimer = setTimeout(() => {
      if (dwellSent) return;
      dwellSent = true;
      void trackEvent({
        event_type: "product_dwell",
        occurred_at: new Date().toISOString(),
        payload: { product_id: productId, dwell_ms: Date.now() - start },
      });
    }, 30_000);

    return () => {
      if (dwellTimer) clearTimeout(dwellTimer);
    };
  }, [productId]);

  return null;
}
```

- [ ] **Step 3: Stub `AddToCartButton`**

Create `src/components/AddToCartButton.tsx`:

```tsx
"use client";
import { useState } from "react";

export function AddToCartButton({ productId }: { productId: string }) {
  const [pending, setPending] = useState(false);
  return (
    <button
      disabled={pending}
      className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
      onClick={async () => {
        setPending(true);
        // Wired in Task 25 — for now just log so the UI is testable.
        console.log("add_to_cart placeholder", productId);
        setPending(false);
      }}
    >
      {pending ? "Agregando..." : "Agregar al carrito"}
    </button>
  );
}
```

- [ ] **Step 4: Smoke test**

Run dev and visit `/products/<some-id>`. Expected: page renders; in DevTools network: a `POST /api/track` with status 200.

```bash
pnpm dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
sleep 6
PROD_ID=$(pnpm tsx -e "import {getPgClient} from '@/lib/db/pg'; const pg=await getPgClient(); const r=await pg.query('SELECT id FROM products LIMIT 1'); console.log(r.rows[0]?.id ?? ''); await pg.end();")
echo "product:$PROD_ID"
curl -s http://localhost:3000/products/$PROD_ID -o /dev/null -w "%{http_code}\n"
kill $DEV_PID 2>/dev/null
```

Expected: `200`. (If no products: skip — covered by Task 19 having seeded.)

- [ ] **Step 5: Commit**

```bash
git add src/app/\(shop\)/products/ src/components/ProductTracker.tsx src/components/AddToCartButton.tsx
git commit -m "feat(ui): product detail page with ProductTracker (view + dwell)"
```

---

## Task 24: Search page + `SearchTracker` + `/api/search` route

**Files:**
- Create: `src/app/(shop)/search/page.tsx`
- Create: `src/components/SearchTracker.tsx`
- Create: `src/app/api/search/route.ts` (returns LIKE results — used both server and client)

**Goal:** `/search?q=foo` returns LIKE matches; emits `search` event with `method='like'`.

- [ ] **Step 1: Implement the search route**

Create `src/app/api/search/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { searchLike } from "@/sectors/b-catalog/repository/products";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ products: [], count: 0 }, { status: 200 });
  const products = await searchLike({ query: q });
  return NextResponse.json({ products, count: products.length }, { status: 200 });
}
```

- [ ] **Step 2: Implement the page**

Create `src/app/(shop)/search/page.tsx`:

```tsx
import { searchLike } from "@/sectors/b-catalog/repository/products";
import { ProductCard } from "@/components/ProductCard";
import { SearchTracker } from "@/components/SearchTracker";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const products = q ? await searchLike({ query: q }) : [];

  return (
    <main className="p-8">
      <SearchTracker query={q} resultsCount={products.length} />
      <h1 className="text-2xl font-bold mb-2">Buscar</h1>
      <form action="/search" method="get" className="mb-6">
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar productos..."
          className="border rounded px-3 py-2 w-full max-w-md"
        />
      </form>
      {q && (
        <p className="text-sm text-gray-600 mb-4">
          Buscaste: <span className="font-mono">{q}</span> — {products.length} resultados.
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Implement the tracker**

Create `src/components/SearchTracker.tsx`:

```tsx
"use client";
import { useEffect, useRef } from "react";

async function trackEvent(body: Record<string, unknown>) {
  return fetch("/api/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
}

function hashKey(q: string): string {
  // Minute-bucket hash so client-side double-renders don't double-emit.
  const bucket = Math.floor(Date.now() / 60_000);
  return `${q}|${bucket}`;
}

const seen = new Set<string>();

export function SearchTracker({ query, resultsCount }: { query: string; resultsCount: number }) {
  const sentRef = useRef(false);
  useEffect(() => {
    if (sentRef.current || !query) return;
    const key = hashKey(query);
    if (seen.has(key)) return;
    seen.add(key);
    sentRef.current = true;
    void trackEvent({
      event_type: "search",
      occurred_at: new Date().toISOString(),
      payload: { raw_query: query, results_count: resultsCount, method: "like" },
    });
  }, [query, resultsCount]);
  return null;
}
```

- [ ] **Step 4: Smoke test**

Run:
```bash
pnpm dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
sleep 6
curl -s "http://localhost:3000/search?q=ropa" -o /dev/null -w "%{http_code}\n"
curl -s "http://localhost:3000/api/search?q=ropa" | head -c 200
echo
kill $DEV_PID 2>/dev/null
```

Expected: page returns 200; api returns JSON `{"products":[...]...}`.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(shop\)/search/ src/app/api/search/ src/components/SearchTracker.tsx
git commit -m "feat(ui,search): /search page + /api/search + client SearchTracker (method=like)"
```

---

## Task 25: `CartProvider` hook (anon localStorage / logged API)

**Files:**
- Create: `src/components/CartProvider.tsx`
- Modify: `src/app/(shop)/layout.tsx` (wrap with provider)
- Modify: `src/components/AddToCartButton.tsx` (use the hook)

**Goal:** Single hook `useCart()` that:
- Returns `{ items, add, remove, clear }`.
- For anon users: scopes localStorage by `anonymous_id` cookie value.
- For logged users: calls `/api/cart` (Task 26).
- Always emits `add_to_cart` / `remove_from_cart` events.

- [ ] **Step 1: Implement provider**

Create `src/components/CartProvider.tsx`:

```tsx
"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

export interface CartItem {
  product_id: string;
  quantity: number;
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

function localKey(): string {
  return `cart:${getCookie("anonymous_id") ?? "anon"}`;
}

function readLocal(): CartItem[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(localKey());
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (i): i is CartItem =>
        typeof i?.product_id === "string" && typeof i?.quantity === "number" && i.quantity > 0,
    );
  } catch {
    return [];
  }
}

function writeLocal(items: CartItem[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(localKey(), JSON.stringify(items));
}

async function trackEvent(body: Record<string, unknown>) {
  return fetch("/api/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
}

interface CartContextValue {
  items: CartItem[];
  loading: boolean;
  add: (productId: string, qty?: number) => Promise<void>;
  remove: (productId: string, qty?: number) => Promise<void>;
  clear: () => Promise<void>;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children, isLoggedIn }: { children: React.ReactNode; isLoggedIn: boolean }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (isLoggedIn) {
      const r = await fetch("/api/cart");
      if (r.ok) {
        const body = await r.json();
        setItems(body.items as CartItem[]);
      }
    } else {
      setItems(readLocal());
    }
    setLoading(false);
  }, [isLoggedIn]);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = useCallback(
    async (productId: string, qty = 1) => {
      if (isLoggedIn) {
        await fetch("/api/cart", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ product_id: productId, quantity: qty }),
        });
      } else {
        const next = [...readLocal()];
        const existing = next.find((i) => i.product_id === productId);
        if (existing) existing.quantity += qty;
        else next.push({ product_id: productId, quantity: qty });
        writeLocal(next);
        setItems(next);
      }
      await trackEvent({
        event_type: "add_to_cart",
        occurred_at: new Date().toISOString(),
        payload: { product_id: productId, quantity: qty },
      });
      if (isLoggedIn) await refresh();
    },
    [isLoggedIn, refresh],
  );

  const remove = useCallback(
    async (productId: string, qty = 1) => {
      if (isLoggedIn) {
        await fetch("/api/cart", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ product_id: productId, quantity: qty }),
        });
      } else {
        const next = readLocal().flatMap((i) => {
          if (i.product_id !== productId) return [i];
          const newQty = i.quantity - qty;
          return newQty > 0 ? [{ product_id: productId, quantity: newQty }] : [];
        });
        writeLocal(next);
        setItems(next);
      }
      await trackEvent({
        event_type: "remove_from_cart",
        occurred_at: new Date().toISOString(),
        payload: { product_id: productId, quantity: qty },
      });
      if (isLoggedIn) await refresh();
    },
    [isLoggedIn, refresh],
  );

  const clear = useCallback(async () => {
    if (!isLoggedIn) {
      writeLocal([]);
      setItems([]);
    } else {
      await fetch("/api/cart", { method: "DELETE" });
      await refresh();
    }
  }, [isLoggedIn, refresh]);

  return (
    <CartContext.Provider value={{ items, loading, add, remove, clear, refresh }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
```

- [ ] **Step 2: Wrap shop layout with provider**

Replace `src/app/(shop)/layout.tsx` content:

```tsx
import { auth0 } from "@/lib/auth";
import { CartProvider } from "@/components/CartProvider";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const session = await auth0.getSession().catch(() => null);
  const isLoggedIn = !!session?.user?.sub;
  return (
    <div className="min-h-screen">
      <CartProvider isLoggedIn={isLoggedIn}>{children}</CartProvider>
    </div>
  );
}
```

- [ ] **Step 3: Wire AddToCartButton**

Replace `src/components/AddToCartButton.tsx` content:

```tsx
"use client";
import { useState } from "react";
import { useCart } from "./CartProvider";

export function AddToCartButton({ productId }: { productId: string }) {
  const [pending, setPending] = useState(false);
  const { add } = useCart();
  return (
    <button
      disabled={pending}
      className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
      onClick={async () => {
        setPending(true);
        try { await add(productId, 1); } finally { setPending(false); }
      }}
    >
      {pending ? "Agregando..." : "Agregar al carrito"}
    </button>
  );
}
```

- [ ] **Step 4: Smoke test (anon)**

```bash
pnpm dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
sleep 6
# curl alone won't drive localStorage; just verify page still loads
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
kill $DEV_PID 2>/dev/null
```

Expected: `200`.

(Real cart flow exercise is deferred to E2E in Task 30.)

- [ ] **Step 5: Commit**

```bash
git add src/components/CartProvider.tsx src/app/\(shop\)/layout.tsx src/components/AddToCartButton.tsx
git commit -m "feat(ui,cart): CartProvider hook (anon localStorage / logged API) + button wired"
```

---

## Task 26: Cart API routes (`GET`/`PUT`/`DELETE`) + integration tests

**Files:**
- Create: `src/app/api/cart/route.ts`
- Create: `tests/integration/cart-api.test.ts`

**Goal:** Server-side cart CRUD for logged users using `cart_items`.

- [ ] **Step 1: Write failing tests**

Create `tests/integration/cart-api.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { createUser, seedProduct } from "@/../tests/helpers/seed";

beforeEach(async () => {
  await truncateTestTables(["cart_items", "products", "users", "anonymous_sessions", "events"]);
});

// We can't easily mock auth0.getSession (banned); instead, test the cart-by-userId path
// by importing the underlying repo function. The route's auth concern is exercised in E2E.

import * as cartRoute from "@/app/api/cart/route";
import { getCartByUserId, putCartItem, removeCartItem, clearCart } from "@/sectors/a-tracking/cart-repo";

describe("cart_items repo", () => {
  test("putCartItem inserts a row when none exists", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      const product = await seedProduct(pg);
      const r = await putCartItem(pg, { user_id: user.id, product_id: product.id, quantity: 2 });
      expect(r.quantity).toBe(2);
      const row = await pg.query(`SELECT quantity FROM cart_items WHERE user_id=$1 AND product_id=$2`, [user.id, product.id]);
      expect(row.rows[0].quantity).toBe(2);
    });
  });

  test("putCartItem upserts (sums) when row exists", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      const product = await seedProduct(pg);
      await putCartItem(pg, { user_id: user.id, product_id: product.id, quantity: 1 });
      await putCartItem(pg, { user_id: user.id, product_id: product.id, quantity: 2 });
      const row = await pg.query(`SELECT quantity FROM cart_items WHERE user_id=$1 AND product_id=$2`, [user.id, product.id]);
      expect(row.rows[0].quantity).toBe(3);
    });
  });

  test("removeCartItem decrements; quantity reaching 0 deletes the row", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      const product = await seedProduct(pg);
      await putCartItem(pg, { user_id: user.id, product_id: product.id, quantity: 3 });
      await removeCartItem(pg, { user_id: user.id, product_id: product.id, quantity: 1 });
      let row = await pg.query(`SELECT quantity FROM cart_items WHERE user_id=$1 AND product_id=$2`, [user.id, product.id]);
      expect(row.rows[0].quantity).toBe(2);
      await removeCartItem(pg, { user_id: user.id, product_id: product.id, quantity: 5 });
      row = await pg.query(`SELECT count(*)::int FROM cart_items WHERE user_id=$1 AND product_id=$2`, [user.id, product.id]);
      expect(row.rows[0].count).toBe(0);
    });
  });

  test("getCartByUserId returns items joined with product info", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      const p1 = await seedProduct(pg, { title: "P1", price_cents: 1000 });
      const p2 = await seedProduct(pg, { title: "P2", price_cents: 2000 });
      await putCartItem(pg, { user_id: user.id, product_id: p1.id, quantity: 1 });
      await putCartItem(pg, { user_id: user.id, product_id: p2.id, quantity: 2 });
      const items = await getCartByUserId(pg, user.id);
      expect(items).toHaveLength(2);
      const byId = Object.fromEntries(items.map((i) => [i.product_id, i]));
      expect(byId[p1.id].title).toBe("P1");
      expect(byId[p1.id].quantity).toBe(1);
      expect(byId[p2.id].quantity).toBe(2);
    });
  });

  test("clearCart removes all rows for a user but not for others", async () => {
    await withTestDb(async (pg) => {
      const userA = await createUser(pg, { email: "a@x.com" });
      const userB = await createUser(pg, { email: "b@x.com" });
      const product = await seedProduct(pg);
      await putCartItem(pg, { user_id: userA.id, product_id: product.id, quantity: 1 });
      await putCartItem(pg, { user_id: userB.id, product_id: product.id, quantity: 1 });
      await clearCart(pg, userA.id);
      const all = await pg.query(`SELECT user_id FROM cart_items`);
      expect(all.rows.map((r: { user_id: string }) => r.user_id)).toEqual([userB.id]);
    });
  });
});
```

- [ ] **Step 2: Run tests (expect FAIL)**

Run: `pnpm vitest run tests/integration/cart-api.test.ts`

Expected: FAIL — `Cannot find module '@/sectors/a-tracking/cart-repo'`.

- [ ] **Step 3: Implement the cart repo**

Create `src/sectors/a-tracking/cart-repo.ts`:

```ts
import type { Client } from "pg";

export interface CartRowWithProduct {
  product_id: string;
  quantity: number;
  title: string;
  price_cents: number;
  image_url: string | null;
  added_at: string;
}

export async function getCartByUserId(pg: Client, userId: string): Promise<CartRowWithProduct[]> {
  const r = await pg.query(
    `SELECT ci.product_id, ci.quantity, ci.added_at, p.title, p.price_cents, p.image_url
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.user_id = $1
     ORDER BY ci.added_at DESC`,
    [userId],
  );
  return r.rows;
}

export interface PutCartInput {
  user_id: string;
  product_id: string;
  quantity: number;
}

export async function putCartItem(pg: Client, input: PutCartInput): Promise<{ quantity: number }> {
  const r = await pg.query(
    `INSERT INTO cart_items (user_id, product_id, quantity)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, product_id) DO UPDATE SET
       quantity = cart_items.quantity + EXCLUDED.quantity,
       updated_at = now()
     RETURNING quantity`,
    [input.user_id, input.product_id, input.quantity],
  );
  return { quantity: r.rows[0].quantity };
}

export async function removeCartItem(
  pg: Client,
  input: { user_id: string; product_id: string; quantity: number },
): Promise<void> {
  await pg.query(
    `UPDATE cart_items SET quantity = quantity - $3, updated_at = now()
     WHERE user_id = $1 AND product_id = $2`,
    [input.user_id, input.product_id, input.quantity],
  );
  await pg.query(
    `DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2 AND quantity <= 0`,
    [input.user_id, input.product_id],
  );
}

export async function clearCart(pg: Client, userId: string): Promise<void> {
  await pg.query(`DELETE FROM cart_items WHERE user_id = $1`, [userId]);
}
```

- [ ] **Step 4: Implement the route**

Create `src/app/api/cart/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import {
  getCartByUserId,
  putCartItem,
  removeCartItem,
  clearCart,
} from "@/sectors/a-tracking/cart-repo";

async function resolveUserId(req: NextRequest): Promise<string | null> {
  const session = await auth0.getSession(req).catch(() => null);
  if (!session?.user?.sub) return null;
  const sub = session.user.sub as string;
  const email = (session.user.email as string) ?? `${sub}@noemail.local`;
  return await withPg(async (pg) => (await getOrCreateUserByAuth0Sub(pg, sub, email)).id);
}

export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const items = await withPg((pg) => getCartByUserId(pg, userId));
  return NextResponse.json({ items });
}

export async function PUT(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.product_id !== "string" || typeof body.quantity !== "number" || body.quantity < 1) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const r = await withPg((pg) =>
    putCartItem(pg, { user_id: userId, product_id: body.product_id, quantity: body.quantity }),
  );
  return NextResponse.json(r);
}

export async function DELETE(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (body && typeof body.product_id === "string" && typeof body.quantity === "number" && body.quantity >= 1) {
    await withPg((pg) =>
      removeCartItem(pg, { user_id: userId, product_id: body.product_id, quantity: body.quantity }),
    );
    return NextResponse.json({ ok: true });
  }
  // No body or missing product_id → clear all
  await withPg((pg) => clearCart(pg, userId));
  return NextResponse.json({ ok: true, cleared: true });
}
```

- [ ] **Step 5: Run tests (expect PASS)**

Run: `pnpm vitest run tests/integration/cart-api.test.ts`

Expected: 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sectors/a-tracking/cart-repo.ts src/app/api/cart/route.ts tests/integration/cart-api.test.ts
git commit -m "feat(cart): cart_items repo (put/remove/get/clear) + GET/PUT/DELETE /api/cart"
```

---

## Task 27: Cart merge route + tests

**Files:**
- Create: `src/app/api/cart/merge/route.ts`
- Create: `tests/integration/cart-merge.test.ts`

**Goal:** Accept the localStorage cart from the client post-login and UPSERT into `cart_items` (summing quantities).

- [ ] **Step 1: Write failing tests**

Create `tests/integration/cart-merge.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { createUser, seedProduct } from "@/../tests/helpers/seed";
import { mergeLocalCartIntoUser } from "@/sectors/a-tracking/cart-repo";

beforeEach(async () => {
  await truncateTestTables(["cart_items", "products", "users", "anonymous_sessions", "events"]);
});

describe("mergeLocalCartIntoUser", () => {
  test("inserts new items when user cart is empty", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      const p = await seedProduct(pg);
      await mergeLocalCartIntoUser(pg, user.id, [{ product_id: p.id, quantity: 2 }]);
      const r = await pg.query(`SELECT quantity FROM cart_items WHERE user_id=$1 AND product_id=$2`, [user.id, p.id]);
      expect(r.rows[0].quantity).toBe(2);
    });
  });

  test("sums quantities when items overlap with existing user cart", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      const p = await seedProduct(pg);
      await pg.query(`INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, 3)`, [user.id, p.id]);
      await mergeLocalCartIntoUser(pg, user.id, [{ product_id: p.id, quantity: 4 }]);
      const r = await pg.query(`SELECT quantity FROM cart_items WHERE user_id=$1 AND product_id=$2`, [user.id, p.id]);
      expect(r.rows[0].quantity).toBe(7);
    });
  });

  test("ignores invalid items (missing product, qty <=0)", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      await mergeLocalCartIntoUser(pg, user.id, [
        { product_id: "00000000-0000-0000-0000-000000000000", quantity: 1 }, // FK fail → silently skipped
        { product_id: "any", quantity: 0 } as never, // qty<=0 skipped
      ]);
      const r = await pg.query(`SELECT count(*)::int FROM cart_items`);
      expect(r.rows[0].count).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run test (expect FAIL)**

Run: `pnpm vitest run tests/integration/cart-merge.test.ts`

Expected: FAIL — `mergeLocalCartIntoUser` not exported.

- [ ] **Step 3: Add `mergeLocalCartIntoUser` to cart-repo**

Append to `src/sectors/a-tracking/cart-repo.ts`:

```ts
export async function mergeLocalCartIntoUser(
  pg: Client,
  userId: string,
  items: { product_id: string; quantity: number }[],
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const item of items) {
    if (typeof item.product_id !== "string" || typeof item.quantity !== "number" || item.quantity < 1) {
      skipped++;
      continue;
    }
    try {
      await pg.query(
        `INSERT INTO cart_items (user_id, product_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, product_id) DO UPDATE SET
           quantity = cart_items.quantity + EXCLUDED.quantity,
           updated_at = now()`,
        [userId, item.product_id, item.quantity],
      );
      inserted++;
    } catch (e) {
      // FK violation, etc. — silently skip individual bad items
      skipped++;
    }
  }
  return { inserted, skipped };
}
```

- [ ] **Step 4: Implement the route**

Create `src/app/api/cart/merge/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { mergeLocalCartIntoUser } from "@/sectors/a-tracking/cart-repo";

export async function POST(req: NextRequest) {
  const session = await auth0.getSession(req).catch(() => null);
  if (!session?.user?.sub) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!Array.isArray(body)) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const sub = session.user.sub as string;
  const email = (session.user.email as string) ?? `${sub}@noemail.local`;

  const result = await withPg(async (pg) => {
    const user = await getOrCreateUserByAuth0Sub(pg, sub, email);
    return await mergeLocalCartIntoUser(pg, user.id, body);
  });
  return NextResponse.json(result);
}
```

- [ ] **Step 5: Run tests (expect PASS)**

Run: `pnpm vitest run tests/integration/cart-merge.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sectors/a-tracking/cart-repo.ts src/app/api/cart/merge/route.ts tests/integration/cart-merge.test.ts
git commit -m "feat(cart): /api/cart/merge for localStorage→cart_items on signup"
```

---

## Task 28: Cart page UI

**Files:**
- Create: `src/app/(shop)/cart/page.tsx`
- Create: `src/components/CartView.tsx` (client component)

**Goal:** Show cart contents with product details, totals, and "Continuar al checkout" button.

- [ ] **Step 1: Implement the page**

Create `src/app/(shop)/cart/page.tsx`:

```tsx
import { CartView } from "@/components/CartView";

export default function CartPage() {
  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Tu carrito</h1>
      <CartView />
    </main>
  );
}
```

- [ ] **Step 2: Implement the client view**

Create `src/components/CartView.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useCart, type CartItem } from "./CartProvider";

interface ProductInfo { id: string; title: string; price_cents: number; image_url: string | null; }

export function CartView() {
  const { items, loading, remove } = useCart();
  const [productMap, setProductMap] = useState<Record<string, ProductInfo>>({});

  // Hydrate product info for the items we have (anon path needs this; logged path already joined server-side)
  useEffect(() => {
    const missing = items.filter((i) => !productMap[i.product_id]).map((i) => i.product_id);
    if (missing.length === 0) return;
    Promise.all(
      missing.map((id) => fetch(`/api/search?q=`).then(async (r) => {
        // simpler path: fetch each via product detail-style endpoint — but we don't have one. Use search by id is overkill.
        // Strategy: ask the cart endpoint for hydrated rows when logged-in (already returns product info).
        // Anon: the localStorage doesn't have product info — fall back to title="Loading..." until /api/products/{id} exists.
        return null;
      })),
    );
  }, [items, productMap]);

  if (loading) return <p>Cargando...</p>;
  if (items.length === 0) return <p>Tu carrito está vacío. <Link className="underline" href="/">Volver al catálogo</Link>.</p>;

  return (
    <div>
      <ul className="divide-y">
        {items.map((item) => {
          const info = (item as CartItem & Partial<ProductInfo>).title
            ? (item as unknown as ProductInfo & CartItem)
            : null;
          return (
            <li key={item.product_id} className="py-4 flex gap-4">
              {info?.image_url ? (
                <img src={info.image_url} alt={info.title} className="w-16 h-16 object-cover rounded" />
              ) : (
                <div className="w-16 h-16 bg-gray-100 rounded" />
              )}
              <div className="flex-1">
                <p className="font-medium">{info?.title ?? "Producto"}</p>
                <p className="text-sm text-gray-500">Cantidad: {item.quantity}</p>
              </div>
              <button
                className="text-red-600 text-sm"
                onClick={() => remove(item.product_id, 1)}
              >
                Quitar 1
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-6">
        <Link href="/checkout" className="bg-black text-white px-6 py-3 rounded inline-block">
          Continuar al checkout
        </Link>
      </div>
    </div>
  );
}
```

(Note: the `productMap` hydration is intentionally minimal here — the GET `/api/cart` endpoint returns hydrated rows for logged-in users, and the anon localStorage cart will show "Producto" placeholder. Since checkout is for logged-in users only, anon cart is a discoverability/preview surface, not transactional. This is acceptable for Phase 1.)

- [ ] **Step 3: Smoke check**

Run dev, visit `/cart`. Expected: page renders.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(shop\)/cart/ src/components/CartView.tsx
git commit -m "feat(ui,cart): cart page + CartView (anon + logged paths)"
```

---

## Task 29: Checkout page + `/api/checkout` route + tests

**Files:**
- Create: `src/app/(shop)/checkout/page.tsx`
- Create: `src/app/(shop)/checkout/success/page.tsx`
- Create: `src/app/api/checkout/route.ts`
- Create: `tests/integration/checkout.test.ts`

**Goal:** Logged-in user POSTs to `/api/checkout` → server creates `orders` + `order_items` (with snapshot), emits `purchase` event, clears cart_items, returns `order_id`.

- [ ] **Step 1: Write failing tests**

Create `tests/integration/checkout.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { createUser, createAnonymousSession, seedProduct } from "@/../tests/helpers/seed";
import { putCartItem } from "@/sectors/a-tracking/cart-repo";
import { createCheckoutOrder } from "@/sectors/a-tracking/checkout";

beforeEach(async () => {
  await truncateTestTables(["events", "order_items", "orders", "cart_items", "products", "users", "anonymous_sessions"]);
});

describe("createCheckoutOrder", () => {
  test("creates order with status='pendiente', items with snapshot, totals correct, clears cart, emits purchase event", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      const anonId = await createAnonymousSession(pg);
      const p1 = await seedProduct(pg, { title: "P1", price_cents: 1000 });
      const p2 = await seedProduct(pg, { title: "P2", price_cents: 2500 });
      await putCartItem(pg, { user_id: user.id, product_id: p1.id, quantity: 2 });
      await putCartItem(pg, { user_id: user.id, product_id: p2.id, quantity: 1 });
      const sessionId = "11111111-1111-1111-1111-111111111111";

      const result = await createCheckoutOrder(pg, {
        user_id: user.id,
        anonymous_id: anonId,
        session_id: sessionId,
      });
      expect(result.order_id).toMatch(/^[0-9a-f-]{36}$/);

      const order = (await pg.query(`SELECT * FROM orders WHERE id=$1`, [result.order_id])).rows[0];
      expect(order.user_id).toBe(user.id);
      expect(order.status).toBe("pendiente");
      expect(order.total_charged_cents).toBe(1000 * 2 + 2500); // 4500
      expect(order.total_cost_cents).toBe(Math.round(4500 * 0.6));

      const items = (await pg.query(`SELECT product_id, quantity, unit_price_cents, product_snapshot FROM order_items WHERE order_id=$1 ORDER BY product_id`, [result.order_id])).rows;
      expect(items).toHaveLength(2);
      const byPid = Object.fromEntries(items.map((r) => [r.product_id, r]));
      expect(byPid[p1.id].quantity).toBe(2);
      expect(byPid[p1.id].unit_price_cents).toBe(1000);
      expect(byPid[p1.id].product_snapshot.title).toBe("P1");

      const cart = await pg.query(`SELECT count(*)::int FROM cart_items WHERE user_id=$1`, [user.id]);
      expect(cart.rows[0].count).toBe(0);

      const ev = await pg.query(`SELECT event_type, payload FROM events WHERE user_id=$1 AND event_type='purchase'`, [user.id]);
      expect(ev.rows).toHaveLength(1);
      expect(ev.rows[0].payload.order_id).toBe(result.order_id);
      expect(ev.rows[0].payload.total_cents).toBe(4500);
      expect(ev.rows[0].payload.product_ids).toEqual(expect.arrayContaining([p1.id, p2.id]));
    });
  });

  test("throws when cart is empty", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      const anonId = await createAnonymousSession(pg);
      await expect(
        createCheckoutOrder(pg, { user_id: user.id, anonymous_id: anonId, session_id: "11111111-1111-1111-1111-111111111111" }),
      ).rejects.toThrow(/empty_cart/);
    });
  });
});
```

- [ ] **Step 2: Run tests (expect FAIL)**

Run: `pnpm vitest run tests/integration/checkout.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the checkout function**

Create `src/sectors/a-tracking/checkout.ts`:

```ts
import type { Client } from "pg";
import { insertEvent } from "./events/insert";

export interface CheckoutInput {
  user_id: string;
  anonymous_id: string;
  session_id: string;
}

export interface CheckoutResult {
  order_id: string;
}

export async function createCheckoutOrder(
  pg: Client,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  await pg.query("BEGIN");
  try {
    const cartRows = await pg.query(
      `SELECT ci.product_id, ci.quantity,
              p.title, p.description, p.price_cents, p.currency, p.image_url, p.metadata
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
       WHERE ci.user_id = $1`,
      [input.user_id],
    );
    if (cartRows.rows.length === 0) {
      throw new Error("empty_cart");
    }

    const totalCharged = cartRows.rows.reduce(
      (s: number, r: { price_cents: number; quantity: number }) => s + r.price_cents * r.quantity,
      0,
    );
    const totalCost = Math.round(totalCharged * 0.6);

    const order = await pg.query(
      `INSERT INTO orders (user_id, status, total_charged_cents, total_cost_cents)
       VALUES ($1, 'pendiente', $2, $3)
       RETURNING id`,
      [input.user_id, totalCharged, totalCost],
    );
    const orderId: string = order.rows[0].id;

    for (const row of cartRows.rows) {
      const snapshot = {
        title: row.title,
        description: row.description,
        currency: row.currency,
        image_url: row.image_url,
        metadata: row.metadata,
      };
      const unitCost = Math.round(row.price_cents * 0.6);
      await pg.query(
        `INSERT INTO order_items
          (order_id, product_id, product_snapshot, quantity, unit_price_cents, unit_cost_cents)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
        [orderId, row.product_id, JSON.stringify(snapshot), row.quantity, row.price_cents, unitCost],
      );
    }

    await pg.query(`DELETE FROM cart_items WHERE user_id = $1`, [input.user_id]);

    const productIds = cartRows.rows.map((r: { product_id: string }) => r.product_id);
    await insertEvent(
      {
        event_type: "purchase",
        occurred_at: new Date().toISOString(),
        payload: { order_id: orderId, product_ids: productIds, total_cents: totalCharged },
      },
      { pg, anonymous_id: input.anonymous_id, session_id: input.session_id, user_id: input.user_id },
    );

    await pg.query("COMMIT");
    return { order_id: orderId };
  } catch (e) {
    await pg.query("ROLLBACK");
    throw e;
  }
}
```

- [ ] **Step 4: Implement the route**

Create `src/app/api/checkout/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { createCheckoutOrder } from "@/sectors/a-tracking/checkout";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const anonymous_id = req.cookies.get("anonymous_id")?.value;
  const session_id = req.cookies.get("session_id")?.value;
  if (!anonymous_id || !UUID_REGEX.test(anonymous_id) || !session_id || !UUID_REGEX.test(session_id)) {
    return NextResponse.json({ error: "no_identity" }, { status: 400 });
  }
  const session = await auth0.getSession(req).catch(() => null);
  if (!session?.user?.sub) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const sub = session.user.sub as string;
  const email = (session.user.email as string) ?? `${sub}@noemail.local`;
  try {
    const result = await withPg(async (pg) => {
      const user = await getOrCreateUserByAuth0Sub(pg, sub, email);
      return await createCheckoutOrder(pg, { user_id: user.id, anonymous_id, session_id });
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof Error && e.message === "empty_cart") {
      return NextResponse.json({ error: "empty_cart" }, { status: 400 });
    }
    throw e;
  }
}
```

- [ ] **Step 5: Implement the checkout pages**

Create `src/app/(shop)/checkout/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth";
import { CheckoutForm } from "@/components/CheckoutForm";

export default async function CheckoutPage() {
  const session = await auth0.getSession().catch(() => null);
  if (!session?.user?.sub) redirect("/auth/login?returnTo=/checkout");
  return (
    <main className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Checkout simulado</h1>
      <CheckoutForm />
    </main>
  );
}
```

Create `src/components/CheckoutForm.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "./CartProvider";

export function CheckoutForm() {
  const router = useRouter();
  const { items, refresh } = useCart();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = items.reduce(
    (s, i) => s + (typeof (i as unknown as { price_cents?: number }).price_cents === "number"
      ? ((i as unknown as { price_cents: number }).price_cents) * i.quantity
      : 0),
    0,
  );

  return (
    <div>
      <p className="mb-4">Items: {items.length} | Total estimado: ${(total / 100).toFixed(2)}</p>
      {error && <p className="text-red-600 mb-2">{error}</p>}
      <button
        disabled={pending || items.length === 0}
        className="bg-black text-white px-6 py-3 rounded disabled:opacity-50"
        onClick={async () => {
          setPending(true); setError(null);
          const r = await fetch("/api/checkout", { method: "POST" });
          if (!r.ok) {
            setPending(false);
            const body = await r.json().catch(() => ({}));
            setError(body.error ?? "checkout_failed");
            return;
          }
          const { order_id } = await r.json();
          // Clear local cart fallback
          if (typeof window !== "undefined") {
            const m = document.cookie.match(/(^|;\s*)anonymous_id=([^;]+)/);
            const anonId = m ? decodeURIComponent(m[2]) : null;
            if (anonId) localStorage.removeItem(`cart:${anonId}`);
          }
          await refresh();
          router.push(`/checkout/success?order_id=${order_id}`);
        }}
      >
        {pending ? "Procesando..." : "Confirmar compra simulada"}
      </button>
    </div>
  );
}
```

Create `src/app/(shop)/checkout/success/page.tsx`:

```tsx
import Link from "next/link";

export default async function CheckoutSuccessPage({ searchParams }: { searchParams: Promise<{ order_id?: string }> }) {
  const { order_id } = await searchParams;
  return (
    <main className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">¡Compra simulada confirmada!</h1>
      {order_id && <p className="mb-4">Order ID: <code className="bg-gray-100 px-2 py-1 rounded">{order_id}</code></p>}
      <Link href="/" className="underline">Volver al catálogo</Link>
    </main>
  );
}
```

- [ ] **Step 6: Run tests (expect PASS)**

Run: `pnpm vitest run tests/integration/checkout.test.ts`

Expected: 2 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/sectors/a-tracking/checkout.ts src/app/api/checkout/route.ts src/app/\(shop\)/checkout/ src/components/CheckoutForm.tsx tests/integration/checkout.test.ts
git commit -m "feat(checkout): /api/checkout route + checkout pages + integration tests"
```

---

## Task 30: `IdentityMergeOnLogin` in root layout + E2E tracking-flow

**Files:**
- Create: `src/components/IdentityMergeOnLogin.tsx`
- Modify: `src/app/layout.tsx`
- Create: `tests/e2e/tracking-flow.spec.ts`

**Goal:** Merge identity client-side after login. E2E spec covers the anon→login→merge happy path with a real Auth0 user (skip if creds missing, like existing `auth.spec.ts`).

- [ ] **Step 1: Implement the component**

Create `src/components/IdentityMergeOnLogin.tsx`:

```tsx
"use client";
import { useEffect } from "react";
import { useUser } from "@auth0/nextjs-auth0";

function getAnonymousId(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(^|;\s*)anonymous_id=([^;]+)/);
  return m ? decodeURIComponent(m[2]) : null;
}

export function IdentityMergeOnLogin() {
  const { user, isLoading } = useUser();

  useEffect(() => {
    if (isLoading || !user) return;
    const flag = `merge_done:${user.sub}`;
    if (localStorage.getItem(flag) === "1") return;

    void (async () => {
      const r1 = await fetch("/api/identity/merge", { method: "POST" }).catch(() => null);
      if (!r1?.ok) return;
      localStorage.setItem(flag, "1");

      const anonId = getAnonymousId();
      if (!anonId) return;
      const cartRaw = localStorage.getItem(`cart:${anonId}`);
      if (!cartRaw) return;
      try {
        const items = JSON.parse(cartRaw);
        const r2 = await fetch("/api/cart/merge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(items),
        });
        if (r2.ok) localStorage.removeItem(`cart:${anonId}`);
      } catch { /* malformed cart, ignore */ }
    })();
  }, [user, isLoading]);

  return null;
}
```

- [ ] **Step 2: Wire it into root layout**

Replace `src/app/layout.tsx` content:

```tsx
import type { Metadata } from "next";
import { Auth0Provider } from "@auth0/nextjs-auth0";
import { IdentityMergeOnLogin } from "@/components/IdentityMergeOnLogin";
import "./globals.css";

export const metadata: Metadata = {
  title: "E-commerce Cuba",
  description: "MVP de e-commerce reseller con personalización adaptativa",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Auth0Provider>
          <IdentityMergeOnLogin />
          {children}
        </Auth0Provider>
      </body>
    </html>
  );
}
```

(Auth0Provider exposes `useUser()` to client components.)

- [ ] **Step 3: Smoke-test (anon flow)**

```bash
pnpm dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
sleep 6
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
kill $DEV_PID 2>/dev/null
```

Expected: `200`. (Real merge flow tested in E2E.)

- [ ] **Step 4: Write E2E tracking-flow spec**

Create `tests/e2e/tracking-flow.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { Client } from "pg";

const HAS_AUTH0_CREDS = !!(process.env.E2E_TEST_USER_EMAIL && process.env.E2E_TEST_USER_PASSWORD);

async function pg() {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await c.connect();
  return c;
}

test.describe("tracking-flow", () => {
  test("anonymous visit sets cookies and persists session_start in events", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/");

    const cookies = await page.context().cookies();
    const anon = cookies.find((c) => c.name === "anonymous_id");
    const sess = cookies.find((c) => c.name === "session_id");
    expect(anon?.value).toMatch(/^[0-9a-f-]{36}$/);
    expect(sess?.value).toMatch(/^[0-9a-f-]{36}$/);

    const c = await pg();
    try {
      const r = await c.query(
        `SELECT event_type FROM events WHERE anonymous_id=$1 AND event_type='session_start'`,
        [anon!.value],
      );
      expect(r.rowCount).toBeGreaterThanOrEqual(1);
    } finally {
      await c.end();
    }
  });

  test.skip(!HAS_AUTH0_CREDS, "E2E_TEST_USER_* not configured")(
    "after login, /api/identity/merge associates events to user_id",
    async ({ page }) => {
      await page.context().clearCookies();
      await page.goto("/");
      const cookies1 = await page.context().cookies();
      const anonId = cookies1.find((c) => c.name === "anonymous_id")!.value;

      // Visit a product detail to generate a product_view event
      const c = await pg();
      const productRow = await c.query(`SELECT id FROM products LIMIT 1`);
      await c.end();
      if (productRow.rows.length === 0) test.skip(true, "no products seeded");
      const productId = productRow.rows[0].id;
      await page.goto(`/products/${productId}`);

      // Login
      await page.goto("/auth/login");
      await page.fill('input[name="username"], input[name="email"]', process.env.E2E_TEST_USER_EMAIL!);
      await page.fill('input[name="password"]', process.env.E2E_TEST_USER_PASSWORD!);
      await page.click('button[type="submit"]');
      await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));

      // Wait for client merge call to settle
      await page.waitForTimeout(2000);

      const c2 = await pg();
      try {
        const r = await c2.query(`SELECT count(*)::int FROM events WHERE anonymous_id=$1 AND user_id IS NOT NULL`, [anonId]);
        expect(r.rows[0].count).toBeGreaterThan(0);
      } finally {
        await c2.end();
      }
    },
  );
});
```

- [ ] **Step 5: Run E2E**

Run: `pnpm test:e2e tests/e2e/tracking-flow.spec.ts`

Expected: 1 test PASS, 1 SKIPPED (if no creds) OR PASS (if creds set).

- [ ] **Step 6: Commit**

```bash
git add src/components/IdentityMergeOnLogin.tsx src/app/layout.tsx tests/e2e/tracking-flow.spec.ts
git commit -m "feat(auth,tracking): IdentityMergeOnLogin in root layout + E2E tracking-flow"
```

---

## Task 31: Mutation testing on 5 critical functions

**Files:** none created — this is a verification task with commits documenting each mutation.

**Goal:** For each of the 5 functions per the spec (sec 6.4), introduce a deliberate bug, verify the test suite catches it, restore, document.

The procedure for each: (1) baseline green; (2) introduce mutation; (3) re-run targeted test, expect FAIL with the specific reason described; (4) restore code; (5) re-run, expect green; (6) commit a small "documentation-only" trailer.

For each step below, you may keep changes uncommitted between steps if your editor supports stashing. Do NOT commit a broken codebase to git.

- [ ] **Mutation 1: `ensureAnonymousId` randomUUID**

In `src/sectors/a-tracking/identity.ts`, change `id = randomUUID();` (in `ensureAnonymousId`) to `id = "00000000-0000-0000-0000-000000000000";`.

Run: `pnpm vitest run tests/integration/identity.test.ts -t "two distinct first visits"`

Expected: FAIL — `expected '00000000-0000-0000-0000-000000000000' not.toBe('00000000-0000-0000-0000-000000000000')` or insertion conflict in `anonymous_sessions`.

Restore the file. Re-run: PASS.

- [ ] **Mutation 2: `insertEvent` ON CONFLICT**

In `src/sectors/a-tracking/events/insert.ts`, remove the line `ON CONFLICT (client_event_id) WHERE client_event_id IS NOT NULL DO NOTHING`.

Run: `pnpm vitest run tests/integration/insert-event.test.ts -t "idempotency"`

Expected: FAIL — duplicate key violation on `events_client_event_id_uniq`.

Restore. Re-run: PASS.

- [ ] **Mutation 3: `mergeIdentities` WHERE clause**

In `src/sectors/a-tracking/events/merge.ts`, change the events UPDATE from:

```
WHERE anonymous_id = $1 AND user_id IS NULL
```

to:

```
WHERE anonymous_id = $1
```

Run: `pnpm vitest run tests/integration/identity-merge.test.ts -t "does NOT overwrite"`

Expected: FAIL — events of the second anon end up with both user_ids depending on call order, the assertion `expect(byAnon[anon1]).toBe(userA.id)` fails.

Restore. Re-run: PASS.

- [ ] **Mutation 4: `buildCanonicalText` description**

In `src/sectors/b-catalog/enrichment/canonical.ts`, remove `raw.description` from the `parts` array.

Run: `pnpm vitest run tests/unit/canonical-text.test.ts -t "different descriptions"`

Expected: FAIL — both canonical texts collapse to the same string.

Restore. Re-run: PASS.

- [ ] **Mutation 5: `runCatalogFill` mock_calls insert**

In `src/sectors/b-catalog/cron/catalog-fill.ts`, comment out the success-path INSERT into `mock_calls`.

Run: `pnpm vitest run tests/integration/cron-catalog-fill.test.ts -t "1 mock_calls row"`

Expected: FAIL — `expect(calls.rows).toHaveLength(1)` — got 0.

Restore. Re-run: PASS.

- [ ] **Document the mutation testing**

Append to `docs/superpowers/reports/2026-05-XX-fase-1-cierre.md` (will be created in Task 33) — for now, prepare a draft commit:

```bash
git commit --allow-empty -m "test(mutation): verified 5 mutations fail as expected

- ensureAnonymousId UUID constant → identity test FAIL (distinct ids)
- insertEvent ON CONFLICT removed → insert-event test FAIL (duplicate key)
- mergeIdentities WHERE user_id IS NULL removed → identity-merge test FAIL (overwrite)
- buildCanonicalText description omitted → canonical-text test FAIL (same canonical)
- runCatalogFill mock_calls INSERT removed → cron-catalog-fill test FAIL (count 0)"
```

---

## Task 32: Full suite green + E2E shopping-flow

**Files:**
- Create: `tests/e2e/shopping-flow.spec.ts`

**Goal:** Whole-suite verification. New shopping-flow E2E: anon visits home → product detail → add to cart → login → checkout → success.

- [ ] **Step 1: Pre-seed catalog (so the home grid has products)**

Run: `pnpm cron:catalog-fill --categories ropa,electronica --pages 1`

Expected: `totalCalls: 2`, `totalProducts: 50` (or close, allowing for 2% mock errors).

- [ ] **Step 2: Write the shopping-flow E2E**

Create `tests/e2e/shopping-flow.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { Client } from "pg";

const HAS_AUTH0_CREDS = !!(process.env.E2E_TEST_USER_EMAIL && process.env.E2E_TEST_USER_PASSWORD);

test.describe("shopping-flow", () => {
  test("anon home → detail → emits product_view in DB", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/");
    await expect(page.locator('[data-testid="product-card"]').first()).toBeVisible();
    await page.locator('[data-testid="product-card"]').first().click();
    await expect(page.getByRole("heading")).toBeVisible();

    const anonId = (await page.context().cookies()).find((c) => c.name === "anonymous_id")!.value;
    // Wait briefly for the async fetch to /api/track to settle
    await page.waitForTimeout(800);

    const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    await c.connect();
    try {
      const r = await c.query(
        `SELECT count(*)::int FROM events WHERE anonymous_id=$1 AND event_type='product_view'`,
        [anonId],
      );
      expect(r.rows[0].count).toBeGreaterThanOrEqual(1);
    } finally {
      await c.end();
    }
  });

  test.skip(!HAS_AUTH0_CREDS, "E2E_TEST_USER_* not configured")(
    "logged user adds to cart → checkout → success → order persisted",
    async ({ page }) => {
      await page.context().clearCookies();
      // Login first
      await page.goto("/auth/login");
      await page.fill('input[name="username"], input[name="email"]', process.env.E2E_TEST_USER_EMAIL!);
      await page.fill('input[name="password"]', process.env.E2E_TEST_USER_PASSWORD!);
      await page.click('button[type="submit"]');
      await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));

      await page.goto("/");
      await page.locator('[data-testid="product-card"]').first().click();
      await page.getByRole("button", { name: /agregar al carrito/i }).click();
      await page.waitForTimeout(500);

      await page.goto("/checkout");
      await page.getByRole("button", { name: /confirmar/i }).click();
      await page.waitForURL(/\/checkout\/success/);

      const url = new URL(page.url());
      const orderId = url.searchParams.get("order_id");
      expect(orderId).toMatch(/^[0-9a-f-]{36}$/);

      const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
      await c.connect();
      try {
        const o = await c.query(`SELECT status, total_charged_cents FROM orders WHERE id=$1`, [orderId]);
        expect(o.rows[0].status).toBe("pendiente");
        expect(o.rows[0].total_charged_cents).toBeGreaterThan(0);
      } finally {
        await c.end();
      }
    },
  );
});
```

- [ ] **Step 3: Run unit tests**

Run: `pnpm test:unit`

Expected: all 15 (Phase 0) + 14 + 3 + 3 = ~35 PASS.

- [ ] **Step 4: Run integration tests**

Run: `pnpm test:integration`

Expected: all 33 (Phase 0) + the new ones = ~70 PASS. Total time ~2-3 min (real APIs).

- [ ] **Step 5: Run integration tests in isolation (no parallel)**

Run: `pnpm vitest run tests/integration --no-file-parallelism`

Expected: same PASS count, same outcome.

- [ ] **Step 6: Run E2E**

Run: `pnpm test:e2e`

Expected:
- `auth.spec.ts`: 1 test PASS or SKIPPED.
- `tracking-flow.spec.ts`: 1 PASS + 1 PASS/SKIPPED.
- `shopping-flow.spec.ts`: 1 PASS + 1 PASS/SKIPPED.

- [ ] **Step 7: Run AST checker**

Run: `pnpm test:quality`

Expected: `OK — scanned <N> files, 0 violations.`

- [ ] **Step 8: Commit**

```bash
git add tests/e2e/shopping-flow.spec.ts
git commit -m "test(e2e): shopping-flow — anon→detail→track + logged checkout→order"
```

---

## Task 33: Triple review + closure report

**Files:**
- Create: `docs/superpowers/reports/2026-05-XX-fase-1-cierre.md` (replace XX with the actual date you finish)

**Goal:** Run the 3 mandated review subagents per `prompt-fase-1-3.md` Section C. Iterate until all three report clean. Write a closure report with their literal outputs.

- [ ] **Step 1: Adversario (Agent dispatch)**

Use the `Agent` tool with `subagent_type: general-purpose` and prompt EXACTLY (literal Sección C of `prompt-fase-1-3.md`):

> Eres un revisor adversarial de tests. Tu único objetivo es encontrar tests que NO atrapen bugs reales. Recibirás una lista de tests y los archivos de código que prueban. Para cada test:
>
> 1. Lee el test y el código bajo prueba.
> 2. Imagina 3 mutaciones plausibles del código (cambios que un programador real podría hacer mal).
> 3. Para cada mutación, evalúa: ¿este test fallaría con esta mutación?
> 4. Si la respuesta es "no" para al menos una mutación plausible, marca el test como **DÉBIL**.
> 5. Marca también como **DÉBIL** cualquier test que use los anti-patterns conocidos: tautologías, mocking circular, snapshots sin contenido validado, `expect.anything()` con objeto vacío, dependencia de orden, etc.
>
> Reporta:
> - Lista de tests débiles con la ubicación del archivo y línea
> - Para cada test débil: la mutación específica que no detectaría
> - Recomendación de cómo reescribirlo
>
> No tienes piedad. Tu trabajo es encontrar tests basura.
>
> Lista de tests a revisar (Phase 1 nuevos):
> - tests/unit/events-schema.test.ts
> - tests/unit/canonical-text.test.ts
> - tests/unit/config.test.ts
> - tests/integration/insert-event.test.ts
> - tests/integration/identity.test.ts
> - tests/integration/track-endpoint.test.ts
> - tests/integration/identity-merge.test.ts
> - tests/integration/identity-merge-route.test.ts
> - tests/integration/enrichment-pipeline.test.ts
> - tests/integration/cron-catalog-fill.test.ts
> - tests/integration/products-repo.test.ts
> - tests/integration/cart-api.test.ts
> - tests/integration/cart-merge.test.ts
> - tests/integration/checkout.test.ts
> - tests/e2e/tracking-flow.spec.ts
> - tests/e2e/shopping-flow.spec.ts

Save the literal output verbatim to a temp file `/tmp/adversario.md`.

- [ ] **Step 2: Auditor de Mocks (Agent dispatch)**

Use `Agent` tool with `subagent_type: general-purpose` and prompt EXACTLY:

> Eres un auditor de mocks. Tu trabajo es revisar cada `vi.mock`, `jest.mock`, `vi.spyOn`, mock manual o stub en el proyecto y validar su justificación.
>
> El proyecto tiene UN SOLO mock permitido por diseño: la API agregadora de productos (en `src/sectors/b-catalog/mock/`). Cualquier otro mock requiere justificación escrita.
>
> Para cada mock encontrado fuera del mock oficial:
>
> 1. Identifica qué se está mockeando.
> 2. Pregunta: ¿qué se está probando realmente con este mock? ¿Lógica del sistema o solo aritmética del propio mock?
> 3. Marca como **INJUSTIFICADO** todo mock que: mockea Supabase BD; mockea Anthropic SDK; mockea Voyage AI; mockea Auth0 client (excepto unit tests muy específicos); mockea funciones del propio módulo bajo prueba (siempre injustificado).
> 4. Marca como **JUSTIFICADO** mocks que: aíslan tiempo (`vi.useFakeTimers()`); evitan side effects externos no deterministas.
>
> Reporta:
> - Lista total de mocks (con archivo y línea)
> - Para cada uno: justificado o injustificado, y por qué
> - Recomendación de cómo eliminar los injustificados
>
> Para tu análisis usa: `grep -rn "vi.mock\|jest.mock\|vi.spyOn" tests/ src/` y revisa archivo por archivo.

Save output to `/tmp/auditor.md`.

- [ ] **Step 3: Probador de Comportamiento (Agent dispatch)**

Start dev server first: `pnpm dev > /tmp/dev.log 2>&1 &` (record PID).

Use `Agent` tool with `subagent_type: general-purpose` and prompt EXACTLY:

> Eres un probador externo. NO tienes acceso al código de producción ni a los tests existentes — sólo al documento de especificación adjunto y al sistema corriendo localmente en `http://localhost:3000`.
>
> Tu trabajo es validar que el sistema cumple la especificación, sin mirar cómo está implementado.
>
> Especificación: `MVP_Ecommerce_Personalizado_Documento_Maestro v2.md` — sección 14 "Roadmap > Fase 1" + sección 7 "Sector A · Captura de datos" + sección 8 "Sector B · Catálogo".
>
> Pasos:
>
> 1. Lee la sección "Fase 1" del documento maestro.
> 2. Identifica los comportamientos observables que el documento promete: anonymous_id se persiste en cookie, eventos se registran en BD, cron trae productos del mock con embeddings, fusión de identidades en signup, búsqueda LIKE, carrito, checkout simulado.
> 3. Para cada comportamiento, diseña tu propio caso de prueba ad-hoc.
> 4. Ejecuta cada caso contra el sistema corriendo (curl, queries SQL via `psql $SUPABASE_DB_URL` o pg cliente, etc.).
> 5. Reporta cada caso como **PASA**, **FALLA**, o **NO VERIFICABLE** (con explicación).
>
> Tienes permitido leer únicamente:
> - `MVP_Ecommerce_Personalizado_Documento_Maestro v2.md`
> - `package.json` (para entender comandos pnpm disponibles)
> - `.env.local` (sólo para SUPABASE_DB_URL)
>
> Tienes prohibido leer cualquier archivo en `src/`, `tests/`, o `docs/superpowers/specs|plans/`.

Save output to `/tmp/probador.md`. Kill dev server after: `kill <PID>`.

- [ ] **Step 4: Iterate until all three report clean**

For each weak test (Adversario), each unjustified mock (Auditor), each FALLA (Probador): fix and re-invoke that specific reviewer until they report clean.

Each fix is its own commit:

```bash
git commit -m "fix(test): rewrite <test name> per Adversario feedback — now catches <mutation>"
```

- [ ] **Step 5: Write the closure report**

Replace `2026-05-XX` with today's date when finishing. Create `docs/superpowers/reports/<date>-fase-1-cierre.md`:

```md
# Reporte de cierre — Fase 1 · Tracking + Catálogo + UI

**Fecha:** <YYYY-MM-DD>
**Branch:** `feat/fase-1-tracking-catalog`
**Spec:** `docs/superpowers/specs/2026-05-07-fase-1-design.md`
**Plan:** `docs/superpowers/plans/2026-05-07-fase-1-tracking-catalog.md`

## Hitos completados

| # | Tarea | Commit |
|---|---|---|
| 1 | Smoke pre-flight | (hash) |
| 2 | Refactor lazy supabase | (hash) |
| 3 | AST checker scaled to wrappers | (hash) |
| 4 | Dynamic regex test_schema gen | (hash) |
| 5 | config zod + withPg | (hash) |
| 6 | Migration 0013 cart_items + regen | (hash) |
| 7-14 | Sector A: tracking infrastructure | (hashes) |
| 15-20 | Sector B: enrichment + cron + repo | (hashes) |
| 21-30 | UI surface | (hashes) |
| 31 | Mutation testing | (hash) |
| 32 | Full suite green + shopping-flow E2E | (hash) |
| 33 | Triple review + this report | (hash) |

## Tests escritos y estado final
(fill in after running pnpm test:unit, test:integration, test:e2e and capturing counts.)

## Bugs encontrados durante el desarrollo
(list real bugs caught by tests during implementation.)

## Output literal de los 3 revisores

### === AGENTE 1 (Adversario) — Output literal ===

[paste content of /tmp/adversario.md verbatim]

### === AGENTE 2 (Auditor de Mocks) — Output literal ===

[paste content of /tmp/auditor.md verbatim]

### === AGENTE 3 (Probador de Comportamiento) — Output literal ===

[paste content of /tmp/probador.md verbatim]

## Métricas

- Tests totales nuevos: ~54.
- Token cost de la suite: estimado ~$0.15 por corrida full.
- Productos en DB tras Task 19/32: <count>.
- Mock_calls acumuladas durante tests: <count>.
- Anti-pattern violations: 0.

## Items pendientes / Setup manual

(any follow-ups for Phase 2.)

## Decisión

✅ Fase 1 cerrada. Listo para Fase 2.
```

- [ ] **Step 6: Final commit**

```bash
git add docs/superpowers/reports/
git commit -m "docs(fase-1): closure report — triple review APPROVED"
```

---

## Self-review checklist (run after Task 33)

- [ ] All steps in all 33 tasks have a checkbox
- [ ] No "TBD" / "TODO" / "fill in later" left in the plan
- [ ] Every function name used in later tasks is defined in an earlier task
- [ ] Every import path matches the actual file location
- [ ] Test count matches spec (~54 new tests in Phase 1)
- [ ] All 5 mutation tests documented (Task 31)
- [ ] Closure report covers spec criteria (sec 8 of spec)

---

**Plan complete.** Total: 33 tasks; 16-22h of focused work; ~$0.15 in API tokens for the full integration test suite.
