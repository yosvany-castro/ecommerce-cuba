# Fase 3a — Personalización con vector único + cold start · Design

**Fecha:** 2026-05-15
**Estado del repo al diseñar:** Fase 2.5 cerrada (`docs/superpowers/reports/2026-05-07-fase-2.5-cierre.md`), merge a `main` (commit `04c7e21`).
**Branch propuesta:** `feat/fase-3a-personalization-vector-unico` (desde `main`).

## 1. Por qué Fase 3a existe

Fase 2.5 entregó búsqueda híbrida + smart mock + debug tools. El sistema ya entiende queries y trae productos relevantes — pero **todos los usuarios ven el mismo feed**. No hay personalización.

El master doc (Sector D) plantea un motor de recomendación multi-modo. Fase 3 se implementa en 3 sub-fases incrementales:

- **3a (esta fase)**: vector ÚNICO por usuario+receptor, cold start con shrinkage bayesiano, retrieval top-K.
- **3b**: multi-modo (k-means 1-3 modos), grafo de co-ocurrencia + NPMI, RRF de 3+ fuentes.
- **3c**: MMR diversification + LLM reranker contextual (aquí entra Anthropic dormant).

Fase 3a es la fundación: vectores actualizados con cada evento, prior por cohorte inferida automáticamente (sin onboarding declarativo), exclusión vía TTL, vista admin read-only del usuario.

### Decisión clave que diferencia esta fase

El master doc proponía **onboarding declarativo** (3-5 preguntas al user → cohorte). El usuario explícitamente descartó esto: *"no podemos preguntarle al usuario para quien compra, debe ser deducible y tampoco durar eternamente. Ya que puede comprar un momento para alguien y luego para el otro"*.

Por eso 3a incluye **inferencia automática de receptor por sub-sesión** — algo que el master doc planeaba para fases posteriores. Esto adelanta complejidad pero mantiene la promesa "feed coherente desde evento 1" sin fricción de UI.

## 2. Decisiones de scope (durante brainstorming)

| Decisión | Elección | Razón |
|---|---|---|
| Multi-destinatario en 3a | SÍ, con inferencia automática | User descartó UI selector |
| Cómo inferir receptor | Por sub-sesión con shift detection | Más responsive que checkout-only |
| Cold start prior | Cohorte por receptor inferido | Reusa el work del multi-destinatario |
| Cuántas cohortes | 11 predefinidas (gender × age_band + unisex_indeterminado) | Cubre demografía Cuba sin explotar |
| Multi-modo (k-means 1-3) | Diferido a 3b | F3a usa 1 modo por receptor |
| Grafo co-ocurrencia + NPMI | Diferido a 3b | F3a sólo retrieval semántico |
| RRF multi-fuente | Diferido a 3b | F3a sólo cosine top-K |
| MMR diversification | Diferido a 3c | |
| LLM reranker | Diferido a 3c (Anthropic) | |
| Slot allocation crudo (70/30) | NO | Cohort prior implícitamente hace popular-by-cohort |
| Evento `dismiss` | SÍ, nuevo en EVENT_TYPES | Alimenta excluded_products automáticamente |
| Vista admin de usuario | SÍ, read-only | Acciones admin → Fase 4 |
| Eval sintético | SÍ obligatorio | Compuerta Recall@10 ≥ baseline +20% |
| Update timing | Per-event synchronous | Personalización instantánea, latencia ~30-80ms aceptable |
| Recálculo nocturno | SÍ (higiene contra drift) | Job cron diario |

## 3. Arquitectura general

Per-event synchronous: cada llamada a `POST /api/track` ejecuta sincrónicamente:

```
1. Validar payload + persistir evento crudo
2. Si el evento tiene peso > 0 (purchase/cart/wishlist/dwell/view/category_click):
   a. Resolver producto referenciado → leer metadata {gender_target, age_target}
   b. Derivar EventSignal {cohort_id, gender, age_band}
   c. Leer estado de la sesión (session_vectors row extendida)
   d. Inferir/actualizar receptor activo (warmup o shift detection)
   e. Update vector_unnormalized + weight_sum del session_vector
   f. Update vector_unnormalized + weight_sum del user_profile_mode(profile, recipient)
3. Si el evento es `dismiss`: insertar en excluded_products con TTL 14 días
4. Devolver 200
```

Latencia añadida: ~30-80ms por evento (pgvector ops + un par de queries indexadas). Personalización instantánea — la siguiente página request ya ve el vector actualizado.

Cron nocturno (job batch separado): recalcula `vector_unnormalized` y `weight_sum` desde cero a partir de los eventos de los últimos 90 días, como higiene contra drift acumulado.

## 4. Bloque 1 — Inferencia de receptor + estado de sub-bucket

### 4.1 Cohortes (11 IDs)

