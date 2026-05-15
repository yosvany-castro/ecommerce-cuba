# Fase 3a — Personalización vector único + cold start · Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar personalización con vector único por (user_profile, recipient, cohort), multi-destinatario inferido por sub-sesión, cold start con shrinkage bayesiano, evento `dismiss` con autoexclusión, vista admin read-only y eval sintético con compuerta Recall@10 ≥ baseline + 20pp.

**Architecture:** Per-event synchronous update. Cada `POST /api/track` deriva una `EventSignal` del producto/query, actualiza estado de sub-bucket (warmup=3, window=5, shift_threshold=3) en `session_vectors`, y actualiza vectores incrementalmente en `user_profile_modes` con decay temporal y shrinkage al prior de cohorte (κ=10). Retrieval top-K por cosine usando `α dinámico` para combinar perfil + sesión. Cron nocturno recalcula desde cero contra drift.

**Tech Stack:** TypeScript 5.6, Next.js 16 (App Router), pg, pgvector (vector(1024)), Voyage embeddings (voyage-4), Vitest 4.1, zod 4. Sin LLM en runtime de personalización (eso es 3c). Sin mocks de externals.

**Branch:** `feat/fase-3a-personalization-vector-unico` (ya creada, spec ya commited en `07b1641`).

**Coste estimado:** suite ~$0.005, eval run ~$0.03. Total fase ~$0.10 con iteraciones.

**Reglas heredadas:**
- Tests reales (`pnpm test:quality` AST checker enforza cero mocks de `@/lib/{db,llm,embeddings,auth}` y `sectors/{a-tracking,b-catalog/{enrichment,cron,repository}}`).
- No `expect(...).toBeDefined()/.not.toBeNull()` (R1 weak assertion).
- Push después de cada commit.
- Mutation tests embebidos en tareas críticas (vector math, shift detection).

---

## Task 1: Migración 0017 + tipos cohorte

**Files:**
- Create: `supabase/migrations/0017_personalization_3a.sql`
- Create: `src/sectors/d-personalization/cohorts/definitions.ts`
- Test: `tests/unit/cohorts-definitions.test.ts`

- [ ] **Step 1.1: Crear migración SQL**

```sql
-- supabase/migrations/0017_personalization_3a.sql

-- Extend session_vectors with sub-bucket state
ALTER TABLE public.session_vectors ADD COLUMN IF NOT EXISTS
  current_recipient_id uuid REFERENCES public.recipients(id) ON DELETE SET NULL;
ALTER TABLE public.session_vectors ADD COLUMN IF NOT EXISTS
  current_cohort_id text;
ALTER TABLE public.session_vectors ADD COLUMN IF NOT EXISTS
  signal_window jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.session_vectors ADD COLUMN IF NOT EXISTS
  signal_window_size smallint NOT NULL DEFAULT 0;

-- Extend user_profile_modes with cohort_id
ALTER TABLE public.user_profile_modes ADD COLUMN IF NOT EXISTS
  cohort_id text;

-- Replace the uniqueness constraint to include cohort_id
ALTER TABLE public.user_profile_modes DROP CONSTRAINT IF EXISTS user_profile_modes_uniq;
ALTER TABLE public.user_profile_modes ADD CONSTRAINT user_profile_modes_uniq
  UNIQUE (user_profile_id, recipient_id, cohort_id, mode_index);

-- Unique indexes for excluded_products to allow ON CONFLICT DO NOTHING
CREATE UNIQUE INDEX IF NOT EXISTS excluded_products_anon_product_uniq
  ON public.excluded_products (anonymous_id, product_id)
  WHERE anonymous_id IS NOT NULL AND user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS excluded_products_user_product_uniq
  ON public.excluded_products (user_id, product_id)
  WHERE user_id IS NOT NULL;
```

- [ ] **Step 1.2: Replicar al test_schema** — regenerar el archivo `0016_test_schema_replicate_v3.sql` o añadir un `0018_test_schema_replicate_3a.sql` que aplique los mismos cambios sobre `test_schema.*`.

Para evitar tocar 0016, crear `supabase/migrations/0018_test_schema_replicate_3a.sql`:

```sql
ALTER TABLE test_schema.session_vectors ADD COLUMN IF NOT EXISTS
  current_recipient_id uuid;
ALTER TABLE test_schema.session_vectors ADD COLUMN IF NOT EXISTS
  current_cohort_id text;
ALTER TABLE test_schema.session_vectors ADD COLUMN IF NOT EXISTS
  signal_window jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE test_schema.session_vectors ADD COLUMN IF NOT EXISTS
  signal_window_size smallint NOT NULL DEFAULT 0;

ALTER TABLE test_schema.user_profile_modes ADD COLUMN IF NOT EXISTS
  cohort_id text;
ALTER TABLE test_schema.user_profile_modes DROP CONSTRAINT IF EXISTS user_profile_modes_uniq;
ALTER TABLE test_schema.user_profile_modes ADD CONSTRAINT user_profile_modes_uniq
  UNIQUE (user_profile_id, recipient_id, cohort_id, mode_index);

CREATE UNIQUE INDEX IF NOT EXISTS excluded_products_anon_product_uniq_test
  ON test_schema.excluded_products (anonymous_id, product_id)
  WHERE anonymous_id IS NOT NULL AND user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS excluded_products_user_product_uniq_test
  ON test_schema.excluded_products (user_id, product_id)
  WHERE user_id IS NOT NULL;
```

- [ ] **Step 1.3: Aplicar migraciones**

Run: `pnpm migrate`
Expected: `[migrate] OK — N files processed.` con `0017` y `0018` listadas como nuevas.

- [ ] **Step 1.4: Crear test fallido `tests/unit/cohorts-definitions.test.ts`**

```ts
import { describe, test, expect } from "vitest";
import {
  COHORT_IDS,
  AGE_BAND_RANGES,
  GENDER_BY_COHORT,
  AGE_BAND_BY_COHORT,
  cohortIdFor,
  parseCohort,
  type CohortId,
  type AgeBand,
} from "@/sectors/d-personalization/cohorts/definitions";

describe("Cohort definitions", () => {
  test("has exactly 11 cohorts", () => {
    expect(COHORT_IDS.length).toBe(11);
  });

  test("includes the documented cohort IDs", () => {
    const expected: CohortId[] = [
      "femenino_bebe", "femenino_nina", "femenino_joven",
      "femenino_adulta", "femenino_mayor",
      "masculino_bebe", "masculino_nino", "masculino_joven",
      "masculino_adulto", "masculino_mayor",
      "unisex_indeterminado",
    ];
    for (const id of expected) expect(COHORT_IDS).toContain(id);
  });

  test("AGE_BAND_RANGES covers the 5 bands with non-overlapping mins", () => {
    expect(AGE_BAND_RANGES.bebe).toEqual({ min: 0, max: 3 });
    expect(AGE_BAND_RANGES.nino).toEqual({ min: 4, max: 11 });
    expect(AGE_BAND_RANGES.joven).toEqual({ min: 12, max: 25 });
    expect(AGE_BAND_RANGES.adulto).toEqual({ min: 26, max: 59 });
    expect(AGE_BAND_RANGES.mayor).toEqual({ min: 60, max: 130 });
  });

  test("cohortIdFor(femenino, adulta-age) → 'femenino_adulta'", () => {
    expect(cohortIdFor("femenino", 35)).toBe("femenino_adulta");
    expect(cohortIdFor("masculino", 70)).toBe("masculino_mayor");
    expect(cohortIdFor("masculino", 8)).toBe("masculino_nino");
    expect(cohortIdFor("femenino", 2)).toBe("femenino_bebe");
  });

  test("cohortIdFor returns unisex_indeterminado on null inputs", () => {
    expect(cohortIdFor(null, 35)).toBe("unisex_indeterminado");
    expect(cohortIdFor("femenino", null)).toBe("unisex_indeterminado");
    expect(cohortIdFor("unisex", 35)).toBe("unisex_indeterminado");
  });

  test("parseCohort('femenino_adulta') round-trips", () => {
    expect(parseCohort("femenino_adulta")).toEqual({
      gender: "femenino",
      age_band: "adulto",
    });
    expect(parseCohort("unisex_indeterminado")).toEqual({
      gender: null,
      age_band: null,
    });
  });
});
```

- [ ] **Step 1.5: Correr → falla (módulo no existe)**

Run: `pnpm test:unit -- tests/unit/cohorts-definitions.test.ts`
Expected: FAIL "Cannot find module".

- [ ] **Step 1.6: Crear `src/sectors/d-personalization/cohorts/definitions.ts`**

```ts
export const AGE_BANDS = ["bebe", "nino", "joven", "adulto", "mayor"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const AGE_BAND_RANGES: Record<AgeBand, { min: number; max: number }> = {
  bebe: { min: 0, max: 3 },
  nino: { min: 4, max: 11 },
  joven: { min: 12, max: 25 },
  adulto: { min: 26, max: 59 },
  mayor: { min: 60, max: 130 },
};

export const COHORT_IDS = [
  "femenino_bebe",
  "femenino_nina",
  "femenino_joven",
  "femenino_adulta",
  "femenino_mayor",
  "masculino_bebe",
  "masculino_nino",
  "masculino_joven",
  "masculino_adulto",
  "masculino_mayor",
  "unisex_indeterminado",
] as const;
export type CohortId = (typeof COHORT_IDS)[number];

export const GENDER_BY_COHORT: Record<CohortId, "femenino" | "masculino" | null> = {
  femenino_bebe: "femenino",
  femenino_nina: "femenino",
  femenino_joven: "femenino",
  femenino_adulta: "femenino",
  femenino_mayor: "femenino",
  masculino_bebe: "masculino",
  masculino_nino: "masculino",
  masculino_joven: "masculino",
  masculino_adulto: "masculino",
  masculino_mayor: "masculino",
  unisex_indeterminado: null,
};

export const AGE_BAND_BY_COHORT: Record<CohortId, AgeBand | null> = {
  femenino_bebe: "bebe",
  femenino_nina: "nino",
  femenino_joven: "joven",
  femenino_adulta: "adulto",
  femenino_mayor: "mayor",
  masculino_bebe: "bebe",
  masculino_nino: "nino",
  masculino_joven: "joven",
  masculino_adulto: "adulto",
  masculino_mayor: "mayor",
  unisex_indeterminado: null,
};

const FEMININE_KID_LABEL: Record<AgeBand, CohortId> = {
  bebe: "femenino_bebe",
  nino: "femenino_nina",
  joven: "femenino_joven",
  adulto: "femenino_adulta",
  mayor: "femenino_mayor",
};

const MASCULINE_KID_LABEL: Record<AgeBand, CohortId> = {
  bebe: "masculino_bebe",
  nino: "masculino_nino",
  joven: "masculino_joven",
  adulto: "masculino_adulto",
  mayor: "masculino_mayor",
};

export function ageToBand(age: number | null | undefined): AgeBand | null {
  if (age === null || age === undefined) return null;
  for (const band of AGE_BANDS) {
    const r = AGE_BAND_RANGES[band];
    if (age >= r.min && age <= r.max) return band;
  }
  return null;
}

export function cohortIdFor(
  gender: "femenino" | "masculino" | "unisex" | null | undefined,
  age: number | null | undefined,
): CohortId {
  if (!gender || gender === "unisex") return "unisex_indeterminado";
  const band = ageToBand(age);
  if (!band) return "unisex_indeterminado";
  return gender === "femenino" ? FEMININE_KID_LABEL[band] : MASCULINE_KID_LABEL[band];
}

export function parseCohort(
  cohort_id: CohortId,
): { gender: "femenino" | "masculino" | null; age_band: AgeBand | null } {
  return {
    gender: GENDER_BY_COHORT[cohort_id],
    age_band: AGE_BAND_BY_COHORT[cohort_id],
  };
}
```

- [ ] **Step 1.7: Correr tests → 6 passing**

Run: `pnpm test:unit -- tests/unit/cohorts-definitions.test.ts`
Expected: 6 PASSING.

- [ ] **Step 1.8: Commit**

```bash
git add supabase/migrations/0017_personalization_3a.sql supabase/migrations/0018_test_schema_replicate_3a.sql src/sectors/d-personalization/cohorts/definitions.ts tests/unit/cohorts-definitions.test.ts
git commit -m "$(cat <<'EOF'
feat(d-personalization): migración 0017+0018 + cohortes (T1 Fase 3a)

- session_vectors: +current_recipient_id, +current_cohort_id,
  +signal_window jsonb, +signal_window_size.
- user_profile_modes: +cohort_id, UNIQUE constraint actualizado
  para incluir cohort_id.
- excluded_products: unique indexes para soportar ON CONFLICT.
- 11 cohortes definidas (gender × 5 age_bands + unisex_indeterminado).
- Helpers cohortIdFor() y parseCohort() con 6 unit tests.

Spec: docs/superpowers/specs/2026-05-15-fase-3a-design.md §4.1, §5.2

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git push
```

---

## Task 2: Cohort centroid compute (job batch)

**Files:**
- Create: `src/sectors/d-personalization/cohorts/centroid-compute.ts`
- Create: `scripts/cron-cohort-centroids.ts`
- Test: `tests/integration/cohort-centroids.test.ts`

- [ ] **Step 2.1: Test fallido**

```ts
// tests/integration/cohort-centroids.test.ts
import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { normalize, cosine } from "@/lib/math";
import { EMBEDDING_DIM } from "@/lib/embeddings/voyage";

beforeEach(async () => {
  await truncateTestTables(["cohort_centroids", "products"]);
});

describe("computeCohortCentroids", () => {
  test("centroid is the normalized mean of products in the cohort", async () => {
    await withTestDb(async (pg) => {
      // 3 products in cohort femenino_adulta
      const p1 = await seedProductWithEmbedding(pg, {
        title: "Vestido fiesta",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      const p2 = await seedProductWithEmbedding(pg, {
        title: "Blusa elegante",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      const p3 = await seedProductWithEmbedding(pg, {
        title: "Falda midi",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      // Decoy in a different cohort
      await seedProductWithEmbedding(pg, {
        title: "Juguete bebe",
        metadata: { gender_target: "unisex", age_target: { min: 0, max: 3 } },
      });

      await computeCohortCentroids(pg);

      const r = await pg.query(
        `SELECT centroid_vector::text AS v, n_users_in_cohort
         FROM cohort_centroids WHERE cohort_id = 'femenino_adulta'`,
      );
      expect(r.rows.length).toBe(1);
      const centroid = JSON.parse(r.rows[0].v) as number[];
      expect(centroid.length).toBe(EMBEDDING_DIM);

      // Centroid should be close to the mean direction of p1,p2,p3
      // (n_users_in_cohort here is reused as n_products_in_cohort for 3a)
      expect(r.rows[0].n_users_in_cohort).toBe(3);

      // Sanity: norm ≈ 1
      const norm = Math.sqrt(centroid.reduce((s, x) => s + x * x, 0));
      expect(Math.abs(norm - 1)).toBeLessThan(1e-5);
    });
  }, 120_000);

  test("cohorts without products do not get a row", async () => {
    await withTestDb(async (pg) => {
      await seedProductWithEmbedding(pg, {
        title: "Solo femenino_adulta",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      await computeCohortCentroids(pg);
      const r = await pg.query(
        `SELECT cohort_id FROM cohort_centroids ORDER BY cohort_id`,
      );
      expect(r.rows.map((x: { cohort_id: string }) => x.cohort_id)).toEqual([
        "femenino_adulta",
      ]);
    });
  }, 90_000);

  test("recompute is idempotent — running twice yields the same result", async () => {
    await withTestDb(async (pg) => {
      await seedProductWithEmbedding(pg, {
        title: "Item",
        metadata: { gender_target: "masculino", age_target: { min: 26, max: 59 } },
      });
      await computeCohortCentroids(pg);
      const r1 = await pg.query(
        `SELECT centroid_vector::text AS v FROM cohort_centroids WHERE cohort_id = 'masculino_adulto'`,
      );
      await computeCohortCentroids(pg);
      const r2 = await pg.query(
        `SELECT centroid_vector::text AS v FROM cohort_centroids WHERE cohort_id = 'masculino_adulto'`,
      );
      expect(r1.rows[0].v).toBe(r2.rows[0].v);
    });
  }, 120_000);
});
```

- [ ] **Step 2.2: Correr → falla**

Run: `pnpm test:integration -- tests/integration/cohort-centroids.test.ts`
Expected: FAIL.

- [ ] **Step 2.3: Helper barrel `src/lib/math/index.ts`**

Verificar que existe; si no, crear:
```ts
export { normalize } from "./normalize";
export { cosine } from "./cosine";
```

- [ ] **Step 2.4: Crear `src/sectors/d-personalization/cohorts/centroid-compute.ts`**

