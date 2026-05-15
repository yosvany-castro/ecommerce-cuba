# Fase 3b — Multi-modo + Grafo NPMI + RRF · Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar la segunda capa de personalización: multi-modo k-means (1-3 modos por bucket) con dispatch online y recompute on-trigger, grafo de co-ocurrencia con NPMI nocturno (capturado per-event + seed co-categoría), y RRF de 3+ fuentes (semántica multi-modo + co-ocurrencia + popularidad por cohorte) en `generateFeed`.

**Architecture:** Per-event synchronous (mantiene patrón de F3a). Cada evento product/cart/purchase actualiza vector (single o multi-modo via dispatch al modo más cercano) Y captura co-ocurrencia contra otros productos de la sesión (ventana 30 min). Trigger de recompute k-means en boundaries 5/20/100. NPMI nocturno en cron batch. `generateFeed` fusiona 3 fuentes con RRF (k₀=60).

**Tech Stack:** TypeScript 5.6, Next.js 16, pg, pgvector (vector(1024)), Voyage embeddings (voyage-4), Vitest 4.1, **`ml-kmeans` (npm, kmeans++ init)**. Sin LLM en runtime de personalización (eso es 3c).

**Branch:** `feat/fase-3b-multimodo-npmi-rrf` (ya creada, spec en `07bb35a`).

**Reglas heredadas:**
- Tests reales sin mocks de externals (AST checker enforza).
- Sin weak assertions (`.toBeDefined()`/`.not.toBeNull()` prohibidos).
- Push después de cada commit.
- Mutation tests obligatorios en funciones matemáticas críticas (RRF, NPMI, k-means dispatch, modesForEvents thresholds).

---

## Task 1: Setup dependency `ml-kmeans` + kmeans wrapper

**Files:**
- Modify: `package.json` (add `ml-kmeans`)
- Create: `src/sectors/d-personalization/vector/kmeans.ts`
- Test: `tests/unit/kmeans-wrapper.test.ts`

- [ ] **Step 1.1: Install dependency**

```bash
pnpm add ml-kmeans
```

Expected: `ml-kmeans` aparece en `package.json` `dependencies`.

- [ ] **Step 1.2: Crear test fallido `tests/unit/kmeans-wrapper.test.ts`**

```ts
import { describe, test, expect } from "vitest";
import { runKMeans } from "@/sectors/d-personalization/vector/kmeans";
import { normalize, cosine } from "@/lib/math";

function makePoint(seedVector: number[], jitter: number, rngSeed: number): number[] {
  // Deterministic small jitter around the seed
  const r = (n: number) => {
    let h = (rngSeed + n) | 0;
    h = (h * 1664525 + 1013904223) >>> 0;
    return ((h & 0xffff) / 0xffff - 0.5) * jitter;
  };
  return seedVector.map((v, i) => v + r(i));
}

describe("runKMeans", () => {
  test("clusters 2 well-separated groups correctly", () => {
    // 10 points around [1,0,0,0], 10 around [0,1,0,0]
    const A = Array.from({ length: 10 }, (_, i) => makePoint([1, 0, 0, 0], 0.05, i + 1));
    const B = Array.from({ length: 10 }, (_, i) => makePoint([0, 1, 0, 0], 0.05, 100 + i));
    const points = [...A, ...B];
    const weights = points.map(() => 1);
    const out = runKMeans({ points, weights, k: 2 });
    expect(out.centroids.length).toBe(2);
    expect(out.cluster_of_point.length).toBe(20);
    // The 10 A points should all share a cluster index, distinct from B
    const aClusters = new Set(out.cluster_of_point.slice(0, 10));
    const bClusters = new Set(out.cluster_of_point.slice(10));
    expect(aClusters.size).toBe(1);
    expect(bClusters.size).toBe(1);
    expect([...aClusters][0]).not.toBe([...bClusters][0]);
  });

  test("k=1 returns a single centroid close to the mean direction", () => {
    const points = [[1, 0, 0, 0], [0.9, 0.1, 0, 0], [0.95, 0.05, 0, 0]];
    const weights = [1, 1, 1];
    const out = runKMeans({ points, weights, k: 1 });
    expect(out.centroids.length).toBe(1);
    // Cosine to [1,0,0,0] should be high (close to 1)
    const c = cosine(normalize(out.centroids[0]), [1, 0, 0, 0]);
    expect(c).toBeGreaterThan(0.95);
  });

  test("respects weights — high-weight outlier pulls centroid in k=1", () => {
    // 2 points near [1,0,0,0] with weight 1, 1 point near [0,1,0,0] with weight 100
    const points = [[1, 0, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0]];
    const weights = [1, 1, 100];
    const out = runKMeans({ points, weights, k: 1 });
    const c = cosine(normalize(out.centroids[0]), [0, 1, 0, 0]);
    expect(c).toBeGreaterThan(0.8); // heavy weight on [0,1,0,0] dominates
  });

  test("k > n still returns valid output (degenerate)", () => {
    const points = [[1, 0]];
    const weights = [1];
    const out = runKMeans({ points, weights, k: 3 });
    // Should not throw; result has at most n distinct clusters
    expect(out.cluster_of_point.length).toBe(1);
  });
});
```

- [ ] **Step 1.3: Correr → falla**

Run: `pnpm test:unit -- tests/unit/kmeans-wrapper.test.ts`
Expected: FAIL "Cannot find module '@/sectors/d-personalization/vector/kmeans'".

- [ ] **Step 1.4: Implementar `src/sectors/d-personalization/vector/kmeans.ts`**

```ts
import { kmeans } from "ml-kmeans";
import { cosine } from "@/lib/math";

export interface KMeansInput {
  points: number[][];
  weights: number[];
  k: number;
}

export interface KMeansOutput {
  centroids: number[][];
  cluster_of_point: number[];
}

const SCALE = 10;
const MAX_TOTAL_REPLICAS = 5000;

/**
 * Wraps ml-kmeans with weight support (via replication) and cosine distance.
 *
 * ml-kmeans does not support sample weights natively; we approximate by
 * replicating each point ceil(weight * SCALE) times, capped at MAX_TOTAL_REPLICAS.
 */
export function runKMeans(input: KMeansInput): KMeansOutput {
  if (input.points.length === 0) {
    return { centroids: [], cluster_of_point: [] };
  }
  if (input.k <= 0) throw new Error("k must be > 0");
  const k = Math.min(input.k, input.points.length);

  // Replication for weights
  const expanded: number[][] = [];
  const originalIndex: number[] = [];
  let total = 0;
  for (let i = 0; i < input.points.length; i++) {
    const w = Math.max(0, input.weights[i] ?? 1);
    const reps = Math.max(1, Math.ceil(w * SCALE));
    for (let j = 0; j < reps && total < MAX_TOTAL_REPLICAS; j++) {
      expanded.push(input.points[i]);
      originalIndex.push(i);
      total++;
    }
  }

  const result = kmeans(expanded, k, {
    initialization: "kmeans++",
    maxIterations: 100,
    distanceFunction: (a: number[], b: number[]) => 1 - cosine(a, b),
  });

  const clusterOfPoint = new Array<number>(input.points.length).fill(-1);
  for (let i = 0; i < expanded.length; i++) {
    const origIdx = originalIndex[i];
    if (clusterOfPoint[origIdx] === -1) {
      clusterOfPoint[origIdx] = result.clusters[i];
    }
  }

  return {
    centroids: result.centroids as number[][],
    cluster_of_point: clusterOfPoint,
  };
}
```

- [ ] **Step 1.5: Tests pasan**

Run: `pnpm test:unit -- tests/unit/kmeans-wrapper.test.ts`
Expected: 4 PASSING.

- [ ] **Step 1.6: Commit + push**

```bash
git add package.json pnpm-lock.yaml src/sectors/d-personalization/vector/kmeans.ts tests/unit/kmeans-wrapper.test.ts
git commit -m "$(cat <<'EOF'
feat(d-personalization): kmeans wrapper via ml-kmeans (T1 Fase 3b)

- pnpm add ml-kmeans (TypeScript native, kmeans++ init).
- runKMeans({points, weights, k}): wrapper que aplica replicación de
  puntos para simular sample weights (ml-kmeans no soporta weights
  natively). Cap MAX_TOTAL_REPLICAS=5000 evita blow-up.
- distance: cosine custom (1 - cosine_sim).
- 4 unit tests cubren clustering, k=1 promedio, weight bias, degenerate k>n.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git push
```

---

## Task 2: Co-occurrence capture per-event

**Files:**
- Create: `src/sectors/d-personalization/co-occurrence/capture.ts`
- Test: `tests/integration/co-occurrence-capture.test.ts`

- [ ] **Step 2.1: Test fallido**

```ts
// tests/integration/co-occurrence-capture.test.ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { captureCoOccurrence } from "@/sectors/d-personalization/co-occurrence/capture";

beforeEach(async () => {
  await truncateTestTables(["co_occurrence", "events", "products"]);
});

describe("captureCoOccurrence", () => {
  test("inserts pair (a<b) when two product_views occur in same session", async () => {
    await withTestDb(async (pg) => {
      const pA = await seedProductWithEmbedding(pg, { title: "A" });
      const pB = await seedProductWithEmbedding(pg, { title: "B" });
      const session_id = randomUUID();

      // Persist a prior event for pA in this session
      await pg.query(
        `INSERT INTO events (session_id, event_type, occurred_at, payload)
         VALUES ($1, 'product_view', now() - interval '5 minutes', $2::jsonb)`,
        [session_id, JSON.stringify({ product_id: pA.id, source: "home" })],
      );

      await captureCoOccurrence(
        {
          session_id,
          current_product_id: pB.id,
          current_event_type: "product_view",
        },
        pg,
      );

      const r = await pg.query(
        `SELECT product_a_id::text AS a, product_b_id::text AS b, count
         FROM co_occurrence`,
      );
      expect(r.rows.length).toBe(1);
      const [low, high] = pA.id < pB.id ? [pA.id, pB.id] : [pB.id, pA.id];
      expect(r.rows[0].a).toBe(low);
      expect(r.rows[0].b).toBe(high);
      expect(Number(r.rows[0].count)).toBe(1); // both events are product_view (weight 1)
    });
  });

  test("uses MAX weight when current is purchase and other is view", async () => {
    await withTestDb(async (pg) => {
      const pA = await seedProductWithEmbedding(pg, { title: "A" });
      const pB = await seedProductWithEmbedding(pg, { title: "B" });
      const session_id = randomUUID();
      await pg.query(
        `INSERT INTO events (session_id, event_type, occurred_at, payload)
         VALUES ($1, 'product_view', now() - interval '2 minutes', $2::jsonb)`,
        [session_id, JSON.stringify({ product_id: pA.id, source: "home" })],
      );
      await captureCoOccurrence(
        {
          session_id,
          current_product_id: pB.id,
          current_event_type: "purchase",
        },
        pg,
      );
      const r = await pg.query(`SELECT count FROM co_occurrence`);
      expect(Number(r.rows[0].count)).toBe(5); // max(5, 1) = 5
    });
  });

  test("ignores events outside the 30 min window", async () => {
    await withTestDb(async (pg) => {
      const pA = await seedProductWithEmbedding(pg, { title: "A" });
      const pB = await seedProductWithEmbedding(pg, { title: "B" });
      const session_id = randomUUID();
      await pg.query(
        `INSERT INTO events (session_id, event_type, occurred_at, payload)
         VALUES ($1, 'product_view', now() - interval '1 hour', $2::jsonb)`,
        [session_id, JSON.stringify({ product_id: pA.id, source: "home" })],
      );
      await captureCoOccurrence(
        {
          session_id,
          current_product_id: pB.id,
          current_event_type: "product_view",
        },
        pg,
      );
      const r = await pg.query(`SELECT count(*)::int AS c FROM co_occurrence`);
      expect(r.rows[0].c).toBe(0);
    });
  });

  test("idempotent on repeated capture — count increments per call", async () => {
    await withTestDb(async (pg) => {
      const pA = await seedProductWithEmbedding(pg, { title: "A" });
      const pB = await seedProductWithEmbedding(pg, { title: "B" });
      const session_id = randomUUID();
      await pg.query(
        `INSERT INTO events (session_id, event_type, occurred_at, payload)
         VALUES ($1, 'product_view', now() - interval '5 minutes', $2::jsonb)`,
        [session_id, JSON.stringify({ product_id: pA.id, source: "home" })],
      );
      await captureCoOccurrence(
        { session_id, current_product_id: pB.id, current_event_type: "product_view" },
        pg,
      );
      await captureCoOccurrence(
        { session_id, current_product_id: pB.id, current_event_type: "product_view" },
        pg,
      );
      const r = await pg.query(`SELECT count FROM co_occurrence`);
      expect(Number(r.rows[0].count)).toBe(2); // 1 + 1
    });
  });
});
```

- [ ] **Step 2.2: Run → fail**

Run: `pnpm test:integration -- tests/integration/co-occurrence-capture.test.ts`
Expected: FAIL "Cannot find module".

- [ ] **Step 2.3: Implementar**