```
femenino_bebe         (gender=femenino, age 0-3)
femenino_nina         (gender=femenino, age 4-11)
femenino_joven        (gender=femenino, age 12-25)
femenino_adulta       (gender=femenino, age 26-59)
femenino_mayor        (gender=femenino, age 60+)
masculino_bebe        (gender=masculino, age 0-3)
masculino_nino        (gender=masculino, age 4-11)
masculino_joven       (gender=masculino, age 12-25)
masculino_adulto      (gender=masculino, age 26-59)
masculino_mayor       (gender=masculino, age 60+)
unisex_indeterminado  (fallback)
```

Pre-computados en `cohort_centroids` al final del enriquecimiento del catálogo (job batch que se ejecuta cuando hay ≥10 productos nuevos por cohorte, o como cron diario).

### 4.2 EventSignal derivada de cada evento

Tipo:
```ts
interface EventSignal {
  cohort_id: string; // uno de los 11 IDs
  gender: 'femenino' | 'masculino' | 'unisex' | null;
  age_band: 'bebe' | 'nino' | 'joven' | 'adulto' | 'mayor' | null;
}
```

Derivación:
- Para eventos basados en producto (`product_view`, `add_to_cart`, etc.): leer `metadata.gender_target` + `metadata.age_target.{min,max}` del producto, mapear `age_target.max` al age_band correspondiente.
- Para `search`: leer `searches.normalized_json.recipient_gender` + `recipient_age_min/max` (ya capturado por Fase 2 normalizer).
- Para `category_click`: derivar de la categoría (mapping fijo: `juguetes_bebe` → cohorte por edad genérica `unisex_indeterminado`; `belleza` → `femenino_adulta`; etc.).
- Fallback (no señal suficiente): `unisex_indeterminado`.

### 4.3 Estado de sub-bucket — extensión de `session_vectors`

Migración 0017:
```sql
ALTER TABLE session_vectors ADD COLUMN current_recipient_id uuid REFERENCES recipients(id) ON DELETE SET NULL;
ALTER TABLE session_vectors ADD COLUMN current_cohort_id text;
ALTER TABLE session_vectors ADD COLUMN signal_window jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE session_vectors ADD COLUMN signal_window_size smallint NOT NULL DEFAULT 0;
```

`signal_window` = array JSON de hasta 5 últimos EventSignals; `signal_window_size` = denormalized count para queries baratas.

### 4.4 Algoritmo de shift detection

Constantes:
```ts
const WARMUP_SIZE = 3;        // necesitamos 3 señales para fijar receptor
const WINDOW_SIZE = 5;        // ventana corredera de últimas N
const SHIFT_THRESHOLD = 3;    // ≥3 de 5 contradicen → shift
```

Pseudocódigo:
```ts
function onEventSignal(session_id, eventSignal):
  state = readSessionState(session_id)
  state.signal_window.push(eventSignal)
  if state.signal_window.length > WINDOW_SIZE:
    state.signal_window.shift() // remove oldest

  if state.signal_window_size < WARMUP_SIZE:
    // Modo warmup — aún no hay receptor fijado
    state.signal_window_size = state.signal_window.length
    if state.signal_window_size === WARMUP_SIZE:
      // Fijar receptor por primera vez
      state.current_cohort_id = majorityCohort(state.signal_window)
      state.current_recipient_id = matchRecipientOrNull(user_id, state.current_cohort_id)
    persistSessionState(state)
    return

  // Receptor ya establecido — chequear shift
  contradicting = countSignalsNotMatchingCohort(state.signal_window, state.current_cohort_id)
  if contradicting >= SHIFT_THRESHOLD:
    // SHIFT detected
    new_cohort = majorityCohort(state.signal_window)
    if new_cohort !== state.current_cohort_id:
      state.current_cohort_id = new_cohort
      state.current_recipient_id = matchRecipientOrNull(user_id, new_cohort)
      state.signal_window = [eventSignal]  // reset window
      state.signal_window_size = 1
  persistSessionState(state)
```

### 4.5 Match contra recipients existentes

```ts
function matchRecipientOrNull(user_id, cohort_id):
  if user_id is null: return null  // anónimos → recipient implícito (NULL)
  
  {gender, age_band} = parseCohort(cohort_id)
  if gender === 'unisex' or age_band === null: return null  // sin señal específica
  
  age_range = AGE_BAND_RANGES[age_band]  // ej: nino → {min:4, max:11}
  row = SELECT id FROM recipients
        WHERE user_id = $1
          AND gender = $2
          AND age BETWEEN $3 AND $4
        ORDER BY created_at DESC
        LIMIT 1
  return row?.id ?? null
```

Si no hay match: `recipient_id = null` representa "receptor implícito de cohorte X" — el vector vive en `user_profile_modes` con `recipient_id IS NULL` y se diferencia por `cohort_id` almacenado en otra columna nueva (ver Bloque 2).