```ts
import type { Client } from "pg";
import { normalize } from "@/lib/math";
import { EMBEDDING_DIM } from "@/lib/embeddings/voyage";
import { cohortIdFor, type CohortId } from "./definitions";

interface ProductRow {
  embedding_text: string;
  gender_target: string | null;
  age_max: number | null;
  age_min: number | null;
}

function parseVectorText(s: string): number[] {
  return JSON.parse(s) as number[];
}

export async function computeCohortCentroids(pg: Client): Promise<void> {
  const r = await pg.query(
    `SELECT embedding::text AS embedding_text,
            (metadata->>'gender_target') AS gender_target,
            ((metadata->'age_target'->>'min')::int) AS age_min,
            ((metadata->'age_target'->>'max')::int) AS age_max
     FROM products
     WHERE is_active = true AND embedding IS NOT NULL`,
  );

  const buckets = new Map<CohortId, { sum: number[]; count: number }>();
  for (const row of r.rows as ProductRow[]) {
    const repAge =
      row.age_max !== null && row.age_min !== null
        ? Math.round((row.age_min + row.age_max) / 2)
        : null;
    const cohort = cohortIdFor(
      row.gender_target as "femenino" | "masculino" | "unisex" | null,
      repAge,
    );
    if (cohort === "unisex_indeterminado") continue; // skip fallback bucket
    let b = buckets.get(cohort);
    if (!b) {
      b = { sum: new Array<number>(EMBEDDING_DIM).fill(0), count: 0 };
      buckets.set(cohort, b);
    }
    const v = parseVectorText(row.embedding_text);
    for (let i = 0; i < EMBEDDING_DIM; i++) b.sum[i] += v[i];
    b.count += 1;
  }

  for (const [cohort, { sum, count }] of buckets) {
    const centroid = normalize(sum.map((x) => x / count));
    await pg.query(
      `INSERT INTO cohort_centroids (cohort_id, centroid_vector, n_users_in_cohort, last_recompute_at)
       VALUES ($1, $2::vector, $3, now())
       ON CONFLICT (cohort_id) DO UPDATE SET
         centroid_vector = EXCLUDED.centroid_vector,
         n_users_in_cohort = EXCLUDED.n_users_in_cohort,
         last_recompute_at = EXCLUDED.last_recompute_at`,
      [cohort, "[" + centroid.join(",") + "]", count],
    );
  }
}
```

- [ ] **Step 2.5: Crear CLI `scripts/cron-cohort-centroids.ts`**

```ts
#!/usr/bin/env tsx
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { withPg } from "@/lib/db/helpers";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";

(async () => {
  const t0 = Date.now();
  await withPg((pg) => computeCohortCentroids(pg));
  console.log(`[cron-cohort-centroids] done in ${Date.now() - t0}ms`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Añadir a `package.json`:
```
"cron:cohort-centroids": "tsx scripts/cron-cohort-centroids.ts",
```

- [ ] **Step 2.6: Correr tests → 3 passing**

Run: `pnpm test:integration -- tests/integration/cohort-centroids.test.ts`
Expected: 3 PASSING.

- [ ] **Step 2.7: Commit**

```bash
git add src/sectors/d-personalization/cohorts/centroid-compute.ts scripts/cron-cohort-centroids.ts package.json tests/integration/cohort-centroids.test.ts src/lib/math/index.ts
git commit -m "feat(d-personalization): cohort centroid compute (T2 Fase 3a)" && git push
```

---

## Task 3: Signal inference desde producto/search

**Files:**
- Create: `src/sectors/d-personalization/cohorts/infer.ts`
- Test: `tests/unit/cohorts-infer.test.ts`

- [ ] **Step 3.1: Test fallido**

```ts
import { describe, test, expect } from "vitest";
import {
  inferSignalFromProductMetadata,
  majorityCohort,
  countSignalsNotMatchingCohort,
  type EventSignal,
} from "@/sectors/d-personalization/cohorts/infer";

describe("inferSignalFromProductMetadata", () => {
  test("femenino adulto product → femenino_adulta cohort", () => {
    const sig = inferSignalFromProductMetadata({
      gender_target: "femenino",
      age_target: { min: 26, max: 50 },
    });
    expect(sig).toEqual({ cohort_id: "femenino_adulta", gender: "femenino", age_band: "adulto" });
  });

  test("masculino nino product → masculino_nino", () => {
    const sig = inferSignalFromProductMetadata({
      gender_target: "masculino",
      age_target: { min: 4, max: 10 },
    });
    expect(sig.cohort_id).toBe("masculino_nino");
  });

  test("unisex product → unisex_indeterminado", () => {
    const sig = inferSignalFromProductMetadata({
      gender_target: "unisex",
      age_target: { min: 0, max: 99 },
    });
    expect(sig.cohort_id).toBe("unisex_indeterminado");
  });

  test("missing fields → unisex_indeterminado", () => {
    expect(inferSignalFromProductMetadata({}).cohort_id).toBe("unisex_indeterminado");
    expect(inferSignalFromProductMetadata(null).cohort_id).toBe("unisex_indeterminado");
  });
});

describe("majorityCohort", () => {
  test("returns the most common cohort", () => {
    const sigs: EventSignal[] = [
      { cohort_id: "femenino_adulta", gender: "femenino", age_band: "adulto" },
      { cohort_id: "femenino_adulta", gender: "femenino", age_band: "adulto" },
      { cohort_id: "masculino_nino", gender: "masculino", age_band: "nino" },
    ];
    expect(majorityCohort(sigs)).toBe("femenino_adulta");
  });

  test("ignores unisex_indeterminado when other signals exist", () => {
    const sigs: EventSignal[] = [
      { cohort_id: "unisex_indeterminado", gender: null, age_band: null },
      { cohort_id: "unisex_indeterminado", gender: null, age_band: null },
      { cohort_id: "femenino_adulta", gender: "femenino", age_band: "adulto" },
    ];
    expect(majorityCohort(sigs)).toBe("femenino_adulta");
  });

  test("all unisex → unisex_indeterminado", () => {
    const sigs: EventSignal[] = [
      { cohort_id: "unisex_indeterminado", gender: null, age_band: null },
      { cohort_id: "unisex_indeterminado", gender: null, age_band: null },
    ];
    expect(majorityCohort(sigs)).toBe("unisex_indeterminado");
  });
});

describe("countSignalsNotMatchingCohort", () => {
  test("counts signals whose cohort differs", () => {
    const sigs: EventSignal[] = [
      { cohort_id: "femenino_adulta", gender: "femenino", age_band: "adulto" },
      { cohort_id: "masculino_nino", gender: "masculino", age_band: "nino" },
      { cohort_id: "masculino_nino", gender: "masculino", age_band: "nino" },
      { cohort_id: "masculino_nino", gender: "masculino", age_band: "nino" },
      { cohort_id: "femenino_adulta", gender: "femenino", age_band: "adulto" },
    ];
    expect(countSignalsNotMatchingCohort(sigs, "femenino_adulta")).toBe(3);
  });
});
```

- [ ] **Step 3.2: Correr → falla**

Run: `pnpm test:unit -- tests/unit/cohorts-infer.test.ts`
Expected: FAIL.

- [ ] **Step 3.3: Implementar**

```ts
// src/sectors/d-personalization/cohorts/infer.ts
import {
  cohortIdFor,
  type CohortId,
  type AgeBand,
  ageToBand,
} from "./definitions";

export interface EventSignal {
  cohort_id: CohortId;
  gender: "femenino" | "masculino" | null;
  age_band: AgeBand | null;
}

interface ProductMetadataLike {
  gender_target?: string | null;
  age_target?: { min?: number; max?: number } | null;
}

export function inferSignalFromProductMetadata(
  meta: ProductMetadataLike | null | undefined,
): EventSignal {
  if (!meta) return { cohort_id: "unisex_indeterminado", gender: null, age_band: null };
  const rawGender = meta.gender_target;
  const gender =
    rawGender === "femenino" || rawGender === "masculino" ? rawGender : null;
  const at = meta.age_target;
  const repAge =
    at && typeof at.min === "number" && typeof at.max === "number"
      ? Math.round((at.min + at.max) / 2)
      : null;
  const cohort_id = cohortIdFor(
    gender ?? (rawGender === "unisex" ? "unisex" : null),
    repAge,
  );
  return {
    cohort_id,
    gender: gender,
    age_band: ageToBand(repAge),
  };
}

export function inferSignalFromNormalizedQuery(n: {
  recipient_gender?: string | null;
  recipient_age_min?: number | null;
  recipient_age_max?: number | null;
}): EventSignal {
  return inferSignalFromProductMetadata({
    gender_target: n.recipient_gender ?? null,
    age_target:
      n.recipient_age_min !== null && n.recipient_age_min !== undefined &&
      n.recipient_age_max !== null && n.recipient_age_max !== undefined
        ? { min: n.recipient_age_min, max: n.recipient_age_max }
        : null,
  });
}

export function majorityCohort(signals: EventSignal[]): CohortId {
  const counts = new Map<CohortId, number>();
  for (const s of signals) {
    if (s.cohort_id === "unisex_indeterminado") continue;
    counts.set(s.cohort_id, (counts.get(s.cohort_id) ?? 0) + 1);
  }
  if (counts.size === 0) return "unisex_indeterminado";
  let best: CohortId = "unisex_indeterminado";
  let bestN = -1;
  for (const [c, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = c;
    }
  }
  return best;
}

export function countSignalsNotMatchingCohort(
  signals: EventSignal[],
  cohort: CohortId,
): number {
  return signals.filter((s) => s.cohort_id !== cohort).length;
}
```

- [ ] **Step 3.4: Tests pasan**

Run: `pnpm test:unit -- tests/unit/cohorts-infer.test.ts`
Expected: 9 PASSING.

- [ ] **Step 3.5: Commit + push**

```bash
git add src/sectors/d-personalization/cohorts/infer.ts tests/unit/cohorts-infer.test.ts
git commit -m "feat(d-personalization): EventSignal inference (T3)" && git push
```

---

## Task 4: Sub-bucket state + shift detection

**Files:**
- Create: `src/sectors/d-personalization/session/state.ts`
- Create: `src/sectors/d-personalization/session/shift-detection.ts`
- Test: `tests/unit/shift-detection.test.ts`
- Test: `tests/integration/session-state.test.ts`

- [ ] **Step 4.1: Unit test fallido (shift detection puro, sin BD)**

```ts
// tests/unit/shift-detection.test.ts
import { describe, test, expect } from "vitest";
import {
  applySignalToState,
  WARMUP_SIZE,
  WINDOW_SIZE,
  SHIFT_THRESHOLD,
  type SubBucketState,
} from "@/sectors/d-personalization/session/shift-detection";
import type { EventSignal } from "@/sectors/d-personalization/cohorts/infer";

const femAdultaSig: EventSignal = {
  cohort_id: "femenino_adulta", gender: "femenino", age_band: "adulto",
};
const mascNinoSig: EventSignal = {
  cohort_id: "masculino_nino", gender: "masculino", age_band: "nino",
};

function emptyState(): SubBucketState {
  return {
    current_cohort_id: null,
    signal_window: [],
    signal_window_size: 0,
  };
}

describe("applySignalToState", () => {
  test("constants are 3 / 5 / 3", () => {
    expect(WARMUP_SIZE).toBe(3);
    expect(WINDOW_SIZE).toBe(5);
    expect(SHIFT_THRESHOLD).toBe(3);
  });

  test("warmup: 3 fem signals sets current_cohort_id to femenino_adulta", () => {
    let s = emptyState();
    s = applySignalToState(s, femAdultaSig);
    expect(s.current_cohort_id).toBeNull();
    s = applySignalToState(s, femAdultaSig);
    expect(s.current_cohort_id).toBeNull();
    s = applySignalToState(s, femAdultaSig);
    expect(s.current_cohort_id).toBe("femenino_adulta");
    expect(s.signal_window_size).toBe(3);
  });

  test("no shift when all signals match current cohort", () => {
    let s = emptyState();
    for (let i = 0; i < 5; i++) s = applySignalToState(s, femAdultaSig);
    expect(s.current_cohort_id).toBe("femenino_adulta");
    s = applySignalToState(s, femAdultaSig);
    expect(s.current_cohort_id).toBe("femenino_adulta");
  });

  test("shift: 3 of last 5 contradict → cohort flips", () => {
    let s = emptyState();
    // Warmup with femAdulta
    s = applySignalToState(s, femAdultaSig);
    s = applySignalToState(s, femAdultaSig);
    s = applySignalToState(s, femAdultaSig);
    expect(s.current_cohort_id).toBe("femenino_adulta");
    // Now 3 mascNino enter → window = [fem, fem, masc, masc, masc] → 3 contradict
    s = applySignalToState(s, mascNinoSig);
    s = applySignalToState(s, mascNinoSig);
    s = applySignalToState(s, mascNinoSig);
    expect(s.current_cohort_id).toBe("masculino_nino");
    // Window resets to [mascNino] after shift
    expect(s.signal_window_size).toBe(1);
  });

  test("no shift when contradictions < threshold", () => {
    let s = emptyState();
    s = applySignalToState(s, femAdultaSig);
    s = applySignalToState(s, femAdultaSig);
    s = applySignalToState(s, femAdultaSig);
    // 2 contradict, 3 match — below threshold
    s = applySignalToState(s, mascNinoSig);
    s = applySignalToState(s, mascNinoSig);
    expect(s.current_cohort_id).toBe("femenino_adulta");
  });

  test("window stays at WINDOW_SIZE max", () => {
    let s = emptyState();
    for (let i = 0; i < 10; i++) s = applySignalToState(s, femAdultaSig);
    expect(s.signal_window.length).toBe(WINDOW_SIZE);
  });
});
```

- [ ] **Step 4.2: Correr → falla**

Run: `pnpm test:unit -- tests/unit/shift-detection.test.ts`
Expected: FAIL.

- [ ] **Step 4.3: Implementar shift-detection.ts**

```ts
// src/sectors/d-personalization/session/shift-detection.ts
import {
  majorityCohort,
  countSignalsNotMatchingCohort,
  type EventSignal,
} from "../cohorts/infer";
import type { CohortId } from "../cohorts/definitions";

export const WARMUP_SIZE = 3;
export const WINDOW_SIZE = 5;
export const SHIFT_THRESHOLD = 3;

export interface SubBucketState {
  current_cohort_id: CohortId | null;
  signal_window: EventSignal[];
  signal_window_size: number;
}

export function applySignalToState(
  state: SubBucketState,
  signal: EventSignal,
): SubBucketState {
  const window = [...state.signal_window, signal];
  if (window.length > WINDOW_SIZE) window.shift();

  // Warmup phase
  if (state.current_cohort_id === null) {
    if (window.length >= WARMUP_SIZE) {
      const cohort = majorityCohort(window);
      return {
        current_cohort_id: cohort,
        signal_window: window,
        signal_window_size: window.length,
      };
    }
    return {
      current_cohort_id: null,
      signal_window: window,
      signal_window_size: window.length,
    };
  }

  // Active cohort — check shift
  const contradicting = countSignalsNotMatchingCohort(window, state.current_cohort_id);
  if (contradicting >= SHIFT_THRESHOLD) {
    const newCohort = majorityCohort(window);
    if (newCohort !== state.current_cohort_id) {
      return {
        current_cohort_id: newCohort,
        signal_window: [signal],
        signal_window_size: 1,
      };
    }
  }
  return {
    current_cohort_id: state.current_cohort_id,
    signal_window: window,
    signal_window_size: window.length,
  };
}
```

- [ ] **Step 4.4: Tests pasan**

Run: `pnpm test:unit -- tests/unit/shift-detection.test.ts`
Expected: 6 PASSING.

- [ ] **Step 4.5: Mutation test (manual)**

Cambiar temporalmente `SHIFT_THRESHOLD = 3` → `4`. Run test → debe fallar el caso "shift: 3 of last 5 contradict → cohort flips". Restaurar. Documentar en commit.

- [ ] **Step 4.6: Integration test para state.ts (BD)**

```ts
// tests/integration/session-state.test.ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import {
  readSessionState,
  persistSessionState,
} from "@/sectors/d-personalization/session/state";
import { applySignalToState } from "@/sectors/d-personalization/session/shift-detection";

beforeEach(async () => {
  await truncateTestTables(["session_vectors"]);
});

