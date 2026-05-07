# Fase 1 — E-commerce básico + tracking · Design

**Fecha:** 2026-05-07
**Estado del repo al diseñar:** Fase 0 cerrada (ver `docs/superpowers/reports/2026-05-07-fase-0-cierre.md`).
**Master doc:** `MVP_Ecommerce_Personalizado_Documento_Maestro v2.md` — Sectores A y B + Roadmap Fase 1 + Modelo de datos sec. 13.
**Prompt operativo:** `prompt-fase-1-3.md` — Sección E (Fase 1) + Sección B (filosofía testing) + Sección C (triple revisión).

---

## 1. Contexto y delta

### 1.1 Lo que Fase 0 ya entregó (no rehacer)

- 19 tablas en `public` + paridad en `test_schema` (todo el modelo de datos del master doc, incluyendo `events`, `products`, `orders`, `searches`, `mock_calls`, `co_occurrence`, etc.).
- Mock aggregator funcional: 25 productos por call, 2-4s jitter, 2% error rate, fixture seedeada de 500 productos (40/20/15/10/10/5%).
- Clientes reales:
  - `getPgClient({ scope })` → pg directo a Postgres con search_path public/test
  - `getSupabaseClient()` → REST (sólo public; test scope tira error explícito)
  - `embed(texts, { inputType })` → Voyage voyage-4, 1024 dim, normalizado defensivamente
  - `sendMessage({ model, system, cacheSystem, messages, ... })` → Anthropic con prompt caching opcional
- Auth0 v4: middleware + `/profile` + E2E real con skip condicional.
- Math: `cosine` y `normalize` con fast-check property tests + mutation testing documentado.
- AST checker (`pnpm test:quality`) que bloquea los 11 anti-patterns prohibidos del prompt.
- Health endpoints + GitHub Actions CI.

### 1.2 Lo que Fase 1 debe añadir

Per master doc Roadmap Fase 1 + prompt Sección E:

1. **Tracking (Sector A)** — cookies `anonymous_id` (1 año) + `session_id` (30 min sliding); endpoint `POST /api/track` write-only con idempotencia por `client_event_id`; 12 event types con schema fijo; fusión de identidades anónimo→user en signup.
2. **Catálogo + enrichment pipeline (Sector B)** — cron CLI (`pnpm cron:catalog-fill`) que llama al mock; pipeline LLM-normaliza categoría → JSON metadata, calcula embedding Voyage normalizado, dedupe por `(source, source_product_id)`, actualiza `last_refreshed_at`.
3. **UI mínima** — home grid (orden por fecha, sin personalización), detalle producto, búsqueda LIKE, carrito (BD para logueados + localStorage para anónimos, con merge en signup), checkout simulado que crea `orders` + `order_items` con snapshot.
4. **Triple revisión** (Sección C del prompt) — Adversario, Auditor de Mocks, Probador de Comportamiento. Iterar hasta limpio antes de cerrar la fase.

### 1.3 Decisiones de scope tomadas durante el brainstorming