### 4.6 Testing del bloque 1

- **Unit** `inferSignalFromProduct(metadata)`: 11 casos, uno por cohorte + 1 fallback.
- **Unit** `majorityCohort([signals])`: empate, todos null, mezcla 3+2, edge cases.
- **Unit** `countSignalsNotMatchingCohort()`: contradicción exacta, parcial, todo matchea.
- **Unit** `parseCohort(cohort_id)`: 11 cohortes → tuple correcto.
- **Integration** `onEventSignal` con BD real: 5 escenarios:
  - Warmup: 3 señales mismas cohorte → `current_cohort_id` se fija.
  - Sin shift: 5 señales mismas cohorte → no cambios.
  - Shift gradual: 3 fem_adulta + 3 masc_nino → shift al final.
  - Shift abrupto: 3 fem_adulta + 2 masc_nino + reset → window resetea.
  - Alternating: contradicciones <3 → sin shift.
- **Integration** `matchRecipientOrNull`: user con 2 recipients matcheando edad → devuelve el más reciente; anónimo → null.
- **Mutation tests**: cambiar `SHIFT_THRESHOLD = 3` → `>= 4` → tests de shift gradual fallan; cambiar `WARMUP_SIZE = 3` → 2 → test de warmup falla.

## 5. Bloque 2 — Vector update incremental + cold start

### 5.1 Constantes

```ts
export const EVENT_WEIGHTS: Record<EventType, number> = {
  purchase: 5.0,
  add_to_cart: 3.0,
  add_to_wishlist: 2.0,
  product_dwell: 1.5,
  product_view: 1.0,
  category_click: 0.5,
  // Sin peso (no contribuyen al vector):
  remove_from_cart: 0,
  search: 0,
  filter_applied: 0,
  page_view: 0,
  session_start: 0,
  session_end: 0,
  dismiss: 0,  // alimenta excluded_products, no el vector
};

export const TAU_PROFILE_DAYS = 60;
export const TAU_SESSION_MINUTES = 30;
export const KAPPA = 10;
export const ALPHA_BASE = 0.1;
export const ALPHA_PER_EVENT = 0.05;
export const ALPHA_MAX = 0.7;
```

### 5.2 Extensión de `user_profile_modes`

Migración 0017 (mismo archivo): añadir `cohort_id` para distinguir múltiples receptores implícitos:

```sql
ALTER TABLE user_profile_modes ADD COLUMN cohort_id text;
-- Drop el UNIQUE constraint actual y crear uno nuevo que incluye cohort_id
ALTER TABLE user_profile_modes DROP CONSTRAINT user_profile_modes_uniq;
ALTER TABLE user_profile_modes ADD CONSTRAINT user_profile_modes_uniq
  UNIQUE (user_profile_id, recipient_id, cohort_id, mode_index);
```

Filas distinguidas por `(user_profile_id, recipient_id, cohort_id, mode_index)`. En 3a `mode_index = 1` siempre.

### 5.3 Update incremental del vector de perfil

```ts
function updateProfileMode(
  modeRow: UserProfileModeRow,
  productEmbedding: number[],
  eventWeight: number,
  now: Date,
): { newUnnorm: number[]; newWeight: number } {
  const ageDays = (now.getTime() - modeRow.last_assigned_at.getTime()) / (24 * 3600 * 1000);
  const decay = Math.exp(-ageDays / TAU_PROFILE_DAYS);
  
  const newUnnorm = modeRow.vector_unnormalized.map(
    (v, i) => v * decay + eventWeight * productEmbedding[i],
  );
  const newWeight = modeRow.weight_sum * decay + eventWeight;
  
  return { newUnnorm, newWeight };
}
```

Persistencia:
```sql
UPDATE user_profile_modes
SET vector_unnormalized = $1::vector,
    weight_sum = $2,
    n_events_in_mode = n_events_in_mode + 1,
    last_assigned_at = $3
WHERE id = $4
```

El vector normalizado se calcula on-demand en retrieval queries: `normalize(vector_unnormalized)`. No se persiste para evitar inconsistencias.

### 5.4 Update del vector de sesión

Análogo:
```ts
function updateSessionVector(
  sessionRow: SessionVectorRow,
  productEmbedding: number[],
  eventWeight: number,
  now: Date,
): { newUnnorm: number[]; newWeight: number } {
  const ageMin = (now.getTime() - sessionRow.updated_at.getTime()) / 60000;
  const decay = Math.exp(-ageMin / TAU_SESSION_MINUTES);
  // ... resto igual
}
```

### 5.5 Cold start (init del profile mode)

Cuando NO existe row `(user_profile_id, recipient_id, cohort_id, mode_index=1)`:

```ts
async function initProfileMode(
  user_profile_id: string,
  recipient_id: string | null,
  cohort_id: string,
  pg: Client,
): Promise<UserProfileModeRow> {
  // 1. Obtener cohort prior (centroide pre-computado)
  let prior = await fetchCohortCentroid(cohort_id, pg);
  if (prior === null) {
    // Cohorte sin productos → fallback al centroide global
    prior = await fetchGlobalCentroid(pg);
  }
  if (prior === null) {
    // Catálogo vacío (edge case) → vector cero
    prior = new Array(EMBEDDING_DIM).fill(0);
  }
  
  // 2. Inicializar con shrinkage strength = κ
  //    vector_unnormalized = κ * prior, weight_sum = κ
  //    Esto hace que el vector normalizado sea exactamente N(prior) al inicio.
  const initUnnorm = prior.map((v) => v * KAPPA);
  
  const r = await pg.query(
    `INSERT INTO user_profile_modes
       (user_profile_id, recipient_id, cohort_id, mode_index,
        vector_unnormalized, weight_sum, n_events_in_mode, last_assigned_at)
     VALUES ($1, $2, $3, 1, $4::vector, $5, 0, now())
     RETURNING *`,
    [user_profile_id, recipient_id, cohort_id, "[" + initUnnorm.join(",") + "]", KAPPA],
  );
  return r.rows[0];
}
```

**Verificación matemática:** después de n eventos con peso total `W = Σwᵢ` (ignorando decays para simplicidad):

```
vector_unnormalized = κ·prior + Σ wᵢ·pᵢ
weight_sum         = κ + W
u                  = N(vector_unnormalized / weight_sum)
                   = N( (κ·prior + Σwᵢ·pᵢ) / (κ + W) )
                   = N( (κ/(κ+W))·prior + (W/(κ+W))·(Σwᵢ·pᵢ/W) )
                   = N( (κ/(κ+W))·prior + (W/(κ+W))·u_obs )
```

Es exactamente la fórmula de shrinkage del master doc. **Cold start n=0**: u = N(prior). **Steady state n→∞**: prior se disuelve. Una sola fórmula maneja ambos.

### 5.6 α dinámico para combinar perfil + sesión

```ts
function effectiveUserVector(
  profileModeUnnorm: number[],
  sessionVectorUnnorm: number[] | null,
  nEventsInSession: number,
): number[] {
  const alpha = Math.min(
    ALPHA_MAX,
    ALPHA_BASE + ALPHA_PER_EVENT * nEventsInSession,
  );
  const uProfile = normalize(profileModeUnnorm);
  const uSession = sessionVectorUnnorm
    ? normalize(sessionVectorUnnorm)
    : uProfile;
  const mixed = uProfile.map((v, i) => alpha * uSession[i] + (1 - alpha) * v);
  return normalize(mixed);
}
```

α = 0.1 cuando recién entra (0 eventos sesión) → profile manda.
α = 0.7 cuando ≥12 eventos sesión → sesión manda. Smooth.

### 5.7 Recálculo nocturno

Cron diario `scripts/cron-profile-recompute.ts`:
1. Para cada `user_profile_modes` row con `n_events_in_mode > 0` y `last_assigned_at < now() - 24h`:
2. Leer todos los eventos del receptor en los últimos 90 días (filtrar por `metadata.recipient_id` si existe, o por cohort match).
3. Recalcular `vector_unnormalized` y `weight_sum` desde el prior aplicando la fórmula completa con decays.
4. UPDATE row.

Detecta drift por bugs incrementales. ~5 min para 10k usuarios. No bloquea runtime.

### 5.8 Testing del bloque 2

- **Property test**: para 100 vectores random, `updateProfileMode` aplicado repetidamente preserva `|new_unnorm| ≤ |old_unnorm| + |new_product_embedding|·weight`.
- **Property test**: convergencia — N updates con producto X repetido → `cosine(vector, X) → 1`.
- **Unit test decay**: evento de hace 60 días con τ=60 pesa exactamente `e⁻¹ ≈ 0.368` del de hoy.
- **Unit test shrinkage**: `initProfileMode` con cohorte conocida → `vector_unnormalized = κ * cohort_centroid` (asserción coordenada por coordenada).
- **Unit test shrinkage**: después de 1 evento, `cosine(u, prior) > cosine(u, event_product)` (κ=10 domina).
- **Unit test shrinkage**: después de 100 eventos del mismo producto, `cosine(u, event_product) > 0.95` y `cosine(u, prior) < 0.5`.
- **Integration**: init profile mode con cohorte `femenino_adulta` (que tiene N productos en BD) → vector_unnormalized matchea `KAPPA * cohort_centroid`.
- **Integration**: cron nocturno corre desde estado divergente (vector incremental con error introducido) → vector resultante matchea recálculo from scratch.
- **Mutation**: `exp(-Δt/τ)` → `exp(Δt/τ)` (signo invertido) → property test decay falla.
- **Mutation**: `weight_sum = weight_sum * decay + event_weight` → `weight_sum + event_weight` (sin decay del peso) → property test convergencia falla.
- **Mutation**: `KAPPA = 10` → `0` → cold start test falla (vector ya no es prior puro).

