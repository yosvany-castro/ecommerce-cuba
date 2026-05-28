# Fase 3c — MMR + LLM Reranker Contextual · Design

**Fecha:** 2026-05-15
**Estado del repo al diseñar:** Fase 3b cerrada (`docs/superpowers/reports/2026-05-15-fase-3b-cierre.md`), merge a `main` (commit `40e2d97`). 367 tests verdes (160 unit + 207 integration).
**Branch propuesta:** `feat/fase-3c-mmr-llm-reranker` (desde `main`).

## 1. Por qué Fase 3c existe

Fase 3b entregó multi-modo + grafo NPMI + RRF de 3+ fuentes. El feed ya es personalizado y trae cross-sell. Las 2 limitaciones que cierra F3c (master doc Sec 10.c):

1. **El feed puede ser homogéneo dentro del top-30.** RRF favorece productos que aparecen en múltiples fuentes → suelen ser similares entre sí. Para un user con gustos heterogéneos (cohorte amplia), el top-10 podría ser "10 vestidos formales casi idénticos" en vez de "5 formales + 3 casuales + 2 accesorios". **MMR** (Maximal Marginal Relevance) ataca esto: selecciona iterativamente balanceando relevancia y diversidad respecto a lo ya seleccionado.

2. **Sin "por qué se le recomienda este producto."** El user ve productos pero no sabe la razón. Esto reduce confianza y CTR. El **LLM reranker contextual** (Claude Haiku) genera una razón corta (max 12 palabras) específica para cada producto y user, mostrada en cada tarjeta. También reordena los top-30 → top-10 basándose en señales que el cosine no captura (intent, contexto temporal, etc.).

F3c es la última sub-fase de personalización. Después: Fase 4 (admin completo) + Fase 5 (validación con holdout real).

## 2. Decisiones de scope (durante brainstorming)

| Decisión | Elección | Razón |
|---|---|---|
| Scope F3c | MMR + LLM reranker + razones en UI | Master doc bundles las 3 cosas |
| LLM provider | Anthropic Claude Haiku 4.5 (dormant ya configurado) | Master doc; mejor reasoning contextual que DeepSeek para razones cortas |
| MMR λ | 0.7 (master doc default) | Sintónica estándar |
| Caching | Cache fuerte `feed_rerank_cache` por (user, top-30 ids hash) | Reduce coste ~70%+ con cache hit rate |
| TTL cache | 4h | Balance entre frescura y reuso |
| Cache invalidation | TTL + prompt version cambio | No requiere DELETE manual cuando cambia el prompt |
| Fallback si Anthropic falla | Top-10 del MMR sin razones | Best-effort: no rompe el feed |
| Prompt versioning | Sí, `prompt_version` field | Permite invalidar cache + auditar en admin |
| Eval cuantitativo | Holdout temporal (adelantamos parte de Fase 5) | Más riguroso que synthetic sub-experimentos |
| Eval cualitativo | Auditoría manual 30 razones | Target ≥80% coherentes (master doc) |
| Latencia target | p99 < 1.5s | Master doc |
| Razones storage | En cache JSON, no en `products` table | Razones son user-specific |
| UI placement | ProductCard.tsx debajo del precio, texto azul itálico | Sin diseño exhaustivo, MVP |

## 3. Arquitectura general

```
generateFeed (extending F3b):
  ┌──────────────────────────────────────────────┐
  │ F3b: 3 fuentes (multi-modo + NPMI + popular) │
  │   ↓ RRF (k0=60)                              │
  │ fused top-100                                │
  └──────────────────────────────────────────────┘
                 ↓ MMR (λ=0.7)
  ┌──────────────────────────────────────────────┐
  │ top-30 diversificado                         │
  └──────────────────────────────────────────────┘
                 ↓ hash(profile, top-30 ids, prompt_v)
  ┌──────────────────────────────────────────────┐
  │ feed_rerank_cache lookup                     │
  └──────────────────────────────────────────────┘
       ↓ HIT (>70% post-warmup)         ↓ MISS
   return cached top-10            anthropicHaiku reranker
   with reasons                     (top-30 → top-10 + razones)
                                         ↓
                                    persist cache
                                         ↓
                                    return top-10 + razones
                                    
                                    On error: fallback MMR top-10
                                    sin razones (no romper feed)
```

