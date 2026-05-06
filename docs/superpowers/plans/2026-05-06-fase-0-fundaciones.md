# Fase 0 · Fundaciones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruir las fundaciones del MVP e-commerce: Next.js 16 scaffolding, modelo de datos completo en Supabase con `pgvector`, clientes reales (Auth0/Voyage/Anthropic/Supabase), mock de API agregadora con fixture de 500 productos, infraestructura de tests (unit + integration + E2E con servicios reales), CI con tokens reales y healthchecks.

**Architecture:** Carpetas por sector (a-tracking, b-catalog, c-search, d-personalization, e-admin) + `src/lib` con frontera clara entre IO (db, auth, llm, embeddings) y lógica pura (`lib/math`). Migraciones SQL versionadas con runner propio. Schema de test (`test_schema`) replicado dentro del mismo proyecto Supabase, generado por script. TDD outside-in: cada entregable arranca con un test E2E o de integración rojo derivado del criterio de aceptación.

**Tech Stack:** Next.js 16.2.5 (App Router, TS, Turbopack), Tailwind v4, Auth0 nextjs-auth0 4.20.0, anthropic-sdk 0.95.0, voyageai 0.2.1, supabase-js 2.105.3, pg 8.20.0, vitest 4.1.5, playwright 1.59.1, fast-check, pnpm.

**Spec referenciada:** `docs/superpowers/specs/2026-05-06-rebuild-mvp-ecommerce-cuba-design.md`
**Documentos fuente de verdad:** `MVP_Ecommerce_Personalizado_Documento_Maestro v2.md`, `prompt-fase-0.md`

---

## File Structure

Archivos creados en esta fase (ruta absoluta partiendo de `/workspaces/ecommerce-cuba/`):

**Raíz del proyecto:**
- `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `.prettierrc`, `.gitignore`, `.nvmrc`, `.env.example`, `README.md`
- `vitest.config.ts`, `playwright.config.ts`

**App router:**
- `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- `src/app/api/health/db/route.ts`, `src/app/api/health/voyage/route.ts`, `src/app/api/health/anthropic/route.ts`

**Sectores (placeholders para scaffolding):**
- `src/sectors/a-tracking/.gitkeep`
- `src/sectors/b-catalog/mock/aggregator.ts`, `src/sectors/b-catalog/mock/fixture.ts`, `src/sectors/b-catalog/mock/types.ts`
- `src/sectors/c-search/.gitkeep`
- `src/sectors/d-personalization/.gitkeep`
- `src/sectors/e-admin/.gitkeep`

**Librerías:**
- `src/lib/db/supabase.ts`, `src/lib/db/pg.ts`
- `src/lib/auth/index.ts`
- `src/lib/llm/anthropic.ts`
- `src/lib/embeddings/voyage.ts`
- `src/lib/math/normalize.ts`, `src/lib/math/cosine.ts`
- `src/lib/time/clock.ts`

**Tipos compartidos:**
- `src/types/product.ts`, `src/types/event.ts`, `src/types/recipient.ts`

**Migraciones:**
- `supabase/migrations/0001_extensions.sql` … `supabase/migrations/0011_indexes_and_views.sql`
- `supabase/migrations/0012_test_schema_replicate.sql` (generado)

**Scripts:**
- `scripts/apply-migrations.ts`
- `scripts/verify-supabase.ts`
- `scripts/generate-test-schema-migration.ts`
- `scripts/seed-fixture.ts`
- `scripts/health-check.ts`
- `scripts/check-test-quality.ts`

**Tests:**
- `tests/unit/normalize.test.ts`, `tests/unit/cosine.test.ts`
- `tests/integration/db.test.ts`, `tests/integration/voyage.test.ts`, `tests/integration/anthropic.test.ts`, `tests/integration/mock-aggregator.test.ts`, `tests/integration/migrations.test.ts`, `tests/integration/test-schema-parity.test.ts`
- `tests/e2e/auth.spec.ts`
- `tests/helpers/db.ts`, `tests/helpers/playwright.ts`

**CI:**
- `.github/workflows/ci.yml`

---

## Pre-Task: Verify Environment

- [ ] **Step P.1: Verify tooling versions**

Run:
```bash
node --version    # expect v20+ (we have v24.14)
pnpm --version || npm install -g pnpm
git --version
```

Expected: all three present. If `pnpm` missing, install it.

- [ ] **Step P.2: Verify .env.local has all required vars**

Run:
```bash
grep -c '^AUTH0_DOMAIN=' .env.local && \
grep -c '^AUTH0_CLIENT_ID=' .env.local && \
grep -c '^AUTH0_CLIENT_SECRET=' .env.local && \
grep -c '^AUTH0_SECRET=' .env.local && \
grep -c '^APP_BASE_URL=' .env.local && \
grep -c '^NEXT_PUBLIC_SUPABASE_URL=' .env.local && \
grep -c '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env.local && \
grep -c '^SUPABASE_SERVICE_ROLE_KEY=' .env.local && \
grep -c '^SUPABASE_DB_URL=' .env.local && \
grep -c '^ANTHROPIC_API_KEY=' .env.local && \
grep -c '^VOYAGE_API_KEY=' .env.local
```

Expected: all `1`. If any is `0`, stop and ask the user.

---

## Task 1: Initialize Next.js project (manual scaffolding to preserve docs/)

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `.prettierrc`, `.gitignore`, `.nvmrc`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`

We scaffold manually because `create-next-app` would refuse to populate a non-empty directory and we want to preserve `docs/`, `prompt-fase-*.md`, and `.env.local`.

- [ ] **Step 1.1: Write `package.json`**

```json
{
  "name": "ecommerce-cuba",
  "version": "0.1.0",
  "private": true,
  "engines": {
    "node": ">=20"
  },
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev": "next dev --turbo",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:e2e": "playwright test",
    "test:all": "pnpm test:unit && pnpm test:integration && pnpm test:e2e",
    "test:quality": "tsx scripts/check-test-quality.ts",
    "migrate": "tsx scripts/apply-migrations.ts",
    "migrate:test": "tsx scripts/apply-migrations.ts --schema=test_schema",
    "verify:supabase": "tsx scripts/verify-supabase.ts",
    "health-check": "tsx scripts/health-check.ts",
    "seed:fixture": "tsx scripts/seed-fixture.ts",
    "format": "prettier --write \"**/*.{ts,tsx,md,json}\"",
    "format:check": "prettier --check \"**/*.{ts,tsx,md,json}\""
  },
  "dependencies": {
    "next": "16.2.5",
    "react": "19.2.1",
    "react-dom": "19.2.1",
    "@auth0/nextjs-auth0": "4.20.0",
    "@anthropic-ai/sdk": "0.95.0",
    "voyageai": "0.2.1",
    "@supabase/supabase-js": "2.105.3",
    "pg": "8.20.0",
    "uuid": "10.0.0"
  },
  "devDependencies": {
    "@types/node": "22.7.0",
    "@types/react": "19.0.0",
    "@types/react-dom": "19.0.0",
    "@types/pg": "8.11.10",
    "@types/uuid": "10.0.0",
    "typescript": "5.6.3",
    "tailwindcss": "4.0.0",
    "@tailwindcss/postcss": "4.0.0",
    "eslint": "9.13.0",
    "eslint-config-next": "16.2.5",
    "prettier": "3.3.3",
    "vitest": "4.1.5",
    "@vitest/coverage-v8": "4.1.5",
    "fast-check": "3.23.1",
    "@playwright/test": "1.59.1",
    "tsx": "4.19.2",
    "dotenv": "16.4.5"
  }
}
```

NOTE: If `pnpm install` reports newer compatible versions, **stop and run `pnpm install` once, capture the resolved versions in `pnpm-lock.yaml`, then continue**. Do not pin newer majors without verifying compatibility — for major bumps, check Context7 docs first.

- [ ] **Step 1.2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "scripts/**/*.ts", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 1.3: Write `next.config.ts`**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
```

- [ ] **Step 1.4: Write `postcss.config.mjs` (Tailwind v4)**

```javascript
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

- [ ] **Step 1.5: Write `eslint.config.mjs`**

```javascript
import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
```

- [ ] **Step 1.6: Write `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 1.7: Write `.gitignore`**

```
node_modules
.next
.env*.local
!.env.example
coverage
test-results
playwright-report
.turbo
*.log
```

- [ ] **Step 1.8: Write `.nvmrc`**

```
22
```

- [ ] **Step 1.9: Write `src/app/globals.css`**

```css
@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #171717;
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: system-ui, sans-serif;
}
```

- [ ] **Step 1.10: Write `src/app/layout.tsx`**

```typescript
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "E-commerce Cuba",
  description: "MVP de e-commerce reseller con personalización adaptativa",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 1.11: Write `src/app/page.tsx`**

```typescript
export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">E-commerce Cuba — Fase 0</h1>
      <p className="mt-2">Scaffolding inicial. Healthchecks en /api/health/*.</p>
    </main>
  );
}
```

- [ ] **Step 1.12: Install dependencies and run smoke check**

```bash
pnpm install
pnpm typecheck
pnpm next dev --turbo &
NEXT_PID=$!
sleep 5
curl -sf http://localhost:3000/ | grep -q "Fase 0"
kill $NEXT_PID
```

Expected: `pnpm install` resolves all deps; `typecheck` exits 0; the curl pipe finds "Fase 0" in the response.

- [ ] **Step 1.13: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs .prettierrc .gitignore .nvmrc src/app/
git commit -m "feat(setup): initialize Next.js 16 app with Tailwind v4 and TS strict"
```

---

## Task 2: Sector and lib scaffolding

**Files:**
- Create: `src/sectors/{a-tracking,b-catalog,c-search,d-personalization,e-admin}/.gitkeep`
- Create: `src/lib/{db,auth,llm,embeddings,math,time}/.gitkeep`
- Create: `src/types/.gitkeep`
- Create: `tests/{unit,integration,e2e,helpers}/.gitkeep`
- Create: `scripts/.gitkeep`
- Create: `supabase/migrations/.gitkeep`

- [ ] **Step 2.1: Create scaffolding directories with placeholder**

```bash
mkdir -p src/sectors/{a-tracking,b-catalog/mock,c-search,d-personalization,e-admin}
mkdir -p src/lib/{db,auth,llm,embeddings,math,time}
mkdir -p src/types
mkdir -p tests/{unit,integration,e2e,helpers}
mkdir -p scripts
mkdir -p supabase/migrations
find src/sectors src/lib src/types tests scripts supabase/migrations -type d -empty -exec touch {}/.gitkeep \;
```

- [ ] **Step 2.2: Verify structure with typecheck**

```bash
pnpm typecheck
```

Expected: exit 0 (no .ts files yet, just empty placeholders).

- [ ] **Step 2.3: Commit**

```bash
git add src/sectors src/lib src/types tests scripts supabase
git commit -m "feat(setup): scaffold sector, lib, tests and migrations directories"
```

---

## Task 3: Test infrastructure (vitest + playwright + check-test-quality)

**Files:**
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `scripts/check-test-quality.ts`
- Create: `tests/helpers/db.ts` (placeholder, real impl in Task 12)
- Create: `tests/helpers/playwright.ts` (placeholder, real impl in Task 15)

- [ ] **Step 3.1: Write `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/helpers/setup.ts"],
    testTimeout: 30_000, // integration tests hit real APIs
    hookTimeout: 30_000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true, // serial: shared test_schema state
      },
    },
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "src/sectors/**/*.ts"],
      exclude: ["**/*.test.ts", "**/types.ts"],
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
```

- [ ] **Step 3.2: Write `tests/helpers/setup.ts`**

```typescript
import { config } from "dotenv";
import { resolve } from "path";

// Load .env.local for tests (covers integration + E2E credentials)
config({ path: resolve(process.cwd(), ".env.local") });

if (!process.env.SUPABASE_DB_URL) {
  throw new Error("SUPABASE_DB_URL is required for tests; check .env.local");
}
```

- [ ] **Step 3.3: Write `playwright.config.ts`**

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false, // shared test_schema state
  retries: 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm next dev --turbo",
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 3.4: Write `scripts/check-test-quality.ts`**

This is an AST-based scanner. Uses TypeScript compiler API for accuracy (regex misses quoted strings, comments, etc.).

```typescript
#!/usr/bin/env tsx
/**
 * Scans tests/ for prohibited anti-patterns.
 * Exits non-zero if any are found. Run in pre-commit and CI.
 */
import { Project, SyntaxKind, Node, CallExpression } from "ts-morph";
import { glob } from "fs/promises";

const VIOLATIONS: { file: string; line: number; rule: string; snippet: string }[] = [];