## 6. Bloque 3 — Retrieval + feed generation

### 6.1 Función principal

`src/sectors/d-personalization/feed.ts`:

```ts
export interface GenerateFeedOpts {
  user_id: string | null;
  anonymous_id: string | null;
  session_id: string | null;
  limit?: number;
}

export interface FeedItem {
  product: ProductListRow;
  similarity: number;
  reason?: string; // 3c añadirá razón generada por LLM; en 3a queda vacío
}

export async function generateFeed(
  opts: GenerateFeedOpts,
  pg: Client,
): Promise<FeedItem[]> {
  const limit = opts.limit ?? 20;
  
  // 1. Profile
  const profile = await getOrCreateUserProfile(opts, pg);
  
  // 2. Session state
  const sessionState = opts.session_id
    ? await getSessionState(opts.session_id, pg)
    : null;
  const recipientId = sessionState?.current_recipient_id ?? null;
  const cohortId = sessionState?.current_cohort_id ?? "unisex_indeterminado";
  const nEventsSession = sessionState?.signal_window_size ?? 0;
  
  // 3. Profile mode para (profile, recipient, cohort)
  let mode = await fetchProfileMode(profile.id, recipientId, cohortId, pg);
  if (!mode) {
    mode = await initProfileMode(profile.id, recipientId, cohortId, pg);
  }
  
  // 4. Session vector
  const sessionVec = sessionState ? await fetchSessionVector(opts.session_id!, pg) : null;
  
  // 5. Efectivo
  const uEffective = effectiveUserVector(
    mode.vector_unnormalized,
    sessionVec?.vector_unnormalized ?? null,
    nEventsSession,
  );
  
  // 6. Excluded IDs
  const excludedIds = await fetchExcludedProductIds(opts, pg);
  
  // 7. Retrieval
  return retrieveTopK(uEffective, excludedIds, limit * 3, pg).then(
    (r) => r.slice(0, limit),
  );
}
```

### 6.2 SQL retrieval

```sql
SELECT id, title, description, price_cents, currency, image_url, metadata, created_at,
       1 - (embedding <=> $1::vector) AS similarity
FROM products
WHERE is_active = true
  AND embedding IS NOT NULL
  AND NOT (id = ANY($2::uuid[]))
ORDER BY embedding <=> $1::vector
LIMIT $3;
```

Sin filtros estructurados aquí (eso es para Fase 3b cuando integremos con `c-search`). El cohort prior del vector ya sesga el retrieval naturalmente.

### 6.3 Página `(shop)/page.tsx` actualizada

El home actual (Fase 1) lista productos por `created_at DESC`. Reemplazar con `generateFeed`:

```tsx
// src/app/(shop)/page.tsx (modify)
import { withPg } from "@/lib/db/helpers";
import { generateFeed } from "@/sectors/d-personalization/feed";

export default async function HomePage() {
  const anonymousId = ... // cookie
  const userId = ... // auth0 session
  const sessionId = ... // cookie
  
  const items = await withPg((pg) =>
    generateFeed({ user_id, anonymous_id, session_id, limit: 20 }, pg),
  );
  
  return <ProductGrid items={items} />;
}
```

### 6.4 Testing del bloque 3

- **Integration** `generateFeed` para usuario sintético con 10 events categoría A → top-10 dominado por A (>70% match).
- **Integration** cold start: usuario nuevo, cohorte `femenino_adulta` inferida, 0 eventos → top-10 son productos del cluster femenino_adulta.
- **Integration** excluded: producto en `excluded_products` con TTL vivo → NO aparece en feed.
- **Integration** excluded post-TTL: producto con TTL pasado → SÍ aparece en feed.
- **Integration** diversidad: 2 usuarios sintéticos contrastados → overlap top-10 < 30%.
- **Integration** α dinámico: usuario con 12 eventos en sesión todos categoría X → feed domina por X aunque profile esté en Y.
- **Mutation**: omitir filtro excluded → test de exclusión falla.
- **Mutation**: `α = 0.7` hardcoded → test α-dinámico falla en boundary nEvents=0.

## 7. Bloque 4 — Dismiss event + autoexclusión

### 7.1 Schema

`src/sectors/a-tracking/events/schema.ts` — agregar:

```ts
export const EVENT_TYPES = [
  "product_view", "add_to_cart", "remove_from_cart", "add_to_wishlist",
  "purchase", "search", "product_dwell", "category_click", "filter_applied",
  "page_view", "session_start", "session_end",
  "dismiss",  // NEW
] as const;

PAYLOAD_SCHEMAS.dismiss = z.object({
  product_id: uuid,
  reason: z.enum(["not_interested", "already_have", "wrong_recipient", "other"]).optional(),
});
```