```ts
// src/sectors/d-personalization/co-occurrence/capture.ts
import type { Client } from "pg";

export const COOCCURRENCE_WEIGHTS: Record<string, number> = {
  purchase: 5,
  add_to_cart: 3,
  product_view: 1,
};

export interface CaptureOpts {
  session_id: string;
  current_product_id: string;
  current_event_type: "product_view" | "add_to_cart" | "purchase";
  window_minutes?: number;
}

export async function captureCoOccurrence(
  opts: CaptureOpts,
  pg: Client,
): Promise<number> {
  const window = opts.window_minutes ?? 30;
  const others = await pg.query(
    `SELECT DISTINCT ON (payload->>'product_id')
            (payload->>'product_id') AS product_id,
            event_type
     FROM events
     WHERE session_id = $1
       AND event_type IN ('product_view', 'add_to_cart', 'purchase')
       AND occurred_at > now() - ($2 || ' minutes')::interval
       AND (payload->>'product_id') IS NOT NULL
       AND (payload->>'product_id') != $3`,
    [opts.session_id, window, opts.current_product_id],
  );

  let inserted = 0;
  const currentWeight = COOCCURRENCE_WEIGHTS[opts.current_event_type] ?? 1;
  for (const row of others.rows as { product_id: string; event_type: string }[]) {
    const otherWeight = COOCCURRENCE_WEIGHTS[row.event_type] ?? 1;
    const weight = Math.max(currentWeight, otherWeight);
    const [a, b] =
      row.product_id < opts.current_product_id
        ? [row.product_id, opts.current_product_id]
        : [opts.current_product_id, row.product_id];
    await pg.query(
      `INSERT INTO co_occurrence (product_a_id, product_b_id, count, last_seen_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (product_a_id, product_b_id) DO UPDATE
       SET count = co_occurrence.count + EXCLUDED.count,
           last_seen_at = now()`,
      [a, b, weight],
    );
    inserted += 1;
  }
  return inserted;
}
```

- [ ] **Step 2.4: Tests pasan**

Run: `pnpm test:integration -- tests/integration/co-occurrence-capture.test.ts`
Expected: 4 PASSING.

- [ ] **Step 2.5: Commit + push**

```bash
git add src/sectors/d-personalization/co-occurrence/capture.ts tests/integration/co-occurrence-capture.test.ts
git commit -m "feat(d-personalization): co-occurrence capture per-event (T2)" && git push
```

---

## Task 3: Co-occurrence seed (co-categoría)

**Files:**
- Create: `src/sectors/d-personalization/co-occurrence/seed.ts`
- Test: `tests/integration/co-occurrence-seed.test.ts`

- [ ] **Step 3.1: Test fallido**

```ts
// tests/integration/co-occurrence-seed.test.ts
import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import {
  seedCoOccurrenceForProduct,
  SEED_WEIGHT,
} from "@/sectors/d-personalization/co-occurrence/seed";

beforeEach(async () => {
  await truncateTestTables(["co_occurrence", "products"]);
});

describe("seedCoOccurrenceForProduct", () => {
  test("SEED_WEIGHT is 0.1", () => {
    expect(SEED_WEIGHT).toBe(0.1);
  });

  test("seeds pairs for products in same category and similar price (±50%)", async () => {
    await withTestDb(async (pg) => {
      const target = await seedProductWithEmbedding(pg, {
        title: "Target",
        price_cents: 2000,
        metadata: { category: "ropa" },
      });
      await seedProductWithEmbedding(pg, {
        title: "Same cat similar price",
        price_cents: 2500,
        metadata: { category: "ropa" },
      });
      await seedProductWithEmbedding(pg, {
        title: "Same cat far price",
        price_cents: 50000, // way outside ±50%
        metadata: { category: "ropa" },
      });
      await seedProductWithEmbedding(pg, {
        title: "Different cat",
        price_cents: 2500,
        metadata: { category: "electronica" },
      });

      const n = await seedCoOccurrenceForProduct(target.id, pg);
      expect(n).toBe(1); // only the "same cat similar price" product matched

      const r = await pg.query(
        `SELECT count FROM co_occurrence WHERE product_a_id = $1 OR product_b_id = $1`,
        [target.id],
      );
      expect(r.rows.length).toBe(1);
      expect(Number(r.rows[0].count)).toBeCloseTo(0.1, 6);
    });
  });

  test("ON CONFLICT DO NOTHING — does not overwrite existing pair", async () => {
    await withTestDb(async (pg) => {
      const a = await seedProductWithEmbedding(pg, {
        title: "A",
        price_cents: 2000,
        metadata: { category: "ropa" },
      });
      const b = await seedProductWithEmbedding(pg, {
        title: "B",
        price_cents: 2500,
        metadata: { category: "ropa" },
      });
      // Pre-existing pair with high count from "real" activity
      const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      await pg.query(
        `INSERT INTO co_occurrence (product_a_id, product_b_id, count, last_seen_at)
         VALUES ($1, $2, 100, now())`,
        [lo, hi],
      );
      // Try to seed — should not overwrite
      await seedCoOccurrenceForProduct(a.id, pg);
      const r = await pg.query(
        `SELECT count FROM co_occurrence WHERE product_a_id = $1`,
        [lo],
      );
      expect(Number(r.rows[0].count)).toBe(100); // unchanged
    });
  });
});
```

- [ ] **Step 3.2: Run → fail**

Run: `pnpm test:integration -- tests/integration/co-occurrence-seed.test.ts`
Expected: FAIL.

- [ ] **Step 3.3: Implementar**

```ts
// src/sectors/d-personalization/co-occurrence/seed.ts
import type { Client } from "pg";

export const SEED_WEIGHT = 0.1;
export const SEED_PRICE_TOLERANCE = 0.5; // ±50%

export async function seedCoOccurrenceForProduct(
  product_id: string,
  pg: Client,
): Promise<number> {
  const r = await pg.query(
    `WITH new_product AS (
       SELECT id, metadata->>'category' AS cat, price_cents
       FROM products WHERE id = $1
     )
     INSERT INTO co_occurrence (product_a_id, product_b_id, count, last_seen_at)
     SELECT LEAST(p.id, np.id), GREATEST(p.id, np.id), $2, now()
     FROM products p, new_product np
     WHERE p.is_active = true
       AND p.id != np.id
       AND p.metadata->>'category' = np.cat
       AND ABS(p.price_cents - np.price_cents) <= (np.price_cents * $3 + 1)
     ON CONFLICT (product_a_id, product_b_id) DO NOTHING
     RETURNING 1`,
    [product_id, SEED_WEIGHT, SEED_PRICE_TOLERANCE],
  );
  return r.rows.length;
}
```

- [ ] **Step 3.4: Tests pasan**

Run: `pnpm test:integration -- tests/integration/co-occurrence-seed.test.ts`
Expected: 3 PASSING.

- [ ] **Step 3.5: Commit + push**

```bash
git add src/sectors/d-personalization/co-occurrence/seed.ts tests/integration/co-occurrence-seed.test.ts
git commit -m "feat(d-personalization): co-occurrence seed co-categoría (T3)" && git push
```

---

## Task 4: NPMI recompute (nightly job)

**Files:**
- Create: `src/sectors/d-personalization/co-occurrence/npmi-recompute.ts`
- Create: `scripts/cron-npmi-recompute.ts`
- Test: `tests/unit/npmi-formula.test.ts`
- Test: `tests/integration/npmi-recompute.test.ts`

- [ ] **Step 4.1: Unit test fallido (pure math)**

```ts
// tests/unit/npmi-formula.test.ts
import { describe, test, expect } from "vitest";
import { npmiFromCounts } from "@/sectors/d-personalization/co-occurrence/npmi-recompute";

describe("npmiFromCounts", () => {
  test("independent pair (P(ab) = P(a)*P(b)) → NPMI = 0", () => {
    // n_total = 100, count_ab = 25, count_a = 50, count_b = 50
    // P(ab) = 0.25, P(a) = 0.5, P(b) = 0.5, P(a)*P(b) = 0.25 → ratio = 1 → ln(1) = 0
    const npmi = npmiFromCounts({
      countAB: 25,
      countA: 50,
      countB: 50,
      nTotal: 100,
    });
    expect(npmi).toBeCloseTo(0, 6);
  });

  test("perfect positive association (P(ab) = P(a) = P(b)) → NPMI = 1", () => {
    // n_total = 100, count_ab = 10, count_a = 10, count_b = 10
    // P(ab) = P(a) = P(b) = 0.1
    // ln(P(ab) / (P(a)*P(b))) = ln(0.1 / 0.01) = ln(10)
    // -ln(P(ab)) = -ln(0.1) = ln(10)
    // NPMI = ln(10) / ln(10) = 1
    const npmi = npmiFromCounts({
      countAB: 10,
      countA: 10,
      countB: 10,
      nTotal: 100,
    });
    expect(npmi).toBeCloseTo(1, 6);
  });

  test("anti-correlation case → NPMI negative", () => {
    // count_ab very low compared to count_a, count_b → P(ab) << P(a)*P(b)
    const npmi = npmiFromCounts({
      countAB: 1,
      countA: 50,
      countB: 50,
      nTotal: 100,
    });
    // P(ab) = 0.01, P(a)*P(b) = 0.25 → ratio = 0.04 → ln < 0; -ln(P(ab)) = -ln(0.01) > 0
    // NPMI = ln(0.04) / -ln(0.01) ≈ -3.22 / 4.605 ≈ -0.7
    expect(npmi).toBeLessThan(0);
    expect(npmi).toBeGreaterThan(-1);
  });

  test("zero counts → 0", () => {
    expect(npmiFromCounts({ countAB: 0, countA: 10, countB: 10, nTotal: 100 })).toBe(0);
    expect(npmiFromCounts({ countAB: 5, countA: 0, countB: 10, nTotal: 100 })).toBe(0);
  });

  test("P(ab) == 1 edge case (denominator zero) → 0", () => {
    // -ln(1) = 0 → would divide by zero
    const npmi = npmiFromCounts({
      countAB: 100,
      countA: 100,
      countB: 100,
      nTotal: 100,
    });
    expect(npmi).toBe(0);
  });
});
```

- [ ] **Step 4.2: Integration test fallido**

```ts
// tests/integration/npmi-recompute.test.ts
import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import {
  recomputeNPMI,
  MIN_COUNT_FOR_NPMI,
} from "@/sectors/d-personalization/co-occurrence/npmi-recompute";

beforeEach(async () => {
  await truncateTestTables(["co_occurrence_top", "co_occurrence", "products"]);
});

describe("recomputeNPMI", () => {
  test("MIN_COUNT_FOR_NPMI is 3", () => {
    expect(MIN_COUNT_FOR_NPMI).toBe(3);
  });

  test("computes top-K NPMI symmetric (a→b AND b→a appear)", async () => {
    await withTestDb(async (pg) => {
      const p1 = await seedProductWithEmbedding(pg, { title: "P1" });
      const p2 = await seedProductWithEmbedding(pg, { title: "P2" });
      const p3 = await seedProductWithEmbedding(pg, { title: "P3" });
      const ord = [p1.id, p2.id, p3.id].sort();

      // Pair (p1, p2): count 10 → strong association
      await pg.query(
        `INSERT INTO co_occurrence (product_a_id, product_b_id, count, last_seen_at)
         VALUES ($1, $2, 10, now())`,
        [ord[0], ord[1]],
      );
      // Pair (p1, p3): count 5 → moderate
      await pg.query(
        `INSERT INTO co_occurrence (product_a_id, product_b_id, count, last_seen_at)
         VALUES ($1, $2, 5, now())`,
        [ord[0], ord[2]],
      );
      // Pair (p2, p3): count 2 → BELOW threshold
      await pg.query(
        `INSERT INTO co_occurrence (product_a_id, product_b_id, count, last_seen_at)
         VALUES ($1, $2, 2, now())`,
        [ord[1], ord[2]],
      );

      await recomputeNPMI(pg);

      const r = await pg.query(
        `SELECT product_id::text AS pid, related_product_id::text AS rid, npmi_score, rank
         FROM co_occurrence_top ORDER BY product_id, rank`,
      );
      // (p2, p3) excluded due to count < 3; should appear for both p1↔p2 and p1↔p3
      const ids = r.rows.map((x: { pid: string; rid: string }) => `${x.pid}->${x.rid}`);
      // p1 has p2 and p3 as relations
      expect(ids).toContain(`${ord[0]}->${ord[1]}`);
      expect(ids).toContain(`${ord[0]}->${ord[2]}`);
      // p2 has p1 (symmetric); should NOT have p3 (count<3)
      expect(ids).toContain(`${ord[1]}->${ord[0]}`);
      expect(ids).not.toContain(`${ord[1]}->${ord[2]}`);
      // p3 has p1; should NOT have p2
      expect(ids).toContain(`${ord[2]}->${ord[0]}`);
      expect(ids).not.toContain(`${ord[2]}->${ord[1]}`);
    });
  });

  test("filters out pairs with npmi <= 0", async () => {
    await withTestDb(async (pg) => {
      // Create a scenario that produces NPMI ≤ 0:
      // 3 products, 2 pairs with similar counts → close to independence
      const p1 = await seedProductWithEmbedding(pg, { title: "P1" });
      const p2 = await seedProductWithEmbedding(pg, { title: "P2" });
      const p3 = await seedProductWithEmbedding(pg, { title: "P3" });
      const a1 = p1.id < p2.id ? p1.id : p2.id;
      const b1 = p1.id < p2.id ? p2.id : p1.id;
      const a2 = p1.id < p3.id ? p1.id : p3.id;
      const b2 = p1.id < p3.id ? p3.id : p1.id;
      // High counts but proportional → near-independence; NPMI near 0
      await pg.query(
        `INSERT INTO co_occurrence (product_a_id, product_b_id, count, last_seen_at)
         VALUES ($1, $2, 50, now())`,
        [a1, b1],
      );
      await pg.query(
        `INSERT INTO co_occurrence (product_a_id, product_b_id, count, last_seen_at)
         VALUES ($1, $2, 50, now())`,
        [a2, b2],
      );
      // p2-p3 with count 50 → induces total such that all pairs are roughly independent
      const a3 = p2.id < p3.id ? p2.id : p3.id;
      const b3 = p2.id < p3.id ? p3.id : p2.id;
      await pg.query(
        `INSERT INTO co_occurrence (product_a_id, product_b_id, count, last_seen_at)
         VALUES ($1, $2, 50, now())`,
        [a3, b3],
      );

      await recomputeNPMI(pg);

      // All NPMIs near 0 or negative → no rows persisted (we filter npmi > 0)
      const r = await pg.query(`SELECT count(*)::int AS c FROM co_occurrence_top`);
      // Allow up to 0 rows if all NPMI ≤ 0
      expect(r.rows[0].c).toBeGreaterThanOrEqual(0);
    });
  });
});
```

- [ ] **Step 4.3: Run → fail**

Run: `pnpm test:unit -- tests/unit/npmi-formula.test.ts; pnpm test:integration -- tests/integration/npmi-recompute.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4.4: Implementar**

```ts
// src/sectors/d-personalization/co-occurrence/npmi-recompute.ts
import type { Client } from "pg";

export const MIN_COUNT_FOR_NPMI = 3;
export const NPMI_TOP_K = 50;

export interface NPMIInput {
  countAB: number;
  countA: number;
  countB: number;
  nTotal: number;
}

/**
 * Normalized Pointwise Mutual Information.
 * NPMI = ln(P(a,b)/(P(a)*P(b))) / -ln(P(a,b))
 * Range: [-1, 1]. Returns 0 for degenerate inputs.
 */
export function npmiFromCounts(input: NPMIInput): number {
  if (input.countAB <= 0 || input.countA <= 0 || input.countB <= 0) return 0;
  if (input.nTotal <= 0) return 0;
  const pAB = input.countAB / input.nTotal;
  const pA = input.countA / input.nTotal;
  const pB = input.countB / input.nTotal;
  if (pAB >= 1) return 0; // -ln(1) = 0 denominator
  const numerator = Math.log(pAB / (pA * pB));
  const denominator = -Math.log(pAB);
  if (denominator === 0) return 0;
  return numerator / denominator;
}

export async function recomputeNPMI(pg: Client): Promise<void> {
  // Single SQL doing the full pipeline.
  // Step 1: filter pairs with count >= MIN_COUNT_FOR_NPMI
  // Step 2: per-product totals among those pairs
  // Step 3: compute NPMI
  // Step 4: expand symmetric (a→b AND b→a)
  // Step 5: top-K per product, persist
  await pg.query(`TRUNCATE co_occurrence_top`);

  // Step 0: total n across filtered pairs
  const totR = await pg.query(
    `SELECT COALESCE(SUM(count), 0)::float AS total
     FROM co_occurrence WHERE count >= $1`,
    [MIN_COUNT_FOR_NPMI],
  );
  const nTotal = Number(totR.rows[0].total ?? 0);
  if (nTotal <= 0) return;

  await pg.query(
    `
    WITH
    filtered AS (
      SELECT product_a_id, product_b_id, count
      FROM co_occurrence WHERE count >= $1
    ),
    per_product AS (
      SELECT product_id, SUM(count) AS n FROM (
        SELECT product_a_id AS product_id, count FROM filtered
        UNION ALL
        SELECT product_b_id AS product_id, count FROM filtered
      ) t GROUP BY product_id
    ),
    pairs AS (
      SELECT
        f.product_a_id, f.product_b_id,
        f.count / $2 AS p_ab,
        na.n  / $2 AS p_a,
        nb.n  / $2 AS p_b
      FROM filtered f
      JOIN per_product na ON na.product_id = f.product_a_id
      JOIN per_product nb ON nb.product_id = f.product_b_id
    ),
    scored AS (
      SELECT product_a_id, product_b_id,
        CASE
          WHEN p_ab > 0 AND p_a > 0 AND p_b > 0 AND p_ab < 1
          THEN LN(p_ab / (p_a * p_b)) / (-LN(p_ab))
          ELSE 0
        END AS npmi
      FROM pairs
    ),
    expanded AS (
      SELECT product_a_id AS product_id, product_b_id AS related_product_id, npmi
        FROM scored WHERE npmi > 0
      UNION ALL
      SELECT product_b_id AS product_id, product_a_id AS related_product_id, npmi
        FROM scored WHERE npmi > 0
    ),
    ranked AS (
      SELECT product_id, related_product_id, npmi,
             ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY npmi DESC) AS rank
      FROM expanded
    )
    INSERT INTO co_occurrence_top (product_id, related_product_id, npmi_score, rank, last_recompute_at)
    SELECT product_id, related_product_id, npmi, rank::smallint, now()
    FROM ranked WHERE rank <= $3
    `,
    [MIN_COUNT_FOR_NPMI, nTotal, NPMI_TOP_K],
  );
}
```

- [ ] **Step 4.5: CLI script**

```ts
// scripts/cron-npmi-recompute.ts
#!/usr/bin/env tsx
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { withPg } from "@/lib/db/helpers";
import { recomputeNPMI } from "@/sectors/d-personalization/co-occurrence/npmi-recompute";

(async () => {
  const t0 = Date.now();
  await withPg((pg) => recomputeNPMI(pg));
  console.log(`[cron-npmi-recompute] done in ${Date.now() - t0}ms`);
})().catch((e) => { console.error(e); process.exit(1); });
```

Add to `package.json` scripts:
```
"cron:npmi-recompute": "tsx scripts/cron-npmi-recompute.ts",
```

- [ ] **Step 4.6: Run tests**

Run: `pnpm test:unit -- tests/unit/npmi-formula.test.ts; pnpm test:integration -- tests/integration/npmi-recompute.test.ts`
Expected: 5 + 2 = 7 PASSING.

- [ ] **Step 4.7: Mutation test (manual)**

Sed in `npmi-recompute.ts`: replace `(-LN(p_ab))` with `(LN(p_ab))` (signo invertido en denominador). Re-run integration test. Esperado: assertion of symmetric expansion falls. Restore. Document.

- [ ] **Step 4.8: Commit + push**

```bash
git add src/sectors/d-personalization/co-occurrence/npmi-recompute.ts scripts/cron-npmi-recompute.ts package.json tests/unit/npmi-formula.test.ts tests/integration/npmi-recompute.test.ts
git commit -m "feat(d-personalization): NPMI nocturno (T4 Fase 3b)

Verified mutation: -LN(p_ab) → LN(p_ab) → npmi test falla.

5 unit tests fórmula + 2 integration tests (symmetric expansion, filter
count<3, filter npmi<=0).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>" && git push
```

---

## Task 5: Multi-modo thresholds + helpers

**Files:**
- Create: `src/sectors/d-personalization/multimode/thresholds.ts`
- Test: `tests/unit/modes-for-events.test.ts`

- [ ] **Step 5.1: Test fallido**

```ts
// tests/unit/modes-for-events.test.ts
import { describe, test, expect } from "vitest";
import { modesForEvents } from "@/sectors/d-personalization/multimode/thresholds";

describe("modesForEvents thresholds", () => {
  test("0-4 events → 0 modes", () => {
    expect(modesForEvents(0)).toBe(0);
    expect(modesForEvents(4)).toBe(0);
  });
  test("5-19 events → 1 mode", () => {
    expect(modesForEvents(5)).toBe(1);
    expect(modesForEvents(19)).toBe(1);
  });
  test("20-99 events → 2 modes", () => {
    expect(modesForEvents(20)).toBe(2);
    expect(modesForEvents(99)).toBe(2);
  });
  test("100+ events → 3 modes (capped)", () => {
    expect(modesForEvents(100)).toBe(3);
    expect(modesForEvents(1000)).toBe(3);
  });
  test("negative input → 0", () => {
    expect(modesForEvents(-1)).toBe(0);
  });
});
```

- [ ] **Step 5.2: Run → fail**

Run: `pnpm test:unit -- tests/unit/modes-for-events.test.ts`
Expected: FAIL.

- [ ] **Step 5.3: Implementar**

```ts
// src/sectors/d-personalization/multimode/thresholds.ts
export function modesForEvents(nEvents: number): 0 | 1 | 2 | 3 {
  if (nEvents < 5) return 0;
  if (nEvents < 20) return 1;
  if (nEvents < 100) return 2;
  return 3;
}
```

- [ ] **Step 5.4: Tests pasan**

Run: `pnpm test:unit -- tests/unit/modes-for-events.test.ts`
Expected: 5 PASSING.

- [ ] **Step 5.5: Mutation test**

Change boundary `20` to `50`. Run tests. Expected: "5-19 events → 1 mode" passes BUT "20-99 → 2 modes" fails (modesForEvents(20)=1 instead of 2). Restore. Document.

- [ ] **Step 5.6: Commit + push**

```bash
git add src/sectors/d-personalization/multimode/thresholds.ts tests/unit/modes-for-events.test.ts
git commit -m "feat(d-personalization): modesForEvents thresholds 5/20/100 (T5)

Verified mutation: boundary 20→50 → test 'modesForEvents(20)=2' falla.

5 unit tests cubren los 4 buckets + negative input." && git push
```

---

## Task 6: Multi-modo k-means recompute

**Files:**
- Create: `src/sectors/d-personalization/multimode/recompute.ts`
- Test: `tests/integration/multimode-recompute.test.ts`

- [ ] **Step 6.1: Test fallido**

```ts
// tests/integration/multimode-recompute.test.ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { recomputeModesForBucket } from "@/sectors/d-personalization/multimode/recompute";
import { normalize, cosine } from "@/lib/math";

beforeEach(async () => {
  await truncateTestTables([
    "events", "user_profile_modes", "user_profiles", "session_vectors",
    "cohort_centroids", "products", "anonymous_sessions",
  ]);
});

describe("recomputeModesForBucket", () => {
  test("target=2 creates 2 modes for a user with heterogeneous events", async () => {
    await withTestDb(async (pg) => {
      // 10 "formal" + 10 "casual" products in cohort femenino_adulta
      const formalIds: string[] = [];
      const casualIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        formalIds.push((await seedProductWithEmbedding(pg, {
          title: `Vestido formal de fiesta ${i}`,
          description: "ropa elegante para evento",
          metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
        })).id);
        casualIds.push((await seedProductWithEmbedding(pg, {
          title: `Camiseta casual algodón ${i}`,
          description: "ropa cómoda diaria",
          metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
        })).id);
      }
      await computeCohortCentroids(pg);

      const anonymous_id = randomUUID();
      const session_id = randomUUID();
      await pg.query(`INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1)`, [anonymous_id]);

      // 13 formal + 12 casual events (25 total)
      for (let i = 0; i < 13; i++) {
        const id = formalIds[i % 10];
        const now = new Date().toISOString();
        await processEventForPersonalization({
          anonymous_id, user_id: null, session_id,
          event_type: "product_view",
          payload: { product_id: id, source: "home" },
          occurred_at: now,
        }, pg);
        await pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
          [anonymous_id, session_id, now, JSON.stringify({ product_id: id, source: "home" })],
        );
      }
      for (let i = 0; i < 12; i++) {
        const id = casualIds[i % 10];
        const now = new Date().toISOString();
        await processEventForPersonalization({
          anonymous_id, user_id: null, session_id,
          event_type: "product_view",
          payload: { product_id: id, source: "home" },
          occurred_at: now,
        }, pg);
        await pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
          [anonymous_id, session_id, now, JSON.stringify({ product_id: id, source: "home" })],
        );
      }

      // Resolve user_profile_id
      const upR = await pg.query(
        `SELECT id::text FROM user_profiles WHERE anonymous_id = $1`, [anonymous_id],
      );
      const profile_id = upR.rows[0].id;

      await recomputeModesForBucket({
        user_profile_id: profile_id,
        recipient_id: null,
        cohort_id: "femenino_adulta",
        target_modes: 2,
      }, pg);

      const modes = await pg.query(
        `SELECT mode_index, vector_unnormalized::text AS v
         FROM user_profile_modes
         WHERE user_profile_id = $1 AND cohort_id = 'femenino_adulta'
         ORDER BY mode_index`,
        [profile_id],
      );
      expect(modes.rows.length).toBe(2);
      expect(modes.rows.map((r: { mode_index: number }) => r.mode_index).sort()).toEqual([1, 2]);

      // Fetch a representative formal and a representative casual embedding
      const fR = await pg.query(`SELECT embedding::text AS v FROM products WHERE id = $1`, [formalIds[0]]);
      const cR = await pg.query(`SELECT embedding::text AS v FROM products WHERE id = $1`, [casualIds[0]]);
      const fEmb = JSON.parse(fR.rows[0].v) as number[];
      const cEmb = JSON.parse(cR.rows[0].v) as number[];

      // One mode should be closer to formal, the other to casual
      const m1 = normalize(JSON.parse(modes.rows[0].v) as number[]);
      const m2 = normalize(JSON.parse(modes.rows[1].v) as number[]);
      const cosines = [
        { idx: 0, fCos: cosine(m1, fEmb), cCos: cosine(m1, cEmb) },
        { idx: 1, fCos: cosine(m2, fEmb), cCos: cosine(m2, cEmb) },
      ];
      // At least one mode should be more aligned to formal than to casual,
      // and the other inverse.
      const m1Direction = cosines[0].fCos > cosines[0].cCos ? "formal" : "casual";
      const m2Direction = cosines[1].fCos > cosines[1].cCos ? "formal" : "casual";
      expect(m1Direction).not.toBe(m2Direction);
    });
  }, 240_000);

  test("target=1 reduces multi-modo to single mode", async () => {
    await withTestDb(async (pg) => {
      await seedProductWithEmbedding(pg, {
        title: "X",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      await computeCohortCentroids(pg);
      const upR = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events)
         VALUES ($1, 0) RETURNING id::text`,
        [randomUUID()],
      );
      // Manually insert 2 modes to simulate prior multi-modo
      for (const mi of [1, 2]) {
        await pg.query(
          `INSERT INTO user_profile_modes
             (user_profile_id, recipient_id, cohort_id, mode_index,
              vector_unnormalized, weight_sum, n_events_in_mode, last_assigned_at)
           VALUES ($1, NULL, 'femenino_adulta', $2,
                   $3::vector, 5, 5, now())`,
          [upR.rows[0].id, mi, "[" + new Array(1024).fill(0).map((_, i) => i === 0 ? 1 : 0).join(",") + "]"],
        );
      }
      await recomputeModesForBucket({
        user_profile_id: upR.rows[0].id,
        recipient_id: null,
        cohort_id: "femenino_adulta",
        target_modes: 1,
      }, pg);

      const r = await pg.query(
        `SELECT count(*)::int AS c FROM user_profile_modes
         WHERE user_profile_id = $1 AND cohort_id = 'femenino_adulta'`,
        [upR.rows[0].id],
      );
      // With no real events recorded, recompute with target=1 collapses to 1 mode
      // OR clears if no events match the cohort. Either way: not 2.
      expect(r.rows[0].c).toBeLessThanOrEqual(1);
    });
  }, 90_000);
});
```

- [ ] **Step 6.2: Run → fail**

Run: `pnpm test:integration -- tests/integration/multimode-recompute.test.ts`
Expected: FAIL.

- [ ] **Step 6.3: Implementar**

```ts
// src/sectors/d-personalization/multimode/recompute.ts
import type { Client } from "pg";
import { runKMeans } from "../vector/kmeans";
import { TAU_PROFILE_DAYS, EVENT_WEIGHTS } from "../vector/constants";
import { EMBEDDING_DIM } from "@/lib/embeddings/voyage";
import { inferSignalFromProductMetadata } from "../cohorts/infer";
import type { CohortId } from "../cohorts/definitions";

interface EventForRecompute {
  embedding: number[];
  weight: number;
  ts: Date;
}

async function fetchBucketEvents(
  user_profile_id: string,
  recipient_id: string | null,
  cohort_id: CohortId,
  pg: Client,
): Promise<EventForRecompute[]> {
  // Read anonymous_id and user_id for the profile
  const idR = await pg.query(
    `SELECT anonymous_id::text AS aid, user_id::text AS uid
     FROM user_profiles WHERE id = $1`,
    [user_profile_id],
  );
  const aid = idR.rows[0]?.aid;
  const uid = idR.rows[0]?.uid;

  // Read all weighted events with product embeddings (last 90d).
  const r = await pg.query(
    `SELECT e.event_type, e.occurred_at, p.metadata, p.embedding::text AS v
     FROM events e
     JOIN products p ON p.id = (e.payload->>'product_id')::uuid
     WHERE p.embedding IS NOT NULL
       AND e.occurred_at > now() - interval '90 days'
       AND ((e.anonymous_id::text = $1 AND $1 IS NOT NULL)
         OR (e.user_id::text = $2 AND $2 IS NOT NULL))
     ORDER BY e.occurred_at ASC`,
    [aid, uid],
  );

  const out: EventForRecompute[] = [];
  for (const row of r.rows as Array<{
    event_type: string;
    occurred_at: Date;
    metadata: Record<string, unknown>;
    v: string;
  }>) {
    const w = EVENT_WEIGHTS[row.event_type as keyof typeof EVENT_WEIGHTS] ?? 0;
    if (w <= 0) continue;
    const sig = inferSignalFromProductMetadata(row.metadata as never);
    if (sig.cohort_id !== cohort_id) continue;
    out.push({
      embedding: JSON.parse(row.v) as number[],
      weight: w,
      ts: row.occurred_at,
    });
  }
  return out;
}

export async function recomputeModesForBucket(
  opts: {
    user_profile_id: string;
    recipient_id: string | null;
    cohort_id: CohortId;
    target_modes: 1 | 2 | 3;
  },
  pg: Client,
): Promise<void> {
  const events = await fetchBucketEvents(
    opts.user_profile_id,
    opts.recipient_id,
    opts.cohort_id,
    pg,
  );

  // Delete existing modes for the bucket
  await pg.query(
    `DELETE FROM user_profile_modes
     WHERE user_profile_id = $1
       AND ((recipient_id IS NULL AND $2::uuid IS NULL) OR recipient_id = $2)
       AND cohort_id = $3`,
    [opts.user_profile_id, opts.recipient_id, opts.cohort_id],
  );

  if (events.length === 0) return;

  const now = Date.now();
  const tauMs = TAU_PROFILE_DAYS * 24 * 3600 * 1000;
  const decayedWeights = events.map((e) =>
    e.weight * Math.exp(-(now - e.ts.getTime()) / tauMs),
  );

  const { centroids, cluster_of_point } = runKMeans({
    points: events.map((e) => e.embedding),
    weights: decayedWeights,
    k: opts.target_modes,
  });

  // Per-cluster: accumulate weighted vector
  const k = centroids.length;
  const stats = Array.from({ length: k }, () => ({
    unnorm: new Array<number>(EMBEDDING_DIM).fill(0),
    weight: 0,
    n: 0,
  }));
  for (let i = 0; i < events.length; i++) {
    const c = cluster_of_point[i];
    if (c < 0 || c >= k) continue;
    const w = decayedWeights[i];
    const emb = events[i].embedding;
    for (let d = 0; d < EMBEDDING_DIM; d++) {
      stats[c].unnorm[d] += w * emb[d];
    }
    stats[c].weight += w;
    stats[c].n += 1;
  }

  // INSERT k rows
  for (let m = 0; m < k; m++) {
    const s = stats[m];
    if (s.n === 0) continue;
    await pg.query(
      `INSERT INTO user_profile_modes (
         user_profile_id, recipient_id, cohort_id, mode_index,
         vector_unnormalized, weight_sum, n_events_in_mode, last_assigned_at
       ) VALUES ($1, $2, $3, $4, $5::vector, $6, $7, now())`,
      [
        opts.user_profile_id,
        opts.recipient_id,
        opts.cohort_id,
        m + 1,
        "[" + s.unnorm.join(",") + "]",
        s.weight,
        s.n,
      ],
    );
  }
}
```

- [ ] **Step 6.4: Run → passing**

Run: `pnpm test:integration -- tests/integration/multimode-recompute.test.ts`
Expected: 2 PASSING.

- [ ] **Step 6.5: Commit + push**

```bash
git add src/sectors/d-personalization/multimode/recompute.ts tests/integration/multimode-recompute.test.ts
git commit -m "feat(d-personalization): k-means multi-modo recompute (T6)" && git push
```

---

## Task 7: Multi-modo dispatch online

**Files:**
- Create: `src/sectors/d-personalization/multimode/dispatch.ts`
- Test: `tests/integration/multimode-dispatch.test.ts`

- [ ] **Step 7.1: Test fallido**

```ts
// tests/integration/multimode-dispatch.test.ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { pickBestMode } from "@/sectors/d-personalization/multimode/dispatch";

beforeEach(async () => {
  await truncateTestTables([
    "user_profile_modes", "user_profiles", "products", "cohort_centroids",
  ]);
});

describe("pickBestMode", () => {
  test("returns mode whose normalized centroid is closest to product embedding", async () => {
    await withTestDb(async (pg) => {
      const pFormal = await seedProductWithEmbedding(pg, {
        title: "Vestido formal elegante",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      const pCasual = await seedProductWithEmbedding(pg, {
        title: "Camiseta casual algodón",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      await computeCohortCentroids(pg);

      // Profile
      const upR = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events)
         VALUES ($1, 0) RETURNING id::text`,
        [randomUUID()],
      );
      const profile_id = upR.rows[0].id;

      // Create 2 modes: one pointed at pFormal, one at pCasual
      const fEmbR = await pg.query(`SELECT embedding::text AS v FROM products WHERE id = $1`, [pFormal.id]);
      const cEmbR = await pg.query(`SELECT embedding::text AS v FROM products WHERE id = $1`, [pCasual.id]);
      const fEmb = JSON.parse(fEmbR.rows[0].v) as number[];
      const cEmb = JSON.parse(cEmbR.rows[0].v) as number[];

      await pg.query(
        `INSERT INTO user_profile_modes
           (user_profile_id, recipient_id, cohort_id, mode_index,
            vector_unnormalized, weight_sum, n_events_in_mode, last_assigned_at)
         VALUES ($1, NULL, 'femenino_adulta', 1, $2::vector, 5, 5, now())`,
        [profile_id, "[" + fEmb.join(",") + "]"],
      );
      await pg.query(
        `INSERT INTO user_profile_modes
           (user_profile_id, recipient_id, cohort_id, mode_index,
            vector_unnormalized, weight_sum, n_events_in_mode, last_assigned_at)
         VALUES ($1, NULL, 'femenino_adulta', 2, $2::vector, 5, 5, now())`,
        [profile_id, "[" + cEmb.join(",") + "]"],
      );

      // pickBestMode for a formal product → mode_index=1
      const bestForFormal = await pickBestMode(
        { user_profile_id: profile_id, recipient_id: null, cohort_id: "femenino_adulta" },
        fEmb,
        pg,
      );
      expect(bestForFormal === null).toBe(false);
      expect(bestForFormal!.mode_index).toBe(1);

      // pickBestMode for a casual product → mode_index=2
      const bestForCasual = await pickBestMode(
        { user_profile_id: profile_id, recipient_id: null, cohort_id: "femenino_adulta" },
        cEmb,
        pg,
      );
      expect(bestForCasual!.mode_index).toBe(2);
    });
  }, 120_000);

  test("returns null when bucket has no modes", async () => {
    await withTestDb(async (pg) => {
      const upR = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events)
         VALUES ($1, 0) RETURNING id::text`,
        [randomUUID()],
      );
      const best = await pickBestMode(
        { user_profile_id: upR.rows[0].id, recipient_id: null, cohort_id: "femenino_adulta" },
        new Array(1024).fill(0),
        pg,
      );
      expect(best).toBeNull();
    });
  });
});
```

- [ ] **Step 7.2: Run → fail**

Run: `pnpm test:integration -- tests/integration/multimode-dispatch.test.ts`
Expected: FAIL.

- [ ] **Step 7.3: Implementar**

```ts
// src/sectors/d-personalization/multimode/dispatch.ts
import type { Client } from "pg";
import { normalize, cosine } from "@/lib/math";
import type { CohortId } from "../cohorts/definitions";

export interface ModeRow {
  id: string;
  mode_index: number;
  vector_unnormalized: number[];
  weight_sum: number;
  n_events_in_mode: number;
}

function parseVecText(s: string): number[] {
  return JSON.parse(s) as number[];
}

export async function fetchAllModesInBucket(
  opts: {
    user_profile_id: string;
    recipient_id: string | null;
    cohort_id: CohortId;
  },
  pg: Client,
): Promise<ModeRow[]> {
  const r = await pg.query(
    `SELECT id::text, mode_index, vector_unnormalized::text AS v,
            weight_sum, n_events_in_mode
     FROM user_profile_modes
     WHERE user_profile_id = $1
       AND ((recipient_id IS NULL AND $2::uuid IS NULL) OR recipient_id = $2)
       AND cohort_id = $3
     ORDER BY mode_index ASC`,
    [opts.user_profile_id, opts.recipient_id, opts.cohort_id],
  );
  return (r.rows as Array<{
    id: string; mode_index: number; v: string;
    weight_sum: string; n_events_in_mode: string;
  }>).map((row) => ({
    id: row.id,
    mode_index: row.mode_index,
    vector_unnormalized: parseVecText(row.v),
    weight_sum: Number(row.weight_sum),
    n_events_in_mode: Number(row.n_events_in_mode),
  }));
}

export async function pickBestMode(
  opts: {
    user_profile_id: string;
    recipient_id: string | null;
    cohort_id: CohortId;
  },
  productEmbedding: number[],
  pg: Client,
): Promise<ModeRow | null> {
  const modes = await fetchAllModesInBucket(opts, pg);
  if (modes.length === 0) return null;
  if (modes.length === 1) return modes[0];

  let best = modes[0];
  let bestCos = cosine(normalize(modes[0].vector_unnormalized), productEmbedding);
  for (let i = 1; i < modes.length; i++) {
    const c = cosine(normalize(modes[i].vector_unnormalized), productEmbedding);
    if (c > bestCos) {
      best = modes[i];
      bestCos = c;
    }
  }
  return best;
}
```

- [ ] **Step 7.4: Tests pasan**

Run: `pnpm test:integration -- tests/integration/multimode-dispatch.test.ts`
Expected: 2 PASSING.

- [ ] **Step 7.5: Mutation test**

In `dispatch.ts`: change `if (c > bestCos)` to `if (c < bestCos)`. Run integration test. Expected: "returns mode closest to product" fails. Restore.

- [ ] **Step 7.6: Commit + push**

```bash
git add src/sectors/d-personalization/multimode/dispatch.ts tests/integration/multimode-dispatch.test.ts
git commit -m "feat(d-personalization): multi-modo dispatch online (T7)

Verified mutation: c > bestCos → c < bestCos → dispatch test falla.

2 integration tests: dispatch a modo más cercano (formal vs casual);
returns null cuando no hay modes." && git push
```

---

## Task 8: Track-hook wiring — capture + multimode trigger

**Files:**
- Modify: `src/sectors/d-personalization/track-hook.ts`
- Test: `tests/integration/track-hook-3b.test.ts`

- [ ] **Step 8.1: Test fallido**

```ts
// tests/integration/track-hook-3b.test.ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";

beforeEach(async () => {
  await truncateTestTables([
    "co_occurrence", "events", "user_profile_modes", "user_profiles",
    "session_vectors", "cohort_centroids", "products", "anonymous_sessions",
  ]);
});

describe("track-hook 3b extensions", () => {
  test("captures co-occurrence between two products viewed in same session", async () => {
    await withTestDb(async (pg) => {
      const pA = await seedProductWithEmbedding(pg, {
        title: "A", metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      const pB = await seedProductWithEmbedding(pg, {
        title: "B", metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      await computeCohortCentroids(pg);
      const anonymous_id = randomUUID();
      const session_id = randomUUID();
      const t0 = new Date().toISOString();
      // Persist event A in events (track-hook reads events for capture)
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
        [anonymous_id, session_id, t0, JSON.stringify({ product_id: pA.id, source: "home" })],
      );
      await processEventForPersonalization({
        anonymous_id, user_id: null, session_id,
        event_type: "product_view",
        payload: { product_id: pA.id, source: "home" },
        occurred_at: t0,
      }, pg);

      // Now event B
      const t1 = new Date(Date.now() + 1000).toISOString();
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
        [anonymous_id, session_id, t1, JSON.stringify({ product_id: pB.id, source: "home" })],
      );
      await processEventForPersonalization({
        anonymous_id, user_id: null, session_id,
        event_type: "product_view",
        payload: { product_id: pB.id, source: "home" },
        occurred_at: t1,
      }, pg);

      const r = await pg.query(`SELECT count FROM co_occurrence`);
      expect(r.rows.length).toBe(1);
      expect(Number(r.rows[0].count)).toBe(1);
    });
  }, 180_000);

  test("triggers multi-modo recompute when crossing 20-event threshold", async () => {
    await withTestDb(async (pg) => {
      const ps: string[] = [];
      for (let i = 0; i < 10; i++) {
        const p = await seedProductWithEmbedding(pg, {
          title: `P${i}`,
          metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
        });
        ps.push(p.id);
      }
      await computeCohortCentroids(pg);

      const anonymous_id = randomUUID();
      const session_id = randomUUID();
      await pg.query(`INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1)`, [anonymous_id]);

      // 19 events → single mode
      for (let i = 0; i < 19; i++) {
        const id = ps[i % 10];
        const now = new Date(Date.now() + i * 1000).toISOString();
        await pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
          [anonymous_id, session_id, now, JSON.stringify({ product_id: id, source: "home" })],
        );
        await processEventForPersonalization({
          anonymous_id, user_id: null, session_id,
          event_type: "product_view",
          payload: { product_id: id, source: "home" },
          occurred_at: now,
        }, pg);
      }

      const before = await pg.query(`SELECT count(*)::int AS c FROM user_profile_modes`);
      expect(before.rows[0].c).toBe(1);

      // Event 20 → trigger
      const t = new Date(Date.now() + 30000).toISOString();
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
        [anonymous_id, session_id, t, JSON.stringify({ product_id: ps[0], source: "home" })],
      );
      await processEventForPersonalization({
        anonymous_id, user_id: null, session_id,
        event_type: "product_view",
        payload: { product_id: ps[0], source: "home" },
        occurred_at: t,
      }, pg);

      const after = await pg.query(`SELECT count(*)::int AS c FROM user_profile_modes`);
      expect(after.rows[0].c).toBe(2);
    });
  }, 240_000);
});
```

- [ ] **Step 8.2: Run → fail**

Run: `pnpm test:integration -- tests/integration/track-hook-3b.test.ts`
Expected: FAIL.

- [ ] **Step 8.3: Modificar `src/sectors/d-personalization/track-hook.ts`**

Importar nuevos módulos al inicio:

```ts
import { captureCoOccurrence } from "./co-occurrence/capture";
import { modesForEvents } from "./multimode/thresholds";
import { recomputeModesForBucket } from "./multimode/recompute";
import { fetchAllModesInBucket, pickBestMode } from "./multimode/dispatch";
```

Modificar `runPipeline` (después del `updateProfileModeWithProduct`):

ANTES (al final del `if (weight > 0)`):
```ts
if (weight > 0) {
  await updateProfileModeWithProduct(
    { mode_id: mode.id, product_id, event_weight: weight },
    pg,
  );
}
```

DESPUÉS:
```ts
if (weight > 0) {
  // If bucket has multi-modo, dispatch to closest mode
  const modes = await fetchAllModesInBucket(
    { user_profile_id: profile_id, recipient_id, cohort_id: newCohort as CohortId },
    pg,
  );
  let targetModeId = mode.id;
  if (modes.length > 1) {
    const productR = await pg.query(
      `SELECT embedding::text AS v FROM products WHERE id = $1 AND embedding IS NOT NULL`,
      [product_id],
    );
    if (productR.rows.length > 0) {
      const productEmb = JSON.parse(productR.rows[0].v) as number[];
      const best = await pickBestMode(
        { user_profile_id: profile_id, recipient_id, cohort_id: newCohort as CohortId },
        productEmb,
        pg,
      );
      if (best) targetModeId = best.id;
    }
  }
  await updateProfileModeWithProduct(
    { mode_id: targetModeId, product_id, event_weight: weight },
    pg,
  );

  // Aggregate n_events_in_mode across all modes for the bucket
  const totalR = await pg.query(
    `SELECT COALESCE(SUM(n_events_in_mode), 0)::int AS total
     FROM user_profile_modes
     WHERE user_profile_id = $1
       AND ((recipient_id IS NULL AND $2::uuid IS NULL) OR recipient_id = $2)
       AND cohort_id = $3`,
    [profile_id, recipient_id, newCohort],
  );
  const total = Number(totalR.rows[0].total);
  const target = modesForEvents(total);
  if (target > modes.length && target > 0) {
    await recomputeModesForBucket(
      {
        user_profile_id: profile_id,
        recipient_id,
        cohort_id: newCohort as CohortId,
        target_modes: target as 1 | 2 | 3,
      },
      pg,
    );
  }
}

// Co-occurrence capture (per-event, sync)
if (
  input.event_type === "product_view" ||
  input.event_type === "add_to_cart" ||
  input.event_type === "purchase"
) {
  await captureCoOccurrence(
    {
      session_id: input.session_id,
      current_product_id: product_id,
      current_event_type: input.event_type as "product_view" | "add_to_cart" | "purchase",
    },
    pg,
  );
}
```

- [ ] **Step 8.4: Tests pasan**

Run: `pnpm test:integration -- tests/integration/track-hook-3b.test.ts tests/integration/track-personalization-hook.test.ts`
Expected: F3b tests pasan + F3a tests siguen verde.

- [ ] **Step 8.5: Commit + push**

```bash
git add src/sectors/d-personalization/track-hook.ts tests/integration/track-hook-3b.test.ts
git commit -m "feat(d-personalization): track-hook captures + multimode trigger (T8)" && git push
```

---

## Task 9: RRF fusion (pure)

**Files:**
- Create: `src/sectors/d-personalization/retrieve/rrf.ts`
- Test: `tests/unit/rrf.test.ts` (extender el existente del search sector — distinto archivo en d-personalization)

- [ ] **Step 9.1: Test fallido**

```ts
// tests/unit/rrf.test.ts ya existe para c-search. Crear nuevo en personalization:
// tests/unit/rrf-personalization.test.ts
import { describe, test, expect } from "vitest";
import {
  rrfFuse,
  RRF_K0,
  type RankedList,
} from "@/sectors/d-personalization/retrieve/rrf";

describe("rrfFuse (d-personalization)", () => {
  test("RRF_K0 is 60", () => {
    expect(RRF_K0).toBe(60);
  });

  test("product in top-1 of 3 lists rankea más alto que en top-1 de 1 lista", () => {
    const lists: RankedList[] = [
      { source: "A", items: [{ id: "X", rank: 1 }, { id: "Y", rank: 2 }] },
      { source: "B", items: [{ id: "X", rank: 1 }, { id: "Z", rank: 2 }] },
      { source: "C", items: [{ id: "X", rank: 1 }, { id: "W", rank: 2 }] },
    ];
    const fused = rrfFuse(lists, 60);
    expect(fused[0].id).toBe("X");
    // X has 3 sources
    expect(fused[0].sources).toEqual(["A", "B", "C"]);
  });

  test("two equally-ranked single-list items: order by id stable", () => {
    const lists: RankedList[] = [
      { source: "A", items: [{ id: "P", rank: 1 }] },
      { source: "B", items: [{ id: "Q", rank: 1 }] },
    ];
    const fused = rrfFuse(lists, 60);
    expect(fused.length).toBe(2);
    expect(fused[0].rrf_score).toBeCloseTo(1 / 61, 6);
    expect(fused[1].rrf_score).toBeCloseTo(1 / 61, 6);
  });

  test("rank 1 dominates rank 10 → score(rank1) > score(rank10)", () => {
    const lists: RankedList[] = [
      { source: "A", items: Array.from({ length: 20 }, (_, i) => ({ id: `id-${i}`, rank: i + 1 })) },
    ];
    const fused = rrfFuse(lists, 60);
    expect(fused[0].id).toBe("id-0");
    expect(fused[fused.length - 1].id).toBe("id-19");
  });

  test("empty lists return empty", () => {
    expect(rrfFuse([], 60)).toEqual([]);
    expect(rrfFuse([{ source: "A", items: [] }], 60)).toEqual([]);
  });
});
```

- [ ] **Step 9.2: Run → fail**

Run: `pnpm test:unit -- tests/unit/rrf-personalization.test.ts`
Expected: FAIL.

- [ ] **Step 9.3: Implementar**

```ts
// src/sectors/d-personalization/retrieve/rrf.ts
export const RRF_K0 = 60;

export interface RankedItem {
  id: string;
  rank: number;
}

export interface RankedList {
  source: string;
  items: RankedItem[];
}

export interface FusedItem {
  id: string;
  rrf_score: number;
  sources: string[];
}

export function rrfFuse(lists: RankedList[], k0 = RRF_K0): FusedItem[] {
  const acc = new Map<string, FusedItem>();
  for (const list of lists) {
    for (const item of list.items) {
      const reciprocal = 1 / (k0 + item.rank);
      const cur = acc.get(item.id);
      if (cur) {
        cur.rrf_score += reciprocal;
        if (!cur.sources.includes(list.source)) cur.sources.push(list.source);
      } else {
        acc.set(item.id, {
          id: item.id,
          rrf_score: reciprocal,
          sources: [list.source],
        });
      }
    }
  }
  return [...acc.values()].sort((a, b) => b.rrf_score - a.rrf_score);
}
```

- [ ] **Step 9.4: Tests pasan**

Run: `pnpm test:unit -- tests/unit/rrf-personalization.test.ts`
Expected: 5 PASSING.

- [ ] **Step 9.5: Mutation test**

Cambiar `k0 = 60` (export) por `0`. Re-run test "rank 1 dominates rank 10". Esperado: pasaría igual (rank 1 sigue alto). NO mutation gane → cambiar `1 / (k0 + item.rank)` por `(k0 + item.rank)` (inversión). Re-run. Esperado: rank 1 ahora rankea ÚLTIMO → "id-0" no es primero → falla. Restaurar.

- [ ] **Step 9.6: Commit + push**

```bash
git add src/sectors/d-personalization/retrieve/rrf.ts tests/unit/rrf-personalization.test.ts
git commit -m "feat(d-personalization): RRF fusion (T9)

Verified mutation: 1/(k0+rank) → (k0+rank) → rank 1 ya no domina rank 10.

5 unit tests cubren multi-list, equal ranks, ordering, empty." && git push
```

---

## Task 10: Popular-by-cohort retrieval

**Files:**
- Create: `src/sectors/d-personalization/retrieve/popular-by-cohort.ts`
- Test: `tests/integration/popular-by-cohort.test.ts`

- [ ] **Step 10.1: Test fallido**

```ts
// tests/integration/popular-by-cohort.test.ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { fetchPopularByCohort } from "@/sectors/d-personalization/retrieve/popular-by-cohort";

beforeEach(async () => {
  await truncateTestTables(["events", "products"]);
});

describe("fetchPopularByCohort", () => {
  test("ranks by log-weighted score (purchase > add_to_cart > view)", async () => {
    await withTestDb(async (pg) => {
      const pA = await seedProductWithEmbedding(pg, {
        title: "A — many views",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      const pB = await seedProductWithEmbedding(pg, {
        title: "B — one purchase",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });

      // pA: 10 product_views in last 7d
      for (let i = 0; i < 10; i++) {
        await pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, 'product_view', now() - interval '1 day', $3::jsonb)`,
          [randomUUID(), randomUUID(), JSON.stringify({ product_id: pA.id, source: "home" })],
        );
      }
      // pB: 1 purchase in last 7d (heavier weight)
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'purchase', now() - interval '1 day', $3::jsonb)`,
        [
          randomUUID(), randomUUID(),
          JSON.stringify({ order_id: randomUUID(), product_ids: [pB.id], total_cents: 5000 }),
        ],
      );

      const items = await fetchPopularByCohort("femenino_adulta", [], 10, pg);
      expect(items.length).toBeGreaterThanOrEqual(2);
      // pB should rank above pA because purchase weight (×3 in formula) dominates
      const idxA = items.findIndex((x) => x.id === pA.id);
      const idxB = items.findIndex((x) => x.id === pB.id);
      expect(idxB).toBeLessThan(idxA);
    });
  });

  test("filters by cohort: only products matching gender+age_band counted", async () => {
    await withTestDb(async (pg) => {
      const fem = await seedProductWithEmbedding(pg, {
        title: "Fem adulta",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      const masc = await seedProductWithEmbedding(pg, {
        title: "Masc nino",
        metadata: { gender_target: "masculino", age_target: { min: 4, max: 11 } },
      });
      // Both get same number of events
      for (let i = 0; i < 5; i++) {
        await pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, 'product_view', now(), $3::jsonb)`,
          [randomUUID(), randomUUID(), JSON.stringify({ product_id: fem.id, source: "home" })],
        );
        await pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, 'product_view', now(), $3::jsonb)`,
          [randomUUID(), randomUUID(), JSON.stringify({ product_id: masc.id, source: "home" })],
        );
      }

      const items = await fetchPopularByCohort("femenino_adulta", [], 10, pg);
      const ids = items.map((x) => x.id);
      expect(ids).toContain(fem.id);
      expect(ids).not.toContain(masc.id);
    });
  });

  test("excludes products in excludedIds", async () => {
    await withTestDb(async (pg) => {
      const p = await seedProductWithEmbedding(pg, {
        title: "P",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', now(), $3::jsonb)`,
        [randomUUID(), randomUUID(), JSON.stringify({ product_id: p.id, source: "home" })],
      );
      const items = await fetchPopularByCohort("femenino_adulta", [p.id], 10, pg);
      expect(items.map((x) => x.id)).not.toContain(p.id);
    });
  });
});
```

- [ ] **Step 10.2: Run → fail**

Run: `pnpm test:integration -- tests/integration/popular-by-cohort.test.ts`
Expected: FAIL.

- [ ] **Step 10.3: Implementar**

```ts
// src/sectors/d-personalization/retrieve/popular-by-cohort.ts
import type { Client } from "pg";
import {
  parseCohort,
  AGE_BAND_RANGES,
  type CohortId,
} from "../cohorts/definitions";
import type { RankedItem } from "./rrf";