Latencia esperada:
- **Cache hit**: ~50ms (DB lookup + resolve products).
- **Cache miss**: ~600-900ms (MMR + Haiku call ~300-500ms + write cache).
- Master doc target p99 < 1.5s: cumplido con margen.

Costo esperado:
- **Cache miss**: ~$0.0015 (Haiku Sonnet 4.6 con ephemeral cache del SYSTEM_PROMPT).
- **Hit rate post-warmup**: >70%.
- **Costo mensual proyectado**: ~$0.50/usuario activo (asumiendo 50 feeds/día con 70% hit).

## 4. Bloque 1 — MMR sobre top-100 RRF → top-30

### 4.1 Constants + algoritmo

`src/sectors/d-personalization/retrieve/mmr.ts`:

```ts
import { normalize, cosine } from "@/lib/math";

export const MMR_LAMBDA = 0.7;

export interface MMRInput {
  candidates: { id: string; rrf_score: number }[];
  embeddings: Map<string, number[]>;
  k: number;
  lambda?: number;
}

export interface MMRItem {
  id: string;
  rrf_score: number;
  mmr_score: number;
}

/**
 * Maximal Marginal Relevance.
 * Iteratively selects items balancing relevance (RRF score) and diversity
 * (max cosine similarity to already-selected items).
 *
 * mmr(item) = λ · rrf_score(item) - (1 - λ) · max(sim(item, sel) for sel in selected)
 *
 * λ=1.0 → pure relevance (top-K by RRF).
 * λ=0.0 → pure diversity (maximize spread).
 * λ=0.7 (default) → relevance-leaning balance.
 */
export function mmrSelect(input: MMRInput): MMRItem[] {
  const lambda = input.lambda ?? MMR_LAMBDA;
  const selected: MMRItem[] = [];
  const remaining = [...input.candidates];

  // Cache normalized embeddings
  const normCache = new Map<string, number[]>();
  function normFor(id: string): number[] | null {
    let v = normCache.get(id);
    if (v) return v;
    const raw = input.embeddings.get(id);
    if (!raw) return null;
    v = normalize(raw);
    normCache.set(id, v);
    return v;
  }

  // First pick: max RRF
  if (remaining.length > 0) {
    remaining.sort((a, b) => b.rrf_score - a.rrf_score);
    const first = remaining.shift()!;
    selected.push({ id: first.id, rrf_score: first.rrf_score, mmr_score: first.rrf_score });
  }

  // Iterative
  while (selected.length < input.k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const candN = normFor(cand.id);
      if (!candN) continue;
      let maxSim = 0;
      for (const sel of selected) {
        const selN = normFor(sel.id);
        if (!selN) continue;
        const sim = cosine(candN, selN);
        if (sim > maxSim) maxSim = sim;
      }
      const score = lambda * cand.rrf_score - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const picked = remaining.splice(bestIdx, 1)[0];
    selected.push({ id: picked.id, rrf_score: picked.rrf_score, mmr_score: bestScore });
  }

  return selected;
}
```

### 4.2 Helper para fetch embeddings batch

