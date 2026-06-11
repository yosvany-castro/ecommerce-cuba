# A4 — Diseño de `src/sectors/g-agents/metrics`: capa READ-ONLY de métricas por placement

**Fecha:** 2026-06-11 · **Fuentes:** migraciones 0005/0006/0009/0023–0029 (columnas verificadas línea a línea), `src/lib/db/{pg,helpers}.ts`, `src/sectors/d-personalization/{feed,holdout,prune}.ts`, `src/sectors/d-personalization/slate/store.ts`, `src/sectors/d-personalization/exclusion/fatigue.ts`, `src/sectors/f-slate/{compose,sections/resolve,sections/registry}.ts`, `src/sectors/a-tracking/{attribution,events/schema}.ts`, `src/app/api/{track,feed/seen}/route.ts`, `src/app/(shop)/page.tsx`, `tests/helpers/db.ts`, `tests/integration/purchase-attribution.test.ts`, `vitest.config.ts`.
**Toda columna citada en el SQL de este informe fue verificada contra el DDL real.** Alineado con A1 (`read_metrics` tool sketch en a1-deepagents-langgraph-api.md §2.1).

---

## 0. El mundo de datos tal como ES (verificado, no asumido)

### 0.1 Tablas y columnas exactas

**`feed_impressions`** (0023 + 0024) — una fila por slot servido:

| columna | tipo | escrita por | notas |
|---|---|---|---|
| `id` | bigint identity | — | |
| `feed_request_id` | uuid NOT NULL | store.ts / feed.ts | **= `slate_id` cuando viene del slate** (store.ts:88-91); uuid random en el path legacy (feed.ts:219) |
| `user_profile_id` | uuid NULL | ambos | FK lógica a `user_profiles.id` (sin FK real) |
| `session_id` | **text** NULL | ambos | ojo: `events.session_id` es **uuid** → cast en joins |
| `position` | smallint | ambos | posición absoluta en el slate; `unique(feed_request_id, position)` |
| `product_id` | uuid | ambos | |
| `source` | text 'exploit'\|'explore' | ambos | |
| `propensity` | float8 (0,1] | ambos | |
| `served_at` | timestamptz default now() | ambos | "tuvo la oportunidad" |
| `seen_at` | timestamptz NULL | `/api/feed/seen` | viewport ≥50%/≥1s; primer avistamiento gana, nunca se sobreescribe |
| `page_request_id` | uuid NULL | store.ts | NULL en path legacy |
| `section_id` | text NULL | store.ts | **hardcodeado `'hero_grid'`** (store.ts:106); NULL en path legacy |
| `placement_version` | int NULL | **nadie** | ⚠️ jamás se escribe hoy — siempre NULL (gap §0.3) |
| `policy` | text NOT NULL default 'default' | ambos | `'default'` \| `'holdout'` (feed.ts:367) \| futuros |
| `experiment_id` | text NULL | nadie aún | |

Índices: `(feed_request_id)`, `(product_id, served_at)`, `(session_id)`, `unique(feed_request_id, position)`, parcial `(experiment_id, served_at)`. **No hay índice por `served_at` solo** (§7).

**`slate_decisions`** (0024) — una fila por *serve* de composePage (puede haber **varias filas por `slate_id`**, una por pageload de la home — page.tsx:45 se ejecuta en cada render):

`id, slate_id uuid, surface text, user_profile_id uuid, session_id text, config_version text, holdout boolean default false, experiment_id text, placements jsonb, created_at`.
`placements` = `[{placement_id, slot, section_type, version}]` (compose.ts:142-149). `holdout` se setea con `isHoldout(identity)` (page.tsx:51).

**`purchase_attributions`** (0029) — una fila por producto comprado:

`id, order_id uuid, product_id uuid, feed_request_id uuid NULL, position smallint NULL, source text NULL, policy text NULL, seen boolean default false, unit_price_cents int, quantity int default 1, attributed_at timestamptz`.
Escrita por `attributePurchaseAndExclude` (attribution.ts): LATERAL a la **última impresión 7d** de la sesión/perfil; compra orgánica ⇒ columnas de feed NULL (se cuenta igual, cero survivor-bias). `(feed_request_id, position)` de una fila atribuida referencia exactamente UNA impresión (por el unique de 0024).

**`events`** (0005): `id, client_event_id, anonymous_id uuid, user_id uuid, session_id uuid NOT NULL, event_type text, occurred_at timestamptz, payload jsonb, source, created_at`. Índices útiles: `(event_type, occurred_at DESC)`, `(session_id, occurred_at)`.
Tipos de evento (events/schema.ts): **no existe `product_click`**. El proxy canónico de click es **`product_view`** con `payload->>'product_id'` (precedente: fatigue.ts:31-36 lo usa exactamente así para "un click lo absuelve"). `add_to_cart` lleva `{product_id, quantity}`. `payload->>'source'` de `product_view` ∈ home|category|search|direct (refinamiento opcional, no la base del join).

**`ui_placements`** (0025): `id uuid, surface, slot smallint, section_type, params jsonb, rule jsonb, scope, scope_ref, status (pending|approved|paused|archived|killed), risk_tier (low|medium|high), experiment_id, ttl_until, created_by, version int, created_at, updated_at`. `updated_at` = ancla de la ventana "desde-último-cambio".