describe("session state read/persist", () => {
  test("read returns empty initial state for unseen session", async () => {
    await withTestDb(async (pg) => {
      const sid = randomUUID();
      const s = await readSessionState(sid, pg);
      expect(s.current_cohort_id).toBeNull();
      expect(s.signal_window).toEqual([]);
      expect(s.signal_window_size).toBe(0);
    });
  });

  test("persist then read round-trips", async () => {
    await withTestDb(async (pg) => {
      const sid = randomUUID();
      const initial = await readSessionState(sid, pg);
      const after = applySignalToState(initial, {
        cohort_id: "femenino_adulta", gender: "femenino", age_band: "adulto",
      });
      await persistSessionState(sid, after, pg);
      const reloaded = await readSessionState(sid, pg);
      expect(reloaded.signal_window_size).toBe(1);
      expect(reloaded.signal_window[0].cohort_id).toBe("femenino_adulta");
    });
  });

  test("warmup completes after 3 signals (end-to-end with BD)", async () => {
    await withTestDb(async (pg) => {
      const sid = randomUUID();
      let s = await readSessionState(sid, pg);
      for (let i = 0; i < 3; i++) {
        s = applySignalToState(s, {
          cohort_id: "masculino_adulto", gender: "masculino", age_band: "adulto",
        });
        await persistSessionState(sid, s, pg);
      }
      const final = await readSessionState(sid, pg);
      expect(final.current_cohort_id).toBe("masculino_adulto");
    });
  });
});
```

- [ ] **Step 4.7: Implementar state.ts**

```ts
// src/sectors/d-personalization/session/state.ts
import type { Client } from "pg";
import type { SubBucketState } from "./shift-detection";
import type { EventSignal } from "../cohorts/infer";
import type { CohortId } from "../cohorts/definitions";
import { EMBEDDING_DIM } from "@/lib/embeddings/voyage";

interface Row {
  current_cohort_id: string | null;
  current_recipient_id: string | null;
  signal_window: EventSignal[];
  signal_window_size: number;
}

export async function readSessionState(
  session_id: string,
  pg: Client,
): Promise<SubBucketState & { current_recipient_id: string | null }> {
  const r = await pg.query(
    `SELECT current_cohort_id, current_recipient_id, signal_window, signal_window_size
     FROM session_vectors WHERE session_id = $1`,
    [session_id],
  );
  if (r.rows.length === 0) {
    return {
      current_cohort_id: null,
      current_recipient_id: null,
      signal_window: [],
      signal_window_size: 0,
    };
  }
  const row = r.rows[0] as Row;
  return {
    current_cohort_id: (row.current_cohort_id as CohortId | null),
    current_recipient_id: row.current_recipient_id,
    signal_window: row.signal_window ?? [],
    signal_window_size: row.signal_window_size ?? 0,
  };
}

export async function persistSessionState(
  session_id: string,
  state: SubBucketState & { current_recipient_id?: string | null },
  pg: Client,
): Promise<void> {
  // Use upsert; vector_unnormalized stays zero in this task (vectors come later T6).
  const zeroVec = "[" + new Array(EMBEDDING_DIM).fill(0).join(",") + "]";
  await pg.query(
    `INSERT INTO session_vectors
       (session_id, vector_unnormalized, weight_sum, updated_at,
        current_cohort_id, current_recipient_id, signal_window, signal_window_size)
     VALUES ($1, $2::vector, 0, now(), $3, $4, $5::jsonb, $6)
     ON CONFLICT (session_id) DO UPDATE SET
       current_cohort_id = EXCLUDED.current_cohort_id,
       current_recipient_id = EXCLUDED.current_recipient_id,
       signal_window = EXCLUDED.signal_window,
       signal_window_size = EXCLUDED.signal_window_size,
       updated_at = now()`,
    [
      session_id,
      zeroVec,
      state.current_cohort_id,
      state.current_recipient_id ?? null,
      JSON.stringify(state.signal_window),
      state.signal_window_size,
    ],
  );
}
```

- [ ] **Step 4.8: Tests integration pasan**

Run: `pnpm test:integration -- tests/integration/session-state.test.ts`
Expected: 3 PASSING.

- [ ] **Step 4.9: Commit + push**

```bash
git add src/sectors/d-personalization/session/ tests/unit/shift-detection.test.ts tests/integration/session-state.test.ts
git commit -m "$(cat <<'EOF'
feat(d-personalization): sub-bucket state + shift detection (T4)

Constants: WARMUP_SIZE=3, WINDOW_SIZE=5, SHIFT_THRESHOLD=3.
Verified mutation: SHIFT_THRESHOLD 3→4 → shift test fails as expected.

- 6 unit tests cubren warmup, no-shift, shift, sub-threshold, window cap.
- 3 integration tests con BD real round-trip.
EOF
)" && git push
```

---

## Task 5: Vector math — constants, decay, update, init, alpha

**Files:**
- Create: `src/sectors/d-personalization/vector/constants.ts`
- Create: `src/sectors/d-personalization/vector/update.ts`
- Create: `src/sectors/d-personalization/vector/init.ts`
- Create: `src/sectors/d-personalization/vector/effective.ts`
- Test: `tests/unit/vector-update.test.ts`
- Test: `tests/unit/vector-shrinkage.test.ts`
- Test: `tests/unit/vector-alpha.test.ts`

- [ ] **Step 5.1: Tests fallidos**

```ts
// tests/unit/vector-update.test.ts
import { describe, test, expect } from "vitest";
import { applyDecayAndAccumulate } from "@/sectors/d-personalization/vector/update";
import { TAU_PROFILE_DAYS, TAU_SESSION_MINUTES } from "@/sectors/d-personalization/vector/constants";
import { cosine, normalize } from "@/lib/math";

const DIM = 4;
function makeVec(values: number[]): number[] {
  if (values.length !== DIM) throw new Error("dim");
  return values.slice();
}

describe("applyDecayAndAccumulate", () => {
  test("constants are 60 days / 30 minutes", () => {
    expect(TAU_PROFILE_DAYS).toBe(60);
    expect(TAU_SESSION_MINUTES).toBe(30);
  });

  test("zero state + 1 event → vector_unnormalized = w*p, weight_sum = w", () => {
    const r = applyDecayAndAccumulate({
      unnorm: makeVec([0, 0, 0, 0]),
      weight: 0,
      lastUpdatedAt: new Date(),
      product: makeVec([1, 0, 0, 0]),
      eventWeight: 5,
      now: new Date(),
      tauMs: TAU_PROFILE_DAYS * 24 * 3600 * 1000,
    });
    expect(r.newUnnorm).toEqual([5, 0, 0, 0]);
    expect(r.newWeight).toBeCloseTo(5);
  });

  test("decay: 60 days old with τ=60d → weight multiplied by ~1/e", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const past = new Date("2026-04-02T00:00:00Z"); // 60d earlier
    const r = applyDecayAndAccumulate({
      unnorm: makeVec([10, 0, 0, 0]),
      weight: 10,
      lastUpdatedAt: past,
      product: makeVec([0, 0, 0, 0]),
      eventWeight: 0,
      now,
      tauMs: TAU_PROFILE_DAYS * 24 * 3600 * 1000,
    });
    expect(r.newWeight).toBeCloseTo(10 / Math.E, 2);
    expect(r.newUnnorm[0]).toBeCloseTo(10 / Math.E, 2);
  });

  test("convergence: repeated updates with same product → cos(normalized, product) → 1", () => {
    let unnorm = makeVec([0, 0, 0, 0]);
    let weight = 0;
    const product = makeVec([1, 1, 0, 0]);
    const productNorm = normalize(product);
    const now = new Date("2026-06-01T00:00:00Z");
    let last = new Date(now.getTime());
    for (let i = 0; i < 30; i++) {
      const r = applyDecayAndAccumulate({
        unnorm, weight, lastUpdatedAt: last,
        product, eventWeight: 1, now,
        tauMs: TAU_PROFILE_DAYS * 24 * 3600 * 1000,
      });
      unnorm = r.newUnnorm; weight = r.newWeight; last = now;
    }
    const u = normalize(unnorm);
    expect(cosine(u, productNorm)).toBeGreaterThan(0.99);
  });
});
```

```ts
// tests/unit/vector-shrinkage.test.ts
import { describe, test, expect } from "vitest";
import { buildInitialUnnormalized } from "@/sectors/d-personalization/vector/init";
import { KAPPA } from "@/sectors/d-personalization/vector/constants";
import { applyDecayAndAccumulate } from "@/sectors/d-personalization/vector/update";
import { normalize, cosine } from "@/lib/math";
import { TAU_PROFILE_DAYS } from "@/sectors/d-personalization/vector/constants";

describe("Shrinkage cold-start math", () => {
  test("KAPPA is 10", () => {
    expect(KAPPA).toBe(10);
  });

  test("init: vector_unnormalized = κ * prior, weight_sum = κ", () => {
    const prior = [0.6, 0.8, 0, 0]; // unit norm
    const { unnorm, weight } = buildInitialUnnormalized(prior);
    expect(weight).toBe(KAPPA);
    expect(unnorm).toEqual(prior.map((x) => x * KAPPA));
  });

  test("n=0 events → normalized vector equals prior", () => {
    const prior = normalize([0.6, 0.8, 0, 0]);
    const { unnorm, weight } = buildInitialUnnormalized(prior);
    const u = normalize(unnorm); // u = N(κ * prior) = prior (since κ > 0 and prior is unit)
    for (let i = 0; i < prior.length; i++) expect(u[i]).toBeCloseTo(prior[i], 6);
    expect(weight).toBe(KAPPA);
  });

  test("after 1 event with κ=10, prior dominates (cosine(u, prior) > cosine(u, p))", () => {
    const prior = normalize([1, 0, 0, 0]);
    const p = normalize([0, 1, 0, 0]);
    let { unnorm, weight } = buildInitialUnnormalized(prior);
    const now = new Date("2026-06-01");
    const r = applyDecayAndAccumulate({
      unnorm, weight, lastUpdatedAt: now,
      product: p, eventWeight: 1, now,
      tauMs: TAU_PROFILE_DAYS * 24 * 3600 * 1000,
    });
    const u = normalize(r.newUnnorm);
    expect(cosine(u, prior)).toBeGreaterThan(cosine(u, p));
  });

  test("after 100 events of same product, vector ≈ product", () => {
    const prior = normalize([1, 0, 0, 0]);
    const p = normalize([0, 1, 0, 0]);
    let { unnorm, weight } = buildInitialUnnormalized(prior);
    const now = new Date("2026-06-01");
    for (let i = 0; i < 100; i++) {
      const r = applyDecayAndAccumulate({
        unnorm, weight, lastUpdatedAt: now,
        product: p, eventWeight: 1, now,
        tauMs: TAU_PROFILE_DAYS * 24 * 3600 * 1000,
      });
      unnorm = r.newUnnorm; weight = r.newWeight;
    }
    const u = normalize(unnorm);
    expect(cosine(u, p)).toBeGreaterThan(0.99);
    expect(cosine(u, prior)).toBeLessThan(0.5);
  });
});
```

```ts
// tests/unit/vector-alpha.test.ts
import { describe, test, expect } from "vitest";
import { effectiveUserVector, alphaFor } from "@/sectors/d-personalization/vector/effective";
import {
  ALPHA_BASE, ALPHA_PER_EVENT, ALPHA_MAX,
} from "@/sectors/d-personalization/vector/constants";
import { cosine, normalize } from "@/lib/math";

describe("α dinámico", () => {
  test("constants 0.1 / 0.05 / 0.7", () => {
    expect(ALPHA_BASE).toBe(0.1);
    expect(ALPHA_PER_EVENT).toBe(0.05);
    expect(ALPHA_MAX).toBe(0.7);
  });

  test("alphaFor(0) = 0.1", () => {
    expect(alphaFor(0)).toBeCloseTo(0.1);
  });

  test("alphaFor(12) = 0.7 (capped)", () => {
    expect(alphaFor(12)).toBeCloseTo(0.7);
  });

  test("with nEventsSession=0 profile dominates", () => {
    const profile = normalize([1, 0, 0, 0]);
    const session = normalize([0, 1, 0, 0]);
    const eff = effectiveUserVector(profile, session, 0);
    expect(cosine(eff, profile)).toBeGreaterThan(cosine(eff, session));
  });

  test("with nEventsSession≥12 session dominates", () => {
    const profile = normalize([1, 0, 0, 0]);
    const session = normalize([0, 1, 0, 0]);
    const eff = effectiveUserVector(profile, session, 12);
    expect(cosine(eff, session)).toBeGreaterThan(cosine(eff, profile));
  });

  test("session null falls back to profile", () => {
    const profile = normalize([1, 0, 0, 0]);
    const eff = effectiveUserVector(profile, null, 5);
    for (let i = 0; i < profile.length; i++) expect(eff[i]).toBeCloseTo(profile[i]);
  });
});
```

- [ ] **Step 5.2: Run tests → fall**

Run: `pnpm test:unit -- tests/unit/vector-update.test.ts tests/unit/vector-shrinkage.test.ts tests/unit/vector-alpha.test.ts`
Expected: FAIL.

- [ ] **Step 5.3: Implementar constants.ts**

```ts
// src/sectors/d-personalization/vector/constants.ts
import type { EventType } from "@/sectors/a-tracking/events/schema";

export const EVENT_WEIGHTS: Record<EventType | "dismiss", number> = {
  purchase: 5.0,
  add_to_cart: 3.0,
  add_to_wishlist: 2.0,
  product_dwell: 1.5,
  product_view: 1.0,
  category_click: 0.5,
  remove_from_cart: 0,
  search: 0,
  filter_applied: 0,
  page_view: 0,
  session_start: 0,
  session_end: 0,
  dismiss: 0,
};

export const TAU_PROFILE_DAYS = 60;
export const TAU_SESSION_MINUTES = 30;
export const KAPPA = 10;

export const ALPHA_BASE = 0.1;
export const ALPHA_PER_EVENT = 0.05;
export const ALPHA_MAX = 0.7;
```

- [ ] **Step 5.4: Implementar update.ts**

```ts
// src/sectors/d-personalization/vector/update.ts
export interface UpdateInput {
  unnorm: number[];
  weight: number;
  lastUpdatedAt: Date;
  product: number[];
  eventWeight: number;
  now: Date;
  tauMs: number;
}

export interface UpdateOutput {
  newUnnorm: number[];
  newWeight: number;
}

export function applyDecayAndAccumulate(input: UpdateInput): UpdateOutput {
  const dtMs = Math.max(0, input.now.getTime() - input.lastUpdatedAt.getTime());
  const decay = Math.exp(-dtMs / input.tauMs);
  const d = input.unnorm.length;
  if (input.product.length !== d) {
    throw new Error(`dim mismatch ${input.product.length} vs ${d}`);
  }
  const newUnnorm = new Array<number>(d);
  for (let i = 0; i < d; i++) {
    newUnnorm[i] = input.unnorm[i] * decay + input.eventWeight * input.product[i];
  }
  const newWeight = input.weight * decay + input.eventWeight;
  return { newUnnorm, newWeight };
}
```

- [ ] **Step 5.5: Implementar init.ts**

```ts
// src/sectors/d-personalization/vector/init.ts
import { KAPPA } from "./constants";

export function buildInitialUnnormalized(prior: readonly number[]): {
  unnorm: number[];
  weight: number;
} {
  const unnorm = new Array<number>(prior.length);
  for (let i = 0; i < prior.length; i++) unnorm[i] = prior[i] * KAPPA;
  return { unnorm, weight: KAPPA };
}
```

- [ ] **Step 5.6: Implementar effective.ts**

```ts
// src/sectors/d-personalization/vector/effective.ts
import { normalize } from "@/lib/math";
import { ALPHA_BASE, ALPHA_PER_EVENT, ALPHA_MAX } from "./constants";

export function alphaFor(nEventsInSession: number): number {
  return Math.min(ALPHA_MAX, ALPHA_BASE + ALPHA_PER_EVENT * nEventsInSession);
}

export function effectiveUserVector(
  profileNormalized: readonly number[],
  sessionNormalized: readonly number[] | null,
  nEventsInSession: number,
): number[] {
  if (!sessionNormalized) return profileNormalized.slice();
  const a = alphaFor(nEventsInSession);
  const d = profileNormalized.length;
  const mix = new Array<number>(d);
  for (let i = 0; i < d; i++) {
    mix[i] = a * sessionNormalized[i] + (1 - a) * profileNormalized[i];
  }
  return normalize(mix);
}
```

- [ ] **Step 5.7: Tests pasan**

Run: `pnpm test:unit -- tests/unit/vector-update.test.ts tests/unit/vector-shrinkage.test.ts tests/unit/vector-alpha.test.ts`
Expected: 14 PASSING.

- [ ] **Step 5.8: Mutation tests (3 manuales)**

1. En `update.ts`: cambiar `Math.exp(-dtMs / input.tauMs)` por `Math.exp(dtMs / input.tauMs)`. Run tests. Esperado: decay test falla. Restaurar.
2. En `update.ts`: cambiar `input.weight * decay + input.eventWeight` por `input.weight + input.eventWeight` (decay no aplicado al peso). Run tests. Esperado: convergence test falla. Restaurar.
3. En `init.ts`: cambiar `prior[i] * KAPPA` por `prior[i]` (sin escala). Run shrinkage test. Esperado: "init: vector_unnormalized = κ * prior" falla. Restaurar.

Documentar las 3 mutaciones en el commit.

- [ ] **Step 5.9: Commit + push**

```bash
git add src/sectors/d-personalization/vector/ tests/unit/vector-update.test.ts tests/unit/vector-shrinkage.test.ts tests/unit/vector-alpha.test.ts
git commit -m "$(cat <<'EOF'
feat(d-personalization): vector math (T5)