```ts
async function fetchProductEmbeddings(
  ids: string[], pg: Client,
): Promise<Map<string, number[]>> {
  if (ids.length === 0) return new Map();
  const r = await pg.query(
    `SELECT id::text, embedding::text AS v FROM products WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  const out = new Map<string, number[]>();
  for (const row of r.rows as { id: string; v: string }[]) {
    out.set(row.id, JSON.parse(row.v) as number[]);
  }
  return out;
}
```

### 4.3 Tests del bloque 1

- **Unit** `mmr-personalization.test.ts`:
  - `MMR_LAMBDA` constant value check.
  - λ=1.0 con 5 candidatos → output = top-5 RRF order.
  - λ=0.0 con 3 candidatos linearmente alineados → output rota direcciones.
  - λ=0.7 con top-10 homogéneo (todos similares, RRF descendente) → mid-ranked diverso entra antes que low-ranked similar al top.
  - Empty candidates → empty output.
  - k > candidates.length → output = candidates.length.
- **Unit Mutation**: signo `- (1-λ)` → `+ (1-λ)` (diversity flip) → test λ=0.7 falla.

## 5. Bloque 2 — LLM reranker contextual con Anthropic Haiku 4.5

### 5.1 Prompt versioning

`src/sectors/d-personalization/reranker/prompt.ts`:

```ts
export const PROMPT_VERSION = "v1.0.0-fase3c";

export const RERANKER_SYSTEM_PROMPT = `Eres un curador experto de productos para una tienda reseller en Cuba. Recibes un JSON con:
- profile: resumen narrativo del usuario
- contexto: { hora (0-23), dia (nombre del día) }
- ultima_interaccion: descripción de la última acción (puede ser null)
- query_reciente: query de búsqueda reciente (puede ser null)
- candidatos: array de 30 productos con { product_id, title, price_cents, brand, category }

Tu trabajo: re-rankear al top-10 más relevante para ESTE usuario en ESTE momento, y generar una razón corta (máx 12 palabras, español) para cada producto.

Reglas para las razones:
- Concretas, NUNCA genéricas. PROHIBIDO: "para ti", "popular", "producto recomendado", "te puede gustar", "popular esta semana", "alto rating".
- Deben referenciar un atributo específico del producto o del perfil del usuario.
- Ejemplos buenos:
  - "Complementa el iPhone que viste hace un momento"
  - "Perfecto para regalar a tía adulta"
  - "Estilo formal que sueles preferir"
  - "Precio acorde a tu presupuesto habitual"
- Ejemplos malos:
  - "Producto recomendado"
  - "Te puede gustar"
  - "Popular esta semana"

Devuelve SOLO un objeto JSON con shape exacto:
{ "items": [ { "product_id": "uuid", "rank": 1, "reason": "..." }, ... ] }
Exactamente 10 items con ranks únicos de 1 a 10. Sin markdown wrap, sin texto adicional.`;
```

### 5.2 `rerankWithLLM` core

`src/sectors/d-personalization/reranker/rerank.ts`:

```ts
import { z } from "zod";
import { anthropicHaikuProvider } from "@/lib/llm/providers";
import { stripMarkdownWrapper } from "@/sectors/b-catalog/enrichment/normalizer";
import { RERANKER_SYSTEM_PROMPT, PROMPT_VERSION } from "./prompt";

const responseSchema = z.object({
  items: z.array(z.object({
    product_id: z.string().uuid(),
    rank: z.number().int().min(1).max(10),
    reason: z.string().min(1).max(200),
  })).length(10),
});

export interface RerankerContext {
  profile_summary: string;
  hour: number;
  day_of_week: string;
  last_interaction: string | null;
  recent_query: string | null;
}

export interface RerankerCandidate {
  product_id: string;
  title: string;
  price_cents: number;
  brand: string;
  category: string;
}

export interface RerankerOutput {
  items: { product_id: string; rank: number; reason: string }[];
  prompt_version: string;
  usage: { input_tokens: number; output_tokens: number };
}