**`product_popularity_7d`** (0027): `product_id, events_7d, views_7d, carts_7d, purchases_7d, category, computed_at` — agregado por cron, **no** es fuente de métricas por placement (no distingue policy/section), pero sirve de contexto de catálogo barato.

**`user_profiles`** (0006): `id uuid, anonymous_id uuid, user_id uuid` — puente perfil↔identidad si hiciera falta atribución por persona.

**`orders`** (0009): `id, user_id, status, total_charged_cents, total_cost_cents, margin_cents (generated), created_at` — **sin session_id**; el revenue por brazo se mide vía `purchase_attributions` (no vía orders).

### 0.2 Retención (prune.ts — acota las ventanas posibles)

- `feed_impressions`: **90 días** (`served_at`).
- `slate_decisions`: **90 días** (`created_at`).
- `feed_slates`: **expirado + 1 día** ⇒ **NO usable** como fuente histórica (la surface histórica se saca de `slate_decisions`, no de `feed_slates`).
- `purchase_attributions`, `events`: sin poda hoy.

### 0.3 Gaps de datos que la capa de métricas DEBE conocer (hallazgos, no diseño)

1. **Los carruseles NO loguean impresiones.** `resolveSections` (resolve.ts) solo materializa ids para `cross_sell`/`popular`/`cart_addons`; únicamente `hero_grid` (vía `serveFeedPage` → `logSlatePageImpressions`) escribe en `feed_impressions`. Consecuencia: el funnel por placement es **solo-hero** hasta que C1/C2 añadan un logging análogo para secciones (con `section_id = section_type` y su propio `feed_request_id = composition_id`). La capa de métricas debe reportar `funnel: null` + flag `no_impression_logging` para esos placements, **no ceros** (un cero engañaría al agente: "este placement no convierte" ≠ "este placement no se mide").
2. **`feed_impressions.placement_version` siempre NULL.** La atribución de versión sale del join con `slate_decisions.placements` (jsonb), no de la columna. Recomendación para C1 (escritura, fuera de A4): que `logSlatePageImpressions` reciba y escriba `placement_version`.
3. **`slate_decisions` tiene N filas por `slate_id`** (una por pageload) ⇒ todo join impresiones↔decisiones debe deduplicar con `DISTINCT ON (slate_id)`.
4. **Impresiones legacy** (`serveWithExploration`, feed.ts:208): `section_id IS NULL` y `feed_request_id` no aparece en `slate_decisions`. Se agregan bajo la etiqueta `legacy_feed` en métricas por sección y quedan fuera de las métricas por placement (correcto: no las produjo ningún placement).
5. **`statement_timeout = 2.5s` en el pool `public`** (pg.ts:54). Las agregaciones 7–28d sobre `feed_impressions` + `events` deben correr por el **path offline** (`withPgDirect`, sin timeout) — el cron del merchandiser ES offline, así que esto es natural, pero queda prohibido llamar esta capa desde el request path (además es la garantía de "NUNCA toca el request path").

---

## 1. Estructura propuesta del sector

```
src/sectors/g-agents/metrics/
  types.ts        // MetricsWindow, filas tipadas, MetricsReport, MetricsSource
  windows.ts      // resolución de ventanas (puro, sin IO)
  confidence.ts   // wilson95, flags de muestra mínima (puro, sin IO)
  queries.ts      // las funciones SQL (toman `pg: Client` como último arg — convención del repo)
  report.ts       // buildMetricsReport: orquesta queries + compacta el JSON del tool
  index.ts        // re-exports
```

Convenciones respetadas: funciones `(args, pg: Client)` como todo el repo (store.ts, fatigue.ts, attribution.ts); identificadores SQL en inglés; sin estado; sin escrituras (la única "tool de escritura" del agente es `propose_placement`, fuera de este sector-archivo).

---

## 2. Funciones tipadas + SQL real (columnas verificadas)

### 2.0 Tipos base (`types.ts`)

```ts
import type { Client } from "pg";

/** Ventana temporal resuelta a [from, to). */
export interface ResolvedWindow {
  from: Date;
  to: Date;
  label: string; // "7d" | "14d" | "since_change" — para el JSON del tool
}

export type WindowSpec =
  | { kind: "fixed"; days: 7 | 14 | 28 }
  | { kind: "since"; from: Date };           // clamp a 28d en windows.ts

export type Surface = "home" | "pdp" | "cart" | "search";

export interface SectionFunnelRow {
  section_id: string;          // 'hero_grid' | 'legacy_feed' | futuros section_types
  policy: string;              // 'default' | 'holdout' | ...
  served: number;
  seen: number;
  clicks: number;              // product_view post-exposición, misma sesión+producto
  add_to_carts: number;
  purchases: number;
  revenue_cents: number;
}

export interface PlacementFunnelRow extends Omit<SectionFunnelRow, "section_id"> {
  placement_id: string;
  section_type: string;
  surface: Surface;
  slot: number;
  placement_version: number;   // del jsonb de slate_decisions (versión servida)
}

export interface PlacementCatalogRow {
  placement_id: string;
  surface: Surface;
  slot: number;
  section_type: string;
  status: string;
  risk_tier: string;
  scope: string;
  version: number;
  created_by: string;
  updated_at: Date;            // ancla de since_change
  age_days: number;
}

export interface PolicyComparisonRow {
  policy: string;              // 'default' | 'holdout' | 'organic' (solo en compras)
  exposed_sessions: number;
  served: number;
  seen: number;
  purchases: number;
  revenue_cents: number;
}

export interface CategoryFunnelRow {
  category: string;            // products.metadata->>'category' | 'uncategorized'
  served: number;
  seen: number;
  clicks: number;
  purchases: number;
  revenue_cents: number;
}
```

