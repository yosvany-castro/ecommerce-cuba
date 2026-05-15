# Fase 3b — Multi-modo + Grafo NPMI + RRF · Design

**Fecha:** 2026-05-15
**Estado del repo al diseñar:** Fase 3a cerrada (`docs/superpowers/reports/2026-05-15-fase-3a-cierre.md`), merge a `main` (commit `66789ac`). 319 tests verdes (141 unit + 178 integration).
**Branch propuesta:** `feat/fase-3b-multimodo-npmi-rrf` (desde `main`).

## 1. Por qué Fase 3b existe

Fase 3a entregó personalización con **un vector único** por (user_profile, recipient, cohort) y retrieval por cosine top-K. Funciona pero tiene 3 limitaciones estructurales que el master doc Sector D señala explícitamente:

1. **Vector único colapsa gustos heterogéneos.** Un usuario con eventos en `femenino_adulta` formal + casual termina con un vector promedio que no apunta bien a ninguno de los dos clusters. El master doc lo cita como el principal error de diseño de sistemas pequeños (Principio 1: "Un usuario es una distribución, no un punto").

2. **Cosine no resuelve cross-sell.** El cosine semántico no captura "frequently bought together". iPhone y funda iPhone tienen embeddings lejanos (descripciones distintas) pero co-ocurren en sesiones reales. Sin el grafo de co-ocurrencia, el feed nunca surfacea complementarios.

3. **Una sola fuente de retrieval = ranking frágil.** Si el cosine falla para una query particular, no hay redundancia. Master doc propone fusión de múltiples fuentes por RRF para robustez.

Fase 3b ataca las 3 limitaciones simultáneamente:
- **Multi-modo k-means** (1-3 modos según historial) reemplaza el vector único.
- **Grafo de co-ocurrencia con NPMI** captura cross-sell.
- **RRF de 3+ fuentes** (multi-modo + co-ocurrencia + popularidad por cohorte) reemplaza el retrieval single-source.

## 2. Decisiones de scope (durante brainstorming)

| Decisión | Elección | Razón |
|---|---|---|
| Scope F3b | Completa (multi-modo + NPMI + RRF) | Las 3 features tienen sinergia; cada una sola tiene impacto marginal |
| Eval design | 3 sub-experimentos enriquecidos | F3a sacó 100% Recall@10 en eval ortogonal — necesitamos exposure de heterogeneidad within-cohort y cross-sell |
| Seed grafo cold start | Sí, co-categoría con weight 0.1 | NPMI ignora el seed cuando hay actividad real (count >> 0.1); da fallback el primer mes |
| Min count para NPMI | 3 | Filtra ruido de pares con count=1-2 |
| K-means library | `ml-kmeans` (npm) | TypeScript native, mature ml.js ecosystem; preferido sobre custom |
| Recompute multi-modo | On-trigger (en boundaries 5/20/100) | Más responsive que solo batch semanal |
| Bucket de multi-modo | Per (user_profile, recipient, cohort) | Master doc: doble nivel pagador-receptor; los thresholds aplican dentro de cada bucket |
| Min cosine para mode | 0 (sin filtro) | RRF naturalmente filtra; orden importa, no score absoluto |

## 3. Arquitectura general

Per-event synchronous (mantiene patrón de 3a) con dos diferencias:

- Cada evento `product_view`/`add_to_cart`/`purchase` además de actualizar el vector, **dispara captura de co-ocurrencia** contra los otros productos vistos en los últimos 30 min de la sesión.
- Si la actualización cruza un threshold de multi-modo (5, 20, 100), **dispara recompute de k-means** para el bucket actual (~30-80ms extra).
- `generateFeed` ahora ejecuta **3 fuentes en paralelo** (multi-modo retrieval × N modes, co-ocurrencia con last viewed, popularidad por cohorte) y las fusiona con **RRF (k₀=60)**.

Cron nocturno (batch heavy):
- Recompute NPMI sobre `co_occurrence` → persiste top-50 por producto en `co_occurrence_top`.
- (Higiene) Re-corre k-means desde cero para todos los modes (consistencia con drift incremental).

Las tablas `co_occurrence`, `co_occurrence_top`, y `user_profile_modes` con `mode_index 1-3` ya están en BD desde Fase 0. No se requieren migraciones de schema nuevas excepto opcionalmente columnas auxiliares.