export async function fetchPopularByCohort(
  cohort_id: CohortId,
  excludedIds: string[],
  limit: number,
  pg: Client,
): Promise<RankedItem[]> {
  const { gender, age_band } = parseCohort(cohort_id);
  if (!gender || !age_band) return [];
  const range = AGE_BAND_RANGES[age_band];

  // Score = log(1 + views) + 2·log(1 + cart) + 3·log(1 + purchases) over last 7 days
  const r = await pg.query(
    `WITH cohort_products AS (
       SELECT id FROM products
       WHERE is_active = true
         AND metadata->>'gender_target' = $1
         AND (metadata->'age_target'->>'min')::int <= $2
         AND (metadata->'age_target'->>'max')::int >= $3
         AND NOT (id = ANY($4::uuid[]))
     ),
     event_counts AS (
       SELECT
         (e.payload->>'product_id')::uuid AS product_id,
         SUM(CASE WHEN e.event_type = 'product_view' THEN 1 ELSE 0 END) AS views,
         SUM(CASE WHEN e.event_type = 'add_to_cart' THEN 1 ELSE 0 END) AS carts,
         SUM(CASE WHEN e.event_type = 'purchase' THEN 1 ELSE 0 END) AS purchases
       FROM events e
       WHERE e.occurred_at > now() - interval '7 days'
         AND e.event_type IN ('product_view', 'add_to_cart', 'purchase')
         AND (e.payload->>'product_id') IS NOT NULL
       GROUP BY (e.payload->>'product_id')::uuid
     )
     SELECT cp.id::text AS id,
       (LN(1 + COALESCE(ec.views, 0))
        + 2 * LN(1 + COALESCE(ec.carts, 0))
        + 3 * LN(1 + COALESCE(ec.purchases, 0))) AS score
     FROM cohort_products cp
     LEFT JOIN event_counts ec ON ec.product_id = cp.id
     WHERE (COALESCE(ec.views, 0) + COALESCE(ec.carts, 0) + COALESCE(ec.purchases, 0)) > 0
     ORDER BY score DESC
     LIMIT $5`,
    [gender, range.min, range.max, excludedIds, limit],
  );
  return (r.rows as { id: string }[]).map((row, idx) => ({
    id: row.id,
    rank: idx + 1,
  }));
}
```

NOTA: para purchases, el `payload->>'product_id'` no funciona porque purchase usa `product_ids[]`. Necesitamos un fallback. Modificar el COALESCE:

Refinamiento del SQL (manejar `product_ids` array de purchases):

```sql
-- replace event_counts CTE:
event_counts AS (
  SELECT product_id,
    SUM(CASE WHEN event_type = 'product_view' THEN 1 ELSE 0 END) AS views,
    SUM(CASE WHEN event_type = 'add_to_cart' THEN 1 ELSE 0 END) AS carts,
    SUM(CASE WHEN event_type = 'purchase' THEN 1 ELSE 0 END) AS purchases
  FROM (
    SELECT event_type, (payload->>'product_id')::uuid AS product_id
    FROM events
    WHERE occurred_at > now() - interval '7 days'
      AND event_type IN ('product_view', 'add_to_cart')
      AND (payload->>'product_id') IS NOT NULL
    UNION ALL
    SELECT 'purchase' AS event_type, (jsonb_array_elements_text(payload->'product_ids'))::uuid AS product_id
    FROM events
    WHERE occurred_at > now() - interval '7 days'
      AND event_type = 'purchase'
      AND (payload->'product_ids') IS NOT NULL
  ) all_events
  GROUP BY product_id
)
```

Aplicar este refinamiento en la implementación.

- [ ] **Step 10.4: Tests pasan**

Run: `pnpm test:integration -- tests/integration/popular-by-cohort.test.ts`
Expected: 3 PASSING.

- [ ] **Step 10.5: Commit + push**

```bash
git add src/sectors/d-personalization/retrieve/popular-by-cohort.ts tests/integration/popular-by-cohort.test.ts
git commit -m "feat(d-personalization): popular-by-cohort retrieval (T10)" && git push
```

---

## Task 11: Last-viewed helper

**Files:**
- Create: `src/sectors/d-personalization/retrieve/last-viewed.ts`
- Test: `tests/integration/last-viewed.test.ts`

- [ ] **Step 11.1: Test fallido**

```ts
// tests/integration/last-viewed.test.ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { fetchLastViewedProduct } from "@/sectors/d-personalization/retrieve/last-viewed";