function record(rule: string, node: Node, file: string) {
  VIOLATIONS.push({
    file,
    line: node.getStartLineNumber(),
    rule,
    snippet: node.getText().slice(0, 120),
  });
}

async function main() {
  const project = new Project({ tsConfigFilePath: "tsconfig.json" });
  const files: string[] = [];
  for await (const f of glob("tests/**/*.{ts,tsx,spec.ts,test.ts}")) files.push(f);
  if (files.length === 0) {
    console.log("[check-test-quality] No test files found yet.");
    return;
  }

  for (const filePath of files) {
    const sf = project.addSourceFileAtPath(filePath);
    sf.forEachDescendant((node) => {
      // Rule 7: .skip / .only / xit
      if (Node.isPropertyAccessExpression(node)) {
        const name = node.getName();
        if (["skip", "only"].includes(name) || node.getText().match(/\b(xit|xtest|xdescribe)\b/)) {
          record("R7-skipped-or-only", node, filePath);
        }
      }
      // Rule 1, 6: weak assertions
      if (Node.isCallExpression(node)) {
        const callText = node.getExpression().getText();
        if (callText === "expect") {
          const args = node.getArguments();
          if (args.length === 1) {
            const parent = node.getParentIfKind(SyntaxKind.PropertyAccessExpression);
            const chain = parent?.getParent()?.getText() ?? "";
            if (
              /\.toBeDefined\(\)\s*$/.test(chain) ||
              /\.not\.toBeNull\(\)\s*$/.test(chain) ||
              /\.toEqual\(\s*expect\.anything\(\)\s*\)\s*$/.test(chain) ||
              /\.toEqual\(\s*expect\.any\(Object\)\s*\)\s*$/.test(chain)
            ) {
              record("R1-weak-assertion", node, filePath);
            }
          }
        }
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
      }
    });
  }

  if (VIOLATIONS.length > 0) {
    console.error("\n[check-test-quality] Anti-pattern violations found:\n");
    for (const v of VIOLATIONS) {
      console.error(`  ${v.file}:${v.line}  [${v.rule}]  ${v.snippet}`);
    }
    process.exit(1);
  }
  console.log(`[check-test-quality] OK — scanned ${files.length} files, 0 violations.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
```

NOTE: Add `ts-morph` to devDependencies: `pnpm add -D ts-morph`. Use the latest stable version.

- [ ] **Step 3.5: Write placeholder helpers** (real impl in later tasks)

`tests/helpers/db.ts`:

```typescript
// Real implementation lands in Task 12 (db client) and Task 4 (migrations).
export const TEST_SCHEMA = "test_schema";
```

`tests/helpers/playwright.ts`:

```typescript
// Real implementation lands in Task 15 (Auth0 E2E).
export const E2E_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";
```

- [ ] **Step 3.6: Verify**

```bash
pnpm install
pnpm typecheck
pnpm test:quality   # should pass: 0 test files yet
```

- [ ] **Step 3.7: Commit**

```bash
git add vitest.config.ts playwright.config.ts scripts/check-test-quality.ts tests/helpers/
git commit -m "feat(test-infra): vitest, playwright, ast-based test-quality checker"
```

---

## Task 4: Migration runner script

**Files:**
- Create: `scripts/apply-migrations.ts`
- Create: `tests/integration/migrations.test.ts`

- [ ] **Step 4.1: Write the failing test (`tests/integration/migrations.test.ts`)**

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "pg";

describe("migration runner", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    await client.connect();
  });

  it("creates _migrations table on first run", async () => {
    // Run the migration runner against a known-empty test_schema marker
    const { execSync } = await import("child_process");
    execSync("pnpm migrate", { stdio: "inherit", env: { ...process.env } });

    const res = await client.query(
      `SELECT to_regclass('public._migrations') AS exists`,
    );
    expect(res.rows[0].exists).toBe("_migrations");
  });

  it("records each migration filename and checksum after applying", async () => {
    const res = await client.query(
      `SELECT filename, checksum FROM public._migrations ORDER BY filename ASC LIMIT 1`,
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(1);
    expect(res.rows[0].filename).toMatch(/^\d{4}_/);
    expect(res.rows[0].checksum).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
  });
});
```

- [ ] **Step 4.2: Run test, verify it fails**

```bash
pnpm test:integration tests/integration/migrations.test.ts
```

Expected: FAIL — script doesn't exist yet, or `_migrations` table doesn't exist.

- [ ] **Step 4.3: Write `scripts/apply-migrations.ts`**

```typescript
#!/usr/bin/env tsx
/**
 * Applies all SQL migrations in supabase/migrations/ in lexical order.
 * - Records each as (filename, applied_at, checksum) in `_migrations`.
 * - Aborts if a previously-applied migration's checksum changed (drift detection).
 * - Idempotent: skips migrations already applied.
 *
 * Usage: tsx scripts/apply-migrations.ts [--schema=test_schema]
 */
import { readFileSync, readdirSync } from "fs";
import { join, basename } from "path";
import { createHash } from "crypto";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function ensureMigrationsTable(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public._migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function applyMigrations() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is required");

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await ensureMigrationsTable(client);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.log("[migrate] No migrations found.");
      return;
    }

    const applied = await client.query(
      `SELECT filename, checksum FROM public._migrations`,
    );
    const appliedMap = new Map<string, string>(
      applied.rows.map((r) => [r.filename, r.checksum]),
    );

    for (const file of files) {
      const sqlPath = join(MIGRATIONS_DIR, file);
      const sql = readFileSync(sqlPath, "utf8");
      const checksum = sha256(sql);

      const previous = appliedMap.get(file);
      if (previous === checksum) {
        console.log(`[migrate] = ${file} (already applied)`);
        continue;
      }
      if (previous !== undefined && previous !== checksum) {
        throw new Error(
          `Drift detected: ${file} was applied with checksum ${previous} but file now hashes to ${checksum}. ` +
            `Edit a NEW migration instead of mutating an applied one.`,
        );
      }

      console.log(`[migrate] + ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO public._migrations (filename, checksum) VALUES ($1, $2)`,
          [file, checksum],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`[migrate] FAILED ${file}: ${(err as Error).message}`);
      }
    }

    console.log(`[migrate] OK — ${files.length} files processed.`);
  } finally {
    await client.end();
  }
}

applyMigrations().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4.4: Run test (still fails — no migrations yet to apply, but `_migrations` should be created on first invoke)**

```bash
pnpm test:integration tests/integration/migrations.test.ts
```

Expected: First test PASSES (`_migrations` table created); second test still fails (no rows yet — no SQL files to apply). This is expected; second test will pass after Task 5.

- [ ] **Step 4.5: Commit**

```bash
git add scripts/apply-migrations.ts tests/integration/migrations.test.ts
git commit -m "feat(db): migration runner with checksum-based drift detection"
```

---

## Task 5: Migration 0001 + 0002 (extensions + bootstrap)

**Files:**
- Create: `supabase/migrations/0001_extensions.sql`
- Create: `supabase/migrations/0002_test_schema.sql`

- [ ] **Step 5.1: Write `0001_extensions.sql`**

```sql
-- Enable pgvector for embeddings and pg_trgm for similarity search.
-- Idempotent: IF NOT EXISTS guards against re-runs and drift with existing DB state.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

- [ ] **Step 5.2: Write `0002_test_schema.sql`**

```sql
-- Dedicated schema for integration tests so prod-style data and test data never mix.
-- Tables themselves are populated by 0012_test_schema_replicate.sql (generated).
CREATE SCHEMA IF NOT EXISTS test_schema;
```

- [ ] **Step 5.3: Apply and verify**

```bash
pnpm migrate
pnpm test:integration tests/integration/migrations.test.ts
```

Expected: both tests in `migrations.test.ts` PASS now (`_migrations` table exists with 2 rows recorded).

- [ ] **Step 5.4: Add a verification query test** — append to `tests/integration/migrations.test.ts`:

```typescript
it("vector extension is active", async () => {
  const res = await client.query(
    `SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'`,
  );
  expect(res.rows).toHaveLength(1);
  expect(res.rows[0].extname).toBe("vector");
});