### 2.1 `fetchPlacementCatalog` — el tablero (qué existe, qué edad tiene)

```ts
export async function fetchPlacementCatalog(
  opts: { surface?: Surface },
  pg: Client,
): Promise<PlacementCatalogRow[]>
```

```sql
SELECT up.id::text            AS placement_id,
       up.surface, up.slot, up.section_type, up.status, up.risk_tier,
       up.scope, up.version, up.created_by, up.updated_at,
       GREATEST(0, floor(extract(epoch FROM (now() - up.updated_at)) / 86400))::int AS age_days
FROM ui_placements up
WHERE up.status <> 'archived'
  AND ($1::text IS NULL OR up.surface = $1)
ORDER BY up.surface, up.slot, up.version DESC
```

Incluye `paused`/`killed`/`pending` a propósito: el agente debe VER lo que está muerto para no re-proponerlo (el trigger `ui_placements_killed_is_final` hace irreversible `killed`; el prompt no basta, pero la visibilidad ayuda).

### 2.2 `fetchSectionFunnels` — funnel servido→visto→click→carrito→compra por sección×policy

El join de clicks/carritos sigue el **precedente de fatigue.ts** (events × product_id del payload) pero a nivel **sesión** (más barato y más específico que perfil): `events.session_id::uuid → ::text = feed_impressions.session_id`. Una pasada con pre-agregado (un hash join, no un EXISTS por fila — máquina de 2 cores):

```ts
export async function fetchSectionFunnels(
  opts: { window: ResolvedWindow; surface?: Surface },
  pg: Client,
): Promise<SectionFunnelRow[]>
```

```sql
WITH session_actions AS (
  -- una fila por (sesión, producto, tipo) con el ÚLTIMO instante de acción:
  -- "hubo acción después de servirse" ⇔ last_at >= served_at
  SELECT e.session_id::text                    AS session_id,
         (e.payload->>'product_id')::uuid      AS product_id,
         e.event_type,
         max(e.occurred_at)                    AS last_at
  FROM events e
  WHERE e.event_type IN ('product_view', 'add_to_cart')
    AND e.occurred_at >= $1                    -- from (≥ from de la ventana: una acción
    AND e.occurred_at <  $2 + interval '1 day' -- post-ventana inmediata cuenta)
    AND e.payload ? 'product_id'
  GROUP BY 1, 2, 3
),
purchases AS (
  -- (feed_request_id, position) referencia UNA impresión (unique de 0024)
  SELECT pa.feed_request_id, pa.position,
         count(*)::int                                  AS purchases,
         sum(pa.unit_price_cents * pa.quantity)::bigint AS revenue_cents
  FROM purchase_attributions pa
  WHERE pa.attributed_at >= $1 AND pa.attributed_at < $2 + interval '1 day'
    AND pa.feed_request_id IS NOT NULL
  GROUP BY 1, 2
),
surfaced AS (
  -- surface por slate (slate_decisions ≅ 90d; feed_slates se poda al expirar)
  SELECT DISTINCT ON (sd.slate_id) sd.slate_id, sd.surface
  FROM slate_decisions sd
  WHERE sd.created_at >= $1 - interval '2 days'
  ORDER BY sd.slate_id, sd.created_at ASC
)
SELECT COALESCE(fi.section_id, 'legacy_feed') AS section_id,
       fi.policy,
       count(*)::int                          AS served,
       count(fi.seen_at)::int                 AS seen,
       count(*) FILTER (
         WHERE fi.seen_at IS NOT NULL
           AND pv.last_at >= fi.served_at
       )::int                                 AS clicks,
       count(*) FILTER (
         WHERE atc.last_at >= fi.served_at
       )::int                                 AS add_to_carts,
       COALESCE(sum(pu.purchases), 0)::int    AS purchases,
       COALESCE(sum(pu.revenue_cents), 0)::bigint AS revenue_cents
FROM feed_impressions fi
LEFT JOIN session_actions pv
  ON pv.session_id = fi.session_id AND pv.product_id = fi.product_id
 AND pv.event_type = 'product_view'
LEFT JOIN session_actions atc
  ON atc.session_id = fi.session_id AND atc.product_id = fi.product_id
 AND atc.event_type = 'add_to_cart'
LEFT JOIN purchases pu
  ON pu.feed_request_id = fi.feed_request_id AND pu.position = fi.position
LEFT JOIN surfaced s ON s.slate_id = fi.feed_request_id
WHERE fi.served_at >= $1 AND fi.served_at < $2
  AND ($3::text IS NULL OR s.surface = $3)
GROUP BY 1, 2
ORDER BY 1, 2
```