export async function rerankWithLLM(input: {
  candidates: RerankerCandidate[];
  context: RerankerContext;
}): Promise<RerankerOutput> {
  if (input.candidates.length < 10) {
    throw new Error(`reranker requires >= 10 candidates, got ${input.candidates.length}`);
  }
  const userMsg = JSON.stringify({
    profile: input.context.profile_summary,
    contexto: { hora: input.context.hour, dia: input.context.day_of_week },
    ultima_interaccion: input.context.last_interaction,
    query_reciente: input.context.recent_query,
    candidatos: input.candidates,
  });
  const res = await anthropicHaikuProvider.chat({
    system: RERANKER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMsg }],
    maxTokens: 1500,
    temperature: 0.3,
    cacheSystem: true,
  });
  const text = stripMarkdownWrapper(res.text);
  const parsed = JSON.parse(text);
  const valid = responseSchema.parse(parsed);

  // Validate: ranks are unique 1..10 + product_ids are subset of input
  const ranks = new Set(valid.items.map((x) => x.rank));
  if (ranks.size !== 10) throw new Error("ranks not unique 1..10");
  const inputIds = new Set(input.candidates.map((c) => c.product_id));
  for (const it of valid.items) {
    if (!inputIds.has(it.product_id)) {
      throw new Error(`unknown product_id ${it.product_id}`);
    }
  }

  return {
    items: valid.items,
    prompt_version: PROMPT_VERSION,
    usage: res.usage,
  };
}
```

### 5.3 `buildProfileSummary` helper

`src/sectors/d-personalization/reranker/profile-summary.ts`:

```ts
import type { Client } from "pg";
import type { CohortId } from "../cohorts/definitions";
import { parseCohort } from "../cohorts/definitions";

const COHORT_HUMAN: Record<string, string> = {
  femenino_bebe: "mujer recién nacida",
  femenino_nina: "niña",
  femenino_joven: "mujer joven",
  femenino_adulta: "mujer adulta",
  femenino_mayor: "mujer mayor",
  masculino_bebe: "varón recién nacido",
  masculino_nino: "niño",
  masculino_joven: "hombre joven",
  masculino_adulto: "hombre adulto",
  masculino_mayor: "hombre mayor",
  unisex_indeterminado: "usuario sin perfil definido",
};