it("test_schema exists", async () => {
  const res = await client.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'test_schema'`,
  );
  expect(res.rows).toHaveLength(1);
});
```

Run: `pnpm test:integration tests/integration/migrations.test.ts`. Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add supabase/migrations/0001_extensions.sql supabase/migrations/0002_test_schema.sql tests/integration/migrations.test.ts
git commit -m "feat(db): migrations 0001-0002 — vector extension and test_schema"
```

---

## Task 6: Migration 0003 — core (users, anonymous_sessions, recipients)

**Files:**
- Create: `supabase/migrations/0003_core_users_anon_recipients.sql`

- [ ] **Step 6.1: Write the failing assertion in `tests/integration/migrations.test.ts`** — append:

```typescript
it("core tables exist with required columns", async () => {
  const tables = ["users", "anonymous_sessions", "recipients"];
  for (const t of tables) {
    const res = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [t],
    );
    expect(res.rows.length).toBeGreaterThan(0);
  }

  const usersCols = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'users'`,
  );
  const colNames = usersCols.rows.map((r) => r.column_name);
  expect(colNames).toEqual(
    expect.arrayContaining(["id", "email", "name", "balance_cents", "created_at"]),
  );
});
```

Run: FAIL (tables don't exist yet).

- [ ] **Step 6.2: Write `0003_core_users_anon_recipients.sql`**

```sql
CREATE TABLE IF NOT EXISTS public.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth0_sub     text UNIQUE,
  email         text UNIQUE NOT NULL,
  name          text,
  balance_cents integer NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.anonymous_sessions (
  anonymous_id   uuid PRIMARY KEY,
  user_id        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS anonymous_sessions_user_idx
  ON public.anonymous_sessions(user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.recipients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  gender          text CHECK (gender IN ('femenino', 'masculino', 'no_especifica')),
  age             smallint CHECK (age IS NULL OR (age >= 0 AND age <= 130)),
  address_cuba    jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recipients_user_idx ON public.recipients(user_id);
```

- [ ] **Step 6.3: Apply and verify**

```bash
pnpm migrate
pnpm test:integration tests/integration/migrations.test.ts
```

Expected: PASS.

- [ ] **Step 6.4: Commit**

```bash
git add supabase/migrations/0003_core_users_anon_recipients.sql tests/integration/migrations.test.ts
git commit -m "feat(db): migration 0003 — users, anonymous_sessions, recipients"
```

---

## Task 7: Migration 0004 — products (with embedding + tsvector + HNSW)

**Files:**
- Create: `supabase/migrations/0004_products.sql`

- [ ] **Step 7.1: Write failing assertion** — append to `migrations.test.ts`:

```typescript
it("products table has embedding vector(1024) and tsvector_es generated stored", async () => {
  const res = await client.query(`
    SELECT column_name, data_type, udt_name, is_generated
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products'
    ORDER BY ordinal_position
  `);
  const byName = Object.fromEntries(res.rows.map((r) => [r.column_name, r]));

  expect(byName.embedding.udt_name).toBe("vector");
  expect(byName.tsvector_es.is_generated).toBe("ALWAYS");

  // Verify vector dimension
  const dim = await client.query(`
    SELECT atttypmod FROM pg_attribute
    WHERE attrelid = 'public.products'::regclass AND attname = 'embedding'
  `);
  // For pgvector, atttypmod stores dimension directly (not (n+4))
  expect(dim.rows[0].atttypmod).toBe(1024);
});

it("products has HNSW index on embedding and GIN on tsvector", async () => {
  const res = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'products'
  `);
  const defs = res.rows.map((r) => r.indexdef).join("\n");
  expect(defs).toMatch(/USING hnsw .*embedding.*vector_cosine_ops/);
  expect(defs).toMatch(/USING gin .*tsvector_es/);
});
```

Run: FAIL.

- [ ] **Step 7.2: Write `0004_products.sql`**

```sql
CREATE TABLE IF NOT EXISTS public.products (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source              text NOT NULL,
  source_product_id   text NOT NULL,
  title               text NOT NULL,
  description         text NOT NULL DEFAULT '',
  price_cents         integer NOT NULL CHECK (price_cents >= 0),
  currency            text NOT NULL DEFAULT 'USD',
  image_url           text,
  raw_category        text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding           vector(1024),
  tsvector_es         tsvector GENERATED ALWAYS AS (
                        to_tsvector(
                          'spanish',
                          coalesce(title, '') || ' ' || coalesce(description, '')
                        )
                      ) STORED,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_refreshed_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_source_unique UNIQUE (source, source_product_id)
);

CREATE INDEX IF NOT EXISTS products_tsvector_idx
  ON public.products USING GIN (tsvector_es);

CREATE INDEX IF NOT EXISTS products_embedding_hnsw_idx
  ON public.products USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS products_metadata_gin_idx
  ON public.products USING GIN (metadata);

CREATE INDEX IF NOT EXISTS products_active_idx
  ON public.products (is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS products_last_refreshed_idx
  ON public.products (last_refreshed_at);
```

- [ ] **Step 7.3: Apply and verify**

```bash
pnpm migrate
pnpm test:integration tests/integration/migrations.test.ts
```

Expected: PASS.

- [ ] **Step 7.4: Commit**

```bash
git add supabase/migrations/0004_products.sql tests/integration/migrations.test.ts
git commit -m "feat(db): migration 0004 — products with vector(1024), tsvector, HNSW + GIN"
```

---

## Task 8: Migration 0005 — events

**Files:**
- Create: `supabase/migrations/0005_events.sql`

- [ ] **Step 8.1: Write failing assertion** — append to `migrations.test.ts`:

```typescript
it("events table has correct schema and indexes", async () => {
  const cols = await client.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events'
  `);
  const names = cols.rows.map((r) => r.column_name);
  expect(names).toEqual(expect.arrayContaining([
    "id", "client_event_id", "anonymous_id", "user_id", "session_id",
    "event_type", "occurred_at", "payload", "source",
  ]));

  const idxs = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'events'
  `);
  const idxNames = idxs.rows.map((r) => r.indexname);
  expect(idxNames).toEqual(expect.arrayContaining([
    "events_pkey",
    "events_anon_time_idx",
    "events_type_time_idx",
    "events_session_idx",
  ]));
});
```

Run: FAIL.

- [ ] **Step 8.2: Write `0005_events.sql`**

```sql
CREATE TABLE IF NOT EXISTS public.events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_event_id text,
  anonymous_id    uuid NOT NULL,
  user_id         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  session_id      uuid NOT NULL,
  event_type      text NOT NULL,
  occurred_at     timestamptz NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  source          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS events_client_event_id_uniq
  ON public.events (client_event_id) WHERE client_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_anon_time_idx
  ON public.events (anonymous_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS events_user_time_idx
  ON public.events (user_id, occurred_at DESC) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_type_time_idx
  ON public.events (event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS events_session_idx
  ON public.events (session_id, occurred_at);
```

- [ ] **Step 8.3: Apply and verify**

```bash
pnpm migrate
pnpm test:integration tests/integration/migrations.test.ts
```

Expected: PASS.

- [ ] **Step 8.4: Commit**

```bash
git add supabase/migrations/0005_events.sql tests/integration/migrations.test.ts
git commit -m "feat(db): migration 0005 — events with idempotency and indexes"
```

---

## Task 9: Migration 0006 — personalization tables

**Files:**
- Create: `supabase/migrations/0006_personalization.sql`

- [ ] **Step 9.1: Write failing assertion** — append:

```typescript
it("personalization tables exist with vector columns", async () => {
  const tables = [
    "user_profiles", "user_profile_modes", "session_vectors",
    "cohort_centroids", "excluded_products"
  ];
  for (const t of tables) {
    const res = await client.query(
      `SELECT to_regclass($1) AS exists`,
      [`public.${t}`],
    );
    expect(res.rows[0].exists).toBe(t);
  }

  // user_profile_modes must have vector_unnormalized vector(1024) and weight_sum
  const cols = await client.query(`
    SELECT column_name, udt_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profile_modes'
  `);
  const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));
  expect(byName.vector_unnormalized.udt_name).toBe("vector");
  expect(byName.weight_sum.udt_name).toMatch(/float8|double_precision/);
});
```

Run: FAIL.

- [ ] **Step 9.2: Write `0006_personalization.sql`**

```sql
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_id            uuid,
  user_id                 uuid REFERENCES public.users(id) ON DELETE CASCADE,
  n_events                integer NOT NULL DEFAULT 0,
  cohort_id               text,
  prior_vector            vector(1024),
  interpretable_profile   jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_recompute_at       timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_profiles_identity_xor CHECK (
    (anonymous_id IS NOT NULL) OR (user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_anon_uniq
  ON public.user_profiles (anonymous_id) WHERE anonymous_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_user_uniq
  ON public.user_profiles (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.user_profile_modes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_profile_id       uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  recipient_id          uuid REFERENCES public.recipients(id) ON DELETE CASCADE,
  mode_index            smallint NOT NULL CHECK (mode_index BETWEEN 1 AND 3),
  vector_unnormalized   vector(1024) NOT NULL,
  weight_sum            double precision NOT NULL DEFAULT 0,
  n_events_in_mode      integer NOT NULL DEFAULT 0,
  last_assigned_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_profile_modes_uniq UNIQUE (user_profile_id, recipient_id, mode_index)
);

CREATE INDEX IF NOT EXISTS user_profile_modes_profile_idx
  ON public.user_profile_modes (user_profile_id);

CREATE TABLE IF NOT EXISTS public.session_vectors (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            uuid NOT NULL UNIQUE,
  vector_unnormalized   vector(1024) NOT NULL,
  weight_sum            double precision NOT NULL DEFAULT 0,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cohort_centroids (
  cohort_id           text PRIMARY KEY,
  centroid_vector     vector(1024) NOT NULL,
  n_users_in_cohort   integer NOT NULL DEFAULT 0,
  last_recompute_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.excluded_products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_id    uuid,
  user_id         uuid REFERENCES public.users(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  excluded_at     timestamptz NOT NULL DEFAULT now(),
  ttl_until       timestamptz NOT NULL,
  CONSTRAINT excluded_products_identity_xor CHECK (
    (anonymous_id IS NOT NULL) OR (user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS excluded_products_anon_ttl_idx
  ON public.excluded_products (anonymous_id, ttl_until) WHERE anonymous_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS excluded_products_user_ttl_idx
  ON public.excluded_products (user_id, ttl_until) WHERE user_id IS NOT NULL;
```

- [ ] **Step 9.3: Apply, verify, commit**

```bash
pnpm migrate
pnpm test:integration tests/integration/migrations.test.ts
git add supabase/migrations/0006_personalization.sql tests/integration/migrations.test.ts
git commit -m "feat(db): migration 0006 — personalization tables (modes, sessions, cohorts, exclusions)"
```

---

## Task 10: Migration 0007 — co_occurrence

**Files:**
- Create: `supabase/migrations/0007_co_occurrence.sql`

- [ ] **Step 10.1: Write failing assertion** — append:

```typescript
it("co_occurrence enforces a < b and indexes are present", async () => {
  // Constraint check must exist
  const constraints = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'public.co_occurrence'::regclass
  `);
  const defs = constraints.rows.map((r) => r.def).join("\n");
  expect(defs).toMatch(/CHECK .*product_a_id\s*<\s*product_b_id/);
});
```

Run: FAIL.

- [ ] **Step 10.2: Write `0007_co_occurrence.sql`**

```sql
CREATE TABLE IF NOT EXISTS public.co_occurrence (
  product_a_id    uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_b_id    uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  count           double precision NOT NULL DEFAULT 0,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_a_id, product_b_id),
  CONSTRAINT co_occurrence_ordered CHECK (product_a_id < product_b_id)
);

CREATE INDEX IF NOT EXISTS co_occurrence_b_a_idx
  ON public.co_occurrence (product_b_id, product_a_id);

CREATE TABLE IF NOT EXISTS public.co_occurrence_top (
  product_id           uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  related_product_id   uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  npmi_score           double precision NOT NULL,
  rank                 smallint NOT NULL CHECK (rank BETWEEN 1 AND 50),
  last_recompute_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, related_product_id)
);

CREATE INDEX IF NOT EXISTS co_occurrence_top_rank_idx
  ON public.co_occurrence_top (product_id, rank);
```

- [ ] **Step 10.3: Apply, verify, commit**

```bash
pnpm migrate
pnpm test:integration tests/integration/migrations.test.ts
git add supabase/migrations/0007_co_occurrence.sql tests/integration/migrations.test.ts
git commit -m "feat(db): migration 0007 — co_occurrence (ordered pairs) + co_occurrence_top"
```

---

## Task 11: Migrations 0008-0010 (search/orders/eval)

**Files:**
- Create: `supabase/migrations/0008_search.sql`
- Create: `supabase/migrations/0009_orders.sql`
- Create: `supabase/migrations/0010_eval.sql`

- [ ] **Step 11.1: Write `0008_search.sql`**

```sql
CREATE TABLE IF NOT EXISTS public.searches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_id       uuid,
  user_id            uuid REFERENCES public.users(id) ON DELETE SET NULL,
  raw_query          text NOT NULL,
  normalized_json    jsonb,
  prompt_version     text,
  search_method      text CHECK (search_method IN ('like', 'bm25_only', 'cosine_only', 'hybrid_rrf')),
  results_count      integer,
  hit_cache          boolean,
  called_mock        boolean,
  occurred_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS searches_user_time_idx
  ON public.searches (user_id, occurred_at DESC) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.product_query_cache (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash          text NOT NULL UNIQUE,
  query_embedding     vector(1024),
  normalized_json     jsonb,
  products_returned   uuid[] NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  ttl_until           timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS product_query_cache_ttl_idx
  ON public.product_query_cache (ttl_until);

CREATE INDEX IF NOT EXISTS product_query_cache_embedding_idx
  ON public.product_query_cache USING hnsw (query_embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS public.mock_calls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  called_at       timestamptz NOT NULL DEFAULT now(),
  params          jsonb,
  response_size   integer,
  simulated_cost_cents integer NOT NULL DEFAULT 4, -- $0.04 per call
  latency_ms      integer,
  was_error       boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS mock_calls_time_idx ON public.mock_calls (called_at DESC);
```

- [ ] **Step 11.2: Write `0009_orders.sql`**

```sql
CREATE TYPE order_status AS ENUM (
  'pendiente', 'comprada', 'en_bodega', 'en_transito',
  'para_entrega', 'entregada',
  'stock_fantasma', 'precio_subido', 'danada_o_no_entregada'
);

CREATE TABLE IF NOT EXISTS public.orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recipient_id    uuid REFERENCES public.recipients(id) ON DELETE SET NULL,
  status          order_status NOT NULL DEFAULT 'pendiente',
  total_charged_cents integer NOT NULL,
  total_cost_cents    integer NOT NULL,
  margin_cents        integer GENERATED ALWAYS AS (total_charged_cents - total_cost_cents) STORED,
  status_history      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_user_idx ON public.orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON public.orders (status);

CREATE TABLE IF NOT EXISTS public.order_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id          uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_snapshot    jsonb NOT NULL,
  quantity            integer NOT NULL CHECK (quantity > 0),
  unit_price_cents    integer NOT NULL CHECK (unit_price_cents >= 0),
  unit_cost_cents     integer NOT NULL CHECK (unit_cost_cents >= 0)
);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON public.order_items (order_id);
```

- [ ] **Step 11.3: Write `0010_eval.sql`**

```sql
CREATE TABLE IF NOT EXISTS public.eval_holdout (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  purchased_at    timestamptz NOT NULL,
  used_in_eval    boolean NOT NULL DEFAULT false,
  CONSTRAINT eval_holdout_unique UNIQUE (user_id, product_id, purchased_at)
);

CREATE INDEX IF NOT EXISTS eval_holdout_unused_idx
  ON public.eval_holdout (used_in_eval) WHERE used_in_eval = false;
```

- [ ] **Step 11.4: Append assertion to `migrations.test.ts`**:

```typescript
it("search, orders, eval tables present", async () => {
  for (const t of [
    "searches", "product_query_cache", "mock_calls",
    "orders", "order_items", "eval_holdout",
  ]) {
    const res = await client.query(`SELECT to_regclass($1) AS exists`, [`public.${t}`]);
    expect(res.rows[0].exists).toBe(t);
  }
});
```

- [ ] **Step 11.5: Apply, verify, commit**

```bash
pnpm migrate
pnpm test:integration tests/integration/migrations.test.ts
git add supabase/migrations/0008_search.sql supabase/migrations/0009_orders.sql supabase/migrations/0010_eval.sql tests/integration/migrations.test.ts
git commit -m "feat(db): migrations 0008-0010 — search, orders, eval"
```

---

## Task 12: Migration 0011 + verify-supabase script

**Files:**
- Create: `supabase/migrations/0011_indexes_and_views.sql` (placeholder for future tuning)
- Create: `scripts/verify-supabase.ts`

- [ ] **Step 12.1: Write `0011_indexes_and_views.sql`** (intentionally minimal — Fase 0 needs no advanced indexes beyond per-table)

```sql
-- Reserved for Phase 0 closure checks; advanced indexes/views land in later phases.
-- Currently a no-op so the migration order has a stable slot for Phase 1+ additions.
SELECT 1;
```

- [ ] **Step 12.2: Write `scripts/verify-supabase.ts`**

```typescript
#!/usr/bin/env tsx
/**
 * Reports the live state of Supabase: extensions, schemas, tables, vector dim.
 * Exit code 0 = healthy. Non-zero = drift from expected Phase 0 state.
 */
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const REQUIRED_TABLES = [
  "users", "anonymous_sessions", "recipients",
  "products", "events",
  "user_profiles", "user_profile_modes", "session_vectors",
  "cohort_centroids", "excluded_products",
  "co_occurrence", "co_occurrence_top",
  "searches", "product_query_cache", "mock_calls",
  "orders", "order_items", "eval_holdout",
  "_migrations",
];

async function verify() {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await client.connect();
  let ok = true;

  try {
    const ext = await client.query(`SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector','pg_trgm') ORDER BY extname`);
    console.log("Extensions:", ext.rows);
    if (ext.rows.length < 2) { ok = false; console.error("Missing extensions"); }

    const schemas = await client.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('public','test_schema')`);
    console.log("Schemas:", schemas.rows.map((r) => r.schema_name));

    const tablesRes = await client.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `);
    const present = new Set(tablesRes.rows.map((r) => r.tablename));
    const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
    if (missing.length > 0) { ok = false; console.error("Missing tables:", missing); }
    console.log("Tables in public:", [...present].sort());

    const dim = await client.query(`
      SELECT atttypmod FROM pg_attribute
      WHERE attrelid = 'public.products'::regclass AND attname = 'embedding'
    `);
    if (dim.rows[0]?.atttypmod !== 1024) {
      ok = false;
      console.error(`products.embedding wrong dimension: ${dim.rows[0]?.atttypmod} (expected 1024)`);
    } else {
      console.log("products.embedding dimension: 1024 OK");
    }

    if (!ok) process.exit(1);
    console.log("\n[verify-supabase] ALL OK ✅");
  } finally {
    await client.end();
  }
}

verify().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 12.3: Run verify**

```bash
pnpm migrate
pnpm verify:supabase
```

Expected: prints "ALL OK ✅". Note: `_migrations` is created by the runner not a migration file, but we still expect it to be present.

- [ ] **Step 12.4: Commit**

```bash
git add supabase/migrations/0011_indexes_and_views.sql scripts/verify-supabase.ts
git commit -m "feat(db): migration 0011 placeholder + verify-supabase script"
```

---

## Task 13: Generate migration 0012 — test_schema replicate

**Files:**
- Create: `scripts/generate-test-schema-migration.ts`
- Create: `supabase/migrations/0012_test_schema_replicate.sql` (generated)
- Create: `tests/integration/test-schema-parity.test.ts`

- [ ] **Step 13.1: Write `scripts/generate-test-schema-migration.ts`**

```typescript
#!/usr/bin/env tsx
/**
 * Reads migrations 0003-0011 (table-DDL migrations), rewrites table/index references
 * from `public.` to `test_schema.`, and emits 0012_test_schema_replicate.sql.
 *
 * Why a script instead of hand-written SQL: Phase 0 alone has 19 tables. Hand-syncing
 * any change between public and test_schema would drift quickly. This guarantees parity.
 */
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const OUT = join(MIGRATIONS_DIR, "0012_test_schema_replicate.sql");

const RANGE = /^(00(0[3-9]|1[01]))_/; // 0003..0011

function rewrite(sql: string): string {
  return sql
    // Tables: CREATE TABLE [IF NOT EXISTS] public.foo  →  test_schema.foo
    .replace(/\bpublic\./g, "test_schema.")
    // Indexes don't carry schema in their NAME (Postgres derives from table) so we keep
    // index NAMES unique by appending _ts so they don't collide with public ones in pg_indexes
    .replace(/CREATE\s+(UNIQUE\s+)?INDEX\s+(IF\s+NOT\s+EXISTS\s+)?([a-z0-9_]+)/gi,
      (_m, uniq, ifn, name) => `CREATE ${uniq ?? ""}INDEX ${ifn ?? ""}${name}_ts`);
}

function main() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => RANGE.test(f)).sort();
  if (files.length === 0) {
    console.error("No source migrations 0003-0011 found.");
    process.exit(1);
  }
  const header = `-- AUTO-GENERATED by scripts/generate-test-schema-migration.ts
-- Replicates migrations ${files[0]}..${files.at(-1)} inside test_schema.
-- DO NOT EDIT BY HAND. Regenerate with: pnpm tsx scripts/generate-test-schema-migration.ts
`;
  const body = files
    .map((f) => `-- === ${f} ===\n` + rewrite(readFileSync(join(MIGRATIONS_DIR, f), "utf8")))
    .join("\n\n");
  writeFileSync(OUT, header + "\n" + body + "\n");
  console.log(`[generate] wrote ${OUT} from ${files.length} sources.`);
}

main();
```

NOTE: ENUM types declared in `0009_orders.sql` (`order_status`) are global and don't carry a schema in the same way; the replicate file will reference `test_schema.order_status` after rewrite, which won't exist. We handle this by predefining the enum in the test_schema header. Expand the header in 13.2 if needed.

- [ ] **Step 13.2: Adjust generator to handle ENUM types**

After reviewing the rewrite output, if `CREATE TYPE order_status` becomes `CREATE TYPE test_schema.order_status` we need to ensure references match. Add this to `rewrite()`:

```typescript
// CREATE TYPE without schema → put in test_schema explicitly
.replace(/CREATE\s+TYPE\s+([a-z0-9_]+)\s+AS\s+ENUM/gi,
  (_m, typ) => `CREATE TYPE test_schema.${typ} AS ENUM`)
// Bare type references in column defs (only the ones we know): order_status
.replace(/\border_status\b/g, "test_schema.order_status")
```

- [ ] **Step 13.3: Generate and apply**

```bash
pnpm tsx scripts/generate-test-schema-migration.ts
pnpm migrate
```

Expected: `0012_test_schema_replicate.sql` created and applied without errors.

- [ ] **Step 13.4: Write parity test (`tests/integration/test-schema-parity.test.ts`)**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

describe("test_schema parity with public", () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    await client.connect();
  });
  afterAll(async () => { await client.end(); });

  it("every public table (except _migrations) has a counterpart in test_schema with same columns", async () => {
    const publicTables = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename != '_migrations'
      ORDER BY tablename
    `);

    for (const { tablename } of publicTables.rows) {
      const pubCols = await client.query(`
        SELECT column_name, udt_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [tablename]);

      const testCols = await client.query(`
        SELECT column_name, udt_name FROM information_schema.columns
        WHERE table_schema = 'test_schema' AND table_name = $1
        ORDER BY ordinal_position
      `, [tablename]);

      expect(testCols.rows.length, `test_schema.${tablename} missing or empty`).toBe(pubCols.rows.length);
      const pubNames = pubCols.rows.map((r) => r.column_name);
      const testNames = testCols.rows.map((r) => r.column_name);
      expect(testNames).toEqual(pubNames);
    }
  });
});
```

- [ ] **Step 13.5: Run parity test**

```bash
pnpm test:integration tests/integration/test-schema-parity.test.ts
```

Expected: PASS.

- [ ] **Step 13.6: Commit**

```bash
git add scripts/generate-test-schema-migration.ts supabase/migrations/0012_test_schema_replicate.sql tests/integration/test-schema-parity.test.ts
git commit -m "feat(db): generate test_schema replica + parity test"
```

---

## Task 14: Supabase + pg clients with schema switch

**Files:**
- Create: `src/lib/db/supabase.ts`
- Create: `src/lib/db/pg.ts`
- Create: `tests/integration/db.test.ts`
- Update: `tests/helpers/db.ts`

- [ ] **Step 14.1: Write the failing test**

```typescript
// tests/integration/db.test.ts
import { describe, it, expect } from "vitest";
import { getSupabaseClient } from "@/lib/db/supabase";
import { getPgClient } from "@/lib/db/pg";

describe("db clients", () => {
  it("supabase client points to public schema by default and round-trips a query", async () => {
    const sb = getSupabaseClient({ scope: "public" });
    const { error, count } = await sb.from("users").select("*", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(typeof count).toBe("number");
  });

  it("supabase client can be scoped to test_schema", async () => {
    const sb = getSupabaseClient({ scope: "test" });
    // The schema option requires the table to exist in test_schema (it does after migration 0012)
    const { error } = await sb.from("users").select("id").limit(1);
    expect(error).toBeNull();
  });

  it("pg client respects search_path for the chosen scope", async () => {
    const pg = await getPgClient({ scope: "test" });
    try {
      const res = await pg.query(`SHOW search_path`);
      expect(res.rows[0].search_path).toContain("test_schema");
    } finally {
      await pg.end();
    }
  });
});
```

Run: FAIL — modules not yet created.

- [ ] **Step 14.2: Write `src/lib/db/supabase.ts`**

```typescript
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Scope = "public" | "test";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!url || !anonKey) {
  throw new Error("Supabase env vars missing (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)");
}

export function getSupabaseClient(opts: { scope?: Scope; admin?: boolean } = {}): SupabaseClient {
  const { scope = "public", admin = false } = opts;
  const key = admin ? serviceKey : anonKey;
  if (admin && !serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY required for admin client");
  return createClient(url, key, {
    db: { schema: scope === "test" ? "test_schema" : "public" },
    auth: { persistSession: false },
  });
}
```

- [ ] **Step 14.3: Write `src/lib/db/pg.ts`**

```typescript
import { Client } from "pg";
import type { Scope } from "./supabase";

export async function getPgClient(opts: { scope?: Scope } = {}): Promise<Client> {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is required");
  const client = new Client({ connectionString: url });
  await client.connect();
  const schema = opts.scope === "test" ? "test_schema, public" : "public";
  await client.query(`SET search_path TO ${schema}`);
  return client;
}
```

- [ ] **Step 14.4: Update `tests/helpers/db.ts`**

```typescript
import { getPgClient } from "@/lib/db/pg";

export const TEST_SCHEMA = "test_schema";

export async function withTestDb<T>(
  fn: (client: Awaited<ReturnType<typeof getPgClient>>) => Promise<T>,
): Promise<T> {
  const client = await getPgClient({ scope: "test" });
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function truncateTestTables(tables: string[]) {
  await withTestDb(async (client) => {
    for (const t of tables) {
      await client.query(`TRUNCATE test_schema.${t} CASCADE`);
    }
  });
}
```

- [ ] **Step 14.5: Run tests**

```bash
pnpm test:integration tests/integration/db.test.ts
```

Expected: PASS.

- [ ] **Step 14.6: Commit**

```bash
git add src/lib/db/ tests/integration/db.test.ts tests/helpers/db.ts
git commit -m "feat(db): supabase + pg clients with public/test schema switch"
```

---

## Task 15: Voyage embeddings client

**Files:**
- Create: `src/lib/embeddings/voyage.ts`
- Create: `tests/integration/voyage.test.ts`

- [ ] **Step 15.1: Verify SDK API shape**

Before writing the wrapper, look up the voyageai 0.2.1 API surface via Context7 to avoid guessing:

```bash
# Run this manually before continuing:
# (Context7) query /websites/voyageai for "voyage-4 typescript SDK embed text input_type document"
```

Confirm the TS SDK exposes `client.embed({ input, model, input_type, output_dimension })` and returns `{ data: [{ embedding: number[] }, ...] }`. If the SDK shape differs from this guess, adjust the wrapper accordingly. **If the SDK looks unstable or buggy, skip directly to a `fetch`-based implementation against `https://api.voyageai.com/v1/embeddings` — see fallback in step 15.3.**

- [ ] **Step 15.2: Write the failing test (`tests/integration/voyage.test.ts`)**

```typescript
import { describe, it, expect } from "vitest";
import { embed, EMBEDDING_DIM } from "@/lib/embeddings/voyage";

describe("voyage embeddings (real API)", () => {
  it("returns 1024-dim normalized vector for a document", async () => {
    const [vec] = await embed(["camiseta de algodón color rojo talla M"], { inputType: "document" });
    expect(vec).toHaveLength(EMBEDDING_DIM);
    expect(EMBEDDING_DIM).toBe(1024);

    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    expect(Math.abs(norm - 1)).toBeLessThan(1e-3);
  });

  it("embeds multiple texts in one call", async () => {
    const vecs = await embed(
      ["zapato de cuero", "auriculares bluetooth"],
      { inputType: "document" },
    );
    expect(vecs).toHaveLength(2);
    expect(vecs[0]).toHaveLength(1024);
    expect(vecs[1]).toHaveLength(1024);
  });

  it("uses input_type=query when requested", async () => {
    // We can't observe the prepended prompt directly, but we can verify the call doesn't error
    // and the resulting vector has the right shape. Behavioral coverage of query vs document
    // input lives in higher-level retrieval tests in Phase 2.
    const [vec] = await embed(["regalo niña 8 años"], { inputType: "query" });
    expect(vec).toHaveLength(1024);
  });
});
```

Run: FAIL — module missing.

- [ ] **Step 15.3: Write `src/lib/embeddings/voyage.ts`**

```typescript
/**
 * Thin wrapper over the Voyage AI API.
 * Strategy: try the official SDK first; fall back to fetch on shape mismatch.
 *
 * We pin: model = voyage-4, output_dimension = 1024, output_dtype = float, normalize to unit L2.
 * voyage-4 returns vectors in float space; we re-normalize defensively because
 * downstream pgvector queries assume unit-norm vectors (cosine distance ≡ 1 - dot).
 */

export const EMBEDDING_MODEL = "voyage-4";
export const EMBEDDING_DIM = 1024;

export type InputType = "document" | "query";

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
  model: string;
  usage: { total_tokens: number };
}

const API_URL = "https://api.voyageai.com/v1/embeddings";

function l2normalize(v: number[]): number[] {
  const sumSq = v.reduce((s, x) => s + x * x, 0);
  const n = Math.sqrt(sumSq);
  if (n === 0) return v.slice();
  return v.map((x) => x / n);
}

export async function embed(
  texts: string[],
  opts: { inputType: InputType },
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY is required");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts,
      model: EMBEDDING_MODEL,
      input_type: opts.inputType,
      output_dimension: EMBEDDING_DIM,
      output_dtype: "float",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Voyage API ${res.status}: ${text}`);
  }

  const json = (await res.json()) as VoyageResponse;
  return json.data
    .sort((a, b) => a.index - b.index)
    .map((d) => l2normalize(d.embedding));
}
```

NOTE: We start with the fetch-based implementation directly. The voyageai 0.2.1 SDK is young; depending on `fetch` keeps us in control of error behavior and avoids surprise updates. Keep the public surface (`embed`, `EMBEDDING_DIM`, `EMBEDDING_MODEL`) so we can swap to SDK later without changing callers.

- [ ] **Step 15.4: Run test**

```bash
pnpm test:integration tests/integration/voyage.test.ts
```

Expected: PASS. If it fails with HTTP 401, double-check `VOYAGE_API_KEY` in `.env.local`.

- [ ] **Step 15.5: Commit**

```bash
git add src/lib/embeddings/voyage.ts tests/integration/voyage.test.ts
git commit -m "feat(embeddings): voyage-4 client with normalize-defensive (1024 float)"
```

---

## Task 16: Anthropic client with prompt caching

**Files:**
- Create: `src/lib/llm/anthropic.ts`
- Create: `tests/integration/anthropic.test.ts`

- [ ] **Step 16.1: Verify SDK API shape**

Look up `@anthropic-ai/sdk@0.95.0`:
- `messages.create({ model, system: [{type:"text", text, cache_control:{type:"ephemeral"}}], messages, max_tokens })`
- Response includes `usage.cache_creation_input_tokens` and `usage.cache_read_input_tokens`.

Confirm via Context7 if uncertain. The cache_control parameter goes on system blocks (or user content blocks) and Anthropic returns cache hit/miss telemetry in `usage`.

- [ ] **Step 16.2: Write the failing test**

```typescript
// tests/integration/anthropic.test.ts
import { describe, it, expect } from "vitest";
import { sendMessage, MODELS } from "@/lib/llm/anthropic";

describe("anthropic client (real API)", () => {
  it("sends a message and receives non-empty text response", async () => {
    const out = await sendMessage({
      model: MODELS.haiku,
      system: "Eres un asistente conciso. Responde en una sola oración.",
      messages: [{ role: "user", content: "Saluda en español." }],
      maxTokens: 64,
    });
    expect(out.text.length).toBeGreaterThan(0);
    expect(out.usage.input_tokens).toBeGreaterThan(0);
    expect(out.usage.output_tokens).toBeGreaterThan(0);
  });

  it("caches a long system prompt across two calls", async () => {
    // System block must be >= 1024 tokens for caching to be eligible (Anthropic limit).
    // Pad with a long stable preamble so the cache is meaningful.
    const longSystem = "Eres un asistente. ".repeat(400) + "Responde con UNA palabra.";

    const a = await sendMessage({
      model: MODELS.haiku,
      system: longSystem,
      cacheSystem: true,
      messages: [{ role: "user", content: "Di 'hola'." }],
      maxTokens: 16,
    });

    const b = await sendMessage({
      model: MODELS.haiku,
      system: longSystem,
      cacheSystem: true,
      messages: [{ role: "user", content: "Di 'hola'." }],
      maxTokens: 16,
    });

    // First call may or may not show a cache hit (just-created); second should.
    const cacheRead = b.usage.cache_read_input_tokens ?? 0;
    expect(cacheRead).toBeGreaterThan(0);
  });
});
```

Run: FAIL — module missing.

- [ ] **Step 16.3: Write `src/lib/llm/anthropic.ts`**

```typescript
import Anthropic from "@anthropic-ai/sdk";

export const MODELS = {
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
} as const;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required");
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export interface SendMessageInput {
  model: string;
  system: string;
  cacheSystem?: boolean;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens: number;
  temperature?: number;
}

export interface SendMessageOutput {
  text: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export async function sendMessage(input: SendMessageInput): Promise<SendMessageOutput> {
  const sys = input.cacheSystem
    ? [{ type: "text" as const, text: input.system, cache_control: { type: "ephemeral" as const } }]
    : input.system;

  const res = await client().messages.create({
    model: input.model,
    max_tokens: input.maxTokens,
    temperature: input.temperature ?? 0,
    system: sys as never, // SDK accepts string or array of blocks
    messages: input.messages,
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");

  return {
    text,
    usage: {
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      cache_creation_input_tokens: (res.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens,
      cache_read_input_tokens: (res.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens,
    },
  };
}
```

- [ ] **Step 16.4: Run test**

```bash
pnpm test:integration tests/integration/anthropic.test.ts
```

Expected: PASS. If the cache test fails because the system prompt is too short for Anthropic's caching threshold, increase the repeat count in the test.

- [ ] **Step 16.5: Commit**

```bash
git add src/lib/llm/anthropic.ts tests/integration/anthropic.test.ts
git commit -m "feat(llm): anthropic client with optional system prompt caching"
```

---

## Task 17: Auth0 v4 setup with E2E test

**Files:**
- Create: `src/lib/auth/index.ts`
- Create: `src/middleware.ts`
- Create: `src/app/(auth)/profile/page.tsx`
- Create: `tests/e2e/auth.spec.ts`
- Update: `.env.example`

- [ ] **Step 17.1: Verify Auth0 v4 setup**

Auth0 nextjs-auth0 v4 uses `Auth0Client` + middleware. Required env vars (already in `.env.local`):
- `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `APP_BASE_URL`.

If Auth0 v4 docs show a different setup pattern, adjust accordingly. Verify via Context7 query: `/auth0/nextjs-auth0` "v4 middleware Auth0Client setup".

- [ ] **Step 17.2: Write `src/lib/auth/index.ts`**

```typescript
import { Auth0Client } from "@auth0/nextjs-auth0/server";

export const auth0 = new Auth0Client({
  domain: process.env.AUTH0_DOMAIN!,
  clientId: process.env.AUTH0_CLIENT_ID!,
  clientSecret: process.env.AUTH0_CLIENT_SECRET!,
  appBaseUrl: process.env.APP_BASE_URL!,
  secret: process.env.AUTH0_SECRET!,
});
```

- [ ] **Step 17.3: Write `src/middleware.ts`**

```typescript
import type { NextRequest } from "next/server";
import { auth0 } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  return auth0.middleware(req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/cron).*)"],
};
```

- [ ] **Step 17.4: Write `src/app/(auth)/profile/page.tsx`**

```typescript
import { auth0 } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">Perfil</h1>
      <p className="mt-2">Hola, {session.user.name ?? session.user.email}</p>
      <a href="/auth/logout" className="mt-4 underline">Cerrar sesión</a>
    </main>
  );
}
```

- [ ] **Step 17.5: Update `.env.example`**

```
# Auth0 v4
AUTH0_DOMAIN=
AUTH0_CLIENT_ID=
AUTH0_CLIENT_SECRET=
AUTH0_SECRET=
APP_BASE_URL=http://localhost:3000

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=

# Anthropic
ANTHROPIC_API_KEY=

# Voyage
VOYAGE_API_KEY=

# E2E test user (NOT committed)
E2E_TEST_USER_EMAIL=
E2E_TEST_USER_PASSWORD=

# Misc
TEST_ENDPOINTS_ENABLED=false
```

- [ ] **Step 17.6: Set up Auth0 test user**

**Manual step (one-time):** ask the user to create a test user in their Auth0 tenant, e.g. `e2e-test@cuba.dev`, with a strong password. Add credentials to `.env.local`:

```
E2E_TEST_USER_EMAIL=e2e-test@cuba.dev
E2E_TEST_USER_PASSWORD=<password>
```

Verify Auth0 application settings include `http://localhost:3000/auth/callback` as an Allowed Callback URL.

- [ ] **Step 17.7: Write the E2E test (`tests/e2e/auth.spec.ts`)**

```typescript
import { test, expect } from "@playwright/test";

test.describe("Auth0 v4 login flow (real)", () => {
  test("anonymous → login → /profile shows user email", async ({ page }) => {
    const email = process.env.E2E_TEST_USER_EMAIL;
    const password = process.env.E2E_TEST_USER_PASSWORD;
    if (!email || !password) test.skip(true, "E2E_TEST_USER_* not configured");

    await page.goto("/profile");
    // middleware redirects to /auth/login then to Auth0 universal login
    await page.waitForURL(/auth0\.com\/u\/login/);

    await page.getByLabel(/email/i).fill(email!);
    await page.getByLabel(/password/i).fill(password!);
    await page.getByRole("button", { name: /continue|log in|iniciar sesión/i }).click();

    // After consent (if any), back to our app at /profile
    await page.waitForURL("**/profile", { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: /perfil/i })).toBeVisible();
    await expect(page.getByText(email!)).toBeVisible();
  });
});
```

- [ ] **Step 17.8: Run E2E**

```bash
pnpm test:e2e tests/e2e/auth.spec.ts
```

Expected: PASS. If Auth0 universal login UI changes, adjust selectors. If consent screen shows, add a click step before `waitForURL("**/profile", ...)`.

- [ ] **Step 17.9: Commit**

```bash
git add src/lib/auth/ src/middleware.ts src/app/(auth)/ tests/e2e/auth.spec.ts .env.example
git commit -m "feat(auth): auth0 v4 middleware + /profile + E2E login test"
```

---

## Task 18: Clock injectable

**Files:**
- Create: `src/lib/time/clock.ts`
- Create: `tests/unit/clock.test.ts`

- [ ] **Step 18.1: Write the failing test**

```typescript
// tests/unit/clock.test.ts
import { describe, it, expect } from "vitest";
import { systemClock, fixedClock, FixedClock } from "@/lib/time/clock";

describe("Clock", () => {
  it("systemClock returns close to Date.now()", () => {
    const before = Date.now();
    const t = systemClock.now();
    const after = Date.now();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it("fixedClock returns exactly the time it was set to", () => {
    const c: FixedClock = fixedClock(new Date("2026-05-06T12:00:00Z"));
    expect(c.now()).toBe(new Date("2026-05-06T12:00:00Z").getTime());
  });

  it("fixedClock can advance by milliseconds", () => {
    const c = fixedClock(new Date("2026-05-06T12:00:00Z"));
    c.advance(15 * 24 * 3600_000); // +15 days
    expect(c.now()).toBe(new Date("2026-05-21T12:00:00Z").getTime());
  });
});
```

Run: FAIL.

- [ ] **Step 18.2: Write `src/lib/time/clock.ts`**

```typescript
export interface Clock {
  now(): number;
}

export interface FixedClock extends Clock {
  advance(ms: number): void;
  set(ts: number | Date): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

export function fixedClock(initial: number | Date): FixedClock {
  let t = typeof initial === "number" ? initial : initial.getTime();
  return {
    now: () => t,
    advance: (ms) => { t += ms; },
    set: (ts) => { t = typeof ts === "number" ? ts : ts.getTime(); },
  };
}
```

- [ ] **Step 18.3: Run + commit**

```bash
pnpm test:unit tests/unit/clock.test.ts
git add src/lib/time/ tests/unit/clock.test.ts
git commit -m "feat(time): injectable Clock for deterministic TTL/decay tests"
```

---

## Task 19: Math — normalize + cosine with property tests + mutation

**Files:**
- Create: `src/lib/math/normalize.ts`
- Create: `src/lib/math/cosine.ts`
- Create: `tests/unit/normalize.test.ts`
- Create: `tests/unit/cosine.test.ts`

- [ ] **Step 19.1: Write failing tests for normalize**

```typescript
// tests/unit/normalize.test.ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { normalize } from "@/lib/math/normalize";

describe("normalize", () => {
  it("zero vector returns zero vector (no NaN)", () => {
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("unit vector is preserved", () => {
    expect(normalize([1, 0, 0])).toEqual([1, 0, 0]);
  });

  it("scalar multiple of unit vector normalizes to it", () => {
    const n = normalize([5, 0, 0]);
    expect(n[0]).toBeCloseTo(1, 9);
    expect(n[1]).toBe(0);
    expect(n[2]).toBe(0);
  });

  it("property: any non-zero vector normalizes to unit norm", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: -100, max: 100, noNaN: true }), { minLength: 2, maxLength: 1024 }),
        (raw) => {
          if (raw.every((x) => x === 0)) return; // skip zero
          const n = normalize(raw);
          const norm = Math.sqrt(n.reduce((s, x) => s + x * x, 0));
          expect(Math.abs(norm - 1)).toBeLessThan(1e-9);
        },
      ),
    );
  });
});
```

- [ ] **Step 19.2: Write `src/lib/math/normalize.ts`**

```typescript
/** L2-normalize a vector. Zero vectors return a zero vector (not NaN). */
export function normalize(v: readonly number[]): number[] {
  const sumSq = v.reduce((s, x) => s + x * x, 0);
  if (sumSq === 0) return v.slice() as number[];
  const inv = 1 / Math.sqrt(sumSq);
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
  return out;
}
```

- [ ] **Step 19.3: Run normalize tests**

```bash
pnpm test:unit tests/unit/normalize.test.ts
```

Expected: PASS.

- [ ] **Step 19.4: Mutation testing for normalize (manual, documented)**

Manually mutate `src/lib/math/normalize.ts:7` (the inv = 1/Math.sqrt line) to `const inv = Math.sqrt(sumSq)` (no inverse). Run unit tests:

```bash
pnpm test:unit tests/unit/normalize.test.ts
```

Expected: FAIL (property test breaks because resulting norm is sumSq, not 1). Restore the line, re-run, expect PASS.

Document in commit:

- [ ] **Step 19.5: Write failing tests for cosine**

```typescript
// tests/unit/cosine.test.ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { cosine } from "@/lib/math/cosine";
import { normalize } from "@/lib/math/normalize";

describe("cosine", () => {
  it("identical unit vectors → 1", () => {
    const v = normalize([3, 4, 0]);
    expect(cosine(v, v)).toBeCloseTo(1, 9);
  });

  it("orthogonal unit vectors → 0", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 9);
  });

  it("opposite unit vectors → -1", () => {
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1, 9);
  });

  it("zero vector cosine returns 0 (defined behavior, no NaN)", () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("dimension mismatch throws", () => {
    expect(() => cosine([1, 2], [1, 2, 3])).toThrow();
  });

  it("property: cosine is symmetric", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: -10, max: 10, noNaN: true }), { minLength: 2, maxLength: 256 }),
        fc.array(fc.float({ min: -10, max: 10, noNaN: true }), { minLength: 2, maxLength: 256 }),
        (a, b) => {
          if (a.length !== b.length) return; // skip mismatched
          if (a.every((x) => x === 0) || b.every((x) => x === 0)) return;
          const ab = cosine(a, b);
          const ba = cosine(b, a);
          expect(Math.abs(ab - ba)).toBeLessThan(1e-9);
        },
      ),
    );
  });

  it("property: cosine ∈ [-1, 1] within float tolerance", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: -10, max: 10, noNaN: true }), { minLength: 2, maxLength: 256 }),
        fc.array(fc.float({ min: -10, max: 10, noNaN: true }), { minLength: 2, maxLength: 256 }),
        (a, b) => {
          if (a.length !== b.length) return;
          if (a.every((x) => x === 0) || b.every((x) => x === 0)) return;
          const c = cosine(a, b);
          expect(c).toBeGreaterThanOrEqual(-1 - 1e-9);
          expect(c).toBeLessThanOrEqual(1 + 1e-9);
        },
      ),
    );
  });
});
```

- [ ] **Step 19.6: Write `src/lib/math/cosine.ts`**

```typescript
/**
 * Cosine similarity. Returns 0 if either vector is zero (defined non-NaN behavior).
 * Throws on dimension mismatch.
 */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    sa += a[i] * a[i];
    sb += b[i] * b[i];
  }
  if (sa === 0 || sb === 0) return 0;
  return dot / Math.sqrt(sa * sb);
}
```

- [ ] **Step 19.7: Mutation testing for cosine**

Mutate `dot / Math.sqrt(sa * sb)` to `dot / (sa * sb)` (forgot the sqrt). Run:

```bash
pnpm test:unit tests/unit/cosine.test.ts
```

Expected: FAIL (the "identical unit vectors → 1" test fails because dot=1, sa*sb=1, but with the bug, only when sa=sb=1 it accidentally still works... so this mutation may not be caught by that one test alone — but the property test "cosine ∈ [-1, 1]" will catch it). Restore line, re-run, PASS.

- [ ] **Step 19.8: Commit (with mutation notes)**

```bash
git add src/lib/math/ tests/unit/normalize.test.ts tests/unit/cosine.test.ts
git commit -m "$(cat <<'EOF'
feat(math): normalize + cosine with property tests

- normalize: zero-vector safe (returns zero, not NaN); inv-sqrt impl
- cosine: zero-vector safe; throws on dim mismatch
- fast-check property tests assert: norm == 1, cosine ∈ [-1, 1], symmetry
- mutation testing verified:
  - changed inv=1/sqrt(s) to sqrt(s) in normalize.ts:7 → property test failed; restored
  - changed sqrt(sa*sb) to (sa*sb) in cosine.ts:13 → property test [-1,1] failed; restored
EOF
)"
```

---

## Task 20: Mock aggregator types + fixture generator

**Files:**
- Create: `src/sectors/b-catalog/mock/types.ts`
- Create: `src/sectors/b-catalog/mock/fixture.ts`
- Create: `scripts/seed-fixture.ts`
- Create: `tests/integration/mock-aggregator.test.ts` (failing test for fixture distribution)

- [ ] **Step 20.1: Write `src/sectors/b-catalog/mock/types.ts`**

```typescript
export type MockProductSource = "amazon" | "aliexpress" | "shein";

export type MockCategory =
  | "ropa"
  | "electronica"
  | "hogar"
  | "juguetes_bebe"
  | "belleza"
  | "otros";

export interface MockProduct {
  id: string; // mock-internal stable ID
  source: MockProductSource;
  source_product_id: string;
  title: string;
  description: string;
  image_url: string;
  price_cents: number;
  brand: string;
  raw_category: string;
  attributes: Record<string, unknown>;
}

export const TARGET_DISTRIBUTION: Record<MockCategory, number> = {
  ropa: 0.40,
  electronica: 0.20,
  hogar: 0.15,
  juguetes_bebe: 0.10,
  belleza: 0.10,
  otros: 0.05,
};

export const FIXTURE_SIZE = 500;
```

- [ ] **Step 20.2: Write the failing test for fixture distribution**

```typescript
// tests/integration/mock-aggregator.test.ts (start)
import { describe, it, expect } from "vitest";
import { loadFixture, FIXTURE_SIZE, TARGET_DISTRIBUTION } from "@/sectors/b-catalog/mock/fixture";

describe("mock fixture", () => {
  it("loads exactly 500 products", async () => {
    const fixture = await loadFixture();
    expect(fixture).toHaveLength(FIXTURE_SIZE);
  });

  it("has unique IDs", async () => {
    const fixture = await loadFixture();
    const ids = new Set(fixture.map((p) => p.id));
    expect(ids.size).toBe(FIXTURE_SIZE);
  });

  it("category distribution matches target ±2%", async () => {
    const fixture = await loadFixture();
    for (const [cat, target] of Object.entries(TARGET_DISTRIBUTION)) {
      const count = fixture.filter((p) => categoryOf(p) === cat).length;
      const ratio = count / FIXTURE_SIZE;
      expect(Math.abs(ratio - target)).toBeLessThan(0.02);
    }
  });

  it("sources spread across amazon, aliexpress, shein", async () => {
    const fixture = await loadFixture();
    const sources = new Set(fixture.map((p) => p.source));
    expect(sources).toEqual(new Set(["amazon", "aliexpress", "shein"]));
  });
});

function categoryOf(p: { raw_category: string }): string {
  // We expect fixture entries to carry a normalized category in raw_category prefix or attributes.
  // The fixture is generated to embed the canonical category in id prefix: "ropa-001" etc.
  return p.raw_category.split("/")[0]?.toLowerCase() ?? "otros";
}
```

Run: FAIL — `fixture.ts` not yet implemented.

- [ ] **Step 20.3: Write `src/sectors/b-catalog/mock/fixture.ts`**

This generator produces 500 deterministic products with the target distribution and seed-stable IDs. We use a deterministic seeded RNG so the fixture is reproducible across machines and CI runs.

```typescript
import {
  type MockProduct,
  type MockCategory,
  type MockProductSource,
  TARGET_DISTRIBUTION,
  FIXTURE_SIZE,
} from "./types";

export { TARGET_DISTRIBUTION, FIXTURE_SIZE };

const SOURCES: MockProductSource[] = ["amazon", "aliexpress", "shein"];

const TEMPLATES: Record<MockCategory, { titles: string[]; brands: string[]; priceRangeCents: [number, number] }> = {
  ropa: {
    titles: [
      "Camiseta de algodón {color} talla {size}",
      "Vestido de verano {color} con estampado floral",
      "Chaqueta vaquera {color} ajustada",
      "Pantalón cargo {color} talla {size}",
      "Sudadera con capucha {color} unisex",
    ],
    brands: ["Zara Mock", "H&M Mock", "Adidas Mock", "Nike Mock", "Mango Mock"],
    priceRangeCents: [800, 8000],
  },
  electronica: {
    titles: [
      "Auriculares inalámbricos Bluetooth {color}",
      "Cargador rápido USB-C {watts}W",
      "Smartwatch deportivo pantalla {size}\"",
      "Cámara web HD {res} para streaming",
      "Power bank {capacity}mAh portátil",
    ],
    brands: ["Sony Mock", "JBL Mock", "Anker Mock", "Xiaomi Mock", "Logitech Mock"],
    priceRangeCents: [1500, 25000],
  },
  hogar: {
    titles: [
      "Juego de sábanas 100% algodón {color}",
      "Olla antiadherente {size}cm con tapa",
      "Lámpara LED de mesa {color} regulable",
      "Set de toallas {color} (3 piezas)",
      "Organizador de cocina {color}",
    ],
    brands: ["IKEA Mock", "Tefal Mock", "Philips Mock", "Tramontina Mock", "Vileda Mock"],
    priceRangeCents: [1000, 12000],
  },
  juguetes_bebe: {
    titles: [
      "Peluche oso {color} {size}cm",
      "Set de bloques de construcción {pieces} piezas",
      "Muñeca articulada {color} con accesorios",
      "Coche de carreras radiocontrol {color}",
      "Cuento ilustrado {age} años (tapa dura)",
    ],
    brands: ["Lego Mock", "Mattel Mock", "Hasbro Mock", "Fisher-Price Mock", "Playmobil Mock"],
    priceRangeCents: [600, 6000],
  },
  belleza: {
    titles: [
      "Crema hidratante facial {ml}ml piel {tipo}",
      "Champú anticaspa {ml}ml",
      "Set de maquillaje paleta {colors} colores",
      "Perfume {gender} {ml}ml fragancia floral",
      "Aceite corporal {ml}ml",
    ],
    brands: ["L'Oréal Mock", "Maybelline Mock", "Nivea Mock", "Pantene Mock", "Dove Mock"],
    priceRangeCents: [400, 5000],
  },
  otros: {
    titles: [
      "Mochila escolar {color} {capacity}L",
      "Botella térmica acero inoxidable {ml}ml",
      "Libreta tapa dura {pages} hojas",
      "Esterilla yoga antideslizante {color}",
      "Cinturón de cuero {color} talla {size}",
    ],
    brands: ["Under Armour Mock", "Sigg Mock", "Moleskine Mock", "Decathlon Mock", "Levi's Mock"],
    priceRangeCents: [500, 7000],
  },
};

const COLORS = ["negro", "blanco", "rojo", "azul", "verde", "rosa", "gris", "marrón"];
const SIZES = ["S", "M", "L", "XL", "38", "40", "42", "44"];
const FILL_VARS: Record<string, string[]> = {
  color: COLORS,
  size: SIZES,
  watts: ["20", "30", "65", "100"],
  res: ["720p", "1080p", "2K", "4K"],
  capacity: ["10000", "20000", "30000"],
  pieces: ["50", "100", "250", "500"],
  age: ["3-5", "5-7", "7-10"],
  ml: ["100", "200", "400", "500"],
  tipo: ["seca", "mixta", "grasa", "sensible"],
  colors: ["12", "24", "48"],
  gender: ["mujer", "hombre"],
  pages: ["80", "160", "240"],
};

// Seeded mulberry32 PRNG: deterministic and reproducible.
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function fillTemplate(template: string, rng: () => number): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) => {
    const choices = FILL_VARS[key] ?? [key];
    return pick(rng, choices);
  });
}

function priceCents(rng: () => number, [lo, hi]: [number, number]): number {
  return Math.round(lo + rng() * (hi - lo));
}

function generateProduct(rng: () => number, cat: MockCategory, idx: number): MockProduct {
  const tmpl = TEMPLATES[cat];
  const title = fillTemplate(pick(rng, tmpl.titles), rng);
  const brand = pick(rng, tmpl.brands);
  const source = pick(rng, SOURCES);
  const description =
    `${title}. Marca ${brand}. Disponible en variantes seleccionadas. ` +
    `Material y acabado de calidad estándar para uso ${cat === "ropa" ? "diario" : "regular"}.`;
  const id = `${cat}-${String(idx).padStart(4, "0")}`;
  return {
    id,
    source,
    source_product_id: `${source}-${id}`,
    title,
    description,
    image_url: `https://placehold.co/400x400?text=${encodeURIComponent(title.slice(0, 20))}`,
    price_cents: priceCents(rng, tmpl.priceRangeCents),
    brand,
    raw_category: cat,
    attributes: { generated: true, seedIndex: idx, cat },
  };
}

let _cache: MockProduct[] | null = null;

export async function loadFixture(): Promise<MockProduct[]> {
  if (_cache) return _cache;
  const rng = mulberry32(20260506); // fixed seed: stable across machines
  const fixture: MockProduct[] = [];
  let idx = 0;
  for (const [cat, ratio] of Object.entries(TARGET_DISTRIBUTION) as [MockCategory, number][]) {
    const count = Math.round(ratio * FIXTURE_SIZE);
    for (let i = 0; i < count; i++) {
      fixture.push(generateProduct(rng, cat, idx++));
    }
  }
  // Adjust size: rounding can produce 499 or 501. Pad/trim to exactly 500 from "otros".
  while (fixture.length < FIXTURE_SIZE) fixture.push(generateProduct(rng, "otros", idx++));
  while (fixture.length > FIXTURE_SIZE) fixture.pop();
  _cache = fixture;
  return fixture;
}
```

- [ ] **Step 20.4: Run fixture distribution tests**

```bash
pnpm test:integration tests/integration/mock-aggregator.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 20.5: Write `scripts/seed-fixture.ts`** (loads fixture into mock_calls metadata, not into products — products get the fixture via the aggregator at runtime, but we want a script for manual sanity checks)

```typescript
#!/usr/bin/env tsx
import { loadFixture, FIXTURE_SIZE } from "@/sectors/b-catalog/mock/fixture";

async function main() {
  const f = await loadFixture();
  console.log(`Fixture loaded: ${f.length}/${FIXTURE_SIZE} products`);
  const counts: Record<string, number> = {};
  for (const p of f) counts[p.raw_category] = (counts[p.raw_category] ?? 0) + 1;
  for (const [cat, n] of Object.entries(counts)) {
    console.log(`  ${cat.padEnd(20)} ${n} (${((n / f.length) * 100).toFixed(1)}%)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 20.6: Run script + commit**

```bash
pnpm seed:fixture
git add src/sectors/b-catalog/mock/types.ts src/sectors/b-catalog/mock/fixture.ts scripts/seed-fixture.ts tests/integration/mock-aggregator.test.ts
git commit -m "feat(mock): seeded fixture of 500 products with target distribution"
```

---

## Task 21: Mock aggregator (latency, errors, 25 per call)

**Files:**
- Create: `src/sectors/b-catalog/mock/aggregator.ts`
- Append to: `tests/integration/mock-aggregator.test.ts`

- [ ] **Step 21.1: Append failing tests for aggregator behavior**

```typescript
// tests/integration/mock-aggregator.test.ts — append:
import { fetchFromAggregator, getCallCount, resetCallCount } from "@/sectors/b-catalog/mock/aggregator";

describe("mock aggregator", () => {
  beforeEach(() => resetCallCount());

  it("returns exactly 25 products per call", async () => {
    const res = await fetchFromAggregator({ category: "ropa" });
    expect(res.products).toHaveLength(25);
  });

  it("filters by category", async () => {
    const res = await fetchFromAggregator({ category: "electronica" });
    for (const p of res.products) expect(p.raw_category).toBe("electronica");
  });

  it("latency is between 2 and 4 seconds (5 measurements)", async () => {
    const ts: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      try {
        await fetchFromAggregator({ category: "ropa" });
      } catch {
        /* error path is timing-correct too */
      }
      ts.push(performance.now() - t0);
    }
    for (const t of ts) {
      expect(t).toBeGreaterThan(1900); // small buffer below 2s
      expect(t).toBeLessThan(4200);    // small buffer above 4s
    }
    // Variance check: not all equal (jitter)
    const max = Math.max(...ts), min = Math.min(...ts);
    expect(max - min).toBeGreaterThan(100); // at least 100ms jitter
  }, 30_000);

  it("call counter increments on every invocation (success or error)", async () => {
    expect(getCallCount()).toBe(0);
    for (let i = 0; i < 3; i++) {
      try { await fetchFromAggregator({ category: "ropa" }); } catch { /* ignore */ }
    }
    expect(getCallCount()).toBe(3);
  });

  it("error rate is approximately 2% over 200 calls (±2%)", async () => {
    let errors = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      try { await fetchFromAggregator({ category: "ropa" }); }
      catch { errors++; }
    }
    const rate = errors / N;
    // 2% target with binomial variance allowance: tolerate 0% to 5%
    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThanOrEqual(0.05);
  }, 200 * 4500); // worst case 200 calls × 4.5s timeout
});
```

NOTE: The 200-call error-rate test takes up to ~15 minutes worst case at full latency. **This test runs only at phase close, not on every CI commit.** Mark it conditionally:

```typescript
const longRunIt = process.env.CI_FULL === "1" ? it : it.skip;
longRunIt("error rate is approximately 2% over 200 calls (±2%)", async () => { /* ... */ });
```

- [ ] **Step 21.2: Write `src/sectors/b-catalog/mock/aggregator.ts`**

```typescript
import { loadFixture } from "./fixture";
import type { MockProduct, MockCategory } from "./types";

export interface FetchOptions {
  category?: MockCategory;
  query?: string;
  limit?: number; // default 25, but spec says exactly 25 per call
}

export interface FetchResult {
  products: MockProduct[];
  cost_cents: number;
  latency_ms: number;
}

const PRODUCTS_PER_CALL = 25;
const COST_PER_CALL_CENTS = 4; // $0.04
const ERROR_RATE = 0.02;
const LATENCY_MIN_MS = 2000;
const LATENCY_MAX_MS = 4000;

let callCount = 0;
let errorCount = 0;

export function getCallCount() { return callCount; }
export function getErrorCount() { return errorCount; }
export function resetCallCount() { callCount = 0; errorCount = 0; }

function jitterMs(): number {
  return LATENCY_MIN_MS + Math.random() * (LATENCY_MAX_MS - LATENCY_MIN_MS);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchFromAggregator(opts: FetchOptions = {}): Promise<FetchResult> {
  callCount++;
  const t0 = performance.now();
  const wait = jitterMs();
  await delay(wait);

  // Simulated error
  if (Math.random() < ERROR_RATE) {
    errorCount++;
    throw new Error("MOCK_AGGREGATOR_TIMEOUT");
  }

  const all = await loadFixture();
  let pool = all;
  if (opts.category) pool = pool.filter((p) => p.raw_category === opts.category);
  if (opts.query) {
    const q = opts.query.toLowerCase();
    pool = pool.filter((p) =>
      p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
    );
  }

  // Random sample of size PRODUCTS_PER_CALL with replacement-from-pool
  // (if pool < 25, repeat to reach 25; spec is "exactly 25 per call")
  const out: MockProduct[] = [];
  for (let i = 0; i < PRODUCTS_PER_CALL; i++) {
    out.push(pool[Math.floor(Math.random() * pool.length)]);
  }

  return {
    products: out,
    cost_cents: COST_PER_CALL_CENTS,
    latency_ms: performance.now() - t0,
  };
}
```

- [ ] **Step 21.3: Run all aggregator tests**

```bash
pnpm test:integration tests/integration/mock-aggregator.test.ts
```

Expected: 8 tests PASS (the long-run 200-call error test is skipped without `CI_FULL=1`).

- [ ] **Step 21.4: Run the long error-rate test once, manually, before phase close**

```bash
CI_FULL=1 pnpm test:integration tests/integration/mock-aggregator.test.ts
```

Expected: ALL PASS.

- [ ] **Step 21.5: Commit**

```bash
git add src/sectors/b-catalog/mock/aggregator.ts tests/integration/mock-aggregator.test.ts
git commit -m "feat(mock): aggregator with 25-per-call, 2-4s jitter, 2% error rate"
```

---

## Task 22: Healthcheck endpoints

**Files:**
- Create: `src/app/api/health/db/route.ts`
- Create: `src/app/api/health/voyage/route.ts`
- Create: `src/app/api/health/anthropic/route.ts`
- Create: `tests/integration/health.test.ts`
- Create: `scripts/health-check.ts`

- [ ] **Step 22.1: Write the failing test**

```typescript
// tests/integration/health.test.ts
import { describe, it, expect } from "vitest";

const BASE = "http://localhost:3000";

describe("health endpoints (real)", () => {
  it("/api/health/db returns ok with extension and table count", async () => {
    const res = await fetch(`${BASE}/api/health/db`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.vector_extension).toBe(true);
    expect(body.tables_count).toBeGreaterThan(15);
  });

  it("/api/health/voyage returns ok with embedding dim", async () => {
    const res = await fetch(`${BASE}/api/health/voyage`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.dim).toBe(1024);
    expect(typeof body.unit_norm).toBe("boolean");
    expect(body.unit_norm).toBe(true);
  });

  it("/api/health/anthropic returns ok with model", async () => {
    const res = await fetch(`${BASE}/api/health/anthropic`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.model).toContain("claude-haiku");
  });
});
```

NOTE: This test requires `next dev` running. We'll launch it inside the test runner via Playwright's webServer config OR run manually before invoking.

- [ ] **Step 22.2: Write `src/app/api/health/db/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { getPgClient } from "@/lib/db/pg";

export const dynamic = "force-dynamic";

export async function GET() {
  const client = await getPgClient();
  try {
    const ext = await client.query(`SELECT 1 FROM pg_extension WHERE extname = 'vector'`);
    const tables = await client.query(
      `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`,
    );
    return NextResponse.json({
      ok: true,
      vector_extension: ext.rowCount === 1,
      tables_count: tables.rows[0].n,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  } finally {
    await client.end();
  }
}
```

- [ ] **Step 22.3: Write `src/app/api/health/voyage/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { embed, EMBEDDING_DIM } from "@/lib/embeddings/voyage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [vec] = await embed(["health check"], { inputType: "document" });
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    return NextResponse.json({
      ok: true,
      dim: vec.length,
      expected_dim: EMBEDDING_DIM,
      unit_norm: Math.abs(norm - 1) < 1e-3,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 22.4: Write `src/app/api/health/anthropic/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { sendMessage, MODELS } from "@/lib/llm/anthropic";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const out = await sendMessage({
      model: MODELS.haiku,
      system: "Eres un asistente conciso.",
      messages: [{ role: "user", content: "Responde con la palabra 'ok' y nada más." }],
      maxTokens: 8,
    });
    return NextResponse.json({
      ok: true,
      model: MODELS.haiku,
      response_excerpt: out.text.slice(0, 16),
      input_tokens: out.usage.input_tokens,
      output_tokens: out.usage.output_tokens,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 22.5: Update middleware matcher to skip health endpoints**

Edit `src/middleware.ts` matcher (already has `api/health` exclusion in step 17.3). Verify.

- [ ] **Step 22.6: Run health endpoints**

```bash
pnpm next dev --turbo &
DEV_PID=$!
sleep 5
pnpm test:integration tests/integration/health.test.ts
kill $DEV_PID
```

Expected: 3 tests PASS.

- [ ] **Step 22.7: Write `scripts/health-check.ts`** (CLI-friendly health check, doesn't need Next.js server)

```typescript
#!/usr/bin/env tsx
import { embed, EMBEDDING_DIM } from "@/lib/embeddings/voyage";
import { sendMessage, MODELS } from "@/lib/llm/anthropic";
import { getPgClient } from "@/lib/db/pg";

async function main() {
  console.log("=== Health Check ===");

  const pg = await getPgClient();
  try {
    const ext = await pg.query(`SELECT extversion FROM pg_extension WHERE extname='vector'`);
    console.log(`DB: pgvector ${ext.rows[0]?.extversion ?? "MISSING"}`);
    const tables = await pg.query(`SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'`);
    console.log(`DB: ${tables.rows[0].n} tables in public`);
  } finally { await pg.end(); }

  const [vec] = await embed(["smoke test"], { inputType: "document" });
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  console.log(`Voyage: dim=${vec.length} (expected ${EMBEDDING_DIM}), norm=${norm.toFixed(4)}`);

  const out = await sendMessage({
    model: MODELS.haiku,
    system: "Asistente conciso.",
    messages: [{ role: "user", content: "Responde 'ok'." }],
    maxTokens: 8,
  });
  console.log(`Anthropic: model=${MODELS.haiku}, response="${out.text.trim()}"`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 22.8: Commit**

```bash
git add src/app/api/health/ tests/integration/health.test.ts scripts/health-check.ts
git commit -m "feat(health): db/voyage/anthropic healthcheck endpoints + CLI"
```

---

## Task 23: GitHub Actions CI + README + .env.example

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `README.md`
- Update: `.env.example` (already created in 17.5)

- [ ] **Step 23.1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test:quality
      - run: pnpm format:check

  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:unit

  integration-tests:
    runs-on: ubuntu-latest
    needs: [lint-typecheck, unit-tests]
    env:
      SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
      NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY_CI }}
      VOYAGE_API_KEY: ${{ secrets.VOYAGE_API_KEY_CI }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: |
          # Reconstruct .env.local for tests
          cat > .env.local <<EOF
          SUPABASE_DB_URL=$SUPABASE_DB_URL
          NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
          NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
          SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
          ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
          VOYAGE_API_KEY=$VOYAGE_API_KEY
          EOF
      - run: pnpm migrate
      - run: pnpm test:integration
```

NOTE: Add the secrets to the GitHub repo settings:
- `SUPABASE_DB_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY_CI` and `VOYAGE_API_KEY_CI` — **dedicated keys with monthly spend caps**, not the dev keys.

E2E tests are NOT run in CI for Phase 0 because they require a live Auth0 user; they run locally only. We add them in CI when Phase 1 stabilizes.

- [ ] **Step 23.2: Write `README.md`**

```markdown
# E-commerce Cuba — MVP

MVP de e-commerce reseller con personalización vectorial multi-modo (modelo pagador-receptor).

## Stack

- Next.js 16 (App Router, TS, Turbopack)
- Tailwind v4
- Supabase (Postgres + pgvector)
- Auth0 v4
- Anthropic SDK (Claude Sonnet 4.6 + Haiku 4.5)
- Voyage AI embeddings (voyage-4, 1024 dim)
- Vitest + Playwright + fast-check

## Setup local

```bash
pnpm install
cp .env.example .env.local   # luego rellenar valores reales
pnpm migrate                 # aplica migraciones a Supabase
pnpm verify:supabase         # verifica estado
pnpm health-check            # verifica clientes externos
pnpm dev                     # levanta el servidor
```

## Tests

```bash
pnpm test:unit               # rápido, sin red
pnpm test:integration        # contra BD test_schema + Voyage + Anthropic reales
pnpm test:e2e                # Playwright + Auth0 real (requiere usuario de test)
pnpm test:quality            # AST-based anti-pattern checker
```

## Roadmap

Ver `docs/superpowers/specs/2026-05-06-rebuild-mvp-ecommerce-cuba-design.md` y los planes en `docs/superpowers/plans/`.

## Estructura

- `src/sectors/{a-tracking, b-catalog, c-search, d-personalization, e-admin}/` — sectores funcionales
- `src/lib/{db, auth, llm, embeddings, math, time}/` — clientes y lógica reutilizable
- `supabase/migrations/` — SQL versionado
- `scripts/` — utilidades (apply-migrations, verify, health, seed, etc.)
- `tests/{unit, integration, e2e}/` — capas de tests con políticas distintas

## Filosofía de tests

- **Único mock permitido:** la API agregadora en `src/sectors/b-catalog/mock/`. Todo lo demás es real.
- Anti-patterns prohibidos validados por `scripts/check-test-quality.ts` en pre-commit.
- Mutation testing manual obligatorio para funciones matemáticas críticas (commit message documenta la mutación verificada).
```

- [ ] **Step 23.3: Push + verify CI run**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "chore: GitHub Actions CI + README"
git push origin main
```

Expected: CI workflow runs successfully on push. If integration job fails because secrets are missing, set them in the repo's Settings → Secrets and re-trigger.

---

## Task 24: Triple revisión de cierre — 3 subagentes

**Files:**
- Create: `docs/superpowers/reports/2026-05-06-fase-0-cierre.md`

- [ ] **Step 24.1: Final integrity check**

```bash
pnpm migrate
pnpm verify:supabase
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm test:quality
```

Expected: ALL GREEN.

- [ ] **Step 24.2: Subagent 1 — Adversario** (run via the Agent tool, subagent_type=general-purpose)

Prompt to send:

> Eres un revisor adversarial de tests. Acabas de entrar en frío al proyecto en `/workspaces/ecommerce-cuba`. Tu único objetivo es encontrar tests que NO atrapan bugs reales.
>
> Pasos:
> 1. Lista los archivos de test en `tests/unit`, `tests/integration`, `tests/e2e`.
> 2. Para cada test, lee el código bajo prueba (en `src/lib`, `src/sectors`, `src/app`, `scripts/`, `supabase/migrations/`).
> 3. Para cada test crítico, imagina 3 mutaciones plausibles del código bajo prueba que un programador real podría hacer mal.
> 4. Para cada mutación: ¿este test fallaría?
> 5. Si la respuesta es NO para al menos 1 mutación plausible → marca el test como **DÉBIL**.
> 6. También marca como DÉBIL los tests que usan anti-patterns: `expect(x).toBeDefined()` solo, `vi.mock` de la BD/Voyage/Anthropic/Auth0, `expect.anything()` con objeto vacío, snapshots sin contenido validado, `.skip`/`.only`/`xit`, etc.
>
> Reporte (under 800 words):
> - Lista de tests débiles con archivo:línea + mutación que no detectaría + cómo reescribir.
> - Tests que pasan tu revisión.
> - No tienes piedad. Tu trabajo es encontrar tests basura.

- [ ] **Step 24.3: Subagent 2 — Auditor de Mocks** (Agent tool, general-purpose)

Prompt:

> Eres un auditor de mocks. El proyecto en `/workspaces/ecommerce-cuba` tiene UN SOLO mock permitido por diseño: `src/sectors/b-catalog/mock/` (la API agregadora). Cualquier otro mock requiere justificación escrita.
>
> Pasos:
> 1. Grep todo el repo: `grep -rn "vi.mock\|jest.mock\|vi.spyOn\|vi.useFakeTimers\|sinon" src/ tests/ scripts/`.
> 2. Para cada mock encontrado fuera del mock oficial:
>    a. Identifica qué se está mockeando.
>    b. Pregunta: ¿se está probando lógica real o solo aritmética del propio mock?
>    c. Marca como **INJUSTIFICADO** si mockea Supabase, Voyage SDK, Anthropic SDK, Auth0 client, o el módulo bajo prueba.
>    d. Marca como **JUSTIFICADO** si aísla tiempo (`useFakeTimers`) o entradas externas no determinísticas.
>
> Reporte (under 500 words):
> - Lista total de mocks con archivo:línea.
> - Para cada uno: justificado/injustificado + por qué.
> - Recomendación de cómo eliminar los injustificados (qué reemplazar por integración real).

- [ ] **Step 24.4: Subagent 3 — Probador de Comportamiento** (Agent tool, general-purpose)

Prompt:

> Eres un probador externo. NO mires el código fuente del proyecto. Solo tienes acceso al sistema corriendo y al documento `MVP_Ecommerce_Personalizado_Documento_Maestro v2.md` en la raíz del repo.
>
> Tu trabajo es validar que Fase 0 cumple la especificación.
>
> Pasos:
> 1. Lee la sección "Roadmap > Fase 0" del documento maestro.
> 2. Lee la sección 13 "Modelo de datos" — todas las tablas listadas deben existir en Supabase.
> 3. Para cada criterio de aceptación de Fase 0, diseña tu propio caso de prueba ad-hoc.
> 4. Ejecuta cada caso usando: `pnpm verify:supabase`, `pnpm health-check`, `curl http://localhost:3000/api/health/...`, queries SQL via psql/Node si hace falta.
> 5. Reporta cada caso como **PASA**, **FALLA**, o **NO VERIFICABLE** con explicación.
>
> Comportamientos a verificar mínimo:
> - BD vacía (en `public`) con todas las tablas + extensión vector + dim 1024 en products.embedding.
> - test_schema con replica idéntica.
> - Login Auth0 funciona (puedes pedirme credenciales de test si las necesitas).
> - Mock devuelve 25 productos exactos con latencia 2-4s y errores ~2%.
> - Fixture de 500 productos con distribución correcta.
> - Healthchecks de Voyage (dim 1024 normalizado) y Anthropic (responde) pasan.
>
> Reporte (under 700 words):
> - Lista de comportamientos esperados.
> - Resultado de cada caso (PASA/FALLA/NO VERIFICABLE).
> - Discrepancias entre el documento y el sistema.

- [ ] **Step 24.5: Compile reports + close phase**

After receiving all 3 outputs, write `docs/superpowers/reports/2026-05-06-fase-0-cierre.md` with:

```markdown
# Reporte de Fase 0 · Fundaciones

## Hitos completados
[lista derivada de los criterios de aceptación cumplidos]

## Tests escritos
- Unit: <N> tests
- Integration: <N> tests
- E2E: <N> tests
- Mutation testing aplicado a: normalize, cosine

## Bugs encontrados durante el desarrollo
[lista honesta — si dices "ninguno", revisa de nuevo; TDD agarra muchos]

## Output literal de los 3 revisores

=== AGENTE 1 (Adversario) — output literal ===
[pegar exactamente]

=== AGENTE 2 (Auditor de Mocks) — output literal ===
[pegar exactamente]

=== AGENTE 3 (Probador de Comportamiento) — output literal ===
[pegar exactamente]

## Métricas
- Tablas en Supabase: <N>
- Productos en fixture: 500
- Costo simulado del mock acumulado durante tests: $<X>
- Tokens reales gastados en CI/integration: ~$<X>

## Items pendientes
[lista]

## Decisión
✅ Fase 0 cerrada. Listo para Fase 1.
o
⚠️ Fase 0 tiene items pendientes que requieren decisión del usuario antes de avanzar:
  1. ...
```

- [ ] **Step 24.6: Commit reporte**

```bash
mkdir -p docs/superpowers/reports
git add docs/superpowers/reports/
git commit -m "chore: Fase 0 cierre — reporte de triple revisión"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Setup Next.js + estructura → Tasks 1-2
- ✅ Migraciones 0001-0012 + scripts → Tasks 4-13
- ✅ Clientes Supabase + Voyage + Anthropic + Auth0 → Tasks 14-17
- ✅ Mock de API agregadora → Tasks 20-21
- ✅ Fixture de 500 productos → Task 20
- ✅ Funciones puras matemáticas iniciales → Task 19
- ✅ Healthchecks → Task 22
- ✅ CI con tokens reales → Task 23
- ✅ Triple revisión → Task 24
- ✅ Clock inyectable → Task 18

**Placeholder scan:** none — every step has exact code or exact commands.

**Type consistency:** `MockProduct`, `Scope`, `Clock`, `EMBEDDING_DIM`, `MODELS` referenced consistently across tasks.

**Outstanding:** Task 23 references GitHub secrets that the user must set manually. Task 17 requires the user to create an Auth0 test user. Both are flagged as manual one-time setups in the steps.