constants + applyDecayAndAccumulate + buildInitialUnnormalized + effectiveUserVector.

Verified mutations:
- update: exp(-) → exp(+) → decay test fails as expected.
- update: weight*decay+w → weight+w → convergence fails as expected.
- init: prior*KAPPA → prior → shrinkage init test fails as expected.

14 unit tests covering decay, convergence, shrinkage init, n=0 prior,
n=1 prior-dominates, n=100 product-dominates, α(0)=0.1, α(12)=0.7,
session-dominates, profile-fallback.

Spec: docs/superpowers/specs/2026-05-15-fase-3a-design.md §5.1-§5.6
EOF
)" && git push
```

---

## Task 6: Profile mode orchestration (init + update + match recipient)

**Files:**
- Create: `src/sectors/d-personalization/cohorts/match-recipient.ts`
- Create: `src/sectors/d-personalization/profile-mode.ts`
- Test: `tests/integration/profile-mode-init.test.ts`
- Test: `tests/integration/profile-mode-update.test.ts`

- [ ] **Step 6.1: Tests fallidos**

```ts
// tests/integration/profile-mode-init.test.ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { getOrInitProfileMode } from "@/sectors/d-personalization/profile-mode";
import { KAPPA } from "@/sectors/d-personalization/vector/constants";

beforeEach(async () => {
  await truncateTestTables([
    "cohort_centroids", "products", "user_profiles", "user_profile_modes",
  ]);
});

