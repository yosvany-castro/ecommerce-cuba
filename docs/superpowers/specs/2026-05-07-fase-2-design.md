# Fase 2 — Búsqueda híbrida (BM25 + cosine + RRF) · Design

**Fecha:** 2026-05-07
**Estado del repo al diseñar:** Fase 1 cerrada (ver `docs/superpowers/reports/2026-05-07-fase-1-cierre.md`).
**Master doc:** `MVP_Ecommerce_Personalizado_Documento_Maestro v2.md` — Sección 9 (Sector C completo).
**Prompt operativo:** `prompt-fase-1-3.md` — Sección F (Fase 2) + Sección B (filosofía testing) + Sección C (triple revisión).

---

## 1. Contexto y delta

### 1.1 Lo que Fase 1 ya entregó (reutilizable)

- Tabla `searches` con `search_method` enum incluyendo `'hybrid_rrf'` (mig 0008 Fase 0).
- Tabla `product_query_cache` con `query_hash UNIQUE`, `query_embedding vector(1024)`, HNSW index, TTL.
- Tabla `mock_calls` para tracking de llamadas externas con costo simulado.
- `/api/search` actual (LIKE-only) en `src/app/api/search/route.ts` — **se reemplaza** en Fase 2.
- `searchLike` en `src/sectors/b-catalog/repository/products.ts` — se conserva como módulo (no expuesto públicamente) solo para el eval set 30-queries.
- `processProduct` pipeline (LLM normalize + Voyage embed + UPSERT) — reutilizado en mock fallback.
- `events` table: el SearchTracker (cliente) emite evento `search` con `method='hybrid_rrf'` (en lugar de `'like'`).
- Voyage `embed()` — para embedding de queries en cache semántico + cosine search.
- Anthropic `sendMessage()` con `cacheSystem: true` — para LLM normalizer con prompt cached.

### 1.2 Lo que Fase 2 debe añadir

Per master doc Sección 9 + prompt Sección F:

1. **LLM normalizer de queries** → JSON estructurado con prompt versionado y schema fijo (`intent`, `recipient_*`, `categories`, `style`, `price_range`, `search_terms`, `confidence`).
2. **Cache exact** con hash sha256 de la query canonicalizada (lowercase + sin acentos + palabras ordenadas).
3. **Cache semantic** con threshold θ inicial = 0.92 (calibración a Fase 5).
4. **Búsqueda híbrida BM25 + cosine en paralelo** sobre `tsvector_es` y `embedding`.
5. **Fusión por RRF** con k₀ = 60.
6. **Mock fallback condicional**: si hits locales < 12 AND confidence > 0.5 → llama mock + corre pipeline + re-corre retrieval.
7. **Skeleton honesto** durante el wait del mock (2-4s) usando React Suspense.
8. **Persistencia + endpoint admin** (`GET /api/admin/searches`) para auditar el log de búsquedas.

### 1.3 Decisiones de scope tomadas durante el brainstorming

- **Endpoint:** reemplazar `/api/search` LIKE por hybrid (la búsqueda LIKE deja de ser accesible públicamente; se mantiene como módulo interno solo para el eval set).
- **Reranking por perfil (Paso 6 Sec 9):** **DIFERIDO totalmente a Fase 3a** — `u_efectivo` (vector multi-modo) se calcula en Sector D Fase 3a. `hybridSearch` se extenderá con un parámetro opcional `userVector` cuando llegue Fase 3a, sin quebrar el contrato Fase 2. Ver Sección 9 de este spec.
- **Admin view:** persistencia + endpoint JSON sin UI. UI admin completo en Fase 4.
- **Eval set 30 queries:** generadas representativas + auditoría subjetiva del usuario (criterio ≥21/30).
- **θ inicial cache semántico:** 0.92 (placeholder per master doc; calibración empírica a Fase 5).
- **Skeleton:** server-side bloquea (Suspense), UI muestra animate-pulse + mensaje "podemos consultar nuestro proveedor externo".
- **Phase 1 follow-ups:** ninguno bloqueante a priori; solo si surgen durante implementación.
- **Branch:** `feat/fase-2-hybrid-search` nuevo desde `main` (después de mergear Fase 1). Si Fase 1 todavía no se merge, ramificar desde `feat/fase-1-tracking-catalog`.
- **LLM provider:** DeepSeek `deepseek-v4-flash` por default para ambos normalizadores (producto Fase 1 + query Fase 2). ~13× más barato que Haiku 4.5. Anthropic Haiku se preserva en `src/lib/llm/anthropic.ts` para uso futuro en Fase 3c (reranker contextual) si la calidad de DeepSeek no es suficiente.

### 1.4 Out of scope (diferido)