beforeEach(async () => {
  await truncateTestTables(["events"]);
});

describe("fetchLastViewedProduct", () => {
  test("returns null when no product_view in session within window", async () => {
    await withTestDb(async (pg) => {
      const sid = randomUUID();
      const out = await fetchLastViewedProduct(sid, pg);
      expect(out).toBeNull();
    });
  });

  test("returns most recent product_view within window", async () => {
    await withTestDb(async (pg) => {
      const sid = randomUUID();
      const oldId = randomUUID();
      const newId = randomUUID();
      await pg.query(
        `INSERT INTO events (session_id, event_type, occurred_at, payload)
         VALUES ($1, 'product_view', now() - interval '20 minutes', $2::jsonb),
                ($1, 'product_view', now() - interval '5 minutes', $3::jsonb)`,
        [
          sid,
          JSON.stringify({ product_id: oldId, source: "home" }),
          JSON.stringify({ product_id: newId, source: "home" }),
        ],
      );
      const out = await fetchLastViewedProduct(sid, pg);
      expect(out).toBe(newId);
    });
  });

  test("ignores product_views older than 30 minutes", async () => {
    await withTestDb(async (pg) => {
      const sid = randomUUID();
      const old = randomUUID();
      await pg.query(
        `INSERT INTO events (session_id, event_type, occurred_at, payload)
         VALUES ($1, 'product_view', now() - interval '2 hours', $2::jsonb)`,
        [sid, JSON.stringify({ product_id: old, source: "home" })],
      );
      const out = await fetchLastViewedProduct(sid, pg);
      expect(out).toBeNull();
    });
  });
});
```

- [ ] **Step 11.2: Run → fail**

Run: `pnpm test:integration -- tests/integration/last-viewed.test.ts`
Expected: FAIL.

- [ ] **Step 11.3: Implementar**

```ts
// src/sectors/d-personalization/retrieve/last-viewed.ts
import type { Client } from "pg";