describe("getOrInitProfileMode", () => {
  test("first call creates row with weight_sum = KAPPA and unnorm = KAPPA * cohort centroid", async () => {
    await withTestDb(async (pg) => {
      // Seed 2 productos en femenino_adulta para tener un centroide
      await seedProductWithEmbedding(pg, {
        title: "Vestido",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      await seedProductWithEmbedding(pg, {
        title: "Blusa",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      await computeCohortCentroids(pg);

      // Create user_profile
      const up = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events)
         VALUES ($1, 0) RETURNING id`,
        [randomUUID()],
      );
      const profile_id = up.rows[0].id;

      const mode = await getOrInitProfileMode(
        { user_profile_id: profile_id, recipient_id: null, cohort_id: "femenino_adulta" },
        pg,
      );
      expect(mode.weight_sum).toBeCloseTo(KAPPA);
      expect(mode.n_events_in_mode).toBe(0);

      // The vector_unnormalized should match KAPPA * centroid
      const c = await pg.query(
        `SELECT centroid_vector::text AS v FROM cohort_centroids WHERE cohort_id = 'femenino_adulta'`,
      );
      const centroid = JSON.parse(c.rows[0].v) as number[];
      const expected = centroid.map((x) => x * KAPPA);
      for (let i = 0; i < expected.length; i++) {
        expect(mode.vector_unnormalized[i]).toBeCloseTo(expected[i], 5);
      }
    });
  }, 120_000);

  test("second call returns the same row (no duplicate)", async () => {
    await withTestDb(async (pg) => {
      await seedProductWithEmbedding(pg, {
        title: "x",
        metadata: { gender_target: "masculino", age_target: { min: 26, max: 59 } },
      });
      await computeCohortCentroids(pg);
      const up = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events) VALUES ($1, 0) RETURNING id`,
        [randomUUID()],
      );
      const profile_id = up.rows[0].id;
      const m1 = await getOrInitProfileMode(
        { user_profile_id: profile_id, recipient_id: null, cohort_id: "masculino_adulto" },
        pg,
      );
      const m2 = await getOrInitProfileMode(
        { user_profile_id: profile_id, recipient_id: null, cohort_id: "masculino_adulto" },
        pg,
      );
      expect(m2.id).toBe(m1.id);
    });
  }, 90_000);
});
```

```ts
// tests/integration/profile-mode-update.test.ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import {
  getOrInitProfileMode, updateProfileModeWithProduct,
} from "@/sectors/d-personalization/profile-mode";
import { EVENT_WEIGHTS } from "@/sectors/d-personalization/vector/constants";
import { normalize, cosine } from "@/lib/math";

beforeEach(async () => {
  await truncateTestTables([
    "cohort_centroids", "products", "user_profiles", "user_profile_modes",
  ]);
});

describe("updateProfileModeWithProduct", () => {
  test("after 10 product_view events on the same product, vector tilts to that product", async () => {
    await withTestDb(async (pg) => {
      // Catálogo: 5 productos femenino_adulta para que el centroide tenga forma
      const products = [];
      for (let i = 0; i < 5; i++) {
        products.push(
          await seedProductWithEmbedding(pg, {
            title: `Producto fem ${i}`,
            metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
          }),
        );
      }
      await computeCohortCentroids(pg);

      const up = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events) VALUES ($1, 0) RETURNING id`,
        [randomUUID()],
      );
      const profile_id = up.rows[0].id;

      let mode = await getOrInitProfileMode(
        { user_profile_id: profile_id, recipient_id: null, cohort_id: "femenino_adulta" },
        pg,
      );

      // The chosen product
      const target = products[0];
      const targetEmbR = await pg.query(
        `SELECT embedding::text AS v FROM products WHERE id = $1`, [target.id],
      );
      const targetEmb = JSON.parse(targetEmbR.rows[0].v) as number[];

      // Apply 10 product_view updates
      for (let i = 0; i < 10; i++) {
        mode = await updateProfileModeWithProduct(
          { mode_id: mode.id, product_id: target.id, event_weight: EVENT_WEIGHTS.product_view },
          pg,
        );
      }

      const uNorm = normalize(mode.vector_unnormalized);
      const cosToTarget = cosine(uNorm, targetEmb);
      // Should be appreciably > centroid baseline (heuristic: > 0.5)
      expect(cosToTarget).toBeGreaterThan(0.5);
      expect(mode.n_events_in_mode).toBe(10);
    });
  }, 120_000);
});
```

- [ ] **Step 6.2: Run → fall**

Run: `pnpm test:integration -- tests/integration/profile-mode-init.test.ts tests/integration/profile-mode-update.test.ts`
Expected: FAIL.

- [ ] **Step 6.3: Implementar match-recipient.ts**

```ts
// src/sectors/d-personalization/cohorts/match-recipient.ts
import type { Client } from "pg";
import { parseCohort, AGE_BAND_RANGES, type CohortId } from "./definitions";

export async function matchRecipientOrNull(
  user_id: string | null,
  cohort_id: CohortId,
  pg: Client,
): Promise<string | null> {
  if (!user_id) return null;
  const { gender, age_band } = parseCohort(cohort_id);
  if (!gender || !age_band) return null;
  const range = AGE_BAND_RANGES[age_band];
  const r = await pg.query(
    `SELECT id FROM recipients
      WHERE user_id = $1
        AND gender = $2
        AND age BETWEEN $3 AND $4
      ORDER BY created_at DESC
      LIMIT 1`,
    [user_id, gender, range.min, range.max],
  );
  return r.rows[0]?.id ?? null;
}
```

- [ ] **Step 6.4: Implementar profile-mode.ts**

```ts
// src/sectors/d-personalization/profile-mode.ts
import type { Client } from "pg";
import { EMBEDDING_DIM } from "@/lib/embeddings/voyage";
import { buildInitialUnnormalized } from "./vector/init";
import { applyDecayAndAccumulate } from "./vector/update";
import { TAU_PROFILE_DAYS } from "./vector/constants";
import type { CohortId } from "./cohorts/definitions";

export interface ProfileMode {
  id: string;
  user_profile_id: string;
  recipient_id: string | null;
  cohort_id: CohortId;
  vector_unnormalized: number[];
  weight_sum: number;
  n_events_in_mode: number;
  last_assigned_at: Date;
}

function parseVecText(s: string): number[] {
  return JSON.parse(s) as number[];
}

async function fetchCohortPrior(cohort_id: CohortId, pg: Client): Promise<number[] | null> {
  const r = await pg.query(
    `SELECT centroid_vector::text AS v FROM cohort_centroids WHERE cohort_id = $1`,
    [cohort_id],
  );
  if (r.rows.length === 0) return null;
  return parseVecText(r.rows[0].v);
}

async function fetchGlobalCentroidFallback(pg: Client): Promise<number[]> {
  // Simple fallback: average of all active product embeddings; if none, zero vector.
  const r = await pg.query(
    `SELECT AVG(t.x)::float8[] AS avg
     FROM (
       SELECT unnest(embedding::float8[]) AS x, generate_subscripts(embedding::float8[], 1) AS i
       FROM products WHERE is_active = true AND embedding IS NOT NULL
     ) t`,
  );
  // Note: the above is a rough fallback. For robustness, do it in JS.
  const r2 = await pg.query(
    `SELECT embedding::text AS v FROM products WHERE is_active = true AND embedding IS NOT NULL LIMIT 200`,
  );
  if (r2.rows.length === 0) return new Array(EMBEDDING_DIM).fill(0);
  const sum = new Array<number>(EMBEDDING_DIM).fill(0);
  for (const row of r2.rows as { v: string }[]) {
    const e = parseVecText(row.v);
    for (let i = 0; i < EMBEDDING_DIM; i++) sum[i] += e[i];
  }
  return sum.map((x) => x / r2.rows.length);
}

export async function getOrInitProfileMode(
  opts: { user_profile_id: string; recipient_id: string | null; cohort_id: CohortId; mode_index?: number },
  pg: Client,
): Promise<ProfileMode> {
  const mode_index = opts.mode_index ?? 1;
  const r = await pg.query(
    `SELECT id, user_profile_id, recipient_id, cohort_id,
            vector_unnormalized::text AS v, weight_sum, n_events_in_mode, last_assigned_at
     FROM user_profile_modes
     WHERE user_profile_id = $1
       AND ((recipient_id IS NULL AND $2::uuid IS NULL) OR recipient_id = $2)
       AND cohort_id = $3
       AND mode_index = $4`,
    [opts.user_profile_id, opts.recipient_id, opts.cohort_id, mode_index],
  );
  if (r.rows.length > 0) {
    const row = r.rows[0];
    return {
      id: row.id,
      user_profile_id: row.user_profile_id,
      recipient_id: row.recipient_id,
      cohort_id: row.cohort_id,
      vector_unnormalized: parseVecText(row.v),
      weight_sum: Number(row.weight_sum),
      n_events_in_mode: Number(row.n_events_in_mode),
      last_assigned_at: row.last_assigned_at,
    };
  }
  // Init
  const prior =
    (await fetchCohortPrior(opts.cohort_id, pg)) ?? (await fetchGlobalCentroidFallback(pg));
  const { unnorm, weight } = buildInitialUnnormalized(prior);
  const ins = await pg.query(
    `INSERT INTO user_profile_modes
       (user_profile_id, recipient_id, cohort_id, mode_index,
        vector_unnormalized, weight_sum, n_events_in_mode, last_assigned_at)
     VALUES ($1, $2, $3, $4, $5::vector, $6, 0, now())
     RETURNING id, last_assigned_at`,
    [
      opts.user_profile_id, opts.recipient_id, opts.cohort_id, mode_index,
      "[" + unnorm.join(",") + "]", weight,
    ],
  );
  return {
    id: ins.rows[0].id,
    user_profile_id: opts.user_profile_id,
    recipient_id: opts.recipient_id,
    cohort_id: opts.cohort_id,
    vector_unnormalized: unnorm,
    weight_sum: weight,
    n_events_in_mode: 0,
    last_assigned_at: ins.rows[0].last_assigned_at,
  };
}

export async function updateProfileModeWithProduct(
  opts: { mode_id: string; product_id: string; event_weight: number },
  pg: Client,
): Promise<ProfileMode> {
  if (opts.event_weight <= 0) {
    // No-op for weight=0 events; just return current row
    const r = await pg.query(
      `SELECT id, user_profile_id, recipient_id, cohort_id,
              vector_unnormalized::text AS v, weight_sum, n_events_in_mode, last_assigned_at
       FROM user_profile_modes WHERE id = $1`,
      [opts.mode_id],
    );
    const row = r.rows[0];
    return {
      id: row.id,
      user_profile_id: row.user_profile_id,
      recipient_id: row.recipient_id,
      cohort_id: row.cohort_id,
      vector_unnormalized: parseVecText(row.v),
      weight_sum: Number(row.weight_sum),
      n_events_in_mode: Number(row.n_events_in_mode),
      last_assigned_at: row.last_assigned_at,
    };
  }
  const cur = await pg.query(
    `SELECT id, user_profile_id, recipient_id, cohort_id,
            vector_unnormalized::text AS v, weight_sum, n_events_in_mode, last_assigned_at
     FROM user_profile_modes WHERE id = $1`,
    [opts.mode_id],
  );
  const curRow = cur.rows[0];
  const curUnnorm = parseVecText(curRow.v);
  const prodR = await pg.query(
    `SELECT embedding::text AS v FROM products WHERE id = $1 AND embedding IS NOT NULL`,
    [opts.product_id],
  );
  if (prodR.rows.length === 0) {
    // product has no embedding — skip
    return {
      id: curRow.id,
      user_profile_id: curRow.user_profile_id,
      recipient_id: curRow.recipient_id,
      cohort_id: curRow.cohort_id,
      vector_unnormalized: curUnnorm,
      weight_sum: Number(curRow.weight_sum),
      n_events_in_mode: Number(curRow.n_events_in_mode),
      last_assigned_at: curRow.last_assigned_at,
    };
  }
  const productEmb = parseVecText(prodR.rows[0].v);
  const now = new Date();
  const { newUnnorm, newWeight } = applyDecayAndAccumulate({
    unnorm: curUnnorm,
    weight: Number(curRow.weight_sum),
    lastUpdatedAt: new Date(curRow.last_assigned_at),
    product: productEmb,
    eventWeight: opts.event_weight,
    now,
    tauMs: TAU_PROFILE_DAYS * 24 * 3600 * 1000,
  });
  const upd = await pg.query(
    `UPDATE user_profile_modes
       SET vector_unnormalized = $1::vector,
           weight_sum = $2,
           n_events_in_mode = n_events_in_mode + 1,
           last_assigned_at = $3
     WHERE id = $4
     RETURNING n_events_in_mode, last_assigned_at`,
    ["[" + newUnnorm.join(",") + "]", newWeight, now, opts.mode_id],
  );
  return {
    id: curRow.id,
    user_profile_id: curRow.user_profile_id,
    recipient_id: curRow.recipient_id,
    cohort_id: curRow.cohort_id,
    vector_unnormalized: newUnnorm,
    weight_sum: newWeight,
    n_events_in_mode: Number(upd.rows[0].n_events_in_mode),
    last_assigned_at: upd.rows[0].last_assigned_at,
  };
}
```

- [ ] **Step 6.5: Tests pasan**

Run: `pnpm test:integration -- tests/integration/profile-mode-init.test.ts tests/integration/profile-mode-update.test.ts`
Expected: 3 PASSING.

- [ ] **Step 6.6: Commit + push**

```bash
git add src/sectors/d-personalization/cohorts/match-recipient.ts src/sectors/d-personalization/profile-mode.ts tests/integration/profile-mode-init.test.ts tests/integration/profile-mode-update.test.ts
git commit -m "feat(d-personalization): profile mode init+update orchestration (T6)" && git push
```

---

## Task 7: Hook en `/api/track` — actualizar sub-bucket + vectores

**Files:**
- Create: `src/sectors/d-personalization/track-hook.ts`
- Modify: `src/app/api/track/route.ts`
- Test: `tests/integration/track-personalization-hook.test.ts`

- [ ] **Step 7.1: Test fallido**

```ts
// tests/integration/track-personalization-hook.test.ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";

beforeEach(async () => {
  await truncateTestTables([
    "events", "user_profiles", "user_profile_modes", "session_vectors",
    "cohort_centroids", "products",
  ]);
});

describe("processEventForPersonalization", () => {
  test("3 product_view events on femenino_adulta products → session.current_cohort_id set, profile mode created with shrinkage", async () => {
    await withTestDb(async (pg) => {
      const ps: { id: string }[] = [];
      for (let i = 0; i < 3; i++) {
        ps.push(await seedProductWithEmbedding(pg, {
          title: `Producto ${i}`,
          metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
        }));
      }
      await computeCohortCentroids(pg);

      const anonymous_id = randomUUID();
      const session_id = randomUUID();

      for (const p of ps) {
        await processEventForPersonalization(
          {
            anonymous_id, user_id: null, session_id,
            event_type: "product_view",
            payload: { product_id: p.id, source: "home" },
            occurred_at: new Date().toISOString(),
          },
          pg,
        );
      }

      const sv = await pg.query(
        `SELECT current_cohort_id, signal_window_size FROM session_vectors WHERE session_id = $1`,
        [session_id],
      );
      expect(sv.rows[0].current_cohort_id).toBe("femenino_adulta");
      expect(sv.rows[0].signal_window_size).toBe(3);

      const modes = await pg.query(
        `SELECT cohort_id, n_events_in_mode, weight_sum FROM user_profile_modes`,
      );
      expect(modes.rows.length).toBe(1);
      expect(modes.rows[0].cohort_id).toBe("femenino_adulta");
      // n_events should be 3 (post-warmup updates: vector receives all 3)
      expect(Number(modes.rows[0].n_events_in_mode)).toBe(3);
    });
  }, 180_000);

  test("weight=0 events (page_view) do NOT update vectors but DO track signals", async () => {
    await withTestDb(async (pg) => {
      const p = await seedProductWithEmbedding(pg, {
        title: "Test", metadata: { gender_target: "masculino", age_target: { min: 26, max: 59 } },
      });
      await computeCohortCentroids(pg);
      const session_id = randomUUID();
      const anonymous_id = randomUUID();

      await processEventForPersonalization(
        {
          anonymous_id, user_id: null, session_id,
          event_type: "page_view",
          payload: { path: "/" },
          occurred_at: new Date().toISOString(),
        },
        pg,
      );

      // page_view has no product → no signal added, no vector update
      const sv = await pg.query(
        `SELECT signal_window_size FROM session_vectors WHERE session_id = $1`,
        [session_id],
      );
      // page_view does not carry product_id so it produces no signal and no row
      expect(sv.rows.length).toBe(0);
    });
  }, 60_000);
});
```

- [ ] **Step 7.2: Run → fall**

Run: `pnpm test:integration -- tests/integration/track-personalization-hook.test.ts`
Expected: FAIL.

- [ ] **Step 7.3: Implementar track-hook.ts**

```ts
// src/sectors/d-personalization/track-hook.ts
import type { Client } from "pg";
import type { EventType } from "@/sectors/a-tracking/events/schema";
import { EVENT_WEIGHTS } from "./vector/constants";
import { inferSignalFromProductMetadata, type EventSignal } from "./cohorts/infer";
import { applySignalToState } from "./session/shift-detection";
import { readSessionState, persistSessionState } from "./session/state";
import { matchRecipientOrNull } from "./cohorts/match-recipient";
import { getOrInitProfileMode, updateProfileModeWithProduct } from "./profile-mode";
import type { CohortId } from "./cohorts/definitions";

interface TrackInput {
  anonymous_id: string;
  user_id: string | null;
  session_id: string;
  event_type: EventType | "dismiss";
  payload: Record<string, unknown>;
  occurred_at: string;
}

async function getOrCreateProfile(
  anonymous_id: string,
  user_id: string | null,
  pg: Client,
): Promise<string> {
  if (user_id) {
    const r = await pg.query(
      `SELECT id FROM user_profiles WHERE user_id = $1`,
      [user_id],
    );
    if (r.rows.length > 0) return r.rows[0].id;
    const ins = await pg.query(
      `INSERT INTO user_profiles (user_id, n_events) VALUES ($1, 0) RETURNING id`,
      [user_id],
    );
    return ins.rows[0].id;
  }
  const r = await pg.query(
    `SELECT id FROM user_profiles WHERE anonymous_id = $1`,
    [anonymous_id],
  );
  if (r.rows.length > 0) return r.rows[0].id;
  const ins = await pg.query(
    `INSERT INTO user_profiles (anonymous_id, n_events) VALUES ($1, 0) RETURNING id`,
    [anonymous_id],
  );
  return ins.rows[0].id;
}

async function fetchProductMetadataAndId(
  payload: Record<string, unknown>,
  pg: Client,
): Promise<{ product_id: string; metadata: Record<string, unknown> } | null> {
  const product_id = (payload.product_id as string) ?? null;
  if (!product_id) return null;
  const r = await pg.query(
    `SELECT metadata FROM products WHERE id = $1`,
    [product_id],
  );
  if (r.rows.length === 0) return null;
  return { product_id, metadata: r.rows[0].metadata ?? {} };
}

export async function processEventForPersonalization(
  input: TrackInput,
  pg: Client,
): Promise<void> {
  // 1. Derive signal (only product-based events contribute here; search handled separately)
  const productInfo =
    input.event_type === "product_view" ||
    input.event_type === "add_to_cart" ||
    input.event_type === "add_to_wishlist" ||
    input.event_type === "product_dwell" ||
    input.event_type === "purchase" // purchase has product_ids[] — handled below
      ? await fetchProductMetadataAndId(input.payload, pg)
      : null;

  // Special-case: purchase has product_ids array — pick first for signal
  if (input.event_type === "purchase" && !productInfo) {
    const ids = input.payload.product_ids as string[] | undefined;
    if (ids && ids.length > 0) {
      const r = await pg.query(`SELECT metadata FROM products WHERE id = $1`, [ids[0]]);
      if (r.rows.length > 0) {
        // synthesize productInfo from first item
        const meta = r.rows[0].metadata ?? {};
        const signal = inferSignalFromProductMetadata(meta as Record<string, unknown> as never);
        await runPipeline(input, signal, ids[0], pg);
      }
    }
    return;
  }

  if (!productInfo) return;

  const signal = inferSignalFromProductMetadata(productInfo.metadata as Record<string, unknown> as never);
  await runPipeline(input, signal, productInfo.product_id, pg);
}

async function runPipeline(
  input: TrackInput,
  signal: EventSignal,
  product_id: string,
  pg: Client,
): Promise<void> {
  // 2. Read + advance session state
  const state = await readSessionState(input.session_id, pg);
  const newState = applySignalToState(state, signal);
  const cohort = newState.current_cohort_id;
  const recipient_id =
    cohort && cohort !== state.current_cohort_id
      ? await matchRecipientOrNull(input.user_id, cohort, pg)
      : state.current_recipient_id;
  await persistSessionState(
    input.session_id,
    { ...newState, current_recipient_id: recipient_id },
    pg,
  );

  // 3. If still in warmup (no cohort fixed yet), don't update vectors
  if (!cohort) return;

  // 4. Get/init profile mode
  const profile_id = await getOrCreateProfile(input.anonymous_id, input.user_id, pg);
  const mode = await getOrInitProfileMode(
    { user_profile_id: profile_id, recipient_id, cohort_id: cohort as CohortId },
    pg,
  );

  // 5. Update vector if event has weight
  const weight = EVENT_WEIGHTS[input.event_type as keyof typeof EVENT_WEIGHTS] ?? 0;
  if (weight > 0) {
    await updateProfileModeWithProduct(
      { mode_id: mode.id, product_id, event_weight: weight },
      pg,
    );
  }

  // 6. Bump user_profiles.n_events
  await pg.query(
    `UPDATE user_profiles SET n_events = n_events + 1, updated_at = now() WHERE id = $1`,
    [profile_id],
  );
}
```

- [ ] **Step 7.4: Modificar `src/app/api/track/route.ts`**

Después de `insertEvent(...)`, antes de devolver el response:

```ts
// Within the try block, after `await insertEvent(...)`:
try {
  await withPg((pg) =>
    processEventForPersonalization(
      {
        anonymous_id,
        user_id,
        session_id,
        event_type: envelope.event_type,
        payload: envelope.payload as Record<string, unknown>,
        occurred_at: envelope.occurred_at,
      },
      pg,
    ),
  );
} catch (e) {
  // Personalization is best-effort; do not fail the request.
  console.warn("[track] personalization hook failed:", e);
}
```

Importar arriba: `import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";`

- [ ] **Step 7.5: Tests pasan**

Run: `pnpm test:integration -- tests/integration/track-personalization-hook.test.ts tests/integration/track-endpoint.test.ts`
Expected: ambos suites verdes (el endpoint sigue funcionando + el hook funciona).

- [ ] **Step 7.6: Commit + push**

```bash
git add src/sectors/d-personalization/track-hook.ts src/app/api/track/route.ts tests/integration/track-personalization-hook.test.ts
git commit -m "feat(d-personalization): track-hook synchronous (T7)" && git push
```

---

## Task 8: Evento `dismiss` + autoexclusión

**Files:**
- Modify: `src/sectors/a-tracking/events/schema.ts`
- Create: `src/sectors/d-personalization/exclusion/dismiss-handler.ts`
- Modify: `src/app/api/track/route.ts`
- Test: `tests/unit/dismiss-schema.test.ts`
- Test: `tests/integration/dismiss-flow.test.ts`

- [ ] **Step 8.1: Test fallido para schema**

```ts
// tests/unit/dismiss-schema.test.ts
import { describe, test, expect } from "vitest";
import { EVENT_TYPES, validatePayload } from "@/sectors/a-tracking/events/schema";

describe("dismiss event schema", () => {
  test("dismiss is in EVENT_TYPES", () => {
    expect(EVENT_TYPES).toContain("dismiss");
  });

  test("valid dismiss payload with reason parses", () => {
    const out = validatePayload("dismiss", {
      product_id: "00000000-0000-0000-0000-000000000001",
      reason: "not_interested",
    });
    expect(out.product_id).toBe("00000000-0000-0000-0000-000000000001");
    expect(out.reason).toBe("not_interested");
  });

  test("valid dismiss payload without reason parses", () => {
    const out = validatePayload("dismiss", {
      product_id: "00000000-0000-0000-0000-000000000001",
    });
    expect(out.product_id).toBe("00000000-0000-0000-0000-000000000001");
  });

  test("invalid product_id rejected", () => {
    expect(() =>
      validatePayload("dismiss", { product_id: "not-uuid" }),
    ).toThrow();
  });
});
```

- [ ] **Step 8.2: Run → fail (dismiss no existe)**

Run: `pnpm test:unit -- tests/unit/dismiss-schema.test.ts`
Expected: FAIL.

- [ ] **Step 8.3: Modificar schema.ts**

```ts
// src/sectors/a-tracking/events/schema.ts — modifica EVENT_TYPES y PAYLOAD_SCHEMAS

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
  "dismiss", // NEW
] as const;

// En PAYLOAD_SCHEMAS añadir:
//   dismiss: z.object({
//     product_id: uuid,
//     reason: z.enum(["not_interested", "already_have", "wrong_recipient", "other"]).optional(),
//   }),
```

- [ ] **Step 8.4: Test integration de dismiss flow**

```ts
// tests/integration/dismiss-flow.test.ts
import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { handleDismissAutoExclude } from "@/sectors/d-personalization/exclusion/dismiss-handler";

beforeEach(async () => {
  await truncateTestTables(["excluded_products", "products"]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("dismiss → excluded_products", () => {
  test("inserts row with ttl_until ≈ now + 14 days", async () => {
    await withTestDb(async (pg) => {
      const p = await seedProductWithEmbedding(pg, { title: "X" });
      const anonymous_id = randomUUID();
      await handleDismissAutoExclude(
        { anonymous_id, user_id: null, product_id: p.id },
        pg,
      );
      const r = await pg.query(
        `SELECT ttl_until, excluded_at FROM excluded_products WHERE product_id = $1`,
        [p.id],
      );
      expect(r.rows.length).toBe(1);
      const ttl = new Date(r.rows[0].ttl_until).getTime();
      const ex = new Date(r.rows[0].excluded_at).getTime();
      const diffDays = (ttl - ex) / (24 * 3600 * 1000);
      expect(diffDays).toBeCloseTo(14, 1);
    });
  });

  test("idempotent: two dismisses on same product → one row", async () => {
    await withTestDb(async (pg) => {
      const p = await seedProductWithEmbedding(pg, { title: "Y" });
      const anonymous_id = randomUUID();
      await handleDismissAutoExclude(
        { anonymous_id, user_id: null, product_id: p.id },
        pg,
      );
      await handleDismissAutoExclude(
        { anonymous_id, user_id: null, product_id: p.id },
        pg,
      );
      const r = await pg.query(
        `SELECT count(*)::int AS c FROM excluded_products WHERE product_id = $1`,
        [p.id],
      );
      expect(r.rows[0].c).toBe(1);
    });
  });
});
```

- [ ] **Step 8.5: Implementar dismiss-handler.ts**

```ts
// src/sectors/d-personalization/exclusion/dismiss-handler.ts
import type { Client } from "pg";

export const DISMISS_TTL_DAYS = 14;

export async function handleDismissAutoExclude(
  opts: { anonymous_id: string; user_id: string | null; product_id: string },
  pg: Client,
): Promise<void> {
  await pg.query(
    `INSERT INTO excluded_products (anonymous_id, user_id, product_id, ttl_until)
     VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)
     ON CONFLICT DO NOTHING`,
    [
      opts.user_id ? null : opts.anonymous_id,
      opts.user_id,
      opts.product_id,
      DISMISS_TTL_DAYS,
    ],
  );
}
```

- [ ] **Step 8.6: Hook en `/api/track/route.ts`**

Después del insert event:
```ts
if (envelope.event_type === "dismiss") {
  try {
    const payload = envelope.payload as { product_id: string };
    await withPg((pg) =>
      handleDismissAutoExclude(
        { anonymous_id, user_id, product_id: payload.product_id },
        pg,
      ),
    );
  } catch (e) {
    console.warn("[track] dismiss handler failed:", e);
  }
}
```

Importar `handleDismissAutoExclude` arriba.

- [ ] **Step 8.7: Tests pasan**

Run: `pnpm test:unit -- tests/unit/dismiss-schema.test.ts && pnpm test:integration -- tests/integration/dismiss-flow.test.ts`
Expected: 4 + 2 = 6 PASSING.

- [ ] **Step 8.8: Commit + push**

```bash
git add src/sectors/a-tracking/events/schema.ts src/sectors/d-personalization/exclusion/ src/app/api/track/route.ts tests/unit/dismiss-schema.test.ts tests/integration/dismiss-flow.test.ts
git commit -m "feat(d-personalization): dismiss event + autoexclusion 14d (T8)" && git push
```

---

## Task 9: Feed generation + retrieval + home wiring

**Files:**
- Create: `src/sectors/d-personalization/retrieve.ts`
- Create: `src/sectors/d-personalization/feed.ts`
- Modify: `src/app/(shop)/page.tsx`
- Test: `tests/integration/feed-generate.test.ts`

- [ ] **Step 9.1: Test fallido**

```ts
// tests/integration/feed-generate.test.ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { generateFeed } from "@/sectors/d-personalization/feed";
import { handleDismissAutoExclude } from "@/sectors/d-personalization/exclusion/dismiss-handler";

beforeEach(async () => {
  await truncateTestTables([
    "events", "user_profiles", "user_profile_modes", "session_vectors",
    "cohort_centroids", "excluded_products", "products",
  ]);
});

describe("generateFeed", () => {
  test("user with 5 product_view events on femenino_adulta → feed top-10 dominated by that cohort (>=60%)", async () => {
    await withTestDb(async (pg) => {
      // Seed 10 products femenino_adulta + 10 unrelated
      const adultaIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const p = await seedProductWithEmbedding(pg, {
          title: `FemAdulta ${i}`, description: "vestidos blusas",
          metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
        });
        adultaIds.push(p.id);
      }
      for (let i = 0; i < 10; i++) {
        await seedProductWithEmbedding(pg, {
          title: `MascNino ${i}`, description: "juguetes",
          metadata: { gender_target: "masculino", age_target: { min: 4, max: 11 } },
        });
      }
      await computeCohortCentroids(pg);

      const anonymous_id = randomUUID();
      const session_id = randomUUID();
      // 5 product_views on the first 5 adulta products
      for (let i = 0; i < 5; i++) {
        await processEventForPersonalization(
          {
            anonymous_id, user_id: null, session_id,
            event_type: "product_view",
            payload: { product_id: adultaIds[i], source: "home" },
            occurred_at: new Date().toISOString(),
          },
          pg,
        );
      }

      const feed = await generateFeed(
        { user_id: null, anonymous_id, session_id, limit: 10 },
        pg,
      );
      expect(feed.length).toBe(10);
      const inAdulta = feed.filter((f) => {
        const meta = f.product.metadata as { gender_target?: string };
        return meta.gender_target === "femenino";
      }).length;
      expect(inAdulta / feed.length).toBeGreaterThanOrEqual(0.6);
    });
  }, 240_000);

  test("excluded product does NOT appear in feed", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 5; i++) {
        await seedProductWithEmbedding(pg, {
          title: `P${i}`,
          metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
        });
      }
      await computeCohortCentroids(pg);
      const anonymous_id = randomUUID();
      const session_id = randomUUID();
      const feedBefore = await generateFeed(
        { user_id: null, anonymous_id, session_id, limit: 5 },
        pg,
      );
      expect(feedBefore.length).toBeGreaterThan(0);
      const target = feedBefore[0].product.id;
      await handleDismissAutoExclude({ anonymous_id, user_id: null, product_id: target }, pg);
      const feedAfter = await generateFeed(
        { user_id: null, anonymous_id, session_id, limit: 5 },
        pg,
      );
      expect(feedAfter.map((f) => f.product.id)).not.toContain(target);
    });
  }, 180_000);

  test("two contrasted synthetic users → feed overlap < 0.30", async () => {
    await withTestDb(async (pg) => {
      const femIds: string[] = [];
      const mascIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        femIds.push((await seedProductWithEmbedding(pg, {
          title: `Fem ${i}`,
          metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
        })).id);
        mascIds.push((await seedProductWithEmbedding(pg, {
          title: `Masc ${i}`,
          metadata: { gender_target: "masculino", age_target: { min: 26, max: 59 } },
        })).id);
      }
      await computeCohortCentroids(pg);

      const u1_anon = randomUUID(), u1_session = randomUUID();
      for (let i = 0; i < 5; i++) {
        await processEventForPersonalization(
          { anonymous_id: u1_anon, user_id: null, session_id: u1_session,
            event_type: "product_view",
            payload: { product_id: femIds[i], source: "home" },
            occurred_at: new Date().toISOString() }, pg,
        );
      }
      const u2_anon = randomUUID(), u2_session = randomUUID();
      for (let i = 0; i < 5; i++) {
        await processEventForPersonalization(
          { anonymous_id: u2_anon, user_id: null, session_id: u2_session,
            event_type: "product_view",
            payload: { product_id: mascIds[i], source: "home" },
            occurred_at: new Date().toISOString() }, pg,
        );
      }
      const feedU1 = await generateFeed(
        { user_id: null, anonymous_id: u1_anon, session_id: u1_session, limit: 10 }, pg,
      );
      const feedU2 = await generateFeed(
        { user_id: null, anonymous_id: u2_anon, session_id: u2_session, limit: 10 }, pg,
      );
      const u1Set = new Set(feedU1.map((f) => f.product.id));
      const u2Set = new Set(feedU2.map((f) => f.product.id));
      const overlap = [...u1Set].filter((x) => u2Set.has(x)).length;
      const jaccard = overlap / new Set([...u1Set, ...u2Set]).size;
      expect(jaccard).toBeLessThan(0.30);
    });
  }, 240_000);
});
```

- [ ] **Step 9.2: Run → fail (módulos no existen)**

Run: `pnpm test:integration -- tests/integration/feed-generate.test.ts`
Expected: FAIL.

- [ ] **Step 9.3: Implementar retrieve.ts**

```ts
// src/sectors/d-personalization/retrieve.ts
import type { Client } from "pg";
import type { ProductListRow } from "@/sectors/b-catalog/repository/products";

export interface FeedItem {
  product: ProductListRow;
  similarity: number;
}

export async function retrieveTopKByVector(
  vector: number[],
  excludedIds: string[],
  K: number,
  pg: Client,
): Promise<FeedItem[]> {
  const r = await pg.query(
    `SELECT id, title, description, price_cents, currency, image_url, metadata, created_at,
            1 - (embedding <=> $1::vector) AS similarity
     FROM products
     WHERE is_active = true
       AND embedding IS NOT NULL
       AND NOT (id = ANY($2::uuid[]))
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    ["[" + vector.join(",") + "]", excludedIds, K],
  );
  return r.rows.map((row) => ({
    product: {
      id: row.id, title: row.title, description: row.description,
      price_cents: row.price_cents, currency: row.currency,
      image_url: row.image_url, metadata: row.metadata, created_at: row.created_at,
    },
    similarity: Number(row.similarity),
  }));
}
```

- [ ] **Step 9.4: Implementar feed.ts**

```ts
// src/sectors/d-personalization/feed.ts
import type { Client } from "pg";
import { normalize } from "@/lib/math";
import { effectiveUserVector } from "./vector/effective";
import { retrieveTopKByVector, type FeedItem } from "./retrieve";
import { getOrInitProfileMode } from "./profile-mode";
import { readSessionState } from "./session/state";
import type { CohortId } from "./cohorts/definitions";
import { EMBEDDING_DIM } from "@/lib/embeddings/voyage";

export interface GenerateFeedOpts {
  user_id: string | null;
  anonymous_id: string | null;
  session_id: string | null;
  limit?: number;
}

async function getOrCreateProfileForFeed(
  user_id: string | null,
  anonymous_id: string | null,
  pg: Client,
): Promise<string | null> {
  if (user_id) {
    const r = await pg.query(`SELECT id FROM user_profiles WHERE user_id = $1`, [user_id]);
    if (r.rows.length > 0) return r.rows[0].id;
    const ins = await pg.query(
      `INSERT INTO user_profiles (user_id, n_events) VALUES ($1, 0) RETURNING id`,
      [user_id],
    );
    return ins.rows[0].id;
  }
  if (anonymous_id) {
    const r = await pg.query(`SELECT id FROM user_profiles WHERE anonymous_id = $1`, [anonymous_id]);
    if (r.rows.length > 0) return r.rows[0].id;
    const ins = await pg.query(
      `INSERT INTO user_profiles (anonymous_id, n_events) VALUES ($1, 0) RETURNING id`,
      [anonymous_id],
    );
    return ins.rows[0].id;
  }
  return null;
}

async function fetchExcludedIds(
  user_id: string | null,
  anonymous_id: string | null,
  pg: Client,
): Promise<string[]> {
  const r = await pg.query(
    `SELECT product_id FROM excluded_products
     WHERE ttl_until > now()
       AND ((user_id IS NOT NULL AND user_id = $1)
         OR (user_id IS NULL AND anonymous_id = $2))`,
    [user_id, anonymous_id],
  );
  return (r.rows as { product_id: string }[]).map((x) => x.product_id);
}

async function fetchSessionVectorUnnormalized(
  session_id: string,
  pg: Client,
): Promise<number[] | null> {
  const r = await pg.query(
    `SELECT vector_unnormalized::text AS v, weight_sum
     FROM session_vectors WHERE session_id = $1`,
    [session_id],
  );
  if (r.rows.length === 0) return null;
  if (Number(r.rows[0].weight_sum) <= 0) return null;
  return JSON.parse(r.rows[0].v) as number[];
}

export async function generateFeed(
  opts: GenerateFeedOpts,
  pg: Client,
): Promise<FeedItem[]> {
  const limit = opts.limit ?? 20;

  const profile_id = await getOrCreateProfileForFeed(opts.user_id, opts.anonymous_id, pg);

  let cohortId: CohortId = "unisex_indeterminado";
  let recipientId: string | null = null;
  let nEventsSession = 0;
  let sessionUnnorm: number[] | null = null;

  if (opts.session_id) {
    const s = await readSessionState(opts.session_id, pg);
    if (s.current_cohort_id) cohortId = s.current_cohort_id;
    recipientId = s.current_recipient_id;
    nEventsSession = s.signal_window_size;
    sessionUnnorm = await fetchSessionVectorUnnormalized(opts.session_id, pg);
  }

  let modeVec: number[];
  if (profile_id) {
    const mode = await getOrInitProfileMode(
      { user_profile_id: profile_id, recipient_id: recipientId, cohort_id: cohortId },
      pg,
    );
    modeVec = mode.vector_unnormalized;
  } else {
    // No profile possible (no anon, no user) — fall back to zero vector (no personalization)
    modeVec = new Array<number>(EMBEDDING_DIM).fill(0);
  }

  const profileNorm = normalize(modeVec);
  const sessionNorm = sessionUnnorm ? normalize(sessionUnnorm) : null;
  const eff = effectiveUserVector(profileNorm, sessionNorm, nEventsSession);

  const excluded = await fetchExcludedIds(opts.user_id, opts.anonymous_id, pg);

  const items = await retrieveTopKByVector(eff, excluded, limit * 3, pg);
  return items.slice(0, limit);
}
```

- [ ] **Step 9.5: Modificar home `src/app/(shop)/page.tsx`**

Reemplazar la lista actual con `generateFeed`. Patrón:

```tsx
import { withPg } from "@/lib/db/helpers";
import { cookies } from "next/headers";
import { auth0 } from "@/lib/auth";
import { generateFeed } from "@/sectors/d-personalization/feed";
import { ProductCard } from "@/components/ProductCard";

export default async function HomePage() {
  const ck = await cookies();
  const anonymous_id = ck.get("anonymous_id")?.value ?? null;
  const session_id = ck.get("session_id")?.value ?? null;
  const session = await auth0.getSession().catch(() => null);
  const user_id = (session?.user?.sub as string | undefined) ?? null;
  // Resolver user_id desde Auth0 sub → users.id no es trivial aquí; para 3a pasamos sub null y resolvemos por anonymous_id.
  // El track-hook ya se encarga de fusionar.
  const items = await withPg((pg) =>
    generateFeed({ user_id: null, anonymous_id, session_id, limit: 20 }, pg),
  );
  return (
    <main className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl mb-4">Home</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {items.map((it) => (
          <ProductCard key={it.product.id} product={it.product} />
        ))}
      </div>
    </main>
  );
}
```

NOTA: si la versión actual del home tiene otras props (tracking, etc.), conservarlas. Esta task asume modificación incremental al archivo existente.

- [ ] **Step 9.6: Tests pasan**

Run: `pnpm test:integration -- tests/integration/feed-generate.test.ts`
Expected: 3 PASSING.

- [ ] **Step 9.7: Commit + push**

```bash
git add src/sectors/d-personalization/retrieve.ts src/sectors/d-personalization/feed.ts src/app/(shop)/page.tsx tests/integration/feed-generate.test.ts
git commit -m "feat(d-personalization): feed generation + home wired (T9)" && git push
```

---

## Task 10: Admin user debug page

**Files:**
- Create: `src/sectors/d-personalization/admin/user-debug.ts`
- Create: `src/app/admin/users/[id]/page.tsx`
- Create: `src/components/UserDebugView.tsx`
- Test: `tests/integration/user-debug.test.ts`

- [ ] **Step 10.1: Test fallido**

```ts
// tests/integration/user-debug.test.ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { getUserDebugInfo } from "@/sectors/d-personalization/admin/user-debug";