## 4. Bloque 1 — Grafo de co-ocurrencia + NPMI nocturno

### 4.1 Schema (ya existe)

```sql
co_occurrence(
  product_a_id uuid,
  product_b_id uuid,
  count float DEFAULT 0,
  last_seen_at timestamptz DEFAULT now(),
  PRIMARY KEY (a, b),
  CHECK (a < b)
);
co_occurrence_top(
  product_id uuid,
  related_product_id uuid,
  npmi_score float,
  rank smallint CHECK (rank BETWEEN 1 AND 50),
  last_recompute_at timestamptz,
  PRIMARY KEY (product_id, related_product_id)
);
```

### 4.2 Pesos de co-ocurrencia

```ts
const COOCCURRENCE_WEIGHTS = {
  purchase: 5,
  add_to_cart: 3,
  product_view: 1,
};
```

Cuando un par de eventos co-ocurren en ventana 30min, el peso del par = **máx** de los 2 weights individuales (purchase domina view).

### 4.3 Captura online (per-event sync)

`src/sectors/d-personalization/co-occurrence/capture.ts`:

```ts
export async function captureCoOccurrence(
  opts: {
    session_id: string;
    current_product_id: string;
    current_event_type: "product_view" | "add_to_cart" | "purchase";
    window_minutes?: number;  // default 30
  },
  pg: Client,
): Promise<void> {
  const window = opts.window_minutes ?? 30;
  // 1. Other products viewed/carted/purchased in same session, last 30 min
  const r = await pg.query(
    `SELECT DISTINCT (payload->>'product_id') AS product_id,
            event_type
     FROM events
     WHERE session_id = $1
       AND event_type IN ('product_view', 'add_to_cart', 'purchase')
       AND occurred_at > now() - ($2 || ' minutes')::interval
       AND (payload->>'product_id') != $3
       AND (payload->>'product_id') IS NOT NULL`,
    [opts.session_id, window, opts.current_product_id],
  );
  const others = r.rows as { product_id: string; event_type: string }[];
  for (const other of others) {
    const weight = Math.max(
      COOCCURRENCE_WEIGHTS[opts.current_event_type],
      COOCCURRENCE_WEIGHTS[other.event_type as keyof typeof COOCCURRENCE_WEIGHTS] ?? 1,
    );
    const [a, b] =
      other.product_id < opts.current_product_id
        ? [other.product_id, opts.current_product_id]
        : [opts.current_product_id, other.product_id];
    await pg.query(
      `INSERT INTO co_occurrence (product_a_id, product_b_id, count, last_seen_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (product_a_id, product_b_id) DO UPDATE
       SET count = co_occurrence.count + EXCLUDED.count,
           last_seen_at = now()`,
      [a, b, weight],
    );
  }
}
```

Llamado desde `track-hook.ts` después de `processEventForPersonalization` (best-effort).

### 4.4 Seed con co-categoría (cold start)

`src/sectors/d-personalization/co-occurrence/seed.ts`:

```ts
export const SEED_WEIGHT = 0.1;

export async function seedCoOccurrenceForProduct(
  product_id: string,
  pg: Client,
): Promise<number> {  // returns # of pairs seeded
  const r = await pg.query(
    `WITH new_product AS (
       SELECT id, metadata->>'category' AS cat, price_cents FROM products WHERE id = $1
     )
     INSERT INTO co_occurrence (product_a_id, product_b_id, count, last_seen_at)
     SELECT LEAST(p.id, np.id), GREATEST(p.id, np.id), $2, now()
     FROM products p, new_product np
     WHERE p.is_active = true
       AND p.id != np.id
       AND p.metadata->>'category' = np.cat
       AND ABS(p.price_cents - np.price_cents) < (np.price_cents * 0.5 + 1)
     ON CONFLICT (product_a_id, product_b_id) DO NOTHING
     RETURNING 1`,
    [product_id, SEED_WEIGHT],
  );
  return r.rows.length;
}
```

Llamado desde `processProduct` (Sector B enrichment) o desde un nuevo cron `cron-cooccurrence-seed.ts` que corre después de `cron-cohort-centroids`.

### 4.5 NPMI nocturno

`src/sectors/d-personalization/co-occurrence/npmi-recompute.ts`:

```ts
export const MIN_COUNT_FOR_NPMI = 3;
export const NPMI_TOP_K = 50;

export async function recomputeNPMI(pg: Client): Promise<void> {
  // 1. n_total = sum of all counts
  const totalR = await pg.query(`SELECT SUM(count)::float AS total FROM co_occurrence`);
  const nTotal = Number(totalR.rows[0].total ?? 0);
  if (nTotal === 0) return;

  // 2. n_per_product = sum of counts of pairs touching each product
  await pg.query(`
    CREATE TEMP TABLE _n_per_product AS
    SELECT product_id, SUM(count) AS n FROM (
      SELECT product_a_id AS product_id, count FROM co_occurrence WHERE count >= $1
      UNION ALL
      SELECT product_b_id AS product_id, count FROM co_occurrence WHERE count >= $1
    ) t GROUP BY product_id
  `, [MIN_COUNT_FOR_NPMI]);

  // 3. Calculate NPMI per pair with count >= min, persist top-K per product
  await pg.query(`TRUNCATE co_occurrence_top`);
  await pg.query(`
    INSERT INTO co_occurrence_top (product_id, related_product_id, npmi_score, rank, last_recompute_at)
    WITH pairs AS (
      SELECT
        c.product_a_id, c.product_b_id, c.count,
        na.n AS n_a, nb.n AS n_b,
        c.count / $1 AS p_ab,
        na.n / $1 AS p_a,
        nb.n / $1 AS p_b
      FROM co_occurrence c
      JOIN _n_per_product na ON na.product_id = c.product_a_id
      JOIN _n_per_product nb ON nb.product_id = c.product_b_id
      WHERE c.count >= $2
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
    -- expand to both directions (a→b and b→a) for symmetric top-K queries
    expanded AS (
      SELECT product_a_id AS product_id, product_b_id AS related_product_id, npmi FROM scored WHERE npmi > 0
      UNION ALL
      SELECT product_b_id AS product_id, product_a_id AS related_product_id, npmi FROM scored WHERE npmi > 0
    ),
    ranked AS (
      SELECT product_id, related_product_id, npmi,
             ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY npmi DESC) AS rank
      FROM expanded
    )
    SELECT product_id, related_product_id, npmi, rank, now()
    FROM ranked
    WHERE rank <= $3
  `, [nTotal, MIN_COUNT_FOR_NPMI, NPMI_TOP_K]);

  await pg.query(`DROP TABLE _n_per_product`);
}
```

CLI: `pnpm cron:npmi-recompute`.

### 4.6 Tests del bloque 1

- **Unit** `pairKey`: ordering `LEAST/GREATEST`.
- **Unit** `npmiFormula`: P=0.5 sobre P=0.5 × P=0.5 → NPMI = 1 (caso perfecto). P_ab = P_a × P_b → NPMI = 0 (independencia).
- **Integration**: insertar 5 productos. Crear 30 sesiones con co-vistas (iPhone, funda iPhone) más 100 sesiones random. Run NPMI → `co_occurrence_top[iPhone]` top-1 contiene funda iPhone. NPMI > 0.3.
- **Integration**: par con count=1 NO aparece en co_occurrence_top (filtro min count).
- **Integration**: seedCoOccurrenceForProduct para nuevo producto en categoría con 10 vecinos similares → 10 pares creados con count=0.1.
- **Integration end-to-end** captureCoOccurrence: track event A en sesión, luego event B 5min después → fila aparece con count = max(weight_A, weight_B).
- **Mutation**: omitir `-LN(p_ab)` denominador → NPMI tests fallan.

## 5. Bloque 2 — Multi-modo k-means + dispatch online + recompute on-trigger

### 5.1 Thresholds (master doc Sec 10.b)

```ts
export function modesForEvents(nEvents: number): 0 | 1 | 2 | 3 {
  if (nEvents < 5) return 0;
  if (nEvents < 20) return 1;
  if (nEvents < 100) return 2;
  return 3;
}
```

Aplica a `n_events_in_mode` SUMADO por bucket (user_profile, recipient, cohort).

### 5.2 K-means lib

```bash
pnpm add ml-kmeans
```

Wrapper en `src/sectors/d-personalization/vector/kmeans.ts`:

```ts
import { kmeans } from "ml-kmeans";
import { cosine } from "@/lib/math";

export interface KMeansInput {
  points: number[][];           // n × d embeddings
  weights: number[];            // n × 1 sample weights (event_weight × decay)
  k: number;
}

export interface KMeansOutput {
  centroids: number[][];        // k × d
  cluster_of_point: number[];   // length n
}

export function runKMeans(input: KMeansInput): KMeansOutput {
  // ml-kmeans doesn't support weights natively. Workaround: replicate each
  // point ceil(weight * SCALE) times. Cap total replicas to prevent blow-up.
  const SCALE = 10;
  const MAX_TOTAL = 5000;
  const expanded: number[][] = [];
  const originalIndex: number[] = [];
  let total = 0;
  for (let i = 0; i < input.points.length; i++) {
    const reps = Math.max(1, Math.ceil(input.weights[i] * SCALE));
    for (let j = 0; j < reps && total < MAX_TOTAL; j++) {
      expanded.push(input.points[i]);
      originalIndex.push(i);
      total++;
    }
  }
  const result = kmeans(expanded, input.k, {
    initialization: "kmeans++",
    maxIterations: 100,
    distanceFunction: (a, b) => 1 - cosine(a, b),
  });
  // Recover cluster_of_point in original index space
  const clusterOfPoint = new Array(input.points.length).fill(-1);
  for (let i = 0; i < expanded.length; i++) {
    const origIdx = originalIndex[i];
    if (clusterOfPoint[origIdx] === -1) clusterOfPoint[origIdx] = result.clusters[i];
  }
  return {
    centroids: result.centroids,
    cluster_of_point: clusterOfPoint,
  };
}
```

### 5.3 Recompute on-trigger

`src/sectors/d-personalization/multimode/recompute.ts`:

```ts
export async function recomputeModesForBucket(
  opts: {
    user_profile_id: string;
    recipient_id: string | null;
    cohort_id: CohortId;
    target_modes: 1 | 2 | 3;
  },
  pg: Client,
): Promise<void> {
  // 1. Read all events for this bucket (matching cohort + recipient) last 90d
  const events = await fetchBucketEvents(opts, pg);  // [{ embedding, weight, ts }]
  if (events.length === 0) return;
  
  // 2. Compute decayed weights
  const now = Date.now();
  const weights = events.map(e => e.weight * Math.exp(-(now - e.ts) / (TAU_PROFILE_DAYS*86400000)));
  
  // 3. Run k-means with k=target_modes
  const { centroids, cluster_of_point } = runKMeans({
    points: events.map(e => e.embedding),
    weights,
    k: opts.target_modes,
  });
  
  // 4. For each cluster, compute weight_sum + vector_unnormalized
  const clusterStats = new Array(opts.target_modes).fill(0).map(() => ({
    unnorm: new Array(EMBEDDING_DIM).fill(0),
    weight: 0,
    n: 0,
  }));
  for (let i = 0; i < events.length; i++) {
    const c = cluster_of_point[i];
    const w = weights[i];
    for (let d = 0; d < EMBEDDING_DIM; d++) {
      clusterStats[c].unnorm[d] += w * events[i].embedding[d];
    }
    clusterStats[c].weight += w;
    clusterStats[c].n += 1;
  }
  
  // 5. DELETE existing modes for bucket; INSERT k new with mode_index 1..k
  await pg.query(
    `DELETE FROM user_profile_modes
     WHERE user_profile_id = $1
       AND ((recipient_id IS NULL AND $2::uuid IS NULL) OR recipient_id = $2)
       AND cohort_id = $3`,
    [opts.user_profile_id, opts.recipient_id, opts.cohort_id],
  );
  for (let m = 0; m < opts.target_modes; m++) {
    await pg.query(
      `INSERT INTO user_profile_modes (
         user_profile_id, recipient_id, cohort_id, mode_index,
         vector_unnormalized, weight_sum, n_events_in_mode, last_assigned_at
       ) VALUES ($1, $2, $3, $4, $5::vector, $6, $7, now())`,
      [
        opts.user_profile_id, opts.recipient_id, opts.cohort_id, m + 1,
        "[" + clusterStats[m].unnorm.join(",") + "]",
        clusterStats[m].weight, clusterStats[m].n,
      ],
    );
  }
}
```

Trigger en `track-hook.ts`:

```ts
// After updateProfileModeWithProduct:
const target = modesForEvents(updatedMode.n_events_in_mode);
const current = await countModesInBucket(profile_id, recipient_id, cohort_id, pg);
if (target > current && target > 0) {
  await recomputeModesForBucket(
    { user_profile_id: profile_id, recipient_id, cohort_id, target_modes: target as 1|2|3 },
    pg,
  );
}
```

### 5.4 Dispatch online a modo más cercano

Cuando el bucket ya tiene multi-modo (≥2 modes) y llega evento:

```ts
async function pickBestMode(
  profile_id: string, recipient_id: string | null, cohort_id: CohortId,
  productEmbedding: number[],
  pg: Client,
): Promise<ProfileMode> {
  const modes = await fetchAllModesInBucket(profile_id, recipient_id, cohort_id, pg);
  if (modes.length <= 1) return modes[0];  // single mode
  let best = modes[0];
  let bestCos = cosine(normalize(modes[0].vector_unnormalized), productEmbedding);
  for (let i = 1; i < modes.length; i++) {
    const c = cosine(normalize(modes[i].vector_unnormalized), productEmbedding);
    if (c > bestCos) { best = modes[i]; bestCos = c; }
  }
  return best;
}
```

Reemplaza el `getOrInitProfileMode` cuando hay multi-modo activo.

### 5.5 Tests del bloque 2

- **Unit** `modesForEvents`: boundaries 0/4/5/19/20/99/100/500.
- **Unit** `runKMeans` con dataset sintético: 2 clusters claramente separados → cluster_of_point segrega correctamente; centroids cerca de los centros sintéticos.
- **Integration** `recomputeModesForBucket`: usuario con 25 events split 13 formal + 12 casual → multi-modo 2 → uno de los centroides cosine > 0.8 a formal-template, otro a casual-template.
- **Integration** trigger boundary: usuario con 19 events single → evento 20 dispara recompute → 2 modes existen.
- **Integration** dispatch: usuario con 2 modes ya creados → nuevo evento formal → solo mode "formal" gana 1 evento, mode "casual" sin cambios.
- **Mutation** `modesForEvents` siempre devuelve 1 → trigger test falla.

## 6. Bloque 3 — RRF fusion de 3+ fuentes en `generateFeed`

### 6.1 Las 3 fuentes

**Fuente A (semántica multi-modo):** Por cada mode activo del bucket actual, top-50 por cosine contra `normalize(mode.vector_unnormalized)`. Si N modes → N listas de 50.

**Fuente B (co-ocurrencia):** Si la sesión tiene `last_viewed_product_id` (último product_view de los 30 min), query `co_occurrence_top[last_viewed]` ordenado por `rank ASC`, top-30. Si no hay last viewed → fuente B vacía.

**Fuente C (popularidad por cohorte):** Score = `log(1+views_7d) + 2·log(1+adds_7d) + 3·log(1+purchases_7d)` dentro de la cohorte actual (sub-query JOIN events ↔ products). Top-20.

### 6.2 RRF

```ts
// src/sectors/d-personalization/retrieve/rrf.ts (NEW)
export const RRF_K0 = 60;

export interface RankedItem { id: string; rank: number }
export interface RankedList { source: string; items: RankedItem[] }

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
        acc.set(item.id, { id: item.id, rrf_score: reciprocal, sources: [list.source] });
      }
    }
  }
  return [...acc.values()].sort((a, b) => b.rrf_score - a.rrf_score);
}
```

### 6.3 `generateFeed` actualizado

```ts
export async function generateFeed(opts, pg) {
  const limit = opts.limit ?? 20;
  const profile_id = await getOrCreateProfileForFeed(...);
  const state = await readSessionState(opts.session_id, pg);
  const cohortId = state?.current_cohort_id ?? "unisex_indeterminado";
  const recipientId = state?.current_recipient_id ?? null;
  const excluded = await fetchExcludedIds(...);

  // Source A: multi-mode semantic
  const modes = await fetchAllModesInBucket(profile_id, recipientId, cohortId, pg);
  const listsA = await Promise.all(modes.map(async (m, i) => {
    const u = normalize(m.vector_unnormalized);
    const items = await retrieveTopKByVector(u, excluded, 50, pg);
    return {
      source: `mode_${m.mode_index}`,
      items: items.map((it, r) => ({ id: it.product.id, rank: r + 1 })),
    };
  }));

  // Source B: co-occurrence
  const lastViewed = await fetchLastViewedProduct(opts.session_id, pg);
  const listB: RankedList = { source: "cooccurrence", items: [] };
  if (lastViewed) {
    const r = await pg.query(
      `SELECT related_product_id::text AS id, rank
       FROM co_occurrence_top
       WHERE product_id = $1
         AND related_product_id != ALL($2::uuid[])
       ORDER BY rank ASC LIMIT 30`,
      [lastViewed, excluded],
    );
    listB.items = r.rows.map(x => ({ id: x.id, rank: Number(x.rank) }));
  }

  // Source C: popularity by cohort
  const listC = await fetchPopularByCohort(cohortId, excluded, 20, pg);

  // RRF fusion
  const allLists = [...listsA, listB, listC];
  const fused = rrfFuse(allLists, RRF_K0).slice(0, limit);

  // Resolve product details
  return resolveProductDetails(fused, pg);
}
```

### 6.4 Tests del bloque 3

- **Unit** `rrfFuse`: producto en top-1 de 3 listas vs en top-1 de 1 lista → primero gana.
- **Unit** `rrfFuse` con k0=0 vs k0=60 → diferencias predecibles.
- **Integration** multi-modo retrieval: usuario con 2 modes claros (formal/casual) → feed contiene productos de AMBOS clusters (≥3 de cada uno en top-10).
- **Integration** co-ocurrencia: sesión con `last_viewed = iPhone`, NPMI top tiene funda iPhone → funda iPhone aparece en feed.
- **Integration** popularidad por cohorte para cold user: usuario con 0 events, cohort `femenino_adulta` → feed dominado por productos populares en `femenino_adulta`.
- **Integration** Jaccard guardrail: 3 usuarios cohortes ortogonales → Jaccard en [0.05, 0.40].
- **Mutation** k0 = 0 → orden de RRF cambia → tests del bloque 3 fallan.

## 7. Bloque 4 — Eval enriquecido (3 sub-experimentos)

### 7.1 Sub-experimento 1: Multi-modo within-cohort

`scripts/eval-3b-multimodo.ts`:
- Setup: cohorte `femenino_adulta` con 20 productos "formal" + 20 "casual" (descripción diferenciada para que embeddings los separen).
- Usuario sintético `U_multi`: 25 events split (13 formal, 12 casual via round-robin).
- Holdout: 5 productos formal + 5 casual NO vistos.
- Métrica: **nDCG@10** = sum (rel_i / log2(i+1)) / IDCG; rel_i = 1 si holdout, 0 else.
- Comparar: nDCG@10 con `target_modes=2` (multi-modo) vs `target_modes=1` (single).
- **Compuerta:** multi-modo nDCG@10 > single-modo nDCG@10 en ≥10%.

### 7.2 Sub-experimento 2: Cross-sell vía NPMI

`scripts/eval-3b-crosssell.ts`:
- Setup: 5 productos iPhone + 5 fundas iPhone + 10 productos random no relacionados.
- Generar 30 sesiones sintéticas con co-vistas (iPhone_i, funda_j) — todas las combinaciones.
- Run `npmi-recompute`.
- Crear usuario sintético, generar 1 evento product_view de iPhone_0.
- Run `generateFeed(limit=10)`.
- **Compuerta:** ≥1 funda iPhone aparece en top-10 (idealmente ≥2). El experimento de control sin co-ocurrencia (sólo cosine) NO surfacea fundas porque cosine es bajo iPhone↔funda.

### 7.3 Sub-experimento 3: Diversidad guardrail (Jaccard)

`scripts/eval-3b-diversity.ts`:
- 3 usuarios sintéticos en cohortes ortogonales (femenino_adulta, masculino_adulto, masculino_nino).
- 12 events cada uno en su cohort.
- Compute Jaccard entre cada par de top-10 feeds.
- **Compuerta:** Jaccard promedio en [0.05, 0.40] (master doc guardrail).

### 7.4 Script orquestador + smoke test

`scripts/eval-personalization-3b.ts` corre los 3 en serie, emite Markdown report.

Smoke test integration: `tests/integration/eval-3b-smoke.test.ts` con `productsPerCohort=5, eventsPerUser=5` — corre rápido (~60s, ~$0.01) y verifica que los 3 sub-experimentos retornan métricas finitas (compuertas no se chequean en smoke, solo finite).

## 8. Bloque 5 — Admin updates + cierre

### 8.1 Página `/admin/co-occurrence/top` (NEW)

Server component, auth-gated:
- Lista top 50 pares globales con NPMI más alto.
- Detecta artefactos (ej: dos productos que dominan TODO con NPMI altísimo → posiblemente bug).
- `getCoOccurrenceTopAdmin(pg)` query JOIN co_occurrence_top × products para títulos.

### 8.2 `/admin/users/[id]` ya hace lo necesario

La página de 3a (`UserDebugView`) ya muestra los modes del usuario con sus top-5 productos. En F3b, cuando un user tiene 2-3 modes, naturalmente verá 2-3 cards.

### 8.3 Triple revisión + cierre

Mismo régimen que F1-F3a:
- **Adversario:** mutaciones de RRF (k0), NPMI (denominador, min_count), modesForEvents thresholds, dispatch (cosine sign).
- **Auditor de mocks:** AST checker 0 violations.
- **Probador:** black-box vs los 3 sub-experimentos del eval.

Reporte de cierre en `docs/superpowers/reports/<date>-fase-3b-cierre.md`.

## 9. File map consolidado

```
supabase/migrations/
└── (sin cambios — schema co_occurrence ya está, mode_index 1-3 ya está)

src/sectors/d-personalization/
├── co-occurrence/                                   [NEW]
│   ├── capture.ts                                   captureCoOccurrence (per-event)
│   ├── seed.ts                                      seedCoOccurrenceForProduct
│   └── npmi-recompute.ts                            recomputeNPMI nocturno
├── multimode/                                       [NEW]
│   ├── thresholds.ts                                modesForEvents
│   ├── recompute.ts                                 recomputeModesForBucket
│   └── dispatch.ts                                  pickBestMode
├── vector/
│   └── kmeans.ts                                    [NEW] wrapper de ml-kmeans
├── retrieve/                                        [NEW dir]
│   ├── rrf.ts                                       rrfFuse
│   ├── popular-by-cohort.ts                         fetchPopularByCohort
│   └── last-viewed.ts                               fetchLastViewedProduct
├── feed.ts                                          [MODIFY] usar RRF 3+ fuentes
├── track-hook.ts                                    [MODIFY] +captureCoOccurrence + multimode trigger
└── admin/
    └── co-occurrence-top.ts                         [NEW]

src/app/admin/
├── co-occurrence/top/page.tsx                       [NEW]
└── users/[id]/page.tsx                              (sin cambios — ya muestra modes)

scripts/
├── cron-cooccurrence-seed.ts                        [NEW] sembrar grafo
├── cron-npmi-recompute.ts                           [NEW] NPMI nocturno
├── eval-personalization-3b.ts                       [NEW] orquesta 3 sub-experimentos
├── eval-3b-multimodo.ts                             [NEW] sub-exp 1
├── eval-3b-crosssell.ts                             [NEW] sub-exp 2
└── eval-3b-diversity.ts                             [NEW] sub-exp 3

tests/
├── unit/
│   ├── rrf.test.ts                                  [NEW] property tests
│   ├── npmi-formula.test.ts                         [NEW]
│   ├── modes-for-events.test.ts                     [NEW] boundaries
│   ├── kmeans-wrapper.test.ts                       [NEW] convergencia
│   └── popular-score.test.ts                        [NEW]
└── integration/
    ├── co-occurrence-capture.test.ts                [NEW]
    ├── co-occurrence-seed.test.ts                   [NEW]
    ├── npmi-recompute.test.ts                       [NEW]
    ├── multimode-recompute.test.ts                  [NEW]
    ├── multimode-dispatch.test.ts                   [NEW]
    ├── feed-rrf.test.ts                             [NEW] feed con 3 fuentes
    ├── cooccurrence-top-admin.test.ts               [NEW]
    └── eval-3b-smoke.test.ts                        [NEW]

package.json                                          [MODIFY] +ml-kmeans, +cron scripts, +eval
```

## 10. Tests — inventario y costo

| Tipo | Archivos | # tests aprox | APIs reales | Costo aprox |
|---|---|---|---|---|
| Unit | 5 archivos | ~22 | — | $0 |
| Integration | 8 archivos | ~22 | pg + Voyage | ~$0.01 |
| Eval smoke | 1 archivo | 1 | pg + Voyage | ~$0.01 |
| Eval full run | 1 script | (no test) | pg + Voyage | ~$0.05 |

**Total: ~45 tests nuevos. Coste suite ~$0.02, eval full ~$0.05.**

## 11. Riesgos identificados

1. **K-means con k=2/3 puede caer en mínimos locales.** Mitigación: `kmeans++` init + 100 maxIterations en `ml-kmeans` default. Si en eval vemos vectores degenerados (uno con todos los puntos), forzar re-init con seed diferente. Por ahora aceptamos.

2. **NPMI recompute es O(N²) en pares.** Con catálogo 500 productos, hasta 125k pares. Postgres lo hace en segundos. Si el catálogo crece a 50k productos → 1.25B pares → necesitamos sampling o LSH. Diferido a Fase 5/cuando aplique.

3. **Co-occurrence captura per-event sync añade latencia.** Mitigación: la query intra-sesión usa índice `(session_id, occurred_at)` que ya existe. ~20-50ms aceptable.

4. **Seed de co-categoría puede contaminar el grafo.** Si seed weight=0.1 es muy alto vs counts reales bajos (1-3 al principio), el NPMI sería dominado por el seed. Mitigación: count >= 3 filtro descarta pares puramente sembrados.

5. **Trigger on-boundary puede causar tormenta de recomputes.** Si un user pasa rápidamente de 19→25 events, dispara recompute en 20. Luego 25→100 dispara otro. Cada uno 30-80ms. Aceptable, pero monitorear.

6. **ml-kmeans no soporta sample weights natively.** Workaround documentado: replicar puntos según weight×SCALE (max 5000 replicas total). Aceptable para datasets de ≤100 events por bucket.

## 12. Items diferidos sin cambio respecto a master doc

- **MMR diversification** → Fase 3c (sobre top-100 RRF → top-30).
- **LLM reranker contextual** → Fase 3c (con Anthropic dormant).
- **Holdout temporal eval real** → Fase 5 (validación con data acumulada).
- **Calibración empírica θ semantic cache** → Fase 5.
- **TTL cleanup cron del cache** → Fase 4.
- **Admin role-based access real** → Fase 4.
- **Two-tower fine-tuned (DPR), Item2vec, cross-encoder** → v2 post-MVP.

## 13. Definition of done

- [ ] Co-occurrence captura online via `track-hook` (per-event sync).
- [ ] Seed co-categoría al popular catálogo (cron + en pipeline).
- [ ] NPMI nocturno con min_count=3 y filtro npmi>0.
- [ ] Multi-modo k-means via `ml-kmeans` con thresholds 5/20/100.
- [ ] Recompute on-trigger en cada boundary.
- [ ] Dispatch online a modo más cercano.
- [ ] RRF de 3+ fuentes en `generateFeed`.
- [ ] Admin `/admin/co-occurrence/top` page.
- [ ] **Eval sub-experimento 1**: multi-modo nDCG@10 > single-modo en ≥10%.
- [ ] **Eval sub-experimento 2**: cross-sell — ≥1 funda iPhone en top-10 (vs 0 con cosine sola).
- [ ] **Eval sub-experimento 3**: Jaccard inter-user en [0.05, 0.40].
- [ ] `pnpm test:unit && pnpm test:integration` verde.
- [ ] `pnpm test:quality` 0 violations.
- [ ] Triple revisión (Adversario + Auditor + Probador) APPROVED.

## 14. Triple revisión Fase 3b

Mutaciones críticas a verificar:
1. `k0 = 60` → `k0 = 0` → tests de RRF orden fallan.
2. `MIN_COUNT_FOR_NPMI = 3` → `1` → tests de ruido NPMI fallan.
3. `modesForEvents`: cambiar boundary 20 → 50 → trigger test falla.
4. NPMI denominator `-LN(p_ab)` → omitir → tests de NPMI fórmula fallan.
5. Dispatch `pickBestMode`: cambiar `c > bestCos` por `c < bestCos` → dispatch test falla.

## 15. Próximo paso

Tras review del spec, invocar `writing-plans` para producir plan ejecutable (~18-22 tareas).