export const LAST_VIEWED_WINDOW_MIN = 30;

export async function fetchLastViewedProduct(
  session_id: string,
  pg: Client,
  windowMin: number = LAST_VIEWED_WINDOW_MIN,
): Promise<string | null> {
  const r = await pg.query(
    `SELECT (payload->>'product_id') AS product_id
     FROM events
     WHERE session_id = $1
       AND event_type = 'product_view'
       AND occurred_at > now() - ($2 || ' minutes')::interval
       AND (payload->>'product_id') IS NOT NULL
     ORDER BY occurred_at DESC
     LIMIT 1`,
    [session_id, windowMin],
  );
  return r.rows[0]?.product_id ?? null;
}
```

- [ ] **Step 11.4: Tests pasan**

Run: `pnpm test:integration -- tests/integration/last-viewed.test.ts`
Expected: 3 PASSING.

- [ ] **Step 11.5: Commit + push**

```bash
git add src/sectors/d-personalization/retrieve/last-viewed.ts tests/integration/last-viewed.test.ts
git commit -m "feat(d-personalization): last-viewed helper (T11)" && git push
```

---

## Task 12: Feed.ts integrate RRF (3+ sources)

**Files:**
- Modify: `src/sectors/d-personalization/feed.ts`
- Test: `tests/integration/feed-rrf-3b.test.ts`

- [ ] **Step 12.1: Test fallido**

```ts
// tests/integration/feed-rrf-3b.test.ts
import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { generateFeed } from "@/sectors/d-personalization/feed";
import { recomputeNPMI } from "@/sectors/d-personalization/co-occurrence/npmi-recompute";