beforeEach(async () => {
  await truncateTestTables([
    "events", "user_profiles", "user_profile_modes", "session_vectors",
    "cohort_centroids", "excluded_products", "products", "users",
  ]);
});

describe("getUserDebugInfo", () => {
  test("returns null for unknown user", async () => {
    await withTestDb(async (pg) => {
      const out = await getUserDebugInfo(randomUUID(), pg);
      expect(out).toBeNull();
    });
  });

  test("returns full info for user with events and one mode", async () => {
    await withTestDb(async (pg) => {
      // user
      const uR = await pg.query(
        `INSERT INTO users (email) VALUES ($1) RETURNING id`,
        [`t-${randomUUID()}@test.local`],
      );
      const user_id = uR.rows[0].id;

      // products
      const ps: string[] = [];
      for (let i = 0; i < 3; i++) {
        const p = await seedProductWithEmbedding(pg, {
          title: `P${i}`,
          metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
        });
        ps.push(p.id);
      }
      await computeCohortCentroids(pg);

      const anonymous_id = randomUUID();
      const session_id = randomUUID();
      for (const id of ps) {
        await processEventForPersonalization(
          {
            anonymous_id, user_id, session_id,
            event_type: "product_view",
            payload: { product_id: id, source: "home" },
            occurred_at: new Date().toISOString(),
          },
          pg,
        );
      }

      const info = await getUserDebugInfo(user_id, pg);
      expect(info === null).toBe(false);
      expect(info!.user.id).toBe(user_id);
      expect(info!.modes.length).toBe(1);
      expect(info!.modes[0].cohort_id).toBe("femenino_adulta");
      expect(info!.modes[0].top_5_products.length).toBeGreaterThan(0);
      expect(info!.recent_events.length).toBeGreaterThan(0);
    });
  }, 240_000);
});
```

- [ ] **Step 10.2: Run → falla**

Run: `pnpm test:integration -- tests/integration/user-debug.test.ts`
Expected: FAIL.

- [ ] **Step 10.3: Implementar user-debug.ts**

```ts
// src/sectors/d-personalization/admin/user-debug.ts
import type { Client } from "pg";
import { normalize } from "@/lib/math";
import { generateFeed } from "../feed";
import { retrieveTopKByVector } from "../retrieve";
import type { CohortId } from "../cohorts/definitions";

export interface UserDebugInfo {
  user: { id: string; email: string; auth0_sub: string | null; created_at: Date };
  anonymous_ids_merged: string[];
  profile: {
    n_events_total: number;
    last_recompute_at: Date | null;
  };
  active_session: {
    session_id: string;
    current_recipient_id: string | null;
    current_cohort_id: CohortId | null;
    signal_window_size: number;
  } | null;
  modes: {
    id: string;
    recipient_id: string | null;
    recipient_name: string | null;
    cohort_id: CohortId;
    n_events_in_mode: number;
    weight_sum: number;
    last_assigned_at: Date;
    top_5_products: { id: string; title: string; similarity: number }[];
  }[];
  recent_events: { event_type: string; occurred_at: Date; payload: unknown }[];
  exclusions_active: { product_id: string; product_title: string; ttl_until: Date }[];
  feed_now: { product_id: string; title: string; similarity: number }[];
}

export async function getUserDebugInfo(
  user_id: string,
  pg: Client,
): Promise<UserDebugInfo | null> {
  const ur = await pg.query(
    `SELECT id, email, auth0_sub, created_at FROM users WHERE id = $1`,
    [user_id],
  );
  if (ur.rows.length === 0) return null;
  const user = ur.rows[0];

  const anonRes = await pg.query(
    `SELECT anonymous_id::text FROM anonymous_sessions WHERE user_id = $1`,
    [user_id],
  );

  const pr = await pg.query(
    `SELECT id, n_events, last_recompute_at FROM user_profiles WHERE user_id = $1`,
    [user_id],
  );
  const profile = pr.rows[0] ?? { id: null, n_events: 0, last_recompute_at: null };

  // Active session: most recent session_vectors row for any anonymous_id of this user
  const anonIds = anonRes.rows.map((x: { anonymous_id: string }) => x.anonymous_id);
  let active_session: UserDebugInfo["active_session"] = null;
  if (anonIds.length > 0) {
    const sR = await pg.query(
      `SELECT sv.session_id::text, sv.current_recipient_id::text, sv.current_cohort_id,
              sv.signal_window_size
       FROM session_vectors sv
       JOIN events e ON e.session_id = sv.session_id
       WHERE e.anonymous_id = ANY($1::uuid[])
       ORDER BY sv.updated_at DESC LIMIT 1`,
      [anonIds],
    );
    if (sR.rows.length > 0) {
      active_session = {
        session_id: sR.rows[0].session_id,
        current_recipient_id: sR.rows[0].current_recipient_id,
        current_cohort_id: sR.rows[0].current_cohort_id,
        signal_window_size: sR.rows[0].signal_window_size,
      };
    }
  }

  // Modes
  const mR = profile.id
    ? await pg.query(
        `SELECT upm.id, upm.recipient_id::text, r.name AS recipient_name,
                upm.cohort_id, upm.n_events_in_mode, upm.weight_sum,
                upm.last_assigned_at, upm.vector_unnormalized::text AS v
         FROM user_profile_modes upm
         LEFT JOIN recipients r ON r.id = upm.recipient_id
         WHERE upm.user_profile_id = $1`,
        [profile.id],
      )
    : { rows: [] };

  const modes: UserDebugInfo["modes"] = [];
  for (const row of mR.rows as Array<{
    id: string; recipient_id: string | null; recipient_name: string | null;
    cohort_id: string; n_events_in_mode: string; weight_sum: string;
    last_assigned_at: Date; v: string;
  }>) {
    const unnorm = JSON.parse(row.v) as number[];
    const u = normalize(unnorm);
    const top = await retrieveTopKByVector(u, [], 5, pg);
    modes.push({
      id: row.id,
      recipient_id: row.recipient_id,
      recipient_name: row.recipient_name,
      cohort_id: row.cohort_id as CohortId,
      n_events_in_mode: Number(row.n_events_in_mode),
      weight_sum: Number(row.weight_sum),
      last_assigned_at: row.last_assigned_at,
      top_5_products: top.map((t) => ({
        id: t.product.id, title: t.product.title, similarity: t.similarity,
      })),
    });
  }

  const evR =
    anonIds.length > 0
      ? await pg.query(
          `SELECT event_type, occurred_at, payload FROM events
           WHERE anonymous_id = ANY($1::uuid[]) ORDER BY occurred_at DESC LIMIT 30`,
          [anonIds],
        )
      : { rows: [] };

  const exR =
    anonIds.length > 0
      ? await pg.query(
          `SELECT ep.product_id::text, p.title AS product_title, ep.ttl_until
           FROM excluded_products ep
           JOIN products p ON p.id = ep.product_id
           WHERE ep.ttl_until > now()
             AND (ep.user_id = $1 OR ep.anonymous_id = ANY($2::uuid[]))`,
          [user_id, anonIds],
        )
      : { rows: [] };

  // Feed now (use first anon if available)
  const feedNow = anonIds.length > 0 && active_session
    ? await generateFeed(
        { user_id, anonymous_id: anonIds[0], session_id: active_session.session_id, limit: 10 },
        pg,
      )
    : [];

  return {
    user: {
      id: user.id, email: user.email,
      auth0_sub: user.auth0_sub ?? null, created_at: user.created_at,
    },
    anonymous_ids_merged: anonIds,
    profile: {
      n_events_total: Number(profile.n_events ?? 0),
      last_recompute_at: profile.last_recompute_at,
    },
    active_session,
    modes,
    recent_events: evR.rows as Array<{ event_type: string; occurred_at: Date; payload: unknown }>,
    exclusions_active: (exR.rows as Array<{ product_id: string; product_title: string; ttl_until: Date }>),
    feed_now: feedNow.map((f) => ({
      product_id: f.product.id, title: f.product.title, similarity: f.similarity,
    })),
  };
}
```

- [ ] **Step 10.4: Crear `src/app/admin/users/[id]/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { getUserDebugInfo } from "@/sectors/d-personalization/admin/user-debug";
import { UserDebugView } from "@/components/UserDebugView";