- **Pre-flight check:** smoke check (10 min: pg + Voyage + Anthropic + Auth0 + count de tablas + dim Voyage = dim columna products.embedding). No el formal de Sección A — ya hay triple-review APPROVED de Fase 0.
- **Follow-ups de Fase 0 incluidos:** sólo bloqueadores reales — `getSupabaseClient` lazy factory (#5), AST checker escala a wrappers de servicio (#7), regex range dinámico en `generate-test-schema-migration.ts` (#2). Resto se difiere.
- **Carrito:** híbrido. Tabla `cart_items` en BD para usuarios logueados + localStorage por `anonymous_id` para anónimos. En signup, el cliente postea su localStorage cart a `/api/cart/merge` que UPSERT en `cart_items` sumando quantities.
- **Cron:** sólo CLI (`pnpm tsx scripts/cron-catalog-fill.ts`). Scheduler en cloud (Vercel Cron / GH Actions) se difiere a Fase 4.
- **Branch:** `feat/fase-1-tracking-catalog` nuevo (no continuar `feat/fase-0-fundaciones`).

### 1.4 Lo que está fuera de scope (diferido a fases posteriores)

- Búsqueda híbrida BM25 + cosine + RRF (Fase 2).
- LLM normaliza queries de búsqueda → JSON estructurado (Fase 2).
- Cache exacto / semántico de búsquedas (Fase 2).
- Vector de perfil/sesión, decay, cold start con prior bayesiano, retrieval personalizado (Fase 3a).
- Multi-vector + grafo NPMI + RRF de fuentes (Fase 3b).
- MMR + LLM reranker contextual (Fase 3c).
- Admin UI (Fase 4).
- Eval set + métricas Recall@k / nDCG (Fase 5).
- Cron en cloud / scheduler real (Fase 4).
- Onboarding declarativo (Fase 3a — necesario para cold start).

---

## 2. Arquitectura

### 2.1 File layout

```
src/
├── lib/
│   ├── config/                 [NEW]
│   │   └── index.ts            zod-validated env reader (scope: lo que toca Fase 1)
│   └── db/
│       └── supabase.ts         [REFACTOR] lazy factory — sin throws a module-level
│
├── sectors/
│   ├── a-tracking/             [NEW]
│   │   ├── identity.ts         ensureAnonymousId(req,res), ensureSession(req,res)
│   │   ├── events/
│   │   │   ├── schema.ts       zod por event_type (12 tipos)
│   │   │   ├── insert.ts       insertEvent(input) UPSERT por client_event_id
│   │   │   └── merge.ts        mergeIdentities(anonymousId, userId)
│   │
│   ├── b-catalog/
│   │   ├── mock/               (existe, no tocar)
│   │   ├── enrichment/         [NEW]
│   │   │   ├── normalizer.ts   normalizeWithLLM(rawProduct) → metadata
│   │   │   ├── prompt.ts       PROMPT_VERSION + system prompt
│   │   │   ├── canonical.ts    buildCanonicalText(raw, metadata) — separado para testabilidad
│   │   │   └── pipeline.ts     processProduct(raw)
│   │   ├── cron/               [NEW]
│   │   │   └── catalog-fill.ts runCatalogFill({ categories, pagesPerCategory, concurrency })
│   │   └── repository/         [NEW]
│   │       └── products.ts     listByDate, getById, searchLike
│   │
│   └── (c, d, e — sin contenido en Fase 1)
│
├── app/
│   ├── (shop)/                 [NEW] grupo
│   │   ├── page.tsx            Home: grid 20 productos created_at DESC
│   │   ├── products/[id]/page.tsx     Detalle + <ProductTracker> client
│   │   ├── search/page.tsx     ?q= LIKE
│   │   ├── cart/page.tsx       Carrito híbrido
│   │   └── checkout/
│   │       ├── page.tsx        Form mínimo
│   │       └── success/page.tsx
│   ├── (auth)/profile/         (existe)
│   └── api/
│       ├── track/route.ts                [NEW] POST events
│       ├── cart/route.ts                 [NEW] GET/PUT cart_items (logged-in)
│       ├── cart/merge/route.ts           [NEW] POST merge localStorage → cart_items
│       ├── checkout/route.ts             [NEW] POST crea order + emite purchase
│       ├── search/route.ts               [NEW] GET ?q= LIKE (server route si la página no es server component)
│       └── identity/merge/route.ts       [NEW] POST mergeIdentities(anonId, userId)
│
└── middleware.ts               [REFACTOR] ensureAnonymousId + ensureSession antes de auth0.middleware

scripts/
└── cron-catalog-fill.ts        [NEW] CLI wrapper de runCatalogFill

supabase/migrations/
├── 0013_cart_items.sql                   [NEW]
└── 0014_test_schema_replicate_v2.sql     [NEW] regenerada por script

tests/
├── unit/
│   ├── events-schema.test.ts             [NEW]
│   └── canonical-text.test.ts            [NEW]
├── integration/
│   ├── identity.test.ts                  [NEW]
│   ├── track-endpoint.test.ts            [NEW]
│   ├── identity-merge.test.ts            [NEW]
│   ├── products-repo.test.ts             [NEW]
│   ├── enrichment-pipeline.test.ts       [NEW]
│   ├── cron-catalog-fill.test.ts         [NEW]
│   ├── cart-api.test.ts                  [NEW]
│   └── checkout.test.ts                  [NEW]
├── e2e/
│   ├── tracking-flow.spec.ts             [NEW]
│   └── shopping-flow.spec.ts             [NEW]
└── helpers/
    ├── wait.ts                           [NEW] waitFor(fn, opts)
    └── seed.ts                           [NEW] seedProduct(), seedEvent(), createUser()
```

### 2.2 Modelo de datos — delta

Sólo una migración nueva más una regeneración de `test_schema`:

**`supabase/migrations/0013_cart_items.sql`**

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

**Invariante:** `cart_items` solo para usuarios autenticados. Anónimos viven en localStorage scoped por `anonymous_id`. Eventos `add_to_cart`/`remove_from_cart`/`purchase` se emiten siempre, independiente del estado de auth — la tabla `events` es el log auditable; `cart_items` es snapshot mutable.

Después de aplicar 0013 se corre `pnpm tsx scripts/generate-test-schema-migration.ts` (con regex range ya dinamizado por follow-up #2) y eso emite `0014_test_schema_replicate_v2.sql`.

---

## 3. Sector A — Tracking

### 3.1 Identity middleware (`src/sectors/a-tracking/identity.ts`)

Constantes:

```ts
const ANON_COOKIE = "anonymous_id"
const SESSION_COOKIE = "session_id"
const SESSION_LAST_ACTIVITY_COOKIE = "session_last_activity"
const ANON_TTL_DAYS = 365
const SESSION_TIMEOUT_MIN = 30
```

`ensureAnonymousId(req, res)`:
1. Lee cookie `anonymous_id`. Si existe, retorna.
2. Si no, genera `crypto.randomUUID()`. Set-Cookie con `Secure; SameSite=Lax; Max-Age=365*86400; Path=/`. **No `HttpOnly`** — el cliente necesita leerla via `document.cookie` para scope-ar el carrito en localStorage. Es seguro: no es credencial, sólo identifica el device; el riesgo de XSS está acotado a "el atacante puede leer un UUID público".
3. Upsert en `anonymous_sessions (anonymous_id, last_seen_at=now())` ON CONFLICT update last_seen_at.
4. Retorna el id.

`ensureSession(req, res, anonymousId)`:
1. Lee cookies `session_id` y `session_last_activity`.
2. Si no hay session O `now - last_activity > 30 min`:
   - Si había sesión expirada: `insertEvent(session_end, payload={duration_ms})` con `occurred_at = now() - 1ms`.
   - Genera nueva `session_id = randomUUID()`. Set-Cookie con `HttpOnly; Secure; SameSite=Lax; Max-Age=30*60; Path=/`. (HttpOnly OK aquí — el cliente no necesita leer session_id.)
   - `insertEvent(session_start, payload={})`.
3. En todos los casos: refresca `session_last_activity` con sliding window (`now()`, `Max-Age=30*60`).
4. Retorna session_id.

### 3.2 Middleware de Next (`src/middleware.ts` — refactor)

```ts
export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const anonId = await ensureAnonymousId(req, res)
  await ensureSession(req, res, anonId)
  return await auth0.middleware(req, res)  // Auth0 corre encima
}
```

`config.matcher` queda igual al actual (excluye `_next/static`, `_next/image`, `favicon.ico`, `api/health`, `api/cron`). `api/track` queda **incluido** en el matcher — ahí es donde queremos `ensureAnonymousId` y `ensureSession` corriendo.

**Detalle Auth0:** `auth0.middleware()` adjunta sesión si existe pero no enforce auth en rutas no protegidas. Llamarlo en `/api/track` es seguro (no rompe el endpoint para anónimos). Para evitar latencia, el handler de `/api/track` lee la sesión sólo si la necesita (cuando hay que asociar `user_id`); no llama a `auth0.middleware` directamente — esto ya lo hizo el wrapper de `src/middleware.ts`.

### 3.3 Event schema (`src/sectors/a-tracking/events/schema.ts`)

```ts
export const EVENT_TYPES = [
  'product_view', 'add_to_cart', 'remove_from_cart', 'add_to_wishlist',
  'purchase', 'search', 'product_dwell', 'category_click', 'filter_applied',
  'page_view', 'session_start', 'session_end'
] as const
export type EventType = typeof EVENT_TYPES[number]

export const PAYLOAD_SCHEMAS: Record<EventType, z.ZodSchema> = {
  product_view:    z.object({ product_id: z.string().uuid(), source: z.enum(['home','category','search','direct']) }),
  add_to_cart:     z.object({ product_id: z.string().uuid(), quantity: z.number().int().min(1) }),
  remove_from_cart:z.object({ product_id: z.string().uuid(), quantity: z.number().int().min(1) }),
  add_to_wishlist: z.object({ product_id: z.string().uuid() }),
  purchase:        z.object({
    order_id: z.string().uuid(),
    product_ids: z.array(z.string().uuid()).min(1),
    total_cents: z.number().int().min(0)
  }),
  search:          z.object({
    raw_query: z.string().min(1),
    results_count: z.number().int().min(0),
    method: z.enum(['like','bm25_only','cosine_only','hybrid_rrf'])
  }),
  product_dwell:   z.object({ product_id: z.string().uuid(), dwell_ms: z.number().int().min(30000) }),
  category_click:  z.object({ category: z.string().min(1) }),
  filter_applied:  z.object({ filter_type: z.string().min(1), filter_value: z.union([z.string(), z.number()]) }),
  page_view:       z.object({ path: z.string().min(1) }),
  session_start:   z.object({}),
  session_end:     z.object({ duration_ms: z.number().int().min(0) })
}

export const eventInputSchema = z.object({
  client_event_id: z.string().uuid().optional(),
  event_type: z.enum(EVENT_TYPES),
  occurred_at: z.string().datetime(),
  payload: z.unknown()  // se valida en segundo paso con PAYLOAD_SCHEMAS[event_type]
})
```

### 3.4 Insert event (`src/sectors/a-tracking/events/insert.ts`)

```ts
export async function insertEvent(input: EventInput, ctx: Ctx): Promise<{ event_id: string|null, deduped: boolean }> {
  // ctx provee: anonymous_id, session_id, user_id (puede ser null), pg client
  const payloadSchema = PAYLOAD_SCHEMAS[input.event_type]
  const payload = payloadSchema.parse(input.payload)  // throws ZodError si inválido

  const sql = `
    INSERT INTO events (client_event_id, anonymous_id, user_id, session_id, event_type, occurred_at, payload, source)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (client_event_id) WHERE client_event_id IS NOT NULL
    DO NOTHING
    RETURNING id
  `
  const r = await ctx.pg.query(sql, [
    input.client_event_id ?? null,
    ctx.anonymous_id,
    ctx.user_id ?? null,
    ctx.session_id,
    input.event_type,
    input.occurred_at,
    JSON.stringify(payload),
    null
  ])
  if (r.rows.length === 0) return { event_id: null, deduped: true }
  return { event_id: r.rows[0].id, deduped: false }
}
```

### 3.5 Identity merge (`src/sectors/a-tracking/events/merge.ts`)

```ts
export async function mergeIdentities(anonymousId: string, userId: string): Promise<MergeResult> {
  return await withTx(async (pg) => {
    // 1. Asociar anonymous_session
    await pg.query(`
      UPDATE anonymous_sessions SET user_id = $2
      WHERE anonymous_id = $1 AND user_id IS NULL
    `, [anonymousId, userId])

    // 2. Asociar TODOS los eventos previos (solo si user_id IS NULL — idempotente y no toca eventos de otros users)
    const r = await pg.query(`
      UPDATE events SET user_id = $2
      WHERE anonymous_id = $1 AND user_id IS NULL
      RETURNING id
    `, [anonymousId, userId])

    return { events_merged: r.rowCount }
  })
}
```

### 3.6 Endpoint `POST /api/track`

`src/app/api/track/route.ts`:

```ts
export async function POST(req: NextRequest) {
  // 1. Read identity from cookies (no body spoofing)
  const anonymous_id = req.cookies.get('anonymous_id')?.value
  const session_id = req.cookies.get('session_id')?.value
  if (!anonymous_id || !session_id) return NextResponse.json({ error: 'no_identity' }, { status: 400 })

  // 2. Read user_id from Auth0 session (optional)
  const session = await auth0.getSession(req)
  const user_id = session?.user?.sub ? await resolveUserIdByAuth0Sub(session.user.sub) : null

  // 3. Validate envelope
  let parsed
  try { parsed = eventInputSchema.parse(await req.json()) }
  catch (e) { return NextResponse.json({ error: 'invalid_input', detail: zodIssues(e) }, { status: 400 }) }

  // 4. Insert
  try {
    const result = await withPg(async (pg) =>
      insertEvent(parsed, { pg, anonymous_id, session_id, user_id })
    )
    return NextResponse.json(result, { status: 200 })
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: 'invalid_payload', detail: zodIssues(e) }, { status: 400 })
    throw e
  }
}
```

---

## 4. Sector B — Catálogo + enrichment

### 4.1 LLM normalizer

**`src/sectors/b-catalog/enrichment/prompt.ts`**

```ts
export const PROMPT_VERSION = "v1.0.0-fase1"

export const SYSTEM_PROMPT = `Eres un normalizador de productos de e-commerce. Recibes un producto crudo y devuelves JSON estructurado en español.

Campos obligatorios:
- category: una de [ropa, electronica, hogar, juguetes_bebe, belleza, otros]
- subcategory: string libre, específica
- gender_target: 'femenino' | 'masculino' | 'unisex' | null
- age_target: { min: number|null, max: number|null }
- occasion: array (ej: ['regalo','diario','formal'])
- style: array (ej: ['casual','elegante'])
- keywords: array de hasta 8 keywords
- enrichment_status: siempre 'ok'

Si no puedes inferir, usa null o array vacío. Devuelve SOLO el JSON, sin markdown ni texto adicional.`

export const normalizedSchema = z.object({
  category: z.enum(['ropa','electronica','hogar','juguetes_bebe','belleza','otros']),
  subcategory: z.string().nullable(),
  gender_target: z.enum(['femenino','masculino','unisex']).nullable(),
  age_target: z.object({ min: z.number().int().nullable(), max: z.number().int().nullable() }),
  occasion: z.array(z.string()),
  style: z.array(z.string()),
  keywords: z.array(z.string()).max(8),
  enrichment_status: z.literal('ok')
})
```

**`src/sectors/b-catalog/enrichment/normalizer.ts`**

```ts
export async function normalizeWithLLM(raw: MockProduct): Promise<NormalizedMetadata> {
  const userMsg = JSON.stringify({
    title: raw.title,
    description: raw.description,
    raw_category: raw.raw_category,
    brand: raw.brand,
    attributes: raw.attributes
  })
  const res = await sendMessage({
    model: MODELS.haiku,
    system: SYSTEM_PROMPT,
    cacheSystem: true,  // real beneficio: cron procesa 25 productos compartiendo system
    messages: [{ role: 'user', content: userMsg }],
    maxTokens: 400,
    temperature: 0
  })

  try {
    const json = JSON.parse(res.text)
    return { ...normalizedSchema.parse(json), prompt_version: PROMPT_VERSION }
  } catch (e) {
    return {
      category: 'otros',
      subcategory: raw.raw_category,
      gender_target: null,
      age_target: { min: null, max: null },
      occasion: [],
      style: [],
      keywords: [],
      enrichment_status: 'error',
      enrichment_error: e instanceof Error ? e.message.slice(0, 200) : 'unknown',
      prompt_version: PROMPT_VERSION
    }
  }
}
```

### 4.2 Canonical text (separado para testar mutation)

**`src/sectors/b-catalog/enrichment/canonical.ts`**

```ts
export function buildCanonicalText(raw: MockProduct, metadata: NormalizedMetadata): string {
  const parts = [
    raw.title,
    raw.description,
    `${metadata.category}${metadata.subcategory ? ' ' + metadata.subcategory : ''}`,
    metadata.keywords.join(' ')
  ].filter(Boolean)
  return parts.join('\n')
}
```

### 4.3 Pipeline

**`src/sectors/b-catalog/enrichment/pipeline.ts`**

```ts
export async function processProduct(raw: MockProduct, opts: { pg: Client } = {}) {
  const metadata = await normalizeWithLLM(raw)
  const canonical = buildCanonicalText(raw, metadata)
  const [embedding] = await embed([canonical], { inputType: 'document' })
  // embedding ya viene normalizado a norma 1 desde voyage.ts

  const r = await opts.pg.query(`
    INSERT INTO products (source, source_product_id, title, description, price_cents, currency, image_url, raw_category, metadata, embedding)
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
    RETURNING id, (xmax = 0) AS inserted
  `, [
    raw.source, raw.source_product_id, raw.title, raw.description,
    raw.price_cents, 'USD', raw.image_url, raw.raw_category,
    JSON.stringify(metadata), `[${embedding.join(',')}]`
  ])

  return {
    productId: r.rows[0].id,
    inserted: r.rows[0].inserted,
    enrichmentStatus: metadata.enrichment_status
  }
}
```

`tsvector_es` se autogenera por la columna STORED de migración 0004; no se toca.

### 4.4 Cron CLI

**`src/sectors/b-catalog/cron/catalog-fill.ts`**

```ts
export async function runCatalogFill(opts: {
  categories: MockCategory[],
  pagesPerCategory: number,
  concurrency?: number
}) {
  const concurrency = opts.concurrency ?? 3
  let totalProducts = 0
  let totalCalls = 0
  const errors: { context: string, message: string }[] = []

  await withPg(async (pg) => {
    for (const category of opts.categories) {
      for (let page = 1; page <= opts.pagesPerCategory; page++) {
        let result: FetchResult
        const t0 = Date.now()
        try {
          result = await fetchFromAggregator({ category })
        } catch (e) {
          await pg.query(`INSERT INTO mock_calls (params, was_error, latency_ms, simulated_cost_cents) VALUES ($1::jsonb, true, $2, $3)`,
            [JSON.stringify({ category, page }), Date.now() - t0, 4])
          errors.push({ context: `fetch ${category} p${page}`, message: String(e) })
          continue
        }
        await pg.query(`INSERT INTO mock_calls (params, response_size, simulated_cost_cents, latency_ms, was_error)
          VALUES ($1::jsonb, $2, $3, $4, false)`,
          [JSON.stringify({ category, page }), result.products.length, result.cost_cents, Math.round(result.latency_ms)])
        totalCalls++

        // Concurrency-limited via Promise.allSettled in chunks (no external lib)
        for (const batch of chunk(result.products, concurrency)) {
          const settled = await Promise.allSettled(batch.map(p => processProduct(p, { pg })))
          for (const [i, s] of settled.entries()) {
            if (s.status === 'fulfilled') totalProducts++
            else errors.push({ context: `process ${batch[i].source_product_id}`, message: String(s.reason) })
          }
        }
      }
    }
  })

  return { totalCalls, totalProducts, errors }
}
```

**`scripts/cron-catalog-fill.ts`** (CLI):

```ts
#!/usr/bin/env tsx
import { parseArgs } from 'node:util'
import { runCatalogFill } from '@/sectors/b-catalog/cron/catalog-fill'

const { values } = parseArgs({ options: {
  categories: { type: 'string' },        // comma-separated
  pages: { type: 'string', default: '1' },
  concurrency: { type: 'string', default: '3' }
}})

const categories = (values.categories ?? 'ropa,electronica,hogar,juguetes_bebe,belleza,otros').split(',') as MockCategory[]
const result = await runCatalogFill({
  categories,
  pagesPerCategory: parseInt(values.pages),
  concurrency: parseInt(values.concurrency)
})
console.log(JSON.stringify(result, null, 2))
process.exit(result.errors.length === 0 ? 0 : 1)
```

Añadir a `package.json`:
```json
"cron:catalog-fill": "tsx scripts/cron-catalog-fill.ts"
```

### 4.5 Repository

**`src/sectors/b-catalog/repository/products.ts`**

```ts
export async function listByDate(opts: { limit?: number, offset?: number } = {}) {
  return await withPg(pg => pg.query(`
    SELECT id, title, description, price_cents, currency, image_url, metadata
    FROM products WHERE is_active = true
    ORDER BY created_at DESC LIMIT $1 OFFSET $2
  `, [opts.limit ?? 20, opts.offset ?? 0]).then(r => r.rows))
}

export async function getById(id: string) {
  return await withPg(pg => pg.query(`SELECT * FROM products WHERE id = $1 AND is_active`, [id]).then(r => r.rows[0]))
}

export async function searchLike(opts: { query: string, limit?: number }) {
  // Simple ILIKE por master doc Fase 1 — la versión LLM-normalizada va a Fase 2
  return await withPg(pg => pg.query(`
    SELECT id, title, description, price_cents, image_url, metadata
    FROM products
    WHERE is_active AND (title ILIKE $1 OR description ILIKE $1)
    ORDER BY created_at DESC LIMIT $2
  `, [`%${opts.query}%`, opts.limit ?? 30]).then(r => r.rows))
}
```

---

## 5. UI surface

### 5.1 Home `app/(shop)/page.tsx`

- Server Component. `const products = await listByDate({ limit: 20 })`.
- Renderiza grid 2 col en mobile / 4 col en desktop usando Tailwind.
- `<ProductCard>` es `<Link href={'/products/' + p.id}>`. No emite eventos al render (el detalle emite product_view).
- Empty state: si `products.length === 0`, banner sugiriendo correr `pnpm cron:catalog-fill --pages 1` (en dev).

### 5.2 Detalle `app/(shop)/products/[id]/page.tsx`

- Server Component fetcheando `getById(params.id)`. 404 si no existe o `is_active=false`.
- Client Component `<ProductTracker productId source>` que:
  - en `useEffect` mount: emite `product_view` con `source` derivado de `document.referrer` (heurística: `/` → 'home'; `/search` → 'search'; `/category/X` → 'category'; otro → 'direct').
  - inicia `setTimeout(() => emit('product_dwell', { product_id, dwell_ms: 30000 }), 30000)` cancelado en unmount o si el user navega.
- Cliente botón "Agregar al carrito" → `useCart().add(productId, 1)`.

### 5.3 Búsqueda `app/(shop)/search/page.tsx`

- Server Component leyendo `searchParams.q`.
- `searchLike({ query: q, limit: 30 })`.
- Renderiza grid + chip "Buscaste: q" + "N resultados".
- En cliente, hook `useSearchTracking` emite `search` event POST `/api/track` con `method='like'` cuando se monta la página con un query (idempotente con `client_event_id` derivado de hash(q + minute)).

### 5.4 Carrito `app/(shop)/cart/page.tsx`

- Client Component que llama `useCart()`:
  - **Hook implementación:**
    - Si `useUser()` (Auth0) tiene user → fetch `GET /api/cart` (lee `cart_items` + JOIN products) → state.
    - Si no → lee `localStorage.getItem('cart:' + anonymousId)` → state. (anonymousId leído de cookie con `document.cookie`.)
  - `add(productId, qty)`:
    - Logged: `PUT /api/cart` con `{ product_id, quantity }`. Server hace UPSERT en `cart_items`.
    - Anónimo: actualiza localStorage.
    - **Siempre** emite `add_to_cart` event.
  - `remove(productId, qty)`: análogo, emite `remove_from_cart`.
- UI muestra items, subtotal, botón "Continuar al checkout".

### 5.5 Checkout `app/(shop)/checkout/page.tsx`

- Si no logueado → redirect a `/auth/login?returnTo=/checkout`.
- Form mínimo: confirmar dirección (free text), confirmar items (read-only del carrito), botón "Confirmar compra simulada".
- Click → `POST /api/checkout`:
  - Server lee `cart_items` del user.
  - Crea `orders` con `total_charged_cents` = sum(price * qty), `total_cost_cents` = round(total_charged_cents * 0.6) (60% del precio simula el costo de adquisición — Fase 1 no rastrea costo por producto del mock; el doc maestro define `margin_cents` como columna generada por la diferencia, así que esto sólo afecta el reporting, no el flujo). `status='pendiente'`.
  - Crea `order_items` con `product_snapshot` = JSON del producto en ese momento.
  - Emite `purchase` event con `order_id`, `product_ids`, `total_cents`.
  - `DELETE FROM cart_items WHERE user_id = $1`.
  - Retorna `{ order_id }`.
- Cliente borra `localStorage[cart:anonId]` si existía.
- Redirige a `/checkout/success?order_id=...`.

### 5.6 Identity merge en signup

**Trigger:** primera visita autenticada después de un login. Auth0 redirige a `returnTo` (la URL de origen, default `/`), así que el merge no puede vivir en una página específica como `/profile` — debe correr en cualquier ruta que el user visite primero post-login.

**Implementación:**

Un Client Component `<IdentityMergeOnLogin>` montado en `app/layout.tsx` (root layout, corre en TODAS las rutas):

```tsx
"use client"
export function IdentityMergeOnLogin() {
  const { user, isLoading } = useUser()  // Auth0 hook
  useEffect(() => {
    if (isLoading || !user) return
    const flagKey = `merge_done:${user.sub}`
    if (localStorage.getItem(flagKey) === '1') return
    fetch('/api/identity/merge', { method: 'POST' })
      .then(r => r.ok && localStorage.setItem(flagKey, '1'))
    // After merge, also push localStorage cart if exists
    const cart = localStorage.getItem('cart:'+getCookie('anonymous_id'))
    if (cart) fetch('/api/cart/merge', { method:'POST', body: cart })
      .then(r => r.ok && localStorage.removeItem('cart:'+getCookie('anonymous_id')))
  }, [user, isLoading])
  return null
}
```

`POST /api/identity/merge` (no body — el server lee `anonymous_id` de cookie + `user.sub` de Auth0 session, busca/crea row en `users`, llama `mergeIdentities(anonId, userRow.id)`). Idempotente: re-llamadas no duplican y no tocan eventos de otros users (porque el UPDATE filtra `WHERE user_id IS NULL`).

**Decisión:** lógica en cliente post-redirect, no hook server post-callback. Razón: `@auth0/nextjs-auth0` v4 no expone hook estable post-callback. Trade-off: si JS deshabilitado, el merge no corre — aceptable para MVP. La idempotencia del UPDATE garantiza que cuando el JS sí corre, el resultado es correcto.

---

## 6. Plan de tests

### 6.1 Inventario

~54 tests nuevos:

| Tipo | Archivo | # tests | APIs reales | Token cost / corrida |
|---|---|---|---|---|
| Unit | events-schema.test.ts | ~14 | — | $0 |
| Unit | canonical-text.test.ts | 3 | — | $0 |
| Integration | identity.test.ts | 4 | pg | $0 |
| Integration | track-endpoint.test.ts | 6 | pg + handler in-process | $0 |
| Integration | identity-merge.test.ts | 3 | pg | $0 |
| Integration | products-repo.test.ts | 5 | pg | $0 |
| Integration | enrichment-pipeline.test.ts | 4 | pg + Voyage + Anthropic + mock | ~$0.02 |
| Integration | cron-catalog-fill.test.ts | 3 | pg + Voyage + Anthropic + mock | ~$0.06 |
| Integration | cart-api.test.ts | 5 | pg + handler in-process | $0 |
| Integration | checkout.test.ts | 4 | pg + handler in-process | $0 |
| E2E | tracking-flow.spec.ts | 2 | Playwright + dev server + Auth0 (skip si no creds) | $0 |
| E2E | shopping-flow.spec.ts | 1 | Playwright + dev server + pg + Voyage + Anthropic | ~$0.06 |

Total: ~54 tests, ~$0.15 por suite full. Acotado y dentro del presupuesto razonable.

### 6.2 Reglas anti-falsify (alineadas con prompt Sección B)

Por cada test escrito, verificar que no entra en estos patrones:

1. ❌ `expect(x).toBeDefined()` / `not.toBeNull()` → ✅ assertion específica del campo (`toMatch`, `toBe`, `toEqual`).
2. ❌ `vi.mock('@anthropic-ai/sdk')` etc. → bloqueado por AST checker R3 + Auditor.
3. ❌ Snapshot de output del LLM (no determinista) → assertions estructurales con regex/enum.
4. ❌ `toEqual(expect.objectContaining({}))` → shape específica.
5. ❌ `await sleep(N)` para esperar evento → `waitFor(fn, { timeout, interval })` polling explícito.
6. ❌ Solo happy path en función crítica → cubrir happy + null/empty + invalid + edge case.
7. ❌ Tests con dependencia de orden global → `beforeEach(truncateTestTables(...))` por archivo.

### 6.3 Tests críticos — assertions concretas

**`enrichment-pipeline.test.ts`**: el más caro y el más crítico.

```ts
test('processProduct enriches with valid metadata + embedding norm=1 dim=1024', async () => {
  await truncateTestTables(['products'])
  const raw = await fetchFromAggregator({ category: 'electronica' })
  const sample = raw.products[0]
  await processProduct(sample, { pg })

  const stored = await pg.queryOne(
    `SELECT metadata, embedding FROM products WHERE source=$1 AND source_product_id=$2`,
    [sample.source, sample.source_product_id]
  )

  expect(stored.metadata.category).toMatch(/^(ropa|electronica|hogar|juguetes_bebe|belleza|otros)$/)
  expect(stored.metadata.keywords).toBeInstanceOf(Array)
  expect(stored.metadata.keywords.length).toBeGreaterThan(0)
  expect(stored.metadata.keywords.length).toBeLessThanOrEqual(8)

  const emb = parsePgVector(stored.embedding)
  expect(emb).toHaveLength(EMBEDDING_DIM)
  const norm = Math.sqrt(emb.reduce((s, x) => s + x*x, 0))
  expect(Math.abs(norm - 1)).toBeLessThan(1e-5)
})

test('processProduct dedupes — same source_product_id updates last_refreshed_at, no new row', async () => {
  await truncateTestTables(['products'])
  const sample = (await fetchFromAggregator({ category: 'ropa' })).products[0]
  const r1 = await processProduct(sample, { pg })
  const t1 = (await pg.queryOne(`SELECT last_refreshed_at FROM products WHERE id=$1`, [r1.productId])).last_refreshed_at
  await new Promise(r => setTimeout(r, 50))
  const r2 = await processProduct(sample, { pg })
  expect(r2.productId).toBe(r1.productId)
  expect(r2.inserted).toBe(false)
  const t2 = (await pg.queryOne(`SELECT last_refreshed_at FROM products WHERE id=$1`, [r1.productId])).last_refreshed_at
  expect(new Date(t2).getTime()).toBeGreaterThan(new Date(t1).getTime())
  const total = await pg.queryOne(`SELECT count(*)::int FROM products`)
  expect(total.count).toBe(1)
})
```

**`identity-merge.test.ts`**:

```ts
test('events from anonymous get user_id after merge', async () => {
  await truncateTestTables(['events','users','anonymous_sessions'])
  const anonId = crypto.randomUUID()
  await pg.query(`INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1)`, [anonId])
  const product = await seedProduct()
  await insertEvent({ event_type: 'product_view', occurred_at: new Date().toISOString(),
    payload: { product_id: product.id, source: 'home' } },
    { pg, anonymous_id: anonId, session_id: crypto.randomUUID(), user_id: null })
  // ... 2 more events

  const userRow = await pg.queryOne(
    `INSERT INTO users (auth0_sub, email) VALUES ('auth0|abc', 'x@y.com') RETURNING id`)

  await mergeIdentities(anonId, userRow.id)

  const after = await pg.queryAsArray(`SELECT user_id FROM events WHERE anonymous_id=$1`, [anonId])
  expect(after).toHaveLength(3)
  expect(after.every(e => e.user_id === userRow.id)).toBe(true)
})

test('merge does NOT overwrite events of OTHER users', async () => {
  // Setup: anonId1 → userA. anonId2 → userB. Llamar mergeIdentities(anonId1, userA) otra vez no debe tocar eventos de anonId2.
})

test('merge is idempotent — running twice produces same state', async () => {
  // First call: 3 events updated. Second call: 0 events updated (WHERE user_id IS NULL filter).
})
```

**`cron-catalog-fill.test.ts`**:

```ts
test('runCatalogFill --pages 1 --categories ropa persists 25 products + 1 mock_calls row', async () => {
  await pg.query(`TRUNCATE products, mock_calls CASCADE`)
  const before = getCallCount()
  resetCallCount()

  await runCatalogFill({ categories: ['ropa'], pagesPerCategory: 1, concurrency: 3 })

  expect(getCallCount()).toBe(1)
  const productCount = await pg.queryOne(`SELECT count(*)::int FROM products`)
  expect(productCount.count).toBe(25)
  const calls = await pg.queryAsArray(`SELECT simulated_cost_cents, response_size FROM mock_calls`)
  expect(calls).toHaveLength(1)
  expect(calls[0].simulated_cost_cents).toBe(4)
  expect(calls[0].response_size).toBe(25)
})

test('runCatalogFill on dedup re-run does not duplicate products', async () => {
  // Truncate. Run once → 25. Run again with same categories/seed → still 25 unique (UPSERT works).
  // mock_calls = 2 because 2 calls; products count = 25 because dedup.
})

test('runCatalogFill error from mock is logged with was_error=true and pipeline does not crash', async () => {
  // Use error injection (forced by env var or mock state) → mock_calls fila con was_error=true; runCatalogFill termina con errors.length > 0 sin throw.
})
```

### 6.4 Mutation testing manual — alcance Fase 1

Per Sección B del prompt, obligatorio para "tracking de eventos críticos" + funciones matemáticas. Alcance Fase 1:

| Función | Mutación | Test que debe fallar |
|---|---|---|
| `ensureAnonymousId` | `crypto.randomUUID()` → constante `'00000000-...'` | identity.test.ts: dos visitas con cookies clear → ids distintos |
| `insertEvent` ON CONFLICT | quitar `ON CONFLICT DO NOTHING` | track-endpoint.test.ts: 2 POSTs con mismo client_event_id → 1 fila, no error |
| `mergeIdentities` UPDATE | quitar `WHERE user_id IS NULL` | identity-merge.test.ts: no overwrite de eventos de otro user |
| `buildCanonicalText` | omitir `raw.description` | canonical-text.test.ts unit: 2 productos con mismo title y description distinta producen canonical text distinto |
| `runCatalogFill` mock_calls insert | quitar el `INSERT INTO mock_calls` | cron-catalog-fill.test.ts: count de mock_calls debe ser 1 |

**Procedimiento (per Sección B del prompt):**
1. Test pasa.
2. Introducir mutación.
3. Test falla.
4. Restaurar.
5. Test pasa.
6. Documentar en commit message: `verified mutation: changed X to Y, test failed as expected`.

### 6.5 Helpers nuevos

**`tests/helpers/wait.ts`**

```ts
export async function waitFor<T>(fn: () => Promise<T>, opts = { timeout: 2000, interval: 50 }): Promise<T> {
  const deadline = Date.now() + opts.timeout
  let lastErr: unknown
  while (Date.now() < deadline) {
    try { return await fn() }
    catch (e) { lastErr = e; await new Promise(r => setTimeout(r, opts.interval)) }
  }
  throw lastErr
}
```

**`tests/helpers/seed.ts`**

```ts
export async function seedProduct(overrides: Partial<MockProduct> = {}): Promise<{ id: string }> {
  // Upsert into test_schema.products with deterministic embedding (e.g., ones() / norm) — for tests that don't need real Voyage
  // For tests that need real enriched embedding, use processProduct directly.
}

export async function createUser(overrides: Partial<{ auth0_sub: string, email: string }> = {}): Promise<{ id: string }> {
  // Insert into test_schema.users
}
```

---

## 7. Triple revisión

Tras tener Fase 1 funcional + tests verdes localmente, se invoca antes de declarar cierre.

### 7.1 Agente 1 — Adversario
- Subagent type: `general-purpose`.
- Input: lista exhaustiva de los ~54 tests + paths a archivos bajo prueba.
- Prompt: literal Sección C del prompt, sin modificar.
- Salida: tests débiles con la mutación que NO detectarían + recomendación de reescritura.

### 7.2 Agente 2 — Auditor de Mocks
- Subagent type: `general-purpose`.
- Input: lista de archivos de test + permitido: `src/sectors/b-catalog/mock/*`.
- Prompt: literal Sección C, sin modificar.
- Salida: APPROVED si solo el mock permitido se usa.

### 7.3 Agente 3 — Probador de Comportamiento
- Subagent type: `general-purpose`.
- Instrucción explícita de NO leer `src/` ni `tests/`, sólo el master doc (sección 14 Roadmap Fase 1) + sistema corriendo en `localhost:3000`.
- Prompt: literal Sección C.
- Salida: cada comportamiento del doc maestro Fase 1 → PASA / FALLA / NO_VERIFICABLE.

### 7.4 Iteración hasta limpio
- Adversario reporta tests débiles → reescribir → re-invocar.
- Auditor reporta mock injustificado → eliminar → re-invocar.
- Probador reporta FALLA → arreglar → re-invocar.
- Compuerta: Fase 1 NO se cierra hasta los 3 limpios.

### 7.5 Reporte literal obligatorio
Output literal de cada agente va en `docs/superpowers/reports/2026-05-XX-fase-1-cierre.md` sin resumen del agente principal. Mi interpretación al final.

---

## 8. Definición de "hecho" (criterio de cierre)

Antes de invocar la triple revisión, todos estos checks deben pasar:

- [ ] Una persona puede entrar al sitio anónima → ver productos en home → click → detalle → add to cart → simular login → checkout → ver order
- [ ] Cookie `anonymous_id` se setea en primera visita, persiste 1 año, no cambia entre páginas
- [ ] `session_id` se setea, expira tras 30 min de inactividad (test usando `Clock` injectable existente para falsificar tiempo determinísticamente)
- [ ] Cada acción emite evento correcto en tabla `events` con schema fijo, idempotente (cuando se incluye `client_event_id`), con `anonymous_id`
- [ ] Identity merge: query SQL `SELECT user_id FROM events WHERE anonymous_id=X` → todos los registros tienen el `user_id` post signup
- [ ] `pnpm cron:catalog-fill --categories ropa --pages 1` → 25 filas en products con `embedding` (norm=1, dim=1024) + `tsvector` autogenerado + `metadata.category` en el enum
- [ ] Búsqueda LIKE en `/search?q=foo` devuelve consistentemente; emite evento `search` con `method='like'`
- [ ] Carrito persiste: anónimo en localStorage, logged-in en `cart_items`; merge en signup
- [ ] Checkout crea `orders` + `order_items` con snapshot, emite `purchase`, vacía `cart_items`
- [ ] Mutation testing aplicado y documentado para las 5 funciones críticas (sección 6.4)
- [ ] `pnpm test:unit && pnpm test:integration && pnpm test:e2e` todos verdes
- [ ] `pnpm test:quality` reporta 0 violations
- [ ] `npx vitest run --no-parallel` (aislamiento) — los integration pasan también
- [ ] Triple revisión: 3 agentes APPROVED (con outputs literales en el reporte de cierre)

---

## 9. Riesgos y mitigaciones

1. **Auth0 hook post-callback complejidad.** `@auth0/nextjs-auth0` v4 no expone hook estable. Mitigación: ejecutar identity merge desde el cliente (`POST /api/identity/merge`) en el primer render post-login. Trade-off: requiere JS habilitado. Aceptable para MVP.

2. **Cost de tokens del cron test.** ~$0.06 por corrida de `cron-catalog-fill.test.ts`. Si muerde el budget, gate con `CI_FULL=1` (patrón ya usado en `mock-aggregator.test.ts` long-run).

3. **`anonymous_sessions` siempre vacía si middleware no escribe.** Riesgo de olvidar el upsert. Mitigación: test integration explícito que cuenta filas en `anonymous_sessions` después de visitar.

4. **Idempotencia de eventos sin `client_event_id`.** Sin client_event_id, doble click en "Agregar al carrito" emite 2 eventos. Decisión: aceptable. Eventos sin client_event_id son "best effort"; la app debe enviarlo cuando puede.

5. **Cookie size for anonymous cart in localStorage.** localStorage no tiene el problema de tamaño de cookies (5MB vs 4KB). Sin issue.

6. **Race condition en cron concurrency=3.** Tres `processProduct` paralelos pueden tirar pg connection pool si `withPg` crea uno nuevo cada vez. Mitigación: pasar `pg` cliente compartido al pipeline, no crear uno por producto.

7. **Test E2E con Auth0 universal real.** Patrón ya existe (skip condicional sin creds). En CI sin creds = E2E parcial — aceptable.

---

## 10. Items pendientes / preguntas abiertas para el implementador

(Ninguna pregunta abierta. El usuario aprobó las 3 decisiones de scope durante el brainstorming.)

---

## 11. Próximo paso

Tras review de este spec, invocar `writing-plans` skill para producir el plan paso a paso ejecutable.