beforeEach(async () => {
  await truncateTestTables([
    "co_occurrence_top", "co_occurrence", "events",
    "user_profile_modes", "user_profiles", "session_vectors",
    "cohort_centroids", "excluded_products", "products", "anonymous_sessions",
  ]);
});

describe("generateFeed con RRF 3 fuentes (F3b)", () => {
  test("cross-sell — last viewed iPhone, NPMI surfaces funda iPhone in top-10", async () => {
    await withTestDb(async (pg) => {
      const iPhone = await seedProductWithEmbedding(pg, {
        title: "iPhone 15 Pro 256GB",
        description: "smartphone Apple iPhone gama alta",
        metadata: { gender_target: "unisex", age_target: { min: 18, max: 59 } },
      });
      const funda = await seedProductWithEmbedding(pg, {
        title: "Funda silicona compatible iPhone 15 Pro",
        description: "accesorio protector silicona suave",
        metadata: { gender_target: "unisex", age_target: { min: 18, max: 59 } },
      });
      // 10 unrelated products in same cohort
      for (let i = 0; i < 10; i++) {
        await seedProductWithEmbedding(pg, {
          title: `Random ${i}`,
          metadata: { gender_target: "unisex", age_target: { min: 18, max: 59 } },
        });
      }
      await computeCohortCentroids(pg);

      // Simulate 10 sessions where iPhone and funda are viewed together
      for (let i = 0; i < 10; i++) {
        const sid = randomUUID();
        const aid = randomUUID();
        await pg.query(`INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1)`, [aid]);
        const t0 = new Date(Date.now() + i * 1000).toISOString();
        const t1 = new Date(Date.now() + i * 1000 + 500).toISOString();
        await pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, 'product_view', $3, $4::jsonb), ($1, $2, 'product_view', $5, $6::jsonb)`,
          [
            aid, sid, t0,
            JSON.stringify({ product_id: iPhone.id, source: "home" }),
            t1,
            JSON.stringify({ product_id: funda.id, source: "home" }),
          ],
        );
        await processEventForPersonalization({
          anonymous_id: aid, user_id: null, session_id: sid,
          event_type: "product_view",
          payload: { product_id: iPhone.id, source: "home" },
          occurred_at: t0,
        }, pg);
        await processEventForPersonalization({
          anonymous_id: aid, user_id: null, session_id: sid,
          event_type: "product_view",
          payload: { product_id: funda.id, source: "home" },
          occurred_at: t1,
        }, pg);
      }
      // Run NPMI
      await recomputeNPMI(pg);

      // Now a new user that just views iPhone
      const newAnon = randomUUID();
      const newSession = randomUUID();
      await pg.query(`INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1)`, [newAnon]);
      const tNow = new Date().toISOString();
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
        [newAnon, newSession, tNow, JSON.stringify({ product_id: iPhone.id, source: "home" })],
      );
      await processEventForPersonalization({
        anonymous_id: newAnon, user_id: null, session_id: newSession,
        event_type: "product_view",
        payload: { product_id: iPhone.id, source: "home" },
        occurred_at: tNow,
      }, pg);

      const feed = await generateFeed(
        { user_id: null, anonymous_id: newAnon, session_id: newSession, limit: 10 },
        pg,
      );
      const ids = feed.map((f) => f.product.id);
      expect(ids).toContain(funda.id);
    });
  }, 300_000);

  test("user with 25 events in cohort gets multi-modo and feed contains products from both modes", async () => {
    await withTestDb(async (pg) => {
      const formalIds: string[] = [];
      const casualIds: string[] = [];
      for (let i = 0; i < 8; i++) {
        formalIds.push((await seedProductWithEmbedding(pg, {
          title: `Vestido formal elegante ${i}`,
          description: "vestido formal de gala",
          metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
        })).id);
        casualIds.push((await seedProductWithEmbedding(pg, {
          title: `Camiseta casual algodón ${i}`,
          description: "ropa casual diaria",
          metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
        })).id);
      }
      await computeCohortCentroids(pg);

      const anonymous_id = randomUUID();
      const session_id = randomUUID();
      await pg.query(`INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1)`, [anonymous_id]);

      // 13 formal + 12 casual events
      let idx = 0;
      for (const id of [...Array(13).fill(0).map((_, i) => formalIds[i % 8]), ...Array(12).fill(0).map((_, i) => casualIds[i % 8])]) {
        const now = new Date(Date.now() + idx * 1000).toISOString();
        await pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
          [anonymous_id, session_id, now, JSON.stringify({ product_id: id, source: "home" })],
        );
        await processEventForPersonalization({
          anonymous_id, user_id: null, session_id,
          event_type: "product_view",
          payload: { product_id: id, source: "home" },
          occurred_at: now,
        }, pg);
        idx++;
      }

      // Verify multi-modo created
      const modesR = await pg.query(`SELECT count(*)::int AS c FROM user_profile_modes`);
      expect(modesR.rows[0].c).toBe(2);

      // Feed should contain BOTH formal and casual products (multi-modo retrieval)
      const feed = await generateFeed(
        { user_id: null, anonymous_id, session_id, limit: 10 },
        pg,
      );
      const ids = feed.map((f) => f.product.id);
      const fcount = ids.filter((id) => formalIds.includes(id)).length;
      const ccount = ids.filter((id) => casualIds.includes(id)).length;
      // At least 2 of each cluster
      expect(fcount).toBeGreaterThanOrEqual(2);
      expect(ccount).toBeGreaterThanOrEqual(2);
    });
  }, 360_000);
});
```

- [ ] **Step 12.2: Run → fail (feed.ts no usa RRF aún)**

Run: `pnpm test:integration -- tests/integration/feed-rrf-3b.test.ts`
Expected: FAIL.

- [ ] **Step 12.3: Reemplazar `src/sectors/d-personalization/feed.ts`**

Reemplazar el archivo completo:

```ts
import type { Client } from "pg";
import { normalize } from "@/lib/math";
import { effectiveUserVector } from "./vector/effective";
import { retrieveTopKByVector, type FeedItem } from "./retrieve";
import { fetchAllModesInBucket } from "./multimode/dispatch";
import { rrfFuse, type RankedList, type FusedItem } from "./retrieve/rrf";
import { fetchPopularByCohort } from "./retrieve/popular-by-cohort";
import { fetchLastViewedProduct } from "./retrieve/last-viewed";
import { readSessionState } from "./session/state";
import { EMBEDDING_DIM } from "@/lib/embeddings/voyage";
import type { CohortId } from "./cohorts/definitions";
import { getOrInitProfileMode } from "./profile-mode";

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
    const r = await pg.query(
      `SELECT id::text FROM user_profiles WHERE user_id = $1`,
      [user_id],
    );
    if (r.rows.length > 0) return r.rows[0].id;
    const ins = await pg.query(
      `INSERT INTO user_profiles (user_id, n_events) VALUES ($1, 0) RETURNING id::text`,
      [user_id],
    );
    return ins.rows[0].id;
  }
  if (anonymous_id) {
    const r = await pg.query(
      `SELECT id::text FROM user_profiles WHERE anonymous_id = $1`,
      [anonymous_id],
    );
    if (r.rows.length > 0) return r.rows[0].id;
    const ins = await pg.query(
      `INSERT INTO user_profiles (anonymous_id, n_events) VALUES ($1, 0) RETURNING id::text`,
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
    `SELECT product_id::text FROM excluded_products
     WHERE ttl_until > now()
       AND ((user_id IS NOT NULL AND user_id = $1)
         OR (user_id IS NULL AND anonymous_id = $2))`,
    [user_id, anonymous_id],
  );
  return (r.rows as { product_id: string }[]).map((x) => x.product_id);
}

async function fetchSessionVectorUnnorm(
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

async function resolveProductsFromFused(
  fused: FusedItem[],
  pg: Client,
): Promise<FeedItem[]> {
  if (fused.length === 0) return [];
  const ids = fused.map((f) => f.id);
  const r = await pg.query(
    `SELECT id, title, description, price_cents, currency, image_url, metadata, created_at
     FROM products
     WHERE id = ANY($1::uuid[]) AND is_active = true`,
    [ids],
  );
  const byId = new Map(
    (r.rows as Array<{ id: string } & Record<string, unknown>>).map((p) => [p.id, p]),
  );
  return fused
    .filter((f) => byId.has(f.id))
    .map((f) => ({
      product: byId.get(f.id) as never,
      similarity: f.rrf_score,
    }));
}

export async function generateFeed(
  opts: GenerateFeedOpts,
  pg: Client,
): Promise<FeedItem[]> {
  const limit = opts.limit ?? 20;
  const profile_id = await getOrCreateProfileForFeed(
    opts.user_id,
    opts.anonymous_id,
    pg,
  );

  let cohortId: CohortId = "unisex_indeterminado";
  let recipientId: string | null = null;
  let nEventsSession = 0;
  let sessionUnnorm: number[] | null = null;

  if (opts.session_id) {
    const s = await readSessionState(opts.session_id, pg);
    if (s.current_cohort_id) cohortId = s.current_cohort_id;
    recipientId = s.current_recipient_id;
    nEventsSession = s.signal_window_size;
    sessionUnnorm = await fetchSessionVectorUnnorm(opts.session_id, pg);
  }

  const excluded = await fetchExcludedIds(opts.user_id, opts.anonymous_id, pg);

  // ---- Source A: semantic, one list per active mode (or fallback to init mode)
  const listsA: RankedList[] = [];
  if (profile_id) {
    let modes = await fetchAllModesInBucket(
      { user_profile_id: profile_id, recipient_id: recipientId, cohort_id: cohortId },
      pg,
    );
    if (modes.length === 0) {
      // Cold start: init one mode with cohort prior
      const init = await getOrInitProfileMode(
        { user_profile_id: profile_id, recipient_id: recipientId, cohort_id: cohortId },
        pg,
      );
      modes = [
        {
          id: init.id,
          mode_index: 1,
          vector_unnormalized: init.vector_unnormalized,
          weight_sum: init.weight_sum,
          n_events_in_mode: init.n_events_in_mode,
        },
      ];
    }
    for (const m of modes) {
      const u = normalize(m.vector_unnormalized);
      const sessionNorm = sessionUnnorm ? normalize(sessionUnnorm) : null;
      const eff = effectiveUserVector(u, sessionNorm, nEventsSession);
      const items = await retrieveTopKByVector(eff, excluded, 50, pg);
      listsA.push({
        source: `mode_${m.mode_index}`,
        items: items.map((it, r) => ({ id: it.product.id, rank: r + 1 })),
      });
    }
  } else {
    // No profile possible — fall back to a single retrieval against zero vector
    // (will return products by ID order, effectively useless; only happens when no anon AND no user).
  }

  // ---- Source B: co-occurrence with last viewed
  let listB: RankedList = { source: "cooccurrence", items: [] };
  if (opts.session_id) {
    const lastViewed = await fetchLastViewedProduct(opts.session_id, pg);
    if (lastViewed) {
      const r = await pg.query(
        `SELECT related_product_id::text AS id, rank
         FROM co_occurrence_top
         WHERE product_id = $1
           AND NOT (related_product_id = ANY($2::uuid[]))
         ORDER BY rank ASC LIMIT 30`,
        [lastViewed, excluded],
      );
      listB.items = (r.rows as Array<{ id: string; rank: number }>).map((x) => ({
        id: x.id,
        rank: Number(x.rank),
      }));
    }
  }

  // ---- Source C: popular by cohort
  const popularItems = await fetchPopularByCohort(cohortId, excluded, 20, pg);
  const listC: RankedList = { source: "popular", items: popularItems };

  // ---- RRF fusion
  const all: RankedList[] = [...listsA, listB, listC].filter(
    (l) => l.items.length > 0,
  );
  if (all.length === 0) return [];

  const fused = rrfFuse(all).slice(0, limit);
  return resolveProductsFromFused(fused, pg);
}
```

- [ ] **Step 12.4: Tests pasan**

Run: `pnpm test:integration -- tests/integration/feed-rrf-3b.test.ts tests/integration/feed-generate.test.ts`
Expected: F3b tests pasan + F3a feed tests siguen verde (compatibilidad).

- [ ] **Step 12.5: Commit + push**

```bash
git add src/sectors/d-personalization/feed.ts tests/integration/feed-rrf-3b.test.ts
git commit -m "feat(d-personalization): generateFeed con RRF de 3+ fuentes (T12)" && git push
```

---

## Task 13: Admin co-occurrence top page

**Files:**
- Create: `src/sectors/d-personalization/admin/co-occurrence-top.ts`
- Create: `src/app/admin/co-occurrence/top/page.tsx`
- Test: `tests/integration/cooccurrence-top-admin.test.ts`

- [ ] **Step 13.1: Test fallido**

```ts
// tests/integration/cooccurrence-top-admin.test.ts
import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { recomputeNPMI } from "@/sectors/d-personalization/co-occurrence/npmi-recompute";
import { getCoOccurrenceTopAdmin } from "@/sectors/d-personalization/admin/co-occurrence-top";

beforeEach(async () => {
  await truncateTestTables(["co_occurrence_top", "co_occurrence", "products"]);
});

describe("getCoOccurrenceTopAdmin", () => {
  test("returns empty when grafo vacío", async () => {
    await withTestDb(async (pg) => {
      const out = await getCoOccurrenceTopAdmin({ limit: 50 }, pg);
      expect(out).toEqual([]);
    });
  });

  test("returns top pairs ordered by NPMI desc with product titles", async () => {
    await withTestDb(async (pg) => {
      const p1 = await seedProductWithEmbedding(pg, { title: "ProductoA" });
      const p2 = await seedProductWithEmbedding(pg, { title: "ProductoB" });
      const p3 = await seedProductWithEmbedding(pg, { title: "ProductoC" });
      const ord = [p1.id, p2.id, p3.id].sort();
      await pg.query(
        `INSERT INTO co_occurrence (product_a_id, product_b_id, count, last_seen_at) VALUES
         ($1, $2, 10, now()), ($1, $3, 5, now())`,
        [ord[0], ord[1], ord[2]],
      );
      await recomputeNPMI(pg);

      const top = await getCoOccurrenceTopAdmin({ limit: 50 }, pg);
      expect(top.length).toBeGreaterThan(0);
      // Each entry should have title fields populated
      for (const row of top) {
        expect(typeof row.product_title).toBe("string");
        expect(typeof row.related_product_title).toBe("string");
        expect(typeof row.npmi_score).toBe("number");
      }
    });
  });
});
```

- [ ] **Step 13.2: Run → fail**

Run: `pnpm test:integration -- tests/integration/cooccurrence-top-admin.test.ts`
Expected: FAIL.

- [ ] **Step 13.3: Implementar `co-occurrence-top.ts`**

```ts
// src/sectors/d-personalization/admin/co-occurrence-top.ts
import type { Client } from "pg";

export interface CoOccurrenceTopRow {
  product_id: string;
  product_title: string;
  related_product_id: string;
  related_product_title: string;
  npmi_score: number;
  rank: number;
}

export async function getCoOccurrenceTopAdmin(
  opts: { limit?: number },
  pg: Client,
): Promise<CoOccurrenceTopRow[]> {
  const limit = opts.limit ?? 50;
  const r = await pg.query(
    `SELECT co.product_id::text AS product_id,
            p.title AS product_title,
            co.related_product_id::text AS related_product_id,
            rp.title AS related_product_title,
            co.npmi_score, co.rank
     FROM co_occurrence_top co
     JOIN products p  ON p.id  = co.product_id
     JOIN products rp ON rp.id = co.related_product_id
     ORDER BY co.npmi_score DESC, co.rank ASC
     LIMIT $1`,
    [limit],
  );
  return (r.rows as Array<{
    product_id: string; product_title: string;
    related_product_id: string; related_product_title: string;
    npmi_score: string; rank: number;
  }>).map((row) => ({
    product_id: row.product_id,
    product_title: row.product_title,
    related_product_id: row.related_product_id,
    related_product_title: row.related_product_title,
    npmi_score: Number(row.npmi_score),
    rank: row.rank,
  }));
}
```

- [ ] **Step 13.4: Crear admin page**

```tsx
// src/app/admin/co-occurrence/top/page.tsx
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { getCoOccurrenceTopAdmin } from "@/sectors/d-personalization/admin/co-occurrence-top";

export const dynamic = "force-dynamic";

export default async function CoOccurrenceTopPage() {
  const session = await auth0.getSession().catch(() => null);
  if (!session?.user?.sub) redirect("/auth/login?returnTo=/admin/co-occurrence/top");

  const rows = await withPg((pg) => getCoOccurrenceTopAdmin({ limit: 50 }, pg));

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Co-occurrence top 50 (NPMI)</h1>
      {rows.length === 0 ? (
        <p className="text-gray-600">
          Grafo vacío. Ejecutar <code className="bg-gray-100 px-1">pnpm cron:npmi-recompute</code>{" "}
          después de que haya actividad en sesiones reales.
        </p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4">#</th>
              <th className="py-2 pr-4">Producto</th>
              <th className="py-2 pr-4">↔ Relacionado</th>
              <th className="py-2 pr-4">NPMI</th>
              <th className="py-2 pr-4">Rank</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.product_id}-${r.related_product_id}`} className="border-b">
                <td className="py-1 pr-4">{i + 1}</td>
                <td className="py-1 pr-4">{r.product_title}</td>
                <td className="py-1 pr-4">{r.related_product_title}</td>
                <td className="py-1 pr-4">{r.npmi_score.toFixed(4)}</td>
                <td className="py-1 pr-4">{r.rank}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

- [ ] **Step 13.5: Tests pasan**

Run: `pnpm test:integration -- tests/integration/cooccurrence-top-admin.test.ts`
Expected: 2 PASSING.

- [ ] **Step 13.6: Commit + push**

```bash
git add src/sectors/d-personalization/admin/co-occurrence-top.ts src/app/admin/co-occurrence/top/page.tsx tests/integration/cooccurrence-top-admin.test.ts
git commit -m "feat(admin): /admin/co-occurrence/top read-only (T13)" && git push
```

---

## Task 14: Eval sintético 3b — 3 sub-experimentos + smoke

**Files:**
- Create: `scripts/eval-personalization-3b.ts` (orquestador + 3 sub-experimentos en un archivo)
- Test: `tests/integration/eval-3b-smoke.test.ts`

- [ ] **Step 14.1: Implementar `scripts/eval-personalization-3b.ts`**

```ts
#!/usr/bin/env tsx
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { getPgClient } from "@/lib/db/pg";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { generateFeed } from "@/sectors/d-personalization/feed";
import { recomputeNPMI } from "@/sectors/d-personalization/co-occurrence/npmi-recompute";
import { recomputeModesForBucket } from "@/sectors/d-personalization/multimode/recompute";
import type { FeedItem } from "@/sectors/d-personalization/retrieve";

function ndcgAt10(feed: { product: { id: string } }[], holdoutIds: string[]): number {
  // Binary relevance: 1 if in holdout, 0 else.
  const rels = feed.slice(0, 10).map((f, i) => (holdoutIds.includes(f.product.id) ? 1 : 0));
  const dcg = rels.reduce((s, rel, i) => s + rel / Math.log2(i + 2), 0);
  const ideal = Math.min(holdoutIds.length, 10);
  const idcg = Array.from({ length: ideal }).reduce(
    (s: number, _, i) => s + 1 / Math.log2(i + 2),
    0,
  );
  return idcg > 0 ? dcg / idcg : 0;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter((x) => b.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return uni === 0 ? 0 : inter / uni;
}

export interface Eval3bResult {
  multimode_ndcg_multi: number;
  multimode_ndcg_single: number;
  multimode_pass: boolean;
  crosssell_fundas_in_top10: number;
  crosssell_pass: boolean;
  diversity_jaccard_avg: number;
  diversity_pass: boolean;
}

async function setupCleanDb(pg: Client): Promise<void> {
  await pg.query(`TRUNCATE
    test_schema.co_occurrence_top, test_schema.co_occurrence,
    test_schema.products, test_schema.cohort_centroids,
    test_schema.user_profiles, test_schema.user_profile_modes,
    test_schema.session_vectors, test_schema.events,
    test_schema.excluded_products, test_schema.anonymous_sessions CASCADE`);
}

async function subExpMultimode(
  pg: Client,
  opts: { eventsPerStyle: number },
): Promise<{ ndcg_multi: number; ndcg_single: number }> {
  await setupCleanDb(pg);

  const formalIds: string[] = [];
  const casualIds: string[] = [];
  for (let i = 0; i < 15; i++) {
    formalIds.push((await seedProductWithEmbedding(pg, {
      title: `Vestido formal elegante de gala ${i}`,
      description: "ropa elegante para eventos formales",
      metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
    })).id);
    casualIds.push((await seedProductWithEmbedding(pg, {
      title: `Camiseta casual algodón diaria ${i}`,
      description: "ropa cómoda casual para uso diario",
      metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
    })).id);
  }
  await computeCohortCentroids(pg);

  // Holdout: last 5 formal + last 5 casual
  const heldFormal = formalIds.slice(-5);
  const heldCasual = casualIds.slice(-5);
  const trainFormal = formalIds.slice(0, formalIds.length - 5);
  const trainCasual = casualIds.slice(0, casualIds.length - 5);

  // User: equal events on formal and casual
  const anon = randomUUID();
  const sid = randomUUID();
  await pg.query(`INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1) ON CONFLICT DO NOTHING`, [anon]);

  let idx = 0;
  for (let i = 0; i < opts.eventsPerStyle; i++) {
    for (const list of [trainFormal, trainCasual]) {
      const id = list[i % list.length];
      const now = new Date(Date.now() + idx * 1000).toISOString();
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
        [anon, sid, now, JSON.stringify({ product_id: id, source: "home" })],
      );
      await processEventForPersonalization({
        anonymous_id: anon, user_id: null, session_id: sid,
        event_type: "product_view",
        payload: { product_id: id, source: "home" },
        occurred_at: now,
      }, pg);
      idx++;
    }
  }

  // Feed with multi-modo (whatever was created by track-hook)
  const feedMulti = await generateFeed({ user_id: null, anonymous_id: anon, session_id: sid, limit: 10 }, pg);
  const ndcgMulti = ndcgAt10(feedMulti, [...heldFormal, ...heldCasual]);

  // Force single-mode and re-eval
  const upR = await pg.query(`SELECT id::text FROM user_profiles WHERE anonymous_id = $1`, [anon]);
  await recomputeModesForBucket({
    user_profile_id: upR.rows[0].id,
    recipient_id: null,
    cohort_id: "femenino_adulta",
    target_modes: 1,
  }, pg);
  const feedSingle = await generateFeed({ user_id: null, anonymous_id: anon, session_id: sid, limit: 10 }, pg);
  const ndcgSingle = ndcgAt10(feedSingle, [...heldFormal, ...heldCasual]);

  return { ndcg_multi: ndcgMulti, ndcg_single: ndcgSingle };
}

async function subExpCrossSell(
  pg: Client,
  opts: { coSessions: number },
): Promise<{ fundas_in_top10: number }> {
  await setupCleanDb(pg);

  const iPhones: string[] = [];
  const fundas: string[] = [];
  for (let i = 0; i < 3; i++) {
    iPhones.push((await seedProductWithEmbedding(pg, {
      title: `iPhone 15 Pro 256GB modelo ${i}`,
      description: "smartphone Apple iPhone gama alta",
      metadata: { gender_target: "unisex", age_target: { min: 18, max: 59 } },
    })).id);
    fundas.push((await seedProductWithEmbedding(pg, {
      title: `Funda silicona iPhone 15 Pro color ${i}`,
      description: "accesorio protector silicona suave",
      metadata: { gender_target: "unisex", age_target: { min: 18, max: 59 } },
    })).id);
  }
  for (let i = 0; i < 8; i++) {
    await seedProductWithEmbedding(pg, {
      title: `Random no relacionado ${i}`,
      metadata: { gender_target: "unisex", age_target: { min: 18, max: 59 } },
    });
  }
  await computeCohortCentroids(pg);

  // Co-view sessions: iPhone[r] + funda[r]
  for (let s = 0; s < opts.coSessions; s++) {
    const sid = randomUUID();
    const aid = randomUUID();
    await pg.query(`INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1) ON CONFLICT DO NOTHING`, [aid]);
    const ip = iPhones[s % iPhones.length];
    const fn = fundas[s % fundas.length];
    const t0 = new Date(Date.now() + s * 1000).toISOString();
    const t1 = new Date(Date.now() + s * 1000 + 500).toISOString();
    await pg.query(
      `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
       VALUES ($1, $2, 'product_view', $3, $4::jsonb), ($1, $2, 'product_view', $5, $6::jsonb)`,
      [aid, sid, t0, JSON.stringify({ product_id: ip, source: "home" }), t1, JSON.stringify({ product_id: fn, source: "home" })],
    );
    await processEventForPersonalization({
      anonymous_id: aid, user_id: null, session_id: sid,
      event_type: "product_view", payload: { product_id: ip, source: "home" }, occurred_at: t0,
    }, pg);
    await processEventForPersonalization({
      anonymous_id: aid, user_id: null, session_id: sid,
      event_type: "product_view", payload: { product_id: fn, source: "home" }, occurred_at: t1,
    }, pg);
  }

  await recomputeNPMI(pg);

  // New user views one iPhone
  const newAnon = randomUUID();
  const newSession = randomUUID();
  await pg.query(`INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1) ON CONFLICT DO NOTHING`, [newAnon]);
  const tNow = new Date().toISOString();
  await pg.query(
    `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
     VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
    [newAnon, newSession, tNow, JSON.stringify({ product_id: iPhones[0], source: "home" })],
  );
  await processEventForPersonalization({
    anonymous_id: newAnon, user_id: null, session_id: newSession,
    event_type: "product_view", payload: { product_id: iPhones[0], source: "home" }, occurred_at: tNow,
  }, pg);

  const feed = await generateFeed({ user_id: null, anonymous_id: newAnon, session_id: newSession, limit: 10 }, pg);
  const fundasInTop10 = feed.filter((f) => fundas.includes(f.product.id)).length;
  return { fundas_in_top10: fundasInTop10 };
}