Parámetros: `[$1=window.from, $2=window.to, $3=surface ?? null]`.

Decisiones explícitas:
- **Click = `product_view` de la MISMA sesión sobre el MISMO producto con `max(occurred_at) >= served_at`.** El `max` (no `min`) evita descartar el caso "vio el producto en búsqueda antes y volvió a clickearlo desde el feed". Sesgo residual asumido y documentado: un click de búsqueda *posterior* a la impresión también cuenta (sobre-cuenta leve, idéntica entre policies ⇒ no sesga comparaciones, que es lo que el agente consume).
- **Clicks condicionados a `seen_at IS NOT NULL`**: regla de la casa (0024: "Fatigue/guardrail denominators MUST use seen") — un click sin viewport confirmado es casi seguro otro origen.
- **`add_to_carts` NO se condiciona a seen**: el add-to-cart puede ocurrir desde el PDP (tras el click); exigir seen del card del feed lo infra-contaría.
- **Compras vía `purchase_attributions`** (no recomputadas): es EL sistema de reward ya construido (F1); las orgánicas (feed_request_id NULL) no entran aquí — entran en 2.4.

### 2.3 `fetchPlacementFunnels` — el funnel POR PLACEMENT (el corazón de la tool)

Atribución impresión→placement vía `slate_decisions.placements` (jsonb) porque `placement_version` no se escribe (§0.3.2):

```ts
export async function fetchPlacementFunnels(
  opts: { window: ResolvedWindow; surface?: Surface; sinceChange?: boolean },
  pg: Client,
): Promise<PlacementFunnelRow[]>
```

```sql
WITH decisions AS (
  SELECT DISTINCT ON (sd.slate_id) sd.slate_id, sd.surface, sd.placements
  FROM slate_decisions sd
  WHERE sd.created_at >= $1 - interval '2 days'   -- el slate pudo nacer antes de la ventana
  ORDER BY sd.slate_id, sd.created_at ASC          -- la composición que lo creó
),
imp AS (
  SELECT fi.*, d.surface,
         pl.placement_id, pl.version AS placement_version
  FROM feed_impressions fi
  JOIN decisions d ON d.slate_id = fi.feed_request_id
  CROSS JOIN LATERAL jsonb_to_recordset(d.placements)
       AS pl(placement_id uuid, slot smallint, section_type text, version int)
  WHERE pl.section_type = fi.section_id            -- hoy: 'hero_grid'; mañana: cada sección
    AND fi.served_at >= $1 AND fi.served_at < $2
    AND ($3::text IS NULL OR d.surface = $3)
),
session_actions AS ( /* idéntico a 2.2 */ ),
purchases       AS ( /* idéntico a 2.2 */ )
SELECT imp.placement_id::text, up.section_type, imp.surface, up.slot,
       imp.placement_version,
       imp.policy,
       count(*)::int                  AS served,
       count(imp.seen_at)::int        AS seen,
       count(*) FILTER (WHERE imp.seen_at IS NOT NULL AND pv.last_at >= imp.served_at)::int AS clicks,
       count(*) FILTER (WHERE atc.last_at >= imp.served_at)::int                            AS add_to_carts,
       COALESCE(sum(pu.purchases), 0)::int          AS purchases,
       COALESCE(sum(pu.revenue_cents), 0)::bigint   AS revenue_cents
FROM imp
JOIN ui_placements up ON up.id = imp.placement_id
LEFT JOIN session_actions pv  ON pv.session_id = imp.session_id AND pv.product_id = imp.product_id AND pv.event_type = 'product_view'
LEFT JOIN session_actions atc ON atc.session_id = imp.session_id AND atc.product_id = imp.product_id AND atc.event_type = 'add_to_cart'
LEFT JOIN purchases pu ON pu.feed_request_id = imp.feed_request_id AND pu.position = imp.position
WHERE ($4::boolean IS DISTINCT FROM true
       OR imp.served_at >= GREATEST(up.updated_at, now() - interval '28 days'))
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY imp.surface, up.slot, imp.policy
```

Parámetros: `[$1=from, $2=to, $3=surface ?? null, $4=sinceChange ?? false]`. Con `sinceChange=true` la ventana efectiva de CADA placement arranca en su propio `updated_at` (clamp 28d) — la ventana causalmente correcta para evaluar un cambio del agente (§4).

`report.ts` cruza este resultado con `fetchPlacementCatalog`: placements aprobados SIN filas aquí (carruseles, §0.3.1) salen con `funnel: null` y flag `no_impression_logging`.

### 2.4 `fetchPolicyComparison` — delta vs holdout (la métrica reina)

Dos agregados combinados en TS (denominadores de exposición + reward atribuido):

```ts
export async function fetchPolicyComparison(
  opts: { window: ResolvedWindow },
  pg: Client,
): Promise<PolicyComparisonRow[]>
```