- **Reranking por perfil** (Paso 6 master doc Sec 9): `s_final = β·s_RRF + (1-β)·sim(u, p)` con β=0.7 — Fase 3a junto con cálculo del vector u.
- **Filtros estructurados extendidos** (gender_target, age_target overlap, price_range mapping a `price_cents`): Fase 3a. Fase 2 solo aplica filtro por `categories`.
- **Calibración empírica de θ:** Fase 5.
- **TTL cleanup cron** del `product_query_cache`: Fase 4.
- **Admin role check** en `/api/admin/searches`: Fase 4 (Fase 2: cualquier usuario logueado accede; documentado).
- **30-query eval con dataset real:** Fase 5 (holdout temporal).
- **UI admin completo** (filtros, búsquedas con confidence baja, NPMI top): Fase 4.

---

## 2. Arquitectura

### 2.1 File layout

```
src/
├── sectors/
│   └── c-search/                                [NEW]
│       ├── normalizer/
│       │   ├── prompt.ts                        # PROMPT_VERSION + SYSTEM_PROMPT + zod schema
│       │   ├── schema.ts                        # NormalizedQuery type (re-exportado)
│       │   └── normalize.ts                     # normalizeQueryWithLLM(rawQuery)
│       ├── cache/
│       │   ├── hash.ts                          # canonicalize() + hashQuery()
│       │   ├── exact.ts                         # lookupExact() / writeExact()
│       │   └── semantic.ts                      # lookupSemantic() / DEFAULT_THETA
│       ├── retrieve/
│       │   ├── bm25.ts                          # bm25Search() vía ts_rank_cd
│       │   ├── cosine.ts                        # cosineSearch() vía pgvector <=>
│       │   └── rrf.ts                           # rrfFuse([rankings], k0=60) — pure
│       ├── decide/
│       │   └── shouldCallMock.ts                # shouldCallMock(localCount, confidence)
│       ├── persist/
│       │   └── searches.ts                      # persistSearch(input, pg)
│       ├── admin/
│       │   └── list.ts                          # listSearches(opts, pg)
│       └── search.ts                            # hybridSearch(rawQuery, ctx) — orchestrator
│
├── app/
│   ├── (shop)/search/page.tsx                   [REFACTOR] Suspense + SearchResults async
│   ├── api/
│   │   ├── search/route.ts                      [REFACTOR] llama hybridSearch
│   │   └── admin/searches/route.ts              [NEW] GET listSearches paginado
│   └── components/
│       ├── SearchSkeleton.tsx                   [NEW] esqueleto durante wait
│       ├── SearchResults.tsx                    [NEW] server component async, llama hybridSearch
│       └── SearchUnderstood.tsx                 [NEW] chips visibles del normalized JSON

scripts/
└── eval-30-queries.ts                           [NEW] CLI que genera el reporte md side-by-side

supabase/migrations/
├── 0015_search_phase2.sql                       [NEW] índices admin + comments
└── 0016_test_schema_replicate_v3.sql            [NEW] regenerado por script

tests/
├── unit/
│   ├── cache-hash.test.ts                       [NEW] 8 tests
│   ├── rrf.test.ts                              [NEW] 8 tests
│   └── decide-mock.test.ts                      [NEW] 4 tests
├── integration/
│   ├── normalize-query.test.ts                  [NEW] 5 tests (real Anthropic)
│   ├── cache-exact.test.ts                      [NEW] 4 tests
│   ├── cache-semantic.test.ts                   [NEW] 4 tests (real Voyage)
│   ├── bm25.test.ts                             [NEW] 5 tests
│   ├── cosine.test.ts                           [NEW] 5 tests (real Voyage)
│   ├── hybrid-search.test.ts                    [NEW] 7 tests (orchestrator full path)
│   ├── search-route.test.ts                     [NEW] 4 tests (HTTP)
│   ├── searches-persist.test.ts                 [NEW] 3 tests
│   ├── admin-searches-route.test.ts             [NEW] 4 tests
│   └── search-mock-fallback.test.ts             [NEW] 3 tests (real APIs + cron pipeline)
└── e2e/
    └── search-flow.spec.ts                      [NEW] 2 tests
```

### 2.2 Modelo de datos — delta

Solo 1 migración nueva (`0015_search_phase2.sql`):

```sql
-- Composite index para admin filter "by method"
CREATE INDEX IF NOT EXISTS searches_method_time_idx
  ON public.searches (search_method, occurred_at DESC);

-- Index para admin filter "by prompt_version" (auditoría de bugs por version)
CREATE INDEX IF NOT EXISTS searches_prompt_version_idx
  ON public.searches (prompt_version) WHERE prompt_version IS NOT NULL;

-- Comment documenting cache TTL semantics
COMMENT ON COLUMN public.product_query_cache.ttl_until IS
  'Rows past this timestamp are ignored by lookupExact/lookupSemantic. Cleanup via Phase 4 cron.';
```

Después: `pnpm tsx scripts/generate-test-schema-migration.ts` → `0016_test_schema_replicate_v3.sql`.