export async function buildProfileSummary(
  user_profile_id: string,
  recipient_id: string | null,
  cohort_id: CohortId,
  pg: Client,
): Promise<string> {
  const cohortHuman = COHORT_HUMAN[cohort_id] ?? "usuario";

  // Top-3 categorías recientes (events últimos 30d)
  const r = await pg.query(
    `SELECT p.metadata->>'category' AS cat, COUNT(*) AS n
     FROM events e
     JOIN products p ON p.id = (e.payload->>'product_id')::uuid
     JOIN user_profiles up ON up.id = $1
     WHERE e.occurred_at > now() - interval '30 days'
       AND e.event_type IN ('product_view', 'add_to_cart', 'purchase')
       AND (e.anonymous_id = up.anonymous_id OR e.user_id = up.user_id)
       AND p.metadata->>'category' IS NOT NULL
     GROUP BY p.metadata->>'category'
     ORDER BY n DESC LIMIT 3`,
    [user_profile_id],
  );
  const topCats = (r.rows as { cat: string }[]).map((x) => x.cat).filter(Boolean);

  const recipientPhrase = recipient_id ? "compra para un destinatario específico" : "navega sin destinatario fijado";
  const catsPhrase = topCats.length > 0
    ? `Categorías frecuentes: ${topCats.join(", ")}.`
    : "Sin categorías frecuentes aún.";

  return `Perfil estimado: ${cohortHuman}. ${recipientPhrase}. ${catsPhrase}`;
}
```

### 5.4 Tests del bloque 2

- **Unit** `reranker-prompt.test.ts`: PROMPT_VERSION matches regex `v\d+\.\d+\.\d+-fase3c`; SYSTEM_PROMPT non-empty; non-genericos en spec ejemplos.
- **Integration REAL Anthropic** `rerank-real.test.ts`:
  - 30 candidatos diversos + context user adulta + viendo iPhone hace 3 min → output 10 items.
  - Cada item tiene rank ∈ [1,10] único.
  - Cada `product_id ∈ candidatos`.
  - Cada `reason` non-empty + non-generic (regex anti-placeholder).
  - `prompt_version` matches PROMPT_VERSION.
  - Cost: ~$0.001-0.002 per test.

## 6. Bloque 3 — Cache fuerte `feed_rerank_cache` + invalidación

### 6.1 Migración 0019

```sql
CREATE TABLE IF NOT EXISTS public.feed_rerank_cache (
  cache_key  text PRIMARY KEY,
  user_profile_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  top10_json jsonb NOT NULL,
  prompt_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ttl_until  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS feed_rerank_cache_profile_ttl_idx
  ON public.feed_rerank_cache(user_profile_id, ttl_until);
CREATE INDEX IF NOT EXISTS feed_rerank_cache_ttl_idx
  ON public.feed_rerank_cache(ttl_until);
```

Replicar en `test_schema` (migración 0020).

### 6.2 Cache key

`src/sectors/d-personalization/reranker/cache-key.ts`:

```ts
import { createHash } from "node:crypto";
import { PROMPT_VERSION } from "./prompt";

export function buildRerankCacheKey(
  user_profile_id: string,
  top30Ids: string[],
): string {
  // Sort to make order-independent (same 30 ids = same key)
  const sorted = [...top30Ids].sort();
  const input = `${user_profile_id}|${sorted.join(",")}|${PROMPT_VERSION}`;
  return createHash("sha256").update(input).digest("hex");
}
```

### 6.3 Lookup + write + cleanup

`src/sectors/d-personalization/reranker/cache.ts`:

```ts
import type { Client } from "pg";
import { PROMPT_VERSION } from "./prompt";

export const CACHE_TTL_HOURS = 4;

export interface CachedRerankItem {
  product_id: string;
  rank: number;
  reason: string;
}

export async function lookupRerankCache(
  cache_key: string, pg: Client,
): Promise<CachedRerankItem[] | null> {
  const r = await pg.query(
    `SELECT top10_json FROM feed_rerank_cache
     WHERE cache_key = $1 AND ttl_until > now()`,
    [cache_key],
  );
  return r.rows.length > 0 ? (r.rows[0].top10_json as CachedRerankItem[]) : null;
}

export async function writeRerankCache(
  cache_key: string,
  user_profile_id: string,
  items: CachedRerankItem[],
  pg: Client,
): Promise<void> {
  await pg.query(
    `INSERT INTO feed_rerank_cache
       (cache_key, user_profile_id, top10_json, prompt_version, ttl_until)
     VALUES ($1, $2, $3::jsonb, $4, now() + ($5 || ' hours')::interval)
     ON CONFLICT (cache_key) DO UPDATE SET
       top10_json = EXCLUDED.top10_json,
       prompt_version = EXCLUDED.prompt_version,
       ttl_until = EXCLUDED.ttl_until`,
    [cache_key, user_profile_id, JSON.stringify(items), PROMPT_VERSION, CACHE_TTL_HOURS],
  );
}

export async function cleanupExpiredRerankCache(pg: Client): Promise<number> {
  const r = await pg.query(`DELETE FROM feed_rerank_cache WHERE ttl_until <= now() RETURNING 1`);
  return r.rows.length;
}
```

CLI `scripts/cron-rerank-cache-cleanup.ts` corre diariamente.

### 6.4 Tests del bloque 3

- **Unit** `cache-key.test.ts`: misma entrada → mismo hash; orden distinto top30 → mismo hash (sort).
- **Integration** `rerank-cache.test.ts`: write → lookup hit; lookup tras TTL → null; cleanup borra expirados.

## 7. Bloque 4 — Wiring en `generateFeed` + UI razones

### 7.1 `generateFeed` extendido

Después de los blocks RRF + (NEW) MMR + (NEW) reranker:

```ts
import { mmrSelect } from "./retrieve/mmr";
import { rerankWithLLM } from "./reranker/rerank";
import { buildProfileSummary } from "./reranker/profile-summary";
import { buildRerankCacheKey } from "./reranker/cache-key";
import { lookupRerankCache, writeRerankCache, type CachedRerankItem } from "./reranker/cache";

// ... after rrfFuse(allLists), expand to top-100:
const top100 = rrfFuse(allLists).slice(0, 100);
if (top100.length === 0) return [];

// MMR top-100 → top-30
const candidateIds = top100.map((f) => f.id);
const embeddings = await fetchProductEmbeddings(candidateIds, pg);
const top30 = mmrSelect({ candidates: top100, embeddings, k: 30 });
const top30Ids = top30.map((t) => t.id);

if (!profile_id) {
  // No profile (no anon, no user) → skip reranker, return MMR top-10
  const fallbackIds = top30.slice(0, limit).map((t) => t.id);
  return resolveProductsByIds(fallbackIds, pg);
}

// Cache lookup
const cacheKey = buildRerankCacheKey(profile_id, top30Ids);
let cached: CachedRerankItem[] | null = await lookupRerankCache(cacheKey, pg);

if (!cached) {
  try {
    const candidates = await fetchRerankerCandidates(top30Ids, pg);
    const context = {
      profile_summary: await buildProfileSummary(profile_id, recipientId, cohortId, pg),
      hour: new Date().getHours(),
      day_of_week: DAYS_ES[new Date().getDay()],
      last_interaction: lastViewedProductTitle ?? null,
      recent_query: null,
    };
    const r = await rerankWithLLM({ candidates, context });
    cached = r.items;
    await writeRerankCache(cacheKey, profile_id, cached, pg);
  } catch (e) {
    console.warn("[feed] reranker failed, fallback to MMR top-10:", e);
    cached = top30.slice(0, 10).map((t, i) => ({
      product_id: t.id,
      rank: i + 1,
      reason: "",
    }));
  }
}

// Resolve products + map reasons
return resolveWithReasons(cached.slice(0, limit), pg);
```

### 7.2 FeedItem schema extendido

```ts
export interface FeedItem {
  product: ProductListRow;
  similarity: number;
  reason?: string; // NEW (F3c)
}
```

### 7.3 ProductCard.tsx UI

Pasar `reason` desde HomePage. ProductCard muestra:

```tsx
<p className="text-sm text-gray-500 mt-1">${(product.price_cents / 100).toFixed(2)}</p>
{reason && (
  <p
    className="text-xs text-blue-600 mt-1 italic line-clamp-2"
    title={reason}
  >
    {reason}
  </p>
)}
```

### 7.4 Tests del bloque 4

- **Integration** `feed-3c-cache.test.ts`: primera llamada con LLM real (~1.5s); segunda llamada inmediata con mismo top-30 → 0 LLM calls (verificado via timing < 200ms).
- **Integration** `feed-3c-fallback.test.ts`: env override `ANTHROPIC_API_KEY=` vacío → reranker throws → fallback devuelve top-10 con `reason=""` sin crash.
- **Integration** `feed-3c-end-to-end.test.ts`: feed completo con anonymous user, 10 events → top-10 con razones non-empty + non-generic.

## 8. Bloque 5 — Eval holdout temporal + manual audit + cierre

### 8.1 Eval cuantitativo holdout temporal

`scripts/eval-personalization-3c.ts`:

Flujo:
1. **Setup**: TRUNCATE test_schema. Genera 30 días de events sintéticos para 5 usuarios (cohortes variadas: fem_adulta, masc_adulto, fem_nina, masc_mayor, unisex_implicito).
2. **Catálogo**: 60 productos distribuidos por cohorte (12 cada una × 5 = 60).
3. **Events generation**:
   - Days 1-23 (train): 80% interaction events
   - Days 24-30 (eval): 20% — estos son el holdout
4. **Train phase**: ingerir events_train en orden cronológico via `processEventForPersonalization`. Run `cron:cohort-centroids` + `cron:npmi-recompute`.
5. **Eval phase**: para cada user en holdout:
   - Generate feed AT timestamp del primer event del eval period (`generateFeed` con top-10).
   - Match top-10 vs holdout productos (los que el user efectivamente interactuó días 24-30).
   - Compute Recall@10, nDCG@10, MRR.
6. **Compare**: F3c (con MMR + LLM rerank) vs F3b (solo RRF — accesible via flag o llamando RRF directo) vs baseline (top-popular global).
7. **Output**: Markdown report con tabla comparativa.

### 8.2 Auditor manual de razones

`scripts/eval-3c-audit-razones.ts`:

```
1. Setup mismo que eval cuantitativo (datos train completos).
2. Para 6 usuarios sintéticos diversos: generar feed top-10.
3. Imprimir las 60 razones (6 users × 10 razones each — wait, 30 según planeación) en Markdown:
   - User label
   - Top-10 con producto + razón
4. Reporte template con checkboxes [ ] coherente para cada razón.
5. Tú revisas, marcas [x] coherente / [ ] no coherente.
6. Cuenta: ≥80% coherentes = ✅ pass.
```

Para el smoke automatizado: assertion básica que cada razón pase regex anti-placeholder + sea ≥3 palabras.

### 8.3 Métricas técnicas

- **Latencia p99 < 1.5s**: medido en eval con 20 feeds back-to-back. Reportar p50/p95/p99.
- **Cache hit rate**: medido en eval con 6 users × 5 feeds c/u = 30 calls. Esperado: primera vez miss, subsecuentes hit (>70%).
- **Costo total eval**: sumar usage tokens × Haiku pricing. Reportar.

### 8.4 Compuertas de cierre F3c

- [ ] **Cuantitativo**: nDCG@10 F3c > F3b en holdout temporal (≥+5% relativo).
- [ ] **Cualitativo**: ≥80% razones coherentes (audit manual).
- [ ] **Performance**: latencia p99 < 1.5s.
- [ ] **Robustez**: fallback funciona si Anthropic falla (test integration).
- [ ] `pnpm test:unit && pnpm test:integration` verde.
- [ ] `pnpm test:quality` 0 violations.
- [ ] Triple revisión APPROVED.

## 9. File map consolidado

```
supabase/migrations/
├── 0019_feed_rerank_cache.sql                       [NEW]
└── 0020_test_schema_replicate_3c.sql                [NEW]

src/sectors/d-personalization/
├── retrieve/
│   └── mmr.ts                                       [NEW] mmrSelect
├── reranker/                                        [NEW dir]
│   ├── prompt.ts                                    PROMPT_VERSION + SYSTEM_PROMPT
│   ├── rerank.ts                                    rerankWithLLM (Haiku)
│   ├── profile-summary.ts                           buildProfileSummary
│   ├── cache-key.ts                                 buildRerankCacheKey
│   └── cache.ts                                     lookup/write/cleanup
└── feed.ts                                          [MODIFY] add MMR + reranker stages

src/components/
└── ProductCard.tsx                                  [MODIFY] mostrar reason

src/app/(shop)/page.tsx                              [MODIFY] pasar reason a ProductCard

scripts/
├── cron-rerank-cache-cleanup.ts                     [NEW]
├── eval-personalization-3c.ts                       [NEW]
└── eval-3c-audit-razones.ts                         [NEW]

tests/
├── unit/
│   ├── mmr-personalization.test.ts                  [NEW] λ behaviors
│   ├── reranker-prompt.test.ts                      [NEW] version, format
│   └── cache-key.test.ts                            [NEW] sort-independence
└── integration/
    ├── rerank-real.test.ts                          [NEW] REAL Haiku
    ├── rerank-cache.test.ts                         [NEW] hit/miss/TTL/cleanup
    ├── feed-3c-cache.test.ts                        [NEW] cache hit no calls Haiku
    ├── feed-3c-fallback.test.ts                     [NEW] graceful Haiku error
    ├── feed-3c-end-to-end.test.ts                   [NEW] complete pipeline
    └── eval-3c-smoke.test.ts                        [NEW] eval orquesta sin error
```

## 10. Tests — inventario y costo

| Tipo | Archivos | # tests aprox | APIs reales | Costo aprox |
|---|---|---|---|---|
| Unit | 3 | ~12 | — | $0 |
| Integration (pg) | 4 | ~10 | pg + Voyage | ~$0.005 |
| Integration (Haiku) | 3 | ~6 | pg + Anthropic | ~$0.008 |
| Eval smoke | 1 | 1 | pg + Voyage + Anthropic | ~$0.01 |
| Eval full run | 1 (script) | (no test) | + Anthropic | ~$0.05-0.10 |

**Total: ~29 tests nuevos. Coste suite ~$0.02, eval full ~$0.10.**

## 11. Riesgos identificados

1. **Calidad de razones inconsistente.** Haiku puede devolver razones que pasan regex pero son ligeramente genéricas. Mitigación: prompt explícito + ejemplos buenos/malos + manual audit con re-iteración del prompt si <80%.

2. **Latencia con cache miss puede picar.** Si muchos users cold-start simultáneamente, latencia p99 puede subir. Mitigación: monitoreo en admin (futuro), eventual streaming de razones progresivamente.

3. **Cache invalidation por cambio de prompt.** Si cambiamos PROMPT_VERSION, todo el cache vivo queda inutilizable. Esperado por diseño — pero hay que documentarlo para futuras iteraciones.

4. **MMR con vectores degenerados.** Si dos productos tienen embeddings idénticos (raro pero posible si descripciones idénticas), MMR puede oscilar. Mitigación: cosine simlarity == 1.0 case tested.

5. **Anthropic API key budget.** Tu sensibilidad histórica al costo. Mitigación: cache 4h + prompt versioning + monitorear via admin futuro.

6. **Holdout temporal sin datos reales.** Eval sintético construye 30d de events. No es producción. Verdadero holdout temporal será en Fase 5 cuando haya users reales.

## 12. Items diferidos sin cambio respecto a master doc

- **Multi-objective ranking explícito** con λ aprendidos por bandit → v2.
- **Cross-encoder neural reranker** (BGE) sustituyendo el LLM cuando latencia importe → v2.
- **A/B testing infra** → v2.
- **Calibración empírica θ semantic cache** → Fase 5.
- **TTL cleanup cron del cache** (de F2) → Fase 4.
- **Admin role-based access real** → Fase 4.

## 13. Definition of done

- [ ] Migración 0019+0020 aplicada (`feed_rerank_cache`).
- [ ] MMR `mmrSelect` con λ=0.7 integrado en `generateFeed`.
- [ ] Anthropic Haiku reranker con prompt versionado.
- [ ] `buildProfileSummary` genera narrativa coherente.
- [ ] Cache fuerte con sort-independent key.
- [ ] Fallback graceful si Anthropic falla.
- [ ] ProductCard muestra razones generadas.
- [ ] Eval cuantitativo holdout temporal: nDCG@10 F3c > F3b (≥+5% relativo).
- [ ] Eval cualitativo: ≥80% razones coherentes (audit manual al cierre).
- [ ] Latencia p99 < 1.5s.
- [ ] `pnpm test:unit && pnpm test:integration` verde.
- [ ] `pnpm test:quality` 0 violations.
- [ ] Triple revisión APPROVED.

## 14. Triple revisión Fase 3c

Mutaciones críticas a verificar:
1. `MMR_LAMBDA = 0.7` → 1.0 (puro RRF) → tests de diversidad fallan.
2. MMR signo `- (1-λ)` → `+ (1-λ)` → tests de diversidad fallan.
3. PROMPT_VERSION constant cambio → cache hash cambia → invalidación verificada.
4. `cache-key` sin sort → orden distinto = key distinto → test sort-independence falla.
5. Reranker `.length(10)` → `.min(5)` → schema acepta menos de 10 → fallback de output count.

## 15. Próximo paso

Tras review del usuario, invocar `writing-plans` para producir plan ejecutable (~17-20 tareas).