```sql
-- (a) exposición por policy
SELECT fi.policy,
       count(DISTINCT fi.session_id)::int AS exposed_sessions,
       count(*)::int                      AS served,
       count(fi.seen_at)::int             AS seen
FROM feed_impressions fi
WHERE fi.served_at >= $1 AND fi.served_at < $2
GROUP BY 1;

-- (b) reward por policy (denormalizada en la atribución; 'organic' = sin crédito del feed)
SELECT COALESCE(pa.policy, 'organic')                  AS policy,
       count(*)::int                                   AS purchases,
       sum(pa.unit_price_cents * pa.quantity)::bigint  AS revenue_cents
FROM purchase_attributions pa
WHERE pa.attributed_at >= $1 AND pa.attributed_at < $2
GROUP BY 1;
```

En TS: `revenue_per_1k_seen = revenue_cents / seen * 1000`, `purchases_per_100_sessions = purchases / exposed_sessions * 100`, y el **delta** `default vs holdout` como razón + ambos numeradores/denominadores crudos (el agente debe ver los `n`, no solo el ratio — §5). La fila `organic` se reporta aparte como contexto (qué fracción del revenue NO es mérito del feed; el agente no debe atribuirse la tienda entera).

Nota metodológica honesta (documentar en el prompt del agente y en el header del archivo): `pa.policy` viene de la *última impresión 7d* del producto comprado (attribution.ts) — es atribución last-touch del feed, no un per-identity ITT perfecto. El holdout sí es asignación por identidad (hash salteado, holdout.ts), así que la comparación de brazos es válida; la fuga posible (usuario holdout que compró algo visto fuera del feed) cae en `organic` para ambos brazos por igual.

### 2.5 `fetchCategoryFunnels` — desglose por categoría

```ts
export async function fetchCategoryFunnels(
  opts: { window: ResolvedWindow; limit?: number },  // default limit 8 (el tool corta a 5 + 'other')
  pg: Client,
): Promise<CategoryFunnelRow[]>
```

```sql
WITH session_actions AS ( /* solo product_view, como en 2.2 */ ),
purchases AS ( /* idéntico a 2.2 */ )
SELECT COALESCE(p.metadata->>'category', 'uncategorized') AS category,
       count(*)::int                AS served,
       count(fi.seen_at)::int       AS seen,
       count(*) FILTER (WHERE fi.seen_at IS NOT NULL AND pv.last_at >= fi.served_at)::int AS clicks,
       COALESCE(sum(pu.purchases), 0)::int        AS purchases,
       COALESCE(sum(pu.revenue_cents), 0)::bigint AS revenue_cents
FROM feed_impressions fi
JOIN products p ON p.id = fi.product_id
LEFT JOIN session_actions pv ON pv.session_id = fi.session_id AND pv.product_id = fi.product_id
LEFT JOIN purchases pu ON pu.feed_request_id = fi.feed_request_id AND pu.position = fi.position
WHERE fi.served_at >= $1 AND fi.served_at < $2
GROUP BY 1
ORDER BY seen DESC
LIMIT $3
```

`p.metadata->>'category'` es la fuente canónica (mismo path que `popular` mode `pdp_category`, registry.ts:76). La compra orgánica no aparece (no tiene impresión); coherente: este desglose mide *el feed*, no la tienda.

### 2.6 (Opcional, barato) `fetchCatalogContext` — contexto de catálogo para el agente

Una lectura de `product_popularity_7d` (`category, sum(events_7d), sum(purchases_7d), count(*) products` GROUP BY category, top 8): le da al agente "qué se mueve en el catálogo" sin tocar `events`. Costo ~0 (tabla pre-materializada por cron).

---

## 3. JSON shape de la tool `read_metrics` (compacto, para LLM)

Principios: **pocas filas** (≤12 placements, top-5 categorías + `other`, 2-3 policies), **números redondeados** (rates a 3 decimales, dinero en `*_cents` enteros — el LLM no debe hacer aritmética de floats), **unidades en el nombre del campo**, **flags en vez de ceros engañosos**, los `n` siempre visibles. Devuelto como `JSON.stringify` desde el tool (A1 §2.1: el func retorna string).