Tablas existentes que usaremos sin cambios estructurales: `searches` (mig 0008), `product_query_cache` (mig 0008 — incluye HNSW index sobre `query_embedding`), `mock_calls` (mig 0008), `products` (mig 0004 — incluye `tsvector_es` STORED + HNSW sobre `embedding`).

---

## 3. LLM normalizer

### 3.1 Prompt versionado (`src/sectors/c-search/normalizer/prompt.ts`)

```ts
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

### 3.2 normalize.ts

```ts
import { sendMessageDeepSeek, DEEPSEEK_MODELS } from "@/lib/llm/deepseek";
import { stripMarkdownWrapper } from "@/sectors/b-catalog/enrichment/normalizer"; // reutilizar helper de Fase 1

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

**Falla del LLM:** si `JSON.parse` o `zod.parse` lanzan, propagar al orchestrator. El orchestrator decide fallback: `search_terms = rawQuery`, `confidence = 0`, `categories = []`. Esto garantiza que el mock NO se invoca (low confidence) y el método persistido es `'bm25_only'` (sin filtros de categoría útiles para cosine).

---

## 4. Cache exact + semantic

### 4.1 hash.ts (puro)

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

### 4.2 exact.ts

```ts
export const EXACT_CACHE_TTL_SECONDS = 24 * 60 * 60;

export interface CachedQueryRow {
  query_hash: string;
  query_embedding: number[] | null;
  normalized_json: NormalizedQuery & { prompt_version: string };
  products_returned: string[];
}

export async function lookupExact(hash: string, pg: Client): Promise<CachedQueryRow | null> { ... }

export async function writeExact(input: {
  query_hash: string;
  query_embedding: number[];
  normalized_json: NormalizedQuery & { prompt_version: string };
  products_returned: string[];
  ttl_seconds?: number;
}, pg: Client): Promise<void> { ... }
```

UPSERT vía `INSERT ... ON CONFLICT (query_hash) DO UPDATE SET ...`. La fila SOLO es válida si `ttl_until > now()`.

### 4.3 semantic.ts

```ts
export const DEFAULT_THETA = 0.92; // empírica → Fase 5

export async function lookupSemantic(
  queryEmbedding: number[],
  theta: number,
  pg: Client,
): Promise<CachedQueryRow | null>;
```

Query SQL aprovecha el HNSW index existente:
```sql
SELECT ..., 1 - (query_embedding <=> $1::vector) AS similarity
FROM product_query_cache
WHERE ttl_until > now() AND query_embedding IS NOT NULL
ORDER BY query_embedding <=> $1::vector
LIMIT 1
```
Si `similarity < theta`, retorna null.

---

## 5. Retrieval — BM25 + cosine

### 5.1 bm25.ts

```ts
export interface SearchFilters {
  categories?: string[];
  // gender_target/age_target/price_range: deferido a Fase 3a (ver Sec 9 deuda)
}

export interface RankedProduct { id: string; rank: number; score: number; }

export async function bm25Search(
  searchTerms: string,
  filters: SearchFilters,
  K: number,
  pg: Client,
): Promise<RankedProduct[]>;
```

SQL:
```sql
SELECT id, ts_rank_cd(tsvector_es, websearch_to_tsquery('spanish', $1)) AS score
FROM products
WHERE is_active = true
  AND tsvector_es @@ websearch_to_tsquery('spanish', $1)
  AND ($2::text[] IS NULL OR (metadata->>'category') = ANY($2::text[]))
ORDER BY score DESC
LIMIT $3
```

`websearch_to_tsquery` (PG ≥ 11) acepta sintaxis Google-like: `OR`, frases entre comillas, `-`. `ts_rank_cd` es TF-IDF + cover density — equivalente funcional a BM25 para ranking relativo. Si en Fase 5 el eval muestra issues, considerar migrar a `pg_search` extension (deferido).

### 5.2 cosine.ts

```ts
export async function cosineSearch(
  queryEmbedding: number[],
  filters: SearchFilters,
  K: number,
  pg: Client,
): Promise<RankedProduct[]>;
```

SQL:
```sql
SELECT id, 1 - (embedding <=> $1::vector) AS score
FROM products
WHERE is_active = true AND embedding IS NOT NULL
  AND ($2::text[] IS NULL OR (metadata->>'category') = ANY($2::text[]))
ORDER BY embedding <=> $1::vector
LIMIT $3
```

Aprovecha el HNSW index de Fase 0.

### 5.3 rrf.ts (puro)

```ts
export const RRF_K0 = 60;

export interface FusedProduct {
  id: string;
  rrf_score: number;
  ranks: { bm25?: number; cosine?: number };
}

export function rrfFuse(
  rankings: RankedProduct[][],
  k0: number = RRF_K0,
  listLabels: string[] = ["bm25", "cosine"],
): FusedProduct[];
```

Fórmula: `RRF(p) = Σ (1 / (k0 + rank_i(p)))` para cada lista i en la que aparezca p. Si no aparece en una lista, no contribuye (no se penaliza con un rank ficticio infinito).

---