### 7.2 Trigger en `/api/track`

`src/app/api/track/route.ts` ya valida y persiste eventos. Añadir post-processing:

```ts
// Después de insertar el evento crudo
if (event.event_type === "dismiss") {
  const ttlDays = 14;
  await pg.query(
    `INSERT INTO excluded_products (anonymous_id, user_id, product_id, ttl_until)
     VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)
     ON CONFLICT DO NOTHING`,
    [anonymous_id, user_id, event.payload.product_id, ttlDays],
  );
}
```

`ON CONFLICT DO NOTHING` requiere un índice único; añadir en migración 0017:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS excluded_products_anon_product_uniq
  ON excluded_products (anonymous_id, product_id) WHERE anonymous_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS excluded_products_user_product_uniq
  ON excluded_products (user_id, product_id) WHERE user_id IS NOT NULL;
```

### 7.3 UI mínima

Botón "no me interesa" en `ProductCard.tsx`:

```tsx
<button
  onClick={async () => {
    await fetch("/api/track", {
      method: "POST",
      body: JSON.stringify({
        event_type: "dismiss",
        occurred_at: new Date().toISOString(),
        payload: { product_id: product.id, reason: "not_interested" },
      }),
    });
    setHidden(true); // optimistic UI
  }}
>
  ✕ no me interesa
</button>
```

### 7.4 Testing del bloque 4

- **Unit**: schema valida payload con reason válida + sin reason; falla con `product_id` no-uuid.
- **Integration**: POST dismiss → row en `excluded_products` con `ttl_until ≈ now + 14d` (±5s).
- **Integration**: dismiss dos veces mismo producto → 1 sola row (ON CONFLICT).
- **Integration**: feed después de dismiss → producto NO aparece (ya cubierto por test del bloque 3).
- **Integration con fake timers**: avanzar 15 días → producto vuelve al feed.
- **Mutation**: TTL hardcoded a 0 días → test de re-aparición falla.

## 8. Bloque 5 — Admin user view + eval sintético

### 8.1 Página `/admin/users/[id]` (server component)

`src/app/admin/users/[id]/page.tsx`:

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
  if (!info) return <p>Usuario no encontrado</p>;
  return <UserDebugView info={info} />;
}
```

### 8.2 `getUserDebugInfo` shape

```ts
interface UserDebugInfo {
  user: { id, email, auth0_sub, created_at };
  anonymous_ids_merged: string[];
  profile: {
    cohort_id_inferred_from_modes: string;
    n_events_total: number;
    last_recompute_at: Date | null;
  };
  active_session: {
    session_id: string | null;
    current_recipient_id: string | null;
    current_cohort_id: string | null;
    signal_window: EventSignal[];
  } | null;
  modes: {
    recipient_id: string | null;
    recipient_name: string | null;
    cohort_id: string;
    n_events_in_mode: number;
    weight_sum: number;
    last_assigned_at: Date;
    top_5_products: { id: string; title: string; similarity: number }[];
  }[];
  recent_events: { event_type, occurred_at, payload }[];
  exclusions_active: { product_id: string; product_title: string; ttl_until: Date }[];
  feed_now: { product_id: string; title: string; similarity: number }[];
}
```

### 8.3 Componente `UserDebugView.tsx`

Renderiza 7 secciones colapsables. Server component, sin lógica cliente. Similar a `SearchTraceView` de F2.5.

### 8.4 Eval sintético `scripts/eval-personalization-3a.ts`

Flujo:
1. **Setup BD**: TRUNCATE test_schema; pueble catálogo con 50 productos por cohorte (10 cohortes con metadata gender_target + age_target × 50 = 500 productos). Generar embeddings reales con Voyage.
2. **Compute cohort centroids**: corra el job batch.
3. **Crear 6 usuarios sintéticos**:
   - U1: 30 events `product_view` en cohorte `femenino_adulta`.
   - U2: 30 events en `masculino_adulto`.
   - U3: 30 events en `femenino_nina` (tía comprando para sobrina).
   - U4: 0 events, cohort inferido `femenino_adulta` (cold start después del 3er warmup event).
   - U5: shift mid-session — 15 events `femenino_adulta` + 15 events `masculino_nino` (regalo abuela, luego juguete sobrino).
   - U6: adversarial — 30 events spread random.