```jsonc
{
  "window": { "label": "7d", "from": "2026-06-04", "to": "2026-06-11" },
  "store": {                       // agregado primero: ancla el razonamiento
    "served": 18420, "seen": 9104, "seen_rate": 0.494,
    "clicks": 512, "ctr_seen": 0.056,
    "add_to_carts": 161, "purchases": 23,
    "feed_revenue_cents": 412800, "organic_revenue_cents": 168000
  },
  "vs_holdout": {                  // null si insufficient_data
    "default": { "sessions": 1620, "seen": 8190, "purchases": 21, "revenue_cents": 391800,
                 "revenue_per_1k_seen_cents": 47838, "purchases_per_100_sessions": 1.296 },
    "holdout": { "sessions": 183, "seen": 914, "purchases": 2, "revenue_cents": 21000,
                 "revenue_per_1k_seen_cents": 22976, "purchases_per_100_sessions": 1.093 },
    "revenue_ratio": 2.08,         // default / holdout, por 1k seen
    "flags": ["holdout_low_purchases"]   // n compras holdout < 10 ⇒ ratio ruidoso
  },
  "placements": [                  // orden: surface, slot. Máx 12.
    {
      "id": "9b2f…",               // uuid completo (el agente lo necesita para proponer)
      "surface": "home", "slot": 10, "section": "hero_grid",
      "status": "approved", "risk_tier": "low", "version": 3,
      "days_since_change": 12,
      "funnel": {                  // policy='default'; el holdout vive en vs_holdout
        "served": 17890, "seen": 8830, "seen_rate": 0.494,
        "clicks": 498, "ctr_seen": 0.056, "ctr_ci95": [0.052, 0.061],
        "add_to_carts": 158, "atc_per_1k_seen": 17.9,
        "purchases": 21, "revenue_cents": 391800
      },
      "since_change": {            // misma forma, ventana GREATEST(updated_at, now()-28d)
        "days": 12, "seen": 14210, "ctr_seen": 0.058, "purchases": 33, "revenue_cents": 602100
      },
      "flags": []
    },
    {
      "id": "c41a…", "surface": "pdp", "slot": 10, "section": "cross_sell",
      "status": "approved", "risk_tier": "low", "version": 1, "days_since_change": 30,
      "funnel": null,
      "flags": ["no_impression_logging"]   // §0.3.1 — medible solo cuando C1 loguee secciones
    }
  ],
  "categories": [                  // top 5 por seen + resto agregado
    { "name": "electronica", "seen": 3120, "ctr_seen": 0.071, "purchases": 9, "revenue_cents": 189000 },
    { "name": "hogar",        "seen": 2270, "ctr_seen": 0.049, "purchases": 6, "revenue_cents": 96000 },
    { "name": "other(+4)",    "seen": 3714, "ctr_seen": 0.047, "purchases": 8, "revenue_cents": 127800 }
  ],
  "data_quality": {
    "impression_sources": ["hero_grid"],   // qué secciones SÍ están instrumentadas
    "retention_days": 90,
    "notes": ["clicks = product_view misma sesión post-exposición (proxy; no hay evento click)"]
  }
}
```

Reglas de compactación en `report.ts`:
- Rates: `Math.round(x * 1000) / 1000`; dinero: enteros en cents; nunca floats largos.
- `ctr_ci95` (Wilson) solo cuando hay muestra (§5) — si no, el campo se omite y se añade flag.
- Cualquier celda bajo mínimos ⇒ métrica `null`/omitida + flag (`low_sample`, `holdout_low_purchases`, `no_impression_logging`) — **el agente nunca ve un 0.0 que en realidad es "sin datos"**.
- El schema zod del tool (A1 §2.1): `z.object({ surface: z.enum(["home","pdp","cart","search"]).optional(), window_days: z.union([z.literal(7), z.literal(14), z.literal(28)]).default(7) })` — el `since_change` por placement se computa SIEMPRE (no es un parámetro: es la vista que el agente más necesita y pedirla aparte duplicaría llamadas).

---

## 4. Ventanas: 7d default + 14d trend + since-change (clamp 28d)

| Ventana | Para qué | Justificación anclada al repo |
|---|---|---|
| **7d (default)** | El estado operativo | Es LA constante del sistema: popularidad materializada es 7d (0027), la atribución mira 7d atrás (attribution.ts:36), la fatiga es 7d (fatigue.ts). Semana completa ⇒ sin sesgo día-de-semana. Con el tráfico de una tienda nueva, menos de 7d no junta muestra. |
| **14d** | Tendencia (dos buckets de 7d → delta) | El agente necesita "¿mejora o decae?" sin que `report.ts` invente forecasting: dos ventanas 7d consecutivas comparadas en TS. |
| **since-change (por placement, clamp 28d)** | Evaluar el efecto del PROPIO cambio | `ui_placements.updated_at` es el ancla natural; mezclar datos pre-cambio contaminaría la evaluación del cambio (el error clásico que haría al agente revertir mejoras). El clamp a 28d acota costo y coincide con el horizonte de no-estacionariedad del negocio (demanda cubana cambia rápido) y queda holgado dentro de la retención de 90d (prune.ts). |

NO se ofrece ventana libre (`from`/`to` arbitrarios) al LLM: más superficie de error (fechas inventadas, ventanas de 1 día llenas de ruido) sin ganancia. El harness sí puede usar `WindowSpec.since` directamente.

---

## 5. Datos escasos: mínimos de muestra (que el agente no persiga ruido)

Con una tienda nueva las celdas serán diminutas. Política: **reportar con intervalo o no reportar** — y el enforcement vive en `report.ts` (estructura), no solo en el prompt.

| Métrica | Mínimo para reportar valor | Por qué |
|---|---|---|
| `seen_rate` | `served ≥ 50` | binomial simple; bajo 50 el rate baila ±14pp |
| `ctr_seen` | `seen ≥ 200` | a CTR~5%, Wilson 95% con n=200 da ±3pp — suficiente para detectar placements rotos, no para micro-optimizar; bajo 200 ⇒ `null` + `low_sample` |
| `ctr_ci95` | siempre que se reporte ctr | el intervalo ES la señal anti-sobre-reacción: `wilson95(clicks, seen)` en `confidence.ts` |
| `atc_per_1k_seen` | `seen ≥ 200` | ídem |
| `purchases`, `revenue_cents` | siempre (conteos crudos) | un conteo nunca miente; lo que se protege son los RATIOS |
| `revenue_per_1k_seen_cents` | `purchases ≥ 10` en la celda | el revenue por compra tiene varianza enorme (un ítem caro mueve todo); bajo 10 compras ⇒ `null` + flag |
| `vs_holdout.revenue_ratio` | ambos brazos `sessions ≥ 30` y `purchases(total) ≥ 10` | con 10% de holdout, esto se alcanza recién con ~300 sesiones/ventana; antes ⇒ `vs_holdout: null` + `insufficient_holdout_data` |