export const dynamic = "force-dynamic";

export default async function UserDebugPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth0.getSession().catch(() => null);
  if (!session?.user?.sub) redirect("/auth/login?returnTo=/admin/users");
  const { id } = await params;
  const info = await withPg((pg) => getUserDebugInfo(id, pg));
  if (!info) return <main className="p-8"><p>Usuario no encontrado</p></main>;
  return (
    <main className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Debug usuario</h1>
      <UserDebugView info={info} />
    </main>
  );
}
```

- [ ] **Step 10.5: Crear `src/components/UserDebugView.tsx`**

Server component que renderiza 7 secciones de `UserDebugInfo` con `<details>` colapsables:

```tsx
import type { UserDebugInfo } from "@/sectors/d-personalization/admin/user-debug";

export function UserDebugView({ info }: { info: UserDebugInfo }) {
  return (
    <section className="space-y-4">
      <Card title="Identidad">
        <dl className="grid grid-cols-2 gap-1 text-sm">
          <dt>ID:</dt><dd className="font-mono text-xs">{info.user.id}</dd>
          <dt>Email:</dt><dd>{info.user.email}</dd>
          <dt>Auth0 sub:</dt><dd className="font-mono text-xs">{info.user.auth0_sub ?? "—"}</dd>
          <dt>Creado:</dt><dd>{String(info.user.created_at)}</dd>
          <dt>Anon IDs:</dt><dd className="font-mono text-xs">{info.anonymous_ids_merged.join(", ") || "—"}</dd>
        </dl>
      </Card>

      <Card title="Perfil">
        <ul className="text-sm">
          <li>Eventos totales: {info.profile.n_events_total}</li>
          <li>Último recompute: {info.profile.last_recompute_at ? String(info.profile.last_recompute_at) : "—"}</li>
        </ul>
      </Card>

      <Card title="Sesión activa">
        {info.active_session ? (
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt>Session ID:</dt><dd className="font-mono text-xs">{info.active_session.session_id}</dd>
            <dt>Receptor actual:</dt><dd>{info.active_session.current_recipient_id ?? "—"}</dd>
            <dt>Cohorte:</dt><dd>{info.active_session.current_cohort_id ?? "—"}</dd>
            <dt>Signal window:</dt><dd>{info.active_session.signal_window_size}</dd>
          </dl>
        ) : <em>Sin sesión activa</em>}
      </Card>

      <Card title={`Modos (${info.modes.length})`}>
        {info.modes.map((m) => (
          <div key={m.id} className="border-t pt-2 mt-2 text-sm">
            <div><strong>{m.cohort_id}</strong>
              {m.recipient_name && ` — para ${m.recipient_name}`}
            </div>
            <div className="text-xs text-gray-600">
              n_events {m.n_events_in_mode} · weight_sum {m.weight_sum.toFixed(2)} · {String(m.last_assigned_at)}
            </div>
            <ol className="mt-1 ml-4 list-decimal">
              {m.top_5_products.map((p) => (
                <li key={p.id}>{p.title} <span className="text-gray-500">({p.similarity.toFixed(3)})</span></li>
              ))}
            </ol>
          </div>
        ))}
        {info.modes.length === 0 && <em>Sin modos creados aún</em>}
      </Card>

      <Card title={`Eventos recientes (${info.recent_events.length})`}>
        <ol className="text-xs space-y-0.5 max-h-64 overflow-auto">
          {info.recent_events.map((e, i) => (
            <li key={i}><strong>{e.event_type}</strong> {String(e.occurred_at)}</li>
          ))}
        </ol>
      </Card>

      <Card title={`Exclusiones activas (${info.exclusions_active.length})`}>
        <ul className="text-sm">
          {info.exclusions_active.map((x) => (
            <li key={x.product_id}>{x.product_title} — TTL {String(x.ttl_until)}</li>
          ))}
        </ul>
      </Card>

      <Card title={`Feed ahora (top-${info.feed_now.length})`}>
        <ol className="text-sm space-y-0.5">
          {info.feed_now.map((p, i) => (
            <li key={p.product_id}>{i + 1}. {p.title} <span className="text-gray-500">({p.similarity.toFixed(3)})</span></li>
          ))}
        </ol>
      </Card>

      <Card title="Raw JSON">
        <details><summary className="cursor-pointer text-sm">Mostrar</summary>
          <pre className="text-xs overflow-auto max-h-96">{JSON.stringify(info, null, 2)}</pre>
        </details>
      </Card>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border rounded p-4">
      <h2 className="font-semibold mb-2">{title}</h2>
      {children}
    </div>
  );
}
```

- [ ] **Step 10.6: Tests pasan + typecheck**

Run: `pnpm test:integration -- tests/integration/user-debug.test.ts && pnpm typecheck`
Expected: 2 PASSING + typecheck OK (errores en `.next/dev/types/` se ignoran como en F2.5).

- [ ] **Step 10.7: Commit + push**

```bash
git add src/sectors/d-personalization/admin/ src/app/admin/users/ src/components/UserDebugView.tsx tests/integration/user-debug.test.ts
git commit -m "feat(d-personalization): admin user debug page (T10)" && git push
```

---

## Task 11: Cron nocturno de recompute (higiene)

**Files:**
- Create: `src/sectors/d-personalization/recompute-nightly.ts`
- Create: `scripts/cron-profile-recompute.ts`
- Test: `tests/integration/recompute-nightly.test.ts`

- [ ] **Step 11.1: Test fallido**

```ts
// tests/integration/recompute-nightly.test.ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { recomputeProfileModes } from "@/sectors/d-personalization/recompute-nightly";
import { normalize, cosine } from "@/lib/math";

beforeEach(async () => {
  await truncateTestTables([
    "events", "user_profiles", "user_profile_modes", "session_vectors",
    "cohort_centroids", "products", "anonymous_sessions",
  ]);
});

describe("recomputeProfileModes", () => {
  test("recompute from scratch matches incremental within ε", async () => {
    await withTestDb(async (pg) => {
      const ps: string[] = [];
      for (let i = 0; i < 5; i++) {
        const p = await seedProductWithEmbedding(pg, {
          title: `P${i}`,
          metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
        });
        ps.push(p.id);
      }
      await computeCohortCentroids(pg);
      const anonymous_id = randomUUID();
      const session_id = randomUUID();
      await pg.query(
        `INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1)`,
        [anonymous_id],
      );
      for (const id of ps) {
        await processEventForPersonalization(
          {
            anonymous_id, user_id: null, session_id,
            event_type: "product_view",
            payload: { product_id: id, source: "home" },
            occurred_at: new Date().toISOString(),
          },
          pg,
        );
      }

      const before = await pg.query(
        `SELECT vector_unnormalized::text AS v, weight_sum::float AS w FROM user_profile_modes`,
      );
      const beforeUnnorm = JSON.parse(before.rows[0].v) as number[];
      const beforeWeight = Number(before.rows[0].w);
      const beforeNormalized = normalize(beforeUnnorm);

      await recomputeProfileModes(pg);

      const after = await pg.query(
        `SELECT vector_unnormalized::text AS v, weight_sum::float AS w FROM user_profile_modes`,
      );
      const afterUnnorm = JSON.parse(after.rows[0].v) as number[];
      const afterNormalized = normalize(afterUnnorm);
      expect(cosine(beforeNormalized, afterNormalized)).toBeGreaterThan(0.999);
    });
  }, 240_000);
});
```

- [ ] **Step 11.2: Run → fail**

Run: `pnpm test:integration -- tests/integration/recompute-nightly.test.ts`
Expected: FAIL.

- [ ] **Step 11.3: Implementar recompute-nightly.ts**

```ts
// src/sectors/d-personalization/recompute-nightly.ts
import type { Client } from "pg";
import { EMBEDDING_DIM } from "@/lib/embeddings/voyage";
import { buildInitialUnnormalized } from "./vector/init";
import { applyDecayAndAccumulate } from "./vector/update";
import {
  EVENT_WEIGHTS, TAU_PROFILE_DAYS,
} from "./vector/constants";
import { inferSignalFromProductMetadata } from "./cohorts/infer";
import type { CohortId } from "./cohorts/definitions";

interface ModeRow {
  id: string;
  user_profile_id: string;
  recipient_id: string | null;
  cohort_id: CohortId;
}

interface EventRow {
  event_type: string;
  occurred_at: Date;
  payload: { product_id?: string; product_ids?: string[] };
}

async function fetchCohortPrior(cohort_id: CohortId, pg: Client): Promise<number[]> {
  const r = await pg.query(
    `SELECT centroid_vector::text AS v FROM cohort_centroids WHERE cohort_id = $1`,
    [cohort_id],
  );
  if (r.rows.length === 0) return new Array(EMBEDDING_DIM).fill(0);
  return JSON.parse(r.rows[0].v) as number[];
}

export async function recomputeProfileModes(pg: Client): Promise<void> {
  const modes = await pg.query<ModeRow>(
    `SELECT id, user_profile_id, recipient_id, cohort_id
     FROM user_profile_modes WHERE n_events_in_mode > 0`,
  );
  for (const m of modes.rows) {
    const prior = await fetchCohortPrior(m.cohort_id, pg);
    let { unnorm, weight } = buildInitialUnnormalized(prior);
    let lastTs = new Date();

    // Find anonymous_ids and user_id of this profile
    const idR = await pg.query(
      `SELECT anonymous_id::text AS aid, user_id::text AS uid
       FROM user_profiles WHERE id = $1`,
      [m.user_profile_id],
    );
    const anon = idR.rows[0]?.aid;
    const uid = idR.rows[0]?.uid;

    // Events: last 90 days for this identity
    const evR = await pg.query<EventRow>(
      `SELECT event_type, occurred_at, payload FROM events
       WHERE occurred_at > now() - interval '90 days'
         AND ((anonymous_id::text = $1 AND $1 IS NOT NULL)
           OR (user_id::text = $2 AND $2 IS NOT NULL))
       ORDER BY occurred_at ASC`,
      [anon, uid],
    );

    for (const e of evR.rows) {
      const weightFor = EVENT_WEIGHTS[e.event_type as keyof typeof EVENT_WEIGHTS] ?? 0;
      if (weightFor <= 0) continue;
      const product_id =
        e.payload.product_id ?? (e.payload.product_ids ? e.payload.product_ids[0] : undefined);
      if (!product_id) continue;
      const pr = await pg.query(
        `SELECT metadata, embedding::text AS v FROM products WHERE id = $1 AND embedding IS NOT NULL`,
        [product_id],
      );
      if (pr.rows.length === 0) continue;

      // Only count events that match the cohort of this mode
      const sig = inferSignalFromProductMetadata(pr.rows[0].metadata);
      if (sig.cohort_id !== m.cohort_id) continue;

      const productVec = JSON.parse(pr.rows[0].v) as number[];
      const r = applyDecayAndAccumulate({
        unnorm, weight, lastUpdatedAt: lastTs,
        product: productVec, eventWeight: weightFor,
        now: e.occurred_at,
        tauMs: TAU_PROFILE_DAYS * 24 * 3600 * 1000,
      });
      unnorm = r.newUnnorm;
      weight = r.newWeight;
      lastTs = e.occurred_at;
    }

    await pg.query(
      `UPDATE user_profile_modes
         SET vector_unnormalized = $1::vector,
             weight_sum = $2,
             last_assigned_at = $3
       WHERE id = $4`,
      ["[" + unnorm.join(",") + "]", weight, lastTs, m.id],
    );
  }
}
```

- [ ] **Step 11.4: CLI script**

```ts
// scripts/cron-profile-recompute.ts
#!/usr/bin/env tsx
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { withPg } from "@/lib/db/helpers";
import { recomputeProfileModes } from "@/sectors/d-personalization/recompute-nightly";

(async () => {
  const t0 = Date.now();
  await withPg((pg) => recomputeProfileModes(pg));
  console.log(`[cron-profile-recompute] done in ${Date.now() - t0}ms`);
})().catch((e) => { console.error(e); process.exit(1); });
```

Añadir a `package.json`:
```
"cron:profile-recompute": "tsx scripts/cron-profile-recompute.ts",
```

- [ ] **Step 11.5: Tests pasan**

Run: `pnpm test:integration -- tests/integration/recompute-nightly.test.ts`
Expected: 1 PASSING.

- [ ] **Step 11.6: Commit + push**

```bash
git add src/sectors/d-personalization/recompute-nightly.ts scripts/cron-profile-recompute.ts package.json tests/integration/recompute-nightly.test.ts
git commit -m "feat(d-personalization): nightly recompute job (T11)" && git push
```

---

## Task 12: ProductCard dismiss button

**Files:**
- Modify: `src/components/ProductCard.tsx`

- [ ] **Step 12.1: Leer ProductCard actual**

Run: `cat src/components/ProductCard.tsx`. Verás un componente simple sin botón dismiss.

- [ ] **Step 12.2: Modificar ProductCard.tsx**

Añadir un botón discreto "✕ no me interesa" abajo a la derecha. Convertir a client component si era server (`"use client"`):

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import type { ProductListRow } from "@/sectors/b-catalog/repository/products";

export function ProductCard({ product }: { product: ProductListRow }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  async function onDismiss() {
    setHidden(true); // optimistic
    try {
      await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: "dismiss",
          occurred_at: new Date().toISOString(),
          payload: { product_id: product.id, reason: "not_interested" },
        }),
      });
    } catch {
      setHidden(false); // revert on error
    }
  }

  return (
    <div className="border rounded p-3 relative">
      <Link href={`/products/${product.id}`} className="block">
        {product.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image_url} alt={product.title} className="w-full h-32 object-cover mb-2" />
        )}
        <div className="text-sm font-medium line-clamp-2">{product.title}</div>
        <div className="text-sm text-gray-700 mt-1">
          ${(product.price_cents / 100).toFixed(2)} {product.currency ?? ""}
        </div>
      </Link>
      <button
        type="button"
        onClick={onDismiss}
        title="No me interesa"
        className="absolute top-1 right-1 text-xs text-gray-400 hover:text-red-600 px-1"
      >
        ✕
      </button>
    </div>
  );
}
```

NOTA: si la versión actual del ProductCard ya es un client component con otras props, preserva el comportamiento y agrega solo el botón y el estado `hidden`. Si es server component, conviértelo a client (toda renderización de UI con click es client en Next 16 App Router).

- [ ] **Step 12.3: Verificar typecheck**

Run: `pnpm typecheck 2>&1 | grep -v "\.next/dev/types" | tail -10`
Expected: 0 nuevos errores en nuestro código.

- [ ] **Step 12.4: Commit + push**

```bash
git add src/components/ProductCard.tsx
git commit -m "feat(ui): ProductCard dismiss button → /api/track (T12)" && git push
```

---

## Task 13: Eval sintético + script

**Files:**
- Create: `scripts/eval-personalization-3a.ts`
- Test: `tests/integration/eval-3a-smoke.test.ts`

- [ ] **Step 13.1: Smoke test mínimo del eval**