## 6. Decisión mock fallback

```ts
// decide/shouldCallMock.ts
export const LOCAL_HITS_THRESHOLD = 12;
export const CONFIDENCE_THRESHOLD = 0.5;

export function shouldCallMock(localCount: number, confidence: number): boolean {
  return localCount < LOCAL_HITS_THRESHOLD && confidence > CONFIDENCE_THRESHOLD;
}
```

Si `shouldCallMock(...) === true`:
1. `fetchFromAggregator({ category: normalized.categories?.[0], query: normalized.search_terms })`.
2. Para cada producto raw: `processProduct(raw, pg)` (pipeline Fase 1 — LLM normalize + Voyage embed + UPSERT).
3. Re-correr `bm25Search` y `cosineSearch` (los nuevos productos ya están en DB).
4. Re-fundir con RRF.
5. Persistir `searches.called_mock = true`.

Si el mock falla (2% probabilidad de error) o devuelve 0 productos relevantes, mantener los resultados originales y persistir `called_mock = true, results_count = local_count` (la llamada se hizo, aunque no aportó).

---

## 7. Persistencia + admin

### 7.1 persist/searches.ts

```ts
export interface PersistSearchInput {
  anonymous_id: string | null;
  user_id: string | null;
  raw_query: string;
  normalized_json: (NormalizedQuery & { prompt_version: string }) | null;
  prompt_version: string | null;
  search_method: "hybrid_rrf" | "bm25_only" | "cosine_only";
  results_count: number;
  hit_cache: boolean;
  called_mock: boolean;
}

export async function persistSearch(input: PersistSearchInput, pg: Client): Promise<void>;
```

**Reglas:**
- `search_method = 'hybrid_rrf'` siempre que tanto BM25 como cosine corrieron y RRF fusionó.
- `'bm25_only'` solo si cosine falló (Voyage API down o embedding null) — fallback graceful.
- `'cosine_only'` solo si BM25 retornó 0 hits y cosine sí (caso semántico puro).
- `hit_cache = true` si exact OR semantic cache hit.
- `called_mock = true` si se invocó `fetchFromAggregator` durante el flow.

### 7.2 admin/list.ts

```ts
export interface ListSearchesOpts {
  from?: Date | null;
  to?: Date | null;
  hit_cache?: boolean | null;
  method?: "hybrid_rrf" | "bm25_only" | "cosine_only" | null;
  page?: number;
  limit?: number; // default 50, max 200
}

export async function listSearches(opts: ListSearchesOpts, pg: Client): Promise<{
  rows: SearchRow[];
  total: number;
  limit: number;
  page: number;
}>;
```

WHERE dinámico, ORDER BY `occurred_at DESC`, paginación LIMIT/OFFSET, COUNT(*) para total.

### 7.3 GET /api/admin/searches

```ts
export async function GET(req: NextRequest) {
  const session = await auth0.getSession(req).catch(() => null);
  if (!session?.user?.sub) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  // TODO Phase 4: admin role check
  
  const sp = req.nextUrl.searchParams;
  const opts = listSearchesQuerySchema.parse({
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    hit_cache: sp.get("hit_cache") ?? undefined,
    method: sp.get("method") ?? undefined,
    page: sp.get("page") ?? undefined,
    limit: sp.get("limit") ?? undefined,
  });
  const result = await withPg((pg) => listSearches(opts, pg));
  return NextResponse.json(result);
}
```

`listSearchesQuerySchema` es zod que parsea strings de URL (`from`/`to` como ISO date, `hit_cache` como `'true'|'false'`, `page`/`limit` como número con bounds).

---

## 8. Orchestrator + UI

### 8.1 search.ts

```ts
export interface HybridSearchCtx {
  pg: Client;
  anonymous_id: string | null;
  user_id: string | null;
}

export interface HybridSearchResult {
  products: ProductListRow[];        // resolved a la shape pública (con title/price_cents/...)
  normalized: (NormalizedQuery & { prompt_version: string }) | null;
  hitCache: boolean;
  calledMock: boolean;
  method: "hybrid_rrf" | "bm25_only" | "cosine_only";
}

export async function hybridSearch(rawQuery: string, ctx: HybridSearchCtx): Promise<HybridSearchResult>;
```

Flujo (11 pasos, implementación canónica):