```ts
// confidence.ts — puro, unit-testeable
export function wilson95(successes: number, n: number): [number, number] | null {
  if (n <= 0 || successes < 0 || successes > n) return null;
  const z = 1.959963984540054, p = successes / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export const MIN_SERVED_FOR_SEEN_RATE = 50;
export const MIN_SEEN_FOR_CTR = 200;
export const MIN_PURCHASES_FOR_REVENUE_RATE = 10;
export const MIN_SESSIONS_PER_ARM = 30;
export const MIN_PURCHASES_FOR_HOLDOUT_DELTA = 10;
```

Regla complementaria en el prompt del merchandiser (C2): "ante `low_sample` la única acción válida es *esperar* o *extender* — nunca pausar/matar/re-priorizar por una métrica flaggeada". La estructura (null en vez de número) hace que la violación sea difícil incluso si el prompt falla.

---

## 6. Paridad sim↔prod: UNA implementación SQL, el sim escribe las MISMAS tablas

**Recomendación: NO escribir una `SimMetricsSource` in-memory.** Dos implementaciones de "CTR" y "revenue por brazo" divergen siempre (¿seen o served como denominador? ¿click post-served o post-seen? ¿max o min de occurred_at?) — y entonces el gate ≥2x estaría midiendo una cantidad distinta de la que el agente observará en prod. En cambio:

1. El harness (C3) **inserta el mundo simulado en las MISMAS tablas** (`feed_impressions`, `slate_decisions`, `events`, `purchase_attributions`, `ui_placements`, `products`) en `test_schema` — las réplicas YA existen (cada migración crea `test_schema.*` con `LIKE ... INCLUDING ALL`), y `getPgClient({ scope: "test" })` resuelve los nombres sin calificar allí (pg.ts:30-34). Inserts batched con `unnest` (patrón ya usado en store.ts:102-121) ⇒ un INSERT por día simulado, no por fila.
2. La interfaz común existe pero es **delgada** — un seam, no una abstracción:

```ts
// types.ts
export interface MetricsSource {
  placementCatalog(opts: { surface?: Surface }): Promise<PlacementCatalogRow[]>;
  placementFunnels(opts: { window: WindowSpec; surface?: Surface; sinceChange?: boolean }): Promise<PlacementFunnelRow[]>;
  sectionFunnels(opts: { window: WindowSpec; surface?: Surface }): Promise<SectionFunnelRow[]>;
  policyComparison(opts: { window: WindowSpec }): Promise<PolicyComparisonRow[]>;
  categoryFunnels(opts: { window: WindowSpec; limit?: number }): Promise<CategoryFunnelRow[]>;
}

// queries.ts exporta la única impl:
export function sqlMetricsSource(pg: Client, opts?: { now?: () => Date }): MetricsSource;
```

   `now` inyectable es el ÚNICO ajuste que el sim necesita (el reloj simulado avanza por días; los `now()` de SQL se sustituyen por `$N::timestamptz` calculado en `windows.ts` — por eso **ningún SQL de §2 usa `now()` para la ventana**, solo parámetros).
3. `buildMetricsReport(source: MetricsSource, opts)` consume la interfaz ⇒ el tool del agente (prod, scope `public`, vía `withPgDirect`) y el harness (scope `test`, reloj simulado) ejecutan **byte-a-byte el mismo SQL y la misma compactación**.
4. **El gate NO se mide con esta capa**: el simulador computa su revenue realizado ground-truth internamente (sabe qué compró cada usuario sintético). La capa de métricas es solo el *canal de observación del agente* — así un bug de métricas no puede inflar el gate, solo cegar al agente (que es exactamente el failure mode que el gate debe castigar).

Precauciones operativas: el harness trunca sus tablas por seed-run (`truncateTestTables`, helpers/db.ts) y **no corre en paralelo con vitest** (vitest ya es serial — `maxWorkers: 1` — y comparte `test_schema`). Si en el futuro estorba, la salida es una migración de réplicas en un schema `sim` dedicado — no hacerlo hasta que duela.

---

## 7. Índice recomendado (única escritura colateral, opcional)

Los scans de §2 filtran `feed_impressions` por `served_at` y `purchase_attributions` por `attributed_at`; no existe índice para ninguno (0023/0024/0029 verificados). Con volúmenes actuales y ejecución offline da igual; para no descubrirlo con la tabla a 90d llena:

```sql
-- 0030_metrics_read_indexes.sql
CREATE INDEX IF NOT EXISTS idx_feed_impressions_served_at
  ON public.feed_impressions (served_at);
CREATE INDEX IF NOT EXISTS idx_purchase_attr_attributed_at
  ON public.purchase_attributions (attributed_at);
-- réplicas test_schema explícitas (las LIKE de 0023/0029 ya copiaron los índices
-- antiguos; los nuevos hay que crearlos aparte, patrón de 0024:98-107):
CREATE INDEX IF NOT EXISTS idx_feed_impressions_served_at_ts
  ON test_schema.feed_impressions (served_at);
CREATE INDEX IF NOT EXISTS idx_purchase_attr_attributed_at_ts
  ON test_schema.purchase_attributions (attributed_at);
```