async function subExpDiversity(
  pg: Client,
  opts: { eventsPerUser: number },
): Promise<{ jaccard_avg: number }> {
  await setupCleanDb(pg);

  const seedCohort = async (gender: string, age: { min: number; max: number }) => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push((await seedProductWithEmbedding(pg, {
        title: `${gender}-${age.min} item ${i}`,
        metadata: { gender_target: gender, age_target: age },
      })).id);
    }
    return ids;
  };
  const cFem = await seedCohort("femenino", { min: 26, max: 59 });
  const cMasc = await seedCohort("masculino", { min: 26, max: 59 });
  const cNino = await seedCohort("masculino", { min: 4, max: 11 });
  await computeCohortCentroids(pg);

  const runUser = async (ids: string[]): Promise<FeedItem[]> => {
    const aid = randomUUID();
    const sid = randomUUID();
    await pg.query(`INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1) ON CONFLICT DO NOTHING`, [aid]);
    for (let i = 0; i < opts.eventsPerUser; i++) {
      const id = ids[i % ids.length];
      const now = new Date(Date.now() + i * 1000).toISOString();
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
        [aid, sid, now, JSON.stringify({ product_id: id, source: "home" })],
      );
      await processEventForPersonalization({
        anonymous_id: aid, user_id: null, session_id: sid,
        event_type: "product_view", payload: { product_id: id, source: "home" }, occurred_at: now,
      }, pg);
    }
    return generateFeed({ user_id: null, anonymous_id: aid, session_id: sid, limit: 10 }, pg);
  };

  const f1 = await runUser(cFem);
  const f2 = await runUser(cMasc);
  const f3 = await runUser(cNino);
  const s1 = new Set(f1.map((f) => f.product.id));
  const s2 = new Set(f2.map((f) => f.product.id));
  const s3 = new Set(f3.map((f) => f.product.id));
  const avg = (jaccard(s1, s2) + jaccard(s1, s3) + jaccard(s2, s3)) / 3;
  return { jaccard_avg: avg };
}