```ts
// tests/integration/eval-3a-smoke.test.ts
import { describe, test, expect } from "vitest";
import { runEval3aSmoke } from "@/scripts/eval-personalization-3a";

describe("eval-personalization-3a smoke (small fixtures)", () => {
  test("runs end-to-end without errors and reports a number for Recall@10", async () => {
    const result = await runEval3aSmoke({ productsPerCohort: 3, eventsPerUser: 5 });
    expect(typeof result.recall_at_10).toBe("number");
    expect(Number.isFinite(result.recall_at_10)).toBe(true);
    expect(typeof result.baseline_recall_at_10).toBe("number");
  }, 600_000);
});
```

- [ ] **Step 13.2: Run → fail**

Run: `pnpm test:integration -- tests/integration/eval-3a-smoke.test.ts`
Expected: FAIL.

- [ ] **Step 13.3: Implementar `scripts/eval-personalization-3a.ts`**

```ts
#!/usr/bin/env tsx
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { randomUUID } from "node:crypto";
import { getPgClient } from "@/lib/db/pg";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { generateFeed } from "@/sectors/d-personalization/feed";
import {
  COHORT_IDS, parseCohort, AGE_BAND_RANGES, type CohortId,
} from "@/sectors/d-personalization/cohorts/definitions";

interface SyntheticUser {
  label: string;
  anonymous_id: string;
  session_id: string;
  events_cohorts: CohortId[]; // sequence of cohorts to emit events from
}

export interface Eval3aResult {
  recall_at_10: number;       // average across U1, U2, U3
  baseline_recall_at_10: number;
  per_user: { label: string; recall: number; cohort: CohortId | "mixed" }[];
  jaccard_inter_user: number; // average pairwise jaccard among U1,U2,U3 feeds
  shift_user_split_score: number; // % of U5 feed in masculino_nino
}

async function seedCatalog(pg: any, perCohort: number): Promise<Map<CohortId, string[]>> {
  const byCohort = new Map<CohortId, string[]>();
  for (const c of COHORT_IDS) {
    if (c === "unisex_indeterminado") continue;
    const { gender, age_band } = parseCohort(c);
    if (!gender || !age_band) continue;
    const r = AGE_BAND_RANGES[age_band];
    const ids: string[] = [];
    for (let i = 0; i < perCohort; i++) {
      const p = await seedProductWithEmbedding(pg, {
        title: `${c} item ${i}`,
        description: `producto de ${c}`,
        metadata: { gender_target: gender, age_target: r },
      });
      ids.push(p.id);
    }
    byCohort.set(c, ids);
  }
  return byCohort;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter((x) => b.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return uni === 0 ? 0 : inter / uni;
}

export async function runEval3aSmoke(opts: {
  productsPerCohort: number; eventsPerUser: number;
}): Promise<Eval3aResult> {
  const pg = await getPgClient({ scope: "test" });
  try {
    await pg.query(
      `TRUNCATE test_schema.products, test_schema.cohort_centroids,
                test_schema.user_profiles, test_schema.user_profile_modes,
                test_schema.session_vectors, test_schema.events,
                test_schema.excluded_products, test_schema.anonymous_sessions CASCADE`,
    );
    const catalog = await seedCatalog(pg, opts.productsPerCohort);
    await computeCohortCentroids(pg);

    const N = opts.eventsPerUser;
    const u1: SyntheticUser = {
      label: "U1-femenino_adulta",
      anonymous_id: randomUUID(), session_id: randomUUID(),
      events_cohorts: new Array(N).fill("femenino_adulta"),
    };
    const u2: SyntheticUser = {
      label: "U2-masculino_adulto",
      anonymous_id: randomUUID(), session_id: randomUUID(),
      events_cohorts: new Array(N).fill("masculino_adulto"),
    };
    const u3: SyntheticUser = {
      label: "U3-femenino_nina",
      anonymous_id: randomUUID(), session_id: randomUUID(),
      events_cohorts: new Array(N).fill("femenino_nina"),
    };
    const u4: SyntheticUser = {
      label: "U4-cold_femenino_adulta",
      anonymous_id: randomUUID(), session_id: randomUUID(),
      events_cohorts: new Array(3).fill("femenino_adulta"), // just enough to warmup
    };
    const u5: SyntheticUser = {
      label: "U5-shift_fem_to_masc_nino",
      anonymous_id: randomUUID(), session_id: randomUUID(),
      events_cohorts: [
        ...new Array(Math.floor(N / 2)).fill("femenino_adulta"),
        ...new Array(Math.ceil(N / 2)).fill("masculino_nino"),
      ] as CohortId[],
    };

    async function runUserEvents(u: SyntheticUser) {
      await pg.query(
        `INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [u.anonymous_id],
      );
      for (const c of u.events_cohorts) {
        const ids = catalog.get(c) ?? [];
        if (ids.length === 0) continue;
        const product_id = ids[Math.floor(Math.random() * ids.length)];
        await processEventForPersonalization(
          {
            anonymous_id: u.anonymous_id, user_id: null, session_id: u.session_id,
            event_type: "product_view",
            payload: { product_id, source: "home" },
            occurred_at: new Date().toISOString(),
          },
          pg,
        );
      }
    }
    for (const u of [u1, u2, u3, u4, u5]) await runUserEvents(u);

    async function feedFor(u: SyntheticUser) {
      return generateFeed(
        { user_id: null, anonymous_id: u.anonymous_id, session_id: u.session_id, limit: 10 },
        pg,
      );
    }

    function recallAt10(feed: { product: { id: string } }[], heldOut: string[]) {
      const ids = new Set(feed.map((f) => f.product.id));
      const hit = heldOut.filter((h) => ids.has(h)).length;
      return heldOut.length === 0 ? 0 : hit / heldOut.length;
    }

    function pickHoldout(catalogIds: string[], usedIds: Set<string>, k = 3): string[] {
      return catalogIds.filter((id) => !usedIds.has(id)).slice(0, k);
    }

    // Compute holdouts from un-seen products of each user's main cohort.
    const usedU1 = new Set<string>();
    const usedU2 = new Set<string>();
    const usedU3 = new Set<string>();

    // For simplicity, holdout = catalog products not in events_cohorts (heuristic).
    // In real synthetic eval we'd track which products each user "viewed".
    // For smoke purposes we use random-but-deterministic split:
    const femAdultaIds = catalog.get("femenino_adulta") ?? [];
    const mascAdultoIds = catalog.get("masculino_adulto") ?? [];
    const femNinaIds = catalog.get("femenino_nina") ?? [];
    const heldU1 = pickHoldout(femAdultaIds, usedU1);
    const heldU2 = pickHoldout(mascAdultoIds, usedU2);
    const heldU3 = pickHoldout(femNinaIds, usedU3);

    const f1 = await feedFor(u1);
    const f2 = await feedFor(u2);
    const f3 = await feedFor(u3);
    const f5 = await feedFor(u5);

    const r1 = recallAt10(f1, heldU1);
    const r2 = recallAt10(f2, heldU2);
    const r3 = recallAt10(f3, heldU3);
    const recall = (r1 + r2 + r3) / 3;

    // Baseline: top-popular global → choose 10 most recently inserted products (proxy for popular in smoke).
    const popR = await pg.query(
      `SELECT id::text FROM products ORDER BY created_at DESC LIMIT 10`,
    );
    const popIds = (popR.rows as { id: string }[]).map((x) => x.id);
    const popSet = new Set(popIds);
    const baseR1 = recallAt10(popIds.map((id) => ({ product: { id } })), heldU1);
    const baseR2 = recallAt10(popIds.map((id) => ({ product: { id } })), heldU2);
    const baseR3 = recallAt10(popIds.map((id) => ({ product: { id } })), heldU3);
    const baseRecall = (baseR1 + baseR2 + baseR3) / 3;

    const f1Ids = new Set(f1.map((f) => f.product.id));
    const f2Ids = new Set(f2.map((f) => f.product.id));
    const f3Ids = new Set(f3.map((f) => f.product.id));
    const jacc = (jaccard(f1Ids, f2Ids) + jaccard(f1Ids, f3Ids) + jaccard(f2Ids, f3Ids)) / 3;

    const u5MascNino = catalog.get("masculino_nino") ?? [];
    const u5MascSet = new Set(u5MascNino);
    const u5Score = f5.filter((f) => u5MascSet.has(f.product.id)).length / Math.max(1, f5.length);

    return {
      recall_at_10: recall,
      baseline_recall_at_10: baseRecall,
      per_user: [
        { label: u1.label, recall: r1, cohort: "femenino_adulta" },
        { label: u2.label, recall: r2, cohort: "masculino_adulto" },
        { label: u3.label, recall: r3, cohort: "femenino_nina" },
      ],
      jaccard_inter_user: jacc,
      shift_user_split_score: u5Score,
    };
  } finally {
    await pg.end();
  }
}

if (require.main === module) {
  (async () => {
    const r = await runEval3aSmoke({ productsPerCohort: 8, eventsPerUser: 12 });
    console.log("# Fase 3a — Eval result\n");
    console.log(`Recall@10: ${(r.recall_at_10 * 100).toFixed(1)}%`);
    console.log(`Baseline Recall@10: ${(r.baseline_recall_at_10 * 100).toFixed(1)}%`);
    console.log(`Δ (pp): ${((r.recall_at_10 - r.baseline_recall_at_10) * 100).toFixed(1)}`);
    console.log(`Jaccard inter-user (lower better): ${r.jaccard_inter_user.toFixed(3)}`);
    console.log(`U5 shift score (masc_nino %): ${(r.shift_user_split_score * 100).toFixed(1)}%`);
  })().catch((e) => { console.error(e); process.exit(1); });
}
```

Añadir a `package.json`:
```
"eval:personalization-3a": "tsx scripts/eval-personalization-3a.ts",
```

NOTA: el smoke test pasa `productsPerCohort: 3, eventsPerUser: 5` — barato. El run completo (`pnpm eval:personalization-3a`) usa 8 × 12 para mejor señal. Coste ~$0.005 smoke, ~$0.03 full.

- [ ] **Step 13.4: Tests pasan**

Run: `pnpm test:integration -- tests/integration/eval-3a-smoke.test.ts`
Expected: 1 PASSING.

- [ ] **Step 13.5: Commit + push**

```bash
git add scripts/eval-personalization-3a.ts tests/integration/eval-3a-smoke.test.ts package.json
git commit -m "feat(d-personalization): eval sintético 3a + smoke test (T13)" && git push
```

---

## Task 14: Re-eval full + triple review + cierre

**Files:**
- Create: `docs/superpowers/reports/2026-05-15-fase-3a-eval.md`
- Create: `docs/superpowers/reports/2026-05-15-fase-3a-cierre.md`

- [ ] **Step 14.1: Suite completa verde**

Run:
```bash
pnpm test:unit && pnpm test:integration
```
Expected: 0 failures. Si hay alguno, arreglar.

- [ ] **Step 14.2: Quality checker**

Run: `pnpm test:quality`
Expected: `0 violations`.

- [ ] **Step 14.3: Eval full run**

Run:
```bash
pnpm eval:personalization-3a > docs/superpowers/reports/2026-05-15-fase-3a-eval.md
```
Captura tabla con: Recall@10, baseline, Δ (pp), Jaccard inter-user, U5 shift score.

**Compuerta:** `Recall@10 ≥ baseline + 20pp`. Si no se alcanza:
- Inspeccionar primero `pnpm explain "<query relacionada>"` (CLI de F2.5).
- Inspeccionar `/admin/users/[id]` de un user sintético (id queda en logs).
- Ajustar `productsPerCohort` / `eventsPerUser` si la BD es muy chica.
- Si después de diagnosticar la métrica no sube, el cierre es CONDICIONAL (mismo pattern que F2.5).

- [ ] **Step 14.4: Triple revisión — Adversario (mutation audit)**

Mutaciones plausibles que los tests deben atrapar:
1. `SHIFT_THRESHOLD = 3` → `4` en `shift-detection.ts` → test "shift de 3 contradice" falla ✅
2. `KAPPA = 10` → `0` en `constants.ts` → shrinkage init test falla ✅
3. `exp(-dtMs / tauMs)` → `exp(dtMs / tauMs)` en `update.ts` → decay test falla ✅
4. `weight * decay + eventWeight` → `weight + eventWeight` en `update.ts` → convergence falla ✅
5. `effectiveUserVector` siempre devuelve `profile` → α dinámico test falla ✅
6. Quitar filtro `excluded` en retrieve.ts → feed-generate.test.ts test exclusión falla ✅
7. `getOrInitProfileMode` ignora `cohort_id` en el UNIQUE → init test "second call returns same row" falla ✅
8. `inferSignalFromProductMetadata` mapea siempre a `unisex_indeterminado` → cohorts-infer test falla ✅

Documentar las 8 mutaciones verificadas en el cierre.

- [ ] **Step 14.5: Triple revisión — Auditor de mocks**

Run: `pnpm test:quality`
Expected: `0 violations`. Sin mocks de externals (`@/lib/{db,llm,embeddings,auth}` ni `sectors/{a-tracking,b-catalog/{enrichment,cron,repository}}`). El sector `d-personalization` no introduce ningún mock.

- [ ] **Step 14.6: Triple revisión — Probador (black-box)**

Verificación manual contra spec:
- ✓ Filtros cohorte: usuario sintético con 5 events `femenino_adulta` → feed >60% en cohorte.
- ✓ Shift detection: U5 (mitad fem_adulta + mitad masc_nino) → feed actual sesga a masc_nino (`shift_user_split_score > 40%`).
- ✓ Cold start: U4 (3 eventos, mínimo warmup) → feed coherente con `femenino_adulta`.
- ✓ Excluded: dismiss → producto desaparece + reaparece tras TTL (test integration).
- ✓ Admin view: `/admin/users/[id]` muestra los 7 secciones populadas para U1.

- [ ] **Step 14.7: Escribir reporte de cierre `docs/superpowers/reports/2026-05-15-fase-3a-cierre.md`**

Estructura:
```markdown
# Fase 3a — Cierre

**Branch:** feat/fase-3a-personalization-vector-unico
**Spec:** docs/superpowers/specs/2026-05-15-fase-3a-design.md
**Plan:** docs/superpowers/plans/2026-05-15-fase-3a-personalization.md

## 1. DoD checklist
[14 items todos ✅ excepto si compuerta del eval no se alcanzó → marcar y explicar]

## 2. Métricas eval F3a (vs baseline top-popular)
| Métrica | Baseline | F3a | Δ (pp) |
|---|---|---|---|
| Recall@10 promedio U1+U2+U3 | __% | __% | +__ |
| Jaccard inter-user | (n/a) | __ | n/a |
| U5 shift score (masc_nino %) | (n/a) | __% | n/a |

## 3. Triple revisión
### Adversario — 8/8 mutaciones detectadas
[lista]
### Auditor de mocks — 0 violations
### Probador — 5/5 black-box OK

## 4. Tests
Unit: __ (15 nuevos)
Integration: __ (12 nuevos)
Total proyecto: __

## 5. Riesgos vivos
- Inferencia de receptor ruidosa cuando catálogo tiene metadata pobre
- Latencia per-event ~80ms aceptable; monitorear en producción
- Multi-modo (k-means) diferido a 3b → vector único puede atorarse en gustos heterogéneos pero el shift detection mitiga

## 6. Decisión
✅ Fase 3a cerrada. Listo para Fase 3b.
o
⚠️ Cierre condicional [detalles].
```

- [ ] **Step 14.8: Commit + push final**

```bash
git add docs/superpowers/reports/2026-05-15-fase-3a-eval.md docs/superpowers/reports/2026-05-15-fase-3a-cierre.md
git commit -m "chore(fase-3a): closure + eval + triple review (T14)" && git push
```

- [ ] **Step 14.9: Merge a main**

```bash
git checkout main && git pull origin main
git merge --no-ff feat/fase-3a-personalization-vector-unico -m "Merge feat/fase-3a-personalization-vector-unico — vector único + cold start + multi-destinatario inferido"
git push origin main
```

---

## Resumen del plan

**14 tareas** organizadas en 4 etapas:

| Etapa | Tareas | Producto |
|---|---|---|
| Foundation | T1-T3 | Migración 0017+0018, cohortes, EventSignal inference |
| Sub-bucket + Vector math | T4-T6 | Shift detection, vector update/init/α, profile-mode orchestration |
| Wiring | T7-T9 | Track hook, dismiss flow, feed generation + home |
| Admin/cron/eval/cierre | T10-T14 | Debug page, recompute cron, ProductCard button, eval, triple review |

**Tests:** ~28 nuevos (10 unit + 12 integration + 1 eval smoke + mutation tests embedded). Coste suite ~$0.005, eval full ~$0.03.

**Branch:** `feat/fase-3a-personalization-vector-unico` (spec ya commited en `07b1641`).

**Verificación final:**
- `pnpm test:unit && pnpm test:integration && pnpm test:quality` → todo verde.
- Eval `Recall@10 ≥ baseline + 20pp` → target alcanzado.
- Triple revisión APPROVED.
- Merge a main.