4. **Generar feed** para cada user (limit=20).
5. **Métricas**:
   - **Recall@10**: para U1, U2, U3 reservar 5 productos hold-out de la misma cohorte (no vistos por el user). ¿Cuántos están en el top-10 del feed?
   - **Diversidad inter-user**: Jaccard entre top-10 de U1 vs U2 vs U3. Esperado: < 0.30.
   - **Coherencia intra-cohort**: % productos del feed que pertenecen a la cohorte esperada del user. Esperado: U1 > 60% en `femenino_adulta`.
   - **Cold start coherence**: U4 feed → % productos en `femenino_adulta`. Esperado: > 50% (porque cohort prior).
   - **Shift end-to-end**: U5 segundo half de eventos → top-10 actual debe sesgar a `masculino_nino` (>40%).
6. **Baseline**: top-popular global (productos con más events totales). Calcular Recall@10 baseline.
7. **Output**: Markdown report en `docs/superpowers/reports/<date>-fase-3a-eval.md` con tabla de métricas + verdict.

**Compuerta**: `Recall@10 promedio U1+U2+U3 ≥ baseline + 20pp`. Si no se alcanza, el cierre de fase es CONDICIONAL.

### 8.5 Testing del bloque 5

- **Integration**: `getUserDebugInfo(invalid_id)` → null.
- **Integration**: `getUserDebugInfo(valid_user)` → todas las secciones pobladas correctamente.
- **Integration**: página sin auth → 401/redirect.
- **Integration eval script (smoke test corto)**: con 6 productos por cohorte y 2 usuarios sintéticos pequeños, el script corre end-to-end sin errores y produce un Markdown válido.
- **Mutation**: si `Recall@k` calcula `k=5` en vez de `k=10` → assertion del eval falla.

## 9. File map consolidado

```
supabase/migrations/
└── 0017_personalization_3a.sql                     [NEW]

src/sectors/a-tracking/events/
└── schema.ts                                        [MODIFY] +dismiss

src/sectors/d-personalization/                       [NUEVO sector]
├── cohorts/
│   ├── definitions.ts                               [NEW] 11 cohort IDs + age ranges
│   ├── infer.ts                                     [NEW] inferSignalFromProduct, majorityCohort
│   ├── match-recipient.ts                           [NEW] matchRecipientOrNull
│   └── centroid-compute.ts                          [NEW] job batch
├── session/
│   ├── state.ts                                     [NEW] readSessionState, persistSessionState
│   └── shift-detection.ts                           [NEW] onEventSignal
├── vector/
│   ├── constants.ts                                 [NEW] EVENT_WEIGHTS, TAU_*, KAPPA, ALPHA_*
│   ├── update.ts                                    [NEW] updateProfileMode, updateSessionVector
│   ├── init.ts                                      [NEW] initProfileMode (cold start)
│   └── effective.ts                                 [NEW] effectiveUserVector (α dinámico)
├── feed.ts                                          [NEW] generateFeed
├── retrieve.ts                                      [NEW] retrieveTopK
├── exclusion/
│   └── dismiss-handler.ts                           [NEW] handleDismiss → excluded_products
├── admin/
│   └── user-debug.ts                                [NEW] getUserDebugInfo
└── recompute-nightly.ts                             [NEW] cron job logic

src/app/api/track/route.ts                           [MODIFY] hook dismiss + signal update
src/app/(shop)/page.tsx                              [MODIFY] use generateFeed
src/app/admin/users/[id]/page.tsx                    [NEW]
src/components/
├── UserDebugView.tsx                                [NEW]
└── ProductCard.tsx                                  [MODIFY] +dismiss button

scripts/
├── cron-profile-recompute.ts                        [NEW]
├── cron-cohort-centroids.ts                         [NEW]
└── eval-personalization-3a.ts                       [NEW]

tests/
├── unit/
│   ├── cohorts-infer.test.ts                        [NEW] 11 cohortes + edge
│   ├── cohorts-match.test.ts                        [NEW]
│   ├── shift-detection.test.ts                      [NEW] 5 escenarios
│   ├── vector-update.test.ts                        [NEW] decay, convergencia
│   ├── vector-shrinkage.test.ts                     [NEW] cold start math
│   ├── vector-alpha.test.ts                         [NEW] α dinámico
│   └── dismiss-schema.test.ts                       [NEW]
└── integration/
    ├── cohort-centroids.test.ts                     [NEW] job batch real
    ├── session-state.test.ts                        [NEW] read/persist
    ├── on-event-signal.test.ts                      [NEW] 5 escenarios end-to-end
    ├── profile-mode-init.test.ts                    [NEW] cold start con cohorte real
    ├── profile-mode-update.test.ts                  [NEW] update incremental
    ├── recompute-nightly.test.ts                    [NEW] cron higiene
    ├── feed-generate.test.ts                        [NEW] 6 tests
    ├── dismiss-flow.test.ts                         [NEW] event → exclude → no en feed
    ├── user-debug.test.ts                           [NEW] admin page data
    └── eval-3a-smoke.test.ts                        [NEW] script termina OK
```

**Estimado total: ~32 tests nuevos** (7 unit + 10 integration + eval).