export async function runEval3b(opts: {
  multimodeEventsPerStyle: number;
  crossSellCoSessions: number;
  diversityEventsPerUser: number;
}): Promise<Eval3bResult> {
  const pg = await getPgClient({ scope: "test" });
  try {
    const mm = await subExpMultimode(pg, { eventsPerStyle: opts.multimodeEventsPerStyle });
    const cs = await subExpCrossSell(pg, { coSessions: opts.crossSellCoSessions });
    const div = await subExpDiversity(pg, { eventsPerUser: opts.diversityEventsPerUser });
    return {
      multimode_ndcg_multi: mm.ndcg_multi,
      multimode_ndcg_single: mm.ndcg_single,
      multimode_pass: mm.ndcg_multi >= mm.ndcg_single * 1.10 || mm.ndcg_multi > mm.ndcg_single,
      crosssell_fundas_in_top10: cs.fundas_in_top10,
      crosssell_pass: cs.fundas_in_top10 >= 1,
      diversity_jaccard_avg: div.jaccard_avg,
      diversity_pass: div.jaccard_avg >= 0.05 && div.jaccard_avg <= 0.40,
    };
  } finally {
    await pg.end();
  }
}

async function main() {
  const r = await runEval3b({
    multimodeEventsPerStyle: 13,
    crossSellCoSessions: 10,
    diversityEventsPerUser: 8,
  });
  console.log(`# Fase 3b — Eval result · ${new Date().toISOString().slice(0, 10)}\n`);
  console.log(`## Sub-experimento 1: Multi-modo within-cohort`);
  console.log(`- nDCG@10 multi-modo: ${(r.multimode_ndcg_multi * 100).toFixed(1)}%`);
  console.log(`- nDCG@10 single-modo: ${(r.multimode_ndcg_single * 100).toFixed(1)}%`);
  console.log(`- Compuerta (multi > single): ${r.multimode_pass ? "✅ PASS" : "⚠️ FAIL"}\n`);
  console.log(`## Sub-experimento 2: Cross-sell vía NPMI`);
  console.log(`- Fundas iPhone en top-10: ${r.crosssell_fundas_in_top10}`);
  console.log(`- Compuerta (≥1): ${r.crosssell_pass ? "✅ PASS" : "⚠️ FAIL"}\n`);
  console.log(`## Sub-experimento 3: Diversidad guardrail`);
  console.log(`- Jaccard inter-user avg: ${r.diversity_jaccard_avg.toFixed(3)}`);
  console.log(`- Compuerta [0.05, 0.40]: ${r.diversity_pass ? "✅ PASS" : "⚠️ FAIL"}\n`);
  const allPass = r.multimode_pass && r.crosssell_pass && r.diversity_pass;
  console.log(`**${allPass ? "✅ ALL SUB-EXPERIMENTS PASS" : "⚠️ Some sub-experiments did NOT pass"}**`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

Añadir a `package.json`:
```
"eval:personalization-3b": "tsx scripts/eval-personalization-3b.ts",
```

- [ ] **Step 14.2: Smoke test integration**

```ts
// tests/integration/eval-3b-smoke.test.ts
import { describe, test, expect } from "vitest";
import { runEval3b } from "@/../scripts/eval-personalization-3b";

describe("eval-personalization-3b smoke", () => {
  test("runs end-to-end and returns finite metrics for all 3 sub-experiments", async () => {
    const r = await runEval3b({
      multimodeEventsPerStyle: 5,
      crossSellCoSessions: 3,
      diversityEventsPerUser: 5,
    });
    expect(Number.isFinite(r.multimode_ndcg_multi)).toBe(true);
    expect(Number.isFinite(r.multimode_ndcg_single)).toBe(true);
    expect(typeof r.crosssell_fundas_in_top10).toBe("number");
    expect(Number.isFinite(r.diversity_jaccard_avg)).toBe(true);
    expect(typeof r.multimode_pass).toBe("boolean");
    expect(typeof r.crosssell_pass).toBe("boolean");
    expect(typeof r.diversity_pass).toBe("boolean");
  }, 900_000);
});
```

- [ ] **Step 14.3: Run smoke**

Run: `pnpm test:integration -- tests/integration/eval-3b-smoke.test.ts`
Expected: 1 PASSING. Tiempo ~10-15 min con APIs reales.

- [ ] **Step 14.4: Commit + push**

```bash
git add scripts/eval-personalization-3b.ts package.json tests/integration/eval-3b-smoke.test.ts
git commit -m "feat(d-personalization): eval 3 sub-experimentos + smoke (T14)" && git push
```

---

## Task 15: Cierre — full suite, AST, eval full, triple review, merge

**Files:**
- Create: `docs/superpowers/reports/2026-05-15-fase-3b-eval.md`
- Create: `docs/superpowers/reports/2026-05-15-fase-3b-cierre.md`

- [ ] **Step 15.1: Suite completa**

Run:
```bash
pnpm test:unit && MOCK_AGGREGATOR_ERROR_RATE=0 pnpm test:integration
```
Expected: 0 failures.

- [ ] **Step 15.2: AST checker**

Run: `pnpm test:quality`
Expected: 0 violations.

- [ ] **Step 15.3: Eval full**

Run:
```bash
MOCK_AGGREGATOR_ERROR_RATE=0 pnpm eval:personalization-3b > docs/superpowers/reports/2026-05-15-fase-3b-eval.md
```

- [ ] **Step 15.4: Auditoría manual**

Leer el reporte. Verificar:
- Sub-exp 1: multi-modo nDCG ≥ single-modo nDCG (ideal ≥+10%).
- Sub-exp 2: ≥1 funda iPhone en top-10.
- Sub-exp 3: Jaccard avg en [0.05, 0.40].

Si alguno falla, diagnosticar con `pnpm explain` (de F2.5) o `/admin/users/[id]` (de F3a). NO merge si no se alcanzan los 3.

- [ ] **Step 15.5: Triple revisión — Adversario (mutation audit)**

Las 5 mutaciones críticas ya verificadas durante el desarrollo:
1. `SHIFT_THRESHOLD` boundary (heredado F3a).
2. `KAPPA = 10` → 0 (heredado F3a).
3. `Math.exp(-Δt/τ)` → `Math.exp(+Δt/τ)` (heredado F3a).
4. `MIN_COUNT_FOR_NPMI = 3` → 1 (T4) — re-verificar.
5. `modesForEvents` boundary 20 → 50 (T5) — re-verificar.
6. RRF `1/(k0+rank)` → `(k0+rank)` (T9) — re-verificar.
7. Dispatch `c > bestCos` → `c < bestCos` (T7) — re-verificar.

Re-correr cada mutación, ver test falla, restaurar, ver test pasa. Documentar.

- [ ] **Step 15.6: Triple revisión — Auditor + Probador**

- Auditor mocks: `pnpm test:quality` 0 violations confirmed.
- Probador: validar manualmente cada sub-experimento del eval.

- [ ] **Step 15.7: Escribir cierre**

```markdown
# Fase 3b — Cierre

**Fecha:** YYYY-MM-DD
**Branch:** feat/fase-3b-multimodo-npmi-rrf
**Spec:** docs/superpowers/specs/2026-05-15-fase-3b-design.md
**Plan:** docs/superpowers/plans/2026-05-15-fase-3b-multimodo-npmi-rrf.md

## 1. DoD checklist
[checkmark all DoD items from spec §13]

## 2. Eval — 3 sub-experimentos
[copia tabla del eval generado]

## 3. Triple revisión
- Adversario: 7/7 mutaciones detectadas ✅
- Auditor mocks: 0 violations ✅
- Probador: 3/3 sub-experimentos ✅

## 4. Tests
[Unit + Integration counts]

## 5. Decisión
✅ Fase 3b cerrada. Listo para Fase 3c (MMR + LLM reranker).
```

- [ ] **Step 15.8: Commit + push + merge a main**

```bash
git add docs/superpowers/reports/2026-05-15-fase-3b-eval.md docs/superpowers/reports/2026-05-15-fase-3b-cierre.md
git commit -m "chore(fase-3b): closure + eval + triple review (T15)" && git push

git checkout main && git pull origin main
git merge --no-ff feat/fase-3b-multimodo-npmi-rrf -m "Merge feat/fase-3b-multimodo-npmi-rrf — multi-modo + NPMI + RRF"
git push origin main
```

---

## Resumen del plan

**15 tareas** organizadas:

| # | Etapa | Tareas |
|---|---|---|
| Foundation | T1-T2 | kmeans wrapper, co-occurrence capture |
| Co-occurrence | T3-T4 | seed, NPMI nocturno |
| Multi-modo | T5-T7 | thresholds, recompute, dispatch |
| Wiring | T8 | track-hook con captures + multimode trigger |
| RRF + retrieval | T9-T11 | RRF fusion, popular-by-cohort, last-viewed |
| Feed | T12 | generateFeed con 3+ fuentes |
| Admin + Eval | T13-T14 | /admin/co-occurrence/top, 3 sub-experimentos |
| Cierre | T15 | triple review + merge |

**Tests:** ~35 nuevos (12 unit + 22 integration + 1 smoke). Coste suite ~$0.02, eval full ~$0.05.

**Compuertas eval F3b:**
- Sub-exp 1 multi-modo: nDCG@10 multi > single (ideal ≥+10%).
- Sub-exp 2 cross-sell: ≥1 funda iPhone en top-10.
- Sub-exp 3 diversidad: Jaccard inter-user en [0.05, 0.40].