---

## 8. Plan de tests frugal

Convenciones observadas: unit = puro sin DB (tests/unit/*, ej. slate-stabilize.test.ts); integración = DB real scope test con `withTestDb` + `truncateTestTables` + seeds mínimos inline (purchase-attribution.test.ts es el ejemplar a imitar). Vitest serial (`maxWorkers: 1`), timeout 30s.

### Unit (3 archivos, puros, milisegundos)

1. **`tests/unit/metrics-confidence.test.ts`** — `wilson95`: casos borde (n=0 ⇒ null, successes>n ⇒ null, [0,1] clamping) + 2 valores conocidos (p.ej. wilson95(5,100) ≈ [0.0215, 0.1118]). Caza: regresión numérica que haría al agente sobre/infra-confiar.
2. **`tests/unit/metrics-windows.test.ts`** — resolución de `WindowSpec`: 7d fijo produce [from,to) exactos con reloj inyectado; `since` se clampa a 28d; label correcto. Caza: off-by-one de ventana (el bug clásico que duplica/pierde un día de revenue).
3. **`tests/unit/metrics-report-shape.test.ts`** — `buildMetricsReport` con un `MetricsSource` fake (objetos literales): aplica mínimos de §5 (celda con seen=150 ⇒ `ctr_seen` ausente + flag `low_sample`; holdout con 1 compra ⇒ `vs_holdout.flags` correcto), top-5 categorías + `other(+N)` agregado, redondeos a 3 decimales, placement sin filas ⇒ `funnel: null` + `no_impression_logging`. Caza: TODA la lógica de compactación/protección — que es donde un refactor rompería al agente silenciosamente.

**No** se testean strings SQL con snapshots (brittle, no caza nada que la integración no cace mejor).

### Integración (1 archivo, 1 test, un seed compartido)

**`tests/integration/metrics-layer.test.ts`** — un solo `test()` con un mundo mínimo y asserts exactos sobre TODAS las funciones de §2 (una pasada, sin demos):

Seed (todo en `test_schema`, vía `withTestDb`): 2 products (con `metadata->>'category'` distinto), 1 `ui_placements` (hero_grid, home, version 2), 1 `slate_decisions` con `placements` jsonb apuntando a ese placement (+ una segunda fila del MISMO slate_id para verificar el DISTINCT ON), 4 `feed_impressions` del slate (2 con `seen_at`, policies: 3 'default' + 1 'holdout', `section_id='hero_grid'`), 1 impresión legacy (`section_id` NULL, feed_request_id random), 1 `events` product_view post-served (misma sesión/producto de una impresión vista) + 1 product_view PRE-served (no debe contar) + 1 add_to_cart, 2 `purchase_attributions` (una enlazada a (feed_request_id, position) con policy 'default' y 2000¢; una orgánica con NULLs y 3000¢).

Asserts: `sectionFunnels` ⇒ hero_grid/default = {served 3, seen 2, clicks 1, add_to_carts 1, purchases 1, revenue 2000} y fila `legacy_feed` presente; `placementFunnels` ⇒ misma celda atribuida al `placement_id` con `placement_version=2` (jsonb join + dedupe funcionan); `policyComparison` ⇒ brazos default/holdout con sus n + fila `organic` con 3000¢; `categoryFunnels` ⇒ split por categoría correcto; `placementCatalog` ⇒ `age_days` ≥ 0 y status. Caza: deriva de columnas (cualquier rename de migración futura revienta aquí), el cast `session_id` uuid↔text, el join jsonb, la dedupe de decisiones, la frontera temporal del click.

Costo total estimado: ~1s de integración + <100ms de unit. Cero tokens LLM.

---

## 9. Resumen de archivos a crear en C1 (spec ejecutable)

| Archivo | Contenido | Depende de |
|---|---|---|
| `src/sectors/g-agents/metrics/types.ts` | §2.0 + `MetricsSource` (§6) | — |
| `src/sectors/g-agents/metrics/windows.ts` | `resolveWindow(spec, now)` clamp 28d | types |
| `src/sectors/g-agents/metrics/confidence.ts` | `wilson95` + constantes §5 | — |
| `src/sectors/g-agents/metrics/queries.ts` | §2.1–2.6 + `sqlMetricsSource(pg, {now})` | types, windows |
| `src/sectors/g-agents/metrics/report.ts` | `buildMetricsReport(source, opts)` → shape §3 | todo lo anterior |
| `src/sectors/g-agents/metrics/index.ts` | re-exports | — |
| `supabase/migrations/0030_metrics_read_indexes.sql` | §7 (opcional pero barato) | — |
| Tests §8 | 3 unit + 1 integración | — |

El tool `read_metrics` (C2) queda en una línea: `tool(async ({surface, window_days}) => JSON.stringify(await withPgDirect((pg) => buildMetricsReport(sqlMetricsSource(pg), {surface, window: {kind:"fixed", days: window_days}}))), {...schema zod})` — ejecutado SOLO desde el cron offline, jamás desde el request path.