## 10. Plan de tests — costos

| Tipo | Test files | # tests | APIs reales | Costo aprox |
|---|---|---|---|---|
| Unit | 7 | ~25 | — | $0 |
| Integration (pg) | 6 | ~20 | pg | $0 |
| Integration (pg+voyage) | 3 | ~12 | pg + Voyage | ~$0.005 |
| Eval script (full) | 1 run | — | pg + Voyage | ~$0.03 (500 embeddings) |

**Costo full suite: ~$0.04.** Eval run: ~$0.03 cada vez.

## 11. Riesgos identificados

1. **Inferencia de receptor puede ser ruidosa.** Si el catálogo tiene muchos productos sin `metadata.gender_target` o `age_target` poblados (los del fixture estático lo tienen, los del smart mock LLM puede que sí pero variable), la mayoría de eventos caerán en `unisex_indeterminado`. Fallback aceptable pero degrada la personalización.

2. **Cold start cohort centroids requieren catálogo poblado.** Si el catálogo está vacío al iniciar, los priors son cero → cold start no funciona. Mitigación: fallback al centroide global; si tampoco hay productos → vector cero (degenera a retrieval by date).

3. **Latencia per-event sync ~80ms.** Si en alguna ráfaga llegan muchos eventos (ej: dwell + view + cart en rápida sucesión), puede acumular. Mitigación: batch al nivel de transacción si llega un array de eventos; serializar updates al mismo session.

4. **Eval Recall@10 con +20pp target puede no alcanzarse.** Si el smart mock genera productos con metadata heterogénea, el clustering por cohorte puede ser pobre. Si no se alcanza, igual que en F2.5 → diagnosticar con admin user view + iterar.

5. **El shift detection puede ser sobre-sensible o sub-sensible.** SHIFT_THRESHOLD=3 de 5 es heurística. Si en eval se ve que detecta shift donde no debería (o no lo detecta cuando sí), ajustar constante.

6. **Auth0 admin gate sin role-based access.** Cualquier user autenticado ve `/admin/users/[id]` ahora. Diferido a Fase 4 (role check real).

## 12. Items diferidos (sin cambio respecto al master doc)

- Multi-modo k-means 1-3 modos → 3b.
- Grafo co-ocurrencia + NPMI → 3b.
- RRF de 3+ fuentes → 3b.
- MMR diversification → 3c.
- LLM reranker contextual → 3c (Anthropic dormant entra acá).
- Calibración empírica de θ semantic cache → Fase 5.
- TTL cleanup cron de cache → Fase 4.
- Admin role-based access real → Fase 4.
- LangGraph evaluation → diferido a 3c.

## 13. Definition of done

- [ ] Migración 0017 aplicada (extensiones de `session_vectors`, `user_profile_modes`, indexes únicos en `excluded_products`).
- [ ] 11 cohortes definidas + centroides computados (job batch).
- [ ] Inferencia de EventSignal correcta para los 5 tipos de eventos con peso.
- [ ] Sub-bucket state persistido con warmup 3 + window 5 + threshold 3.
- [ ] Update incremental de vectores con decay temporal correcto.
- [ ] Cold start vía init con `weight_sum = κ` y `vector_unnormalized = κ * prior`.
- [ ] α dinámico aplicado al combinar perfil + sesión.
- [ ] Cron nocturno de recálculo desde cero converge al mismo vector mod ε.
- [ ] Evento `dismiss` añadido + auto-llena `excluded_products`.
- [ ] Botón "no me interesa" en ProductCard.
- [ ] `/admin/users/[id]` renderiza 7 secciones, auth-gated.
- [ ] Home `/` usa `generateFeed`.
- [ ] **Eval sintético**: `Recall@10 promedio U1+U2+U3 ≥ baseline + 20pp` ALCANZADO.
- [ ] `pnpm test:unit && pnpm test:integration` verde.
- [ ] `pnpm test:quality` 0 violations.
- [ ] Triple revisión (Adversario + Auditor mocks + Probador) APPROVED.

## 14. Triple revisión Fase 3a

Mismo régimen que F1, F2, F2.5:

- **Adversario**: revisar los 32 tests nuevos vs mutaciones plausibles de las funciones críticas (cohort inference, shift detection, vector update, shrinkage, retrieval, dismiss).
- **Auditor de mocks**: AST checker pasa + revisión manual de cualquier mock nuevo (no debería haber, todo es real DB + real Voyage).
- **Probador**: black-box vs spec — verificar las 5 decisiones de scope, los 11 cohortes funcionando, dismiss flow E2E, eval reproduce métricas.

Iterar hasta limpio. Reporte literal en `docs/superpowers/reports/<date>-fase-3a-cierre.md`.

## 15. Próximos pasos

Tras review del usuario, invocar `writing-plans` para producir plan ejecutable (~18-22 tareas).