1. `hash = hashQuery(rawQuery)`.
2. `exact = await lookupExact(hash, pg)`. Si hay hit y no expirado → resolver products via `getProductsByIds(exact.products_returned, pg)`, `persistSearch(hit_cache=true, called_mock=false)`, return.
3. `embedding = await embed([rawQuery], { inputType: "query" })`.
4. `semantic = await lookupSemantic(embedding, DEFAULT_THETA, pg)`. Si hay hit → análogo a (2).
5. `normalized = await normalizeQueryWithLLM(rawQuery)`. (Si throw: catch, normalized=null, fallback a `bm25_only` con `search_terms = rawQuery`.)
6. `[bm25, cos] = await Promise.all([bm25Search(normalized.search_terms, filters, 50, pg), cosineSearch(embedding, filters, 50, pg)])`.
7. `fused = rrfFuse([bm25, cos])`. `method = bm25.length > 0 && cos.length > 0 ? 'hybrid_rrf' : (cos.length === 0 ? 'bm25_only' : 'cosine_only')`.
8. Si `shouldCallMock(fused.length, normalized.confidence)`:
   - `mockResult = await fetchFromAggregator({ category: normalized.categories?.[0], query: normalized.search_terms })`.
   - Para cada raw: `await processProduct(raw, pg)`.
   - Re-correr (6) y (7).
   - `calledMock = true`.
9. `await writeExact({ query_hash: hash, query_embedding: embedding, normalized_json: normalized, products_returned: fused.map(f => f.id), ttl_seconds: EXACT_CACHE_TTL_SECONDS }, pg)`.
10. `await persistSearch({ ..., hit_cache: false, called_mock: calledMock, results_count: fused.length, search_method: method }, pg)`.
11. `return { products: resolveProducts(fused, pg), normalized, hitCache: false, calledMock, method }`.

### 8.2 /api/search route refactor

```ts
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ products: [], count: 0, hit_cache: false, called_mock: false }, { status: 200 });
  
  const anonymous_id = req.cookies.get("anonymous_id")?.value ?? null;
  const session = await auth0.getSession(req).catch(() => null);
  let user_id: string | null = null;
  if (session?.user?.sub) {
    const sub = session.user.sub as string;
    const email = (session.user.email as string) ?? `${sub}@noemail.local`;
    user_id = await withPg(async (pg) => (await getOrCreateUserByAuth0Sub(pg, sub, email)).id);
  }
  
  const result = await withPg((pg) => hybridSearch(q, { anonymous_id, user_id, pg }));
  return NextResponse.json({
    products: result.products,
    count: result.products.length,
    hit_cache: result.hitCache,
    called_mock: result.calledMock,
    normalized: result.normalized,
    method: result.method,
  });
}
```

### 8.3 UI — search page con Suspense + skeleton honesto

```tsx
// app/(shop)/search/page.tsx
import { Suspense } from "react";
import { SearchSkeleton } from "@/components/SearchSkeleton";
import { SearchForm } from "@/components/SearchForm";
import { SearchResults } from "@/components/SearchResults";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-2">Buscar</h1>
      <SearchForm initial={q} />
      {q && (
        <Suspense key={q} fallback={<SearchSkeleton query={q} />}>
          <SearchResults query={q} />
        </Suspense>
      )}
    </main>
  );
}
```

`<SearchResults>` es un server component async que llama `hybridSearch` directamente (sin roundtrip extra a `/api/search`):

```tsx
// components/SearchResults.tsx (server)
export async function SearchResults({ query }: { query: string }) {
  const anonId = (await cookies()).get("anonymous_id")?.value ?? null;
  const session = await auth0.getSession().catch(() => null);
  const userId = session?.user?.sub
    ? await withPg(async (pg) => (await getOrCreateUserByAuth0Sub(pg, session.user.sub as string, session.user.email as string)).id)
    : null;
  const result = await withPg((pg) => hybridSearch(query, { pg, anonymous_id: anonId, user_id: userId }));
  return <>
    <SearchUnderstood normalized={result.normalized} method={result.method} hitCache={result.hitCache} calledMock={result.calledMock} />
    <ProductGrid products={result.products} />
  </>;
}
```

`<SearchUnderstood>` es client component que muestra chips: "Para: niña, 7-9 años, regalo, presupuesto bajo". El usuario puede ver lo que el LLM entendió y eventualmente corregirlo (corrección manual del JSON: deferido a Fase 4 admin).

`<SearchSkeleton>`:

```tsx
export function SearchSkeleton({ query }: { query: string }) {
  return (
    <div className="mt-4">
      <p className="text-sm text-gray-600">Buscando "{query}"…</p>
      <p className="text-xs text-gray-400 mt-1">
        Si tu búsqueda es muy específica, podemos consultar nuestro proveedor externo (puede tomar 2-4 segundos).
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="border rounded-lg p-4 animate-pulse">
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

`SearchTracker` (Fase 1) sigue emitiendo `search` event desde el cliente con `method='hybrid_rrf'`.

---

## 9. Deuda técnica explícita diferida a Fase 3a

> **Paso 6 del flujo Sec 9 master doc — "Reranking por perfil"** — define `s_final = β·s_RRF + (1-β)·sim(u_efectivo, p)` con β=0.7. **NO está implementado en Fase 2.** Razón: `u_efectivo` (vector multi-modo del usuario) es Fase 3a (Sector D). Cuando Fase 3a aterrice, `hybridSearch` se extiende con un parámetro opcional `userVector?: number[]`:
>
> - Si `userVector` está presente: aplicar el reranking con β=0.7 sobre `fused` antes de retornar.
> - Si está ausente: comportamiento Fase 2 (RRF puro).
>
> El contrato externo (`HybridSearchResult`) no cambia. La extensión es retro-compatible.

**Tracking:** El spec de Fase 3a debe reabrir explícitamente esta función. El reporte de cierre de Fase 2 incluirá esta nota como "deuda diferida documentada".

---

## 10. Plan de tests

### 10.1 Inventario

| Tipo | Archivo | # tests | APIs reales | Token cost |
|---|---|---|---|---|
| Unit | cache-hash.test.ts | 8 | — | $0 |
| Unit | rrf.test.ts | 8 | — | $0 |
| Unit | decide-mock.test.ts | 4 | — | $0 |
| Integration | normalize-query.test.ts | 5 | Anthropic | ~$0.01 |
| Integration | cache-exact.test.ts | 4 | pg | $0 |
| Integration | cache-semantic.test.ts | 4 | pg + Voyage | ~$0.001 |
| Integration | bm25.test.ts | 5 | pg | $0 |
| Integration | cosine.test.ts | 5 | pg + Voyage | ~$0.001 |
| Integration | hybrid-search.test.ts | 7 | pg + Voyage + Anthropic + mock | ~$0.03 |
| Integration | search-route.test.ts | 4 | pg + Voyage + Anthropic | ~$0.005 |
| Integration | searches-persist.test.ts | 3 | pg | $0 |
| Integration | admin-searches-route.test.ts | 4 | pg | $0 |
| Integration | search-mock-fallback.test.ts | 3 | pg + Voyage + Anthropic + mock + cron | ~$0.08 |
| E2E | search-flow.spec.ts | 2 | dev + Voyage + Anthropic + mock | ~$0.02 |

**Total Fase 2: ~66 tests nuevos. Cost full suite: ~$0.15.** Si supera $0.30, gate `search-mock-fallback.test.ts` con `CI_FULL=1`.

### 10.2 Reglas anti-falsify (alineadas con prompt Sección B)

1. ❌ `expect(x).toBeDefined()` → ✅ assertion específica.
2. ❌ Mock de `@/sectors/c-search/normalizer` o `@/lib/llm/anthropic` etc. → bloqueado por AST checker R3 (Fase 1 follow-up #7 ya escala wrappers).
3. ❌ Snapshot del JSON del LLM → ✅ shape específica (`toMatchObject` con regex/enum).
4. ❌ `await sleep(N)` para esperar persistencia → ✅ `waitFor(fn, { timeout, interval })`.
5. ❌ Solo happy path en RRF/cache/decide → ✅ cubrir happy + null/empty + invalid + edge case.
6. ❌ Tests con dependencia de orden global → `beforeEach(truncateTestTables(...))`.

### 10.3 Tests críticos — assertions concretas

- **hybrid-search.test.ts** (7 escenarios):
  1. Cache miss path: LLM se llama, BM25+cosine corren, cache se puebla, no mock cuando count >= 12.
  2. Cache hit path: 2× misma query → 2ª `hit_cache=true`, sin nuevo LLM call (verificable por count de filas con `normalized_json IS NOT NULL` vs `hit_cache` flag).
  3. Order-invariant cache: 3 permutaciones del mismo conjunto de palabras → 1 row en `product_query_cache` + flags `[false, true, true]` en `searches`.
  4. Low-confidence query ("asdfgh qwerty"): `confidence < 0.5` → `mock_calls` count == 0.
  5. Mock fallback: count < 12 + confidence > 0.5 → `getCallCount()` increments by 1 + productos enriquecidos en DB + retrieval re-corre.
  6. BM25 wins on literal: producto seeded con título "Nike Air Max 270 talle 42" rankea primero contra otros con embeddings similares (Adidas Ultraboost, Puma RS-X).
  7. Cosine catches synonym: producto con título "Auriculares inalámbricos Sony WH-1000XM5" aparece en results para query "audífonos bluetooth con cancelación de ruido".

- **rrf.test.ts** (8 unit):
  1. Producto en ambas listas rank 1: `rrf_score = 2/(60+1) ≈ 0.0328`.
  2. Producto solo BM25 rank 1: `rrf_score = 1/61 ≈ 0.0164`.
  3. RRF fórmula es commutativa (BM25 1 + cos 5 == BM25 5 + cos 1 en score, orden estable por inserción).
  4. `k0=60` cambia scores vs `k0=0` (mutation guard).
  5. `[]` lists → `[]` resultado.
  6. Single-list ranking: pasa a través.
  7. 3 productos en BM25 + 1 distinto en cosine: 4 fusionados ordenados correctamente.
  8. Big input (100 productos): no crash + orden correcto + sum de scores válida.

- **cache-hash.test.ts** (8 unit):
  1. `canonicalize("Hello World")` === `"hello world"` (case).
  2. `canonicalize("WORLD HELLO")` === `"hello world"` (case + sort).
  3. `canonicalize("Sábanas")` === `"sabanas"` (acentos NFD strip).
  4. `canonicalize("  multiple   spaces  ")` === `"multiple spaces"` (whitespace).
  5. `canonicalize("regalo niña 8 años")` === `canonicalize("niña 8 años regalo")` (permutación).
  6. `canonicalize("8 años niña regalo")` === resultado idéntico (3ª permutación).
  7. `hashQuery` retorna `/^[0-9a-f]{64}$/` (hex 64).
  8. Inputs distintos → hashes distintos (collision spot-check).

- **decide-mock.test.ts** (4 unit, 4 cuadrantes):
  1. `(localCount=12, confidence=0.9)` → `false` (>= threshold).
  2. `(localCount=5, confidence=0.4)` → `false` (low confidence).
  3. `(localCount=5, confidence=0.9)` → `true`.
  4. `(localCount=15, confidence=0.9)` → `false`.

### 10.4 Mutation testing — alcance Fase 2

Per criterio prompt: "Mutation testing aplicado al RRF, al cálculo de cache hash, al threshold de confidence."

| # | Función | Mutación | Test que debe fallar |
|---|---|---|---|
| 1 | `rrfFuse` k0 | `1/(k0+rank)` → `1/rank` | rrf.test.ts: "k0=60 changes scores vs k0=0" |
| 2 | `rrfFuse` adición | `+=` → `=` | rrf.test.ts: "product in both lists at rank 1" (score 1/61 ≠ 2/61) |
| 3 | `canonicalize` sort | quitar `.sort()` | cache-hash.test.ts: "permutation = same" |
| 4 | `canonicalize` accents | quitar NFD strip | cache-hash.test.ts: "Sábanas → sabanas" |
| 5 | `canonicalize` lowercase | quitar `.toLowerCase()` | cache-hash.test.ts: "WORLD HELLO → hello world" |
| 6 | `shouldCallMock` confidence | `> 0.5` → `> 0.1` | decide-mock.test.ts: "low confidence (0.4) → false" |
| 7 | `shouldCallMock` count | `< 12` → `<= 12` | decide-mock.test.ts: "exact 12 hits → false" |

**Procedimiento:** test verde → introducir mutación → test rojo → restaurar → test verde → commit `--allow-empty -m "test(mutation): verified 7 mutations Fase 2 fail as expected"`.

---

## 11. Eval set 30-queries

### 11.1 Conjunto generado (representativo, 6 categorías × 5)

**Literal/SKU (BM25 brilla):**
1. "Nike Air Max 270 talle 42"
2. "iPhone 15 Pro 256GB"
3. "Samsung Galaxy S24 Ultra"
4. "Sony WH-1000XM5"
5. "Adidas Stan Smith blanco"

**Sinónimos (cosine brilla):**
6. "audifonos bluetooth con cancelación de ruido"
7. "bocinas portátiles"
8. "remera deportiva"
9. "pantalón corto verano"
10. "auriculares para correr"

**Receptor + edad/género (filtros estructurados — pero filters extendidos diferido):**
11. "regalo para mi sobrina de 8 años"
12. "regalo para mi abuelo"
13. "ropa para mi esposo de 35 años"
14. "juguete educativo para niño de 5 años"
15. "vestido para boda femenino"

**Estilo subjetivo:**
16. "algo bonito y barato"
17. "vestido elegante para fiesta"
18. "ropa deportiva colorida"
19. "algo formal masculino"
20. "estilo vintage"

**Categórico amplio:**
21. "ropa de niño"
22. "electrónica para oficina"
23. "productos para la cocina"
24. "belleza para mujer"
25. "juguetes bebé"

**Edge / basura (low-confidence; mock NO se llama):**
26. "asdfgh"
27. "?"
28. "1234"
29. "AAAAAAAA"
30. "" (string vacío — early return en /api/search)

### 11.2 Procedimiento

`scripts/eval-30-queries.ts`:
1. Para cada query, ejecuta `hybridSearch(q)` (toma 1-4s) y `searchLike(q)` (Fase 1 module preservado).
2. Captura top-10 ids + títulos de cada uno.
3. Genera `docs/superpowers/reports/2026-05-XX-fase-2-eval-30-queries.md` con tabla side-by-side.
4. **El usuario abre el archivo** y marca para cada query: `[ ] hybrid mejor`, `[ ] LIKE mejor`, `[ ] empate`, o `[ ] N/A` (caso garbage donde ambos empiezan vacíos).
5. Sección final: conteo manual.

**Compuerta del cierre:** ≥ 21 de 30 marcadas "hybrid mejor" (o ≥ 21 de las que NO son N/A si las garbage cuentan como N/A).

Las 5 garbage queries pueden contar como "hybrid mejor" trivialmente: hybrid no llama mock (low-confidence), LIKE retorna 0; misma ineficacia, hybrid sin desperdicio. Si el usuario las marca como empate, el threshold debería evaluarse sobre las 25 no-garbage.

---

## 12. Triple revisión

Idéntico patrón Fase 1 (Sección C de prompt-fase-1-3.md). Después de tener Fase 2 funcional + tests verdes + eval pasado:

1. **Adversario** (general-purpose) — auditar los ~66 tests nuevos vs mutaciones plausibles.
2. **Auditor de Mocks** (general-purpose) — confirmar 0 mocks injustificados (solo `src/sectors/b-catalog/mock/*` permitido; `src/sectors/c-search/*` debe usar APIs reales en tests).
3. **Probador de Comportamiento** (general-purpose, restricción: no leer src/ ni tests/) — black-box vs master doc Sección 9 completa.

Iterar hasta 3 limpios. Reporte literal en `docs/superpowers/reports/2026-05-XX-fase-2-cierre.md`.

---

## 13. Definition of done — Fase 2

Antes de invocar la triple revisión, todos estos checks deben pasar:

- [ ] LLM normaliza queries con schema válido (test real "regalo para sobrina de 8 años" → recipient_gender="femenino" o "niña", age 7-9, confidence > 0.5).
- [ ] Cache exact: 2× misma query → 2ª es hit (verificable: `searches.hit_cache=true`, sin nuevo LLM call).
- [ ] Cache exact: 3 permutaciones del mismo conjunto de palabras → 1 row en `product_query_cache`.
- [ ] Cache semantic con θ=0.92 documentado y placeholder de calibración Fase 5.
- [ ] BM25 ranks "Nike Air Max 270 talle 42" target product first.
- [ ] Cosine catches "audífonos" → "Auriculares Sony" cuando BM25 lo perdería.
- [ ] RRF k₀=60 fusiona correctamente (8 unit tests pass).
- [ ] Low-confidence query ("asdfgh") → mock NOT invoked (verificable por mock_calls count).
- [ ] Hits locales < 12 + confidence > 0.5 → mock invocado + productos enriquecidos via pipeline Fase 1 + retrieval re-corre.
- [ ] `/api/admin/searches` retorna paginado con normalized_json + filtros from/to/hit_cache/method.
- [ ] UI: skeleton honesto durante Suspense.
- [ ] Mutation testing aplicado y documentado (7 mutaciones).
- [ ] 30-query eval ≥ 21/30 wins para hybrid (o ≥ 21/25 si garbage es N/A).
- [ ] `pnpm test:unit && pnpm test:integration && pnpm test:e2e` todos verdes.
- [ ] `pnpm test:quality` reporta 0 violations.
- [ ] `npx vitest run --no-file-parallelism tests/integration` también limpio.
- [ ] Triple revisión: 3 agentes APPROVED (output literal en reporte de cierre).
- [ ] Spec/plan/closure docs commiteados.
- [ ] Nota deuda técnica diferida (Paso 6 reranking → Fase 3a) explícita en spec + en commit message del cierre Fase 2.

---

## 14. Riesgos y mitigaciones

1. **Token cost de tests con LLM real (~$0.15/full suite).** Si supera $0.30, gate `search-mock-fallback.test.ts` con `CI_FULL=1`.
2. **`ts_rank_cd` ≠ BM25 estricto.** Funcionalmente equivalente para ranking relativo en MVP. Si Fase 5 eval muestra issues, considerar `pg_search` (deferido).
3. **HNSW recall < 100% en datasets pequeños.** Con 200 productos es irrelevante; con 100k+ podría perder hits. Documentado.
4. **`seedProductWithEmbedding`** helper necesario para el test "BM25 wins on literal" — extender helper Fase 1 con flag opcional `embed: true` que llama Voyage.
5. **Mock fallback test es el más caro** (~$0.07 — pipeline Fase 1 completo sobre 25 productos). Mantener en suite default; gate solo si excede budget.
6. **Race condition en escritura concurrente al cache:** dos requests simultáneos con misma query → dos LLM calls. ON CONFLICT garantiza una sola fila final pero no ahorra tokens. Aceptable para MVP — Fase 4 podría introducir advisory lock.
7. **Skeleton via React Suspense + Next 16 RSC streaming.** Si streaming tiene issues en Vercel, fallback a client-side fetch + state.
8. **Eval set subjetivo.** Tu juicio es la métrica. Si en duda, marca "empate"; el criterio ≥21/30 sigue válido aunque sean 21 wins + 5 empates + 4 LIKE wins.
9. **Cookies en server component:** `cookies()` (de `next/headers`) requiere `dynamic = "force-dynamic"` o el page fallará en build. Ya está marcado.

---

## 15. Items pendientes / preguntas abiertas

(Ninguna pregunta abierta. Las 4 decisiones estratégicas — endpoint, reranking deferido, admin scope, eval set — fueron aprobadas durante el brainstorming.)

---

## 16. Próximo paso

Tras review de este spec, invocar `writing-plans` skill para producir el plan ejecutable paso a paso (estimado ~25-30 tareas).
