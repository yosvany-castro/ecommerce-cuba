# Handoff — Audit adversarial del pipeline de ranking / personalización

> **Para pegar en una nueva conversación.** Este documento es el contexto completo que necesita un agente fresco para someter a prueba (y romper) el sistema de personalización del MVP. Mantén las rutas exactas, los hashes y las decisiones documentadas — no las re-derives.

---

## 0. Misión del agente

**Objetivo:** romper el pipeline de ranking, encontrar el máximo de fallas, malas
decisiones, comportamientos absurdos, supuestos no validados. Producir un reporte
priorizado con tests fallidos reproducibles.

**Scope (in):**
- Reranker LLM (top-30 → top-10 con razones).
- MMR (top-100 → top-30, λ=0.7).
- RRF (3 fuentes → top-100).
- Cache fuerte del reranker (lookup/write/cleanup, TTL 4h).
- Fallback graceful cuando el LLM falla.
- Cohort assignment, multi-modo del usuario, vectores de perfil/sesión.
- "Productos similares" (co-ocurrencia / NPMI / cosine neighbors).
- `generateFeed` end-to-end (`src/sectors/d-personalization/feed.ts`).
- Profile summary (texto que va al prompt del LLM).

**Scope (out):**
- Admin UI, auth, checkout, mock aggregator interno, normalización de queries.
- Refactors no relacionados con bugs encontrados.
- Cambios en main; no merges, no force-push.

**Output esperado:**
1. Lista priorizada (P0 / P1 / P2) de bugs y malas decisiones encontradas.
2. Para cada P0/P1: un test fallido reproducible en `tests/integration/` o `tests/unit/` que demuestre el bug.
3. Recomendaciones de fix (sin implementarlas a menos que se autorice).
4. Reporte final en `docs/superpowers/reports/2026-MM-DD-audit-ranker.md`.

---

## 1. Contexto del proyecto

**Negocio:** e-commerce reseller para Cuba. Revende productos de Amazon /
AliExpress sin stock físico. Cada llamada al mock aggregator = $ real en
producción. Minimizar fallbacks costosos = prioridad arquitectónica.

**Stack:**
- Next.js 16 (App Router, Turbopack), TypeScript 5.6.
- Supabase Postgres + pgvector. Pooler `postgres.qyvpkzjwofouquyvaoag` (free
  tier, auto-pause tras 7 días inactividad — si los tests dan `ENOTFOUND
  postgres.…`, despertar el proyecto en supabase.com/dashboard).
- Auth0 (`@auth0/nextjs-auth0`).
- **Embeddings:** Voyage AI (`voyageai`), dimensión 1024.
- **LLM reranker:** ⚠️ ACTUALMENTE DeepSeek-flash (`defaultProvider`), NO
  Anthropic Haiku como pedía el spec. Swap forzado por créditos Anthropic
  agotados durante T4 de F3c. El adapter `LLMProvider` (F2) permite revertir
  en 1 línea en `src/sectors/d-personalization/reranker/rerank.ts:62`.

**Estado actual del repo:**
- Branch `main` en `d2c2f81` (merge de `feat/fase-3c-mmr-llm-reranker`).
- 176 unit + 221 integration = **397 tests verde** con
  `MOCK_AGGREGATOR_ERROR_RATE=0`. Sin esa env var, el mock simula errores
  aleatorios y un test puede fallar por flakiness no relacionada al ranker.
- 0 violations en `pnpm test:quality` (AST checker).
- 5 mutation tests verificados (MMR_LAMBDA, MMR signo, PROMPT_VERSION,
  cache-key sort, zod `.length(10)`).

---

## 2. Mapa del pipeline (orden de ejecución de `generateFeed`)

Archivo principal: **`src/sectors/d-personalization/feed.ts`**

```
opts {user_id, anonymous_id, session_id, limit=20}
  ↓
getOrCreateProfileForFeed → user_profile_id (o null)
  ↓
readSessionState → cohortId, recipientId, nEventsSession
  ↓
fetchSessionVectorUnnorm (puede ser null)
  ↓
fetchExcludedIds (TTL filter)
  ↓
[Source A] foreach mode in fetchAllModesInBucket:
   effectiveUserVector(profileNorm, sessionNorm, nEventsSession)
   → retrieveTopKByVector(eff, excluded, 50) → listA[mode_i]
[Source B] fetchLastViewedProduct → co_occurrence_top top-30 → listB
[Source C] fetchPopularByCohort(cohortId, excluded, 20) → listC
  ↓
rrfFuse([listsA…, listB, listC]).slice(0, 100)         ← F3b
  ↓
fetchProductEmbeddings(top100)
mmrSelect({candidates, embeddings, k:30, lambda:0.7})  ← F3c (MMR_LAMBDA=0.7)
  ↓
if (!profile_id || top30.length < 10):
   → resolveWithReasons(top30.slice(0,limit), reason="")
else:
   cacheKey = buildRerankCacheKey(profile_id, top30Ids)
     (sha256 de profile_id|sorted_ids|PROMPT_VERSION)
   lookupRerankCache(cacheKey)  → si hit, usar
   si miss:
     ctx = {profile_summary, hour, day_of_week, last_interaction, recent_query}
     rerankWithLLM({candidates(top30), context})  ← DeepSeek
     writeRerankCache(cacheKey, profile_id, items)   ← TTL 4h
   si rerankWithLLM throw → catch → top10 MMR sin razones (FALLBACK silencioso)
  ↓
resolveWithReasons(cached.slice(0, limit))
  → FeedItem[]: {product, similarity, reason?}
```

---

## 3. Mapa de archivos (rutas exactas)

### Personalización — núcleo

| Archivo | Responsabilidad | Sospechas |
|---|---|---|
| `src/sectors/d-personalization/feed.ts` | Orquestador `generateFeed`, wiring completo F3a+F3b+F3c | fallback silencioso, `top30.length < 10` salta reranker sin avisar |
| `src/sectors/d-personalization/retrieve.ts` | `retrieveTopKByVector` (cosine pgvector) + `FeedItem` interface | excluye productos sin embedding sin loguear |
| `src/sectors/d-personalization/retrieve/mmr.ts` | `mmrSelect`, `MMR_LAMBDA=0.7` | λ hardcoded; primer pick por rrf_score puro; ¿qué pasa si embedding falta para un candidato? |
| `src/sectors/d-personalization/retrieve/rrf.ts` | `rrfFuse`, `k_0=60` (verificar) | sin weights por fuente; las 3 listas pesan igual |
| `src/sectors/d-personalization/retrieve/popular-by-cohort.ts` | top-N popular del cohort | si cohort sin events → vacío |
| `src/sectors/d-personalization/retrieve/last-viewed.ts` | último `product_view` de la sesión | sin TTL de sesión aquí mismo |

### Reranker (todo F3c)

| Archivo | Responsabilidad | Sospechas |
|---|---|---|
| `src/sectors/d-personalization/reranker/rerank.ts` | `rerankWithLLM`, zod strict, `defaultProvider` (DeepSeek) | line 62: aquí está el provider; line ~70 strip markdown wrapper; throw si `< 10 candidates`, ranks no únicos, product_id desconocido |
| `src/sectors/d-personalization/reranker/prompt.ts` | `RERANKER_SYSTEM_PROMPT`, `PROMPT_VERSION = "v1.0.0-fase3c"` | el prompt define las reglas (no genérico, no inventar, máx 200 chars) — verificar que el LLM las respeta |
| `src/sectors/d-personalization/reranker/profile-summary.ts` | `buildProfileSummary` → texto humano para el prompt | cohort_id si no mapea → ¿qué string sale? |
| `src/sectors/d-personalization/reranker/cache-key.ts` | sha256 sort-independent de `profile_id|sorted_ids|PROMPT_VERSION` | si cambia el prompt sin bump de version → cache poisoning |
| `src/sectors/d-personalization/reranker/cache.ts` | `lookupRerankCache` / `writeRerankCache` (upsert) / `cleanupExpiredRerankCache`, `CACHE_TTL_HOURS=4` | sin invalidación por evento (purchase debería ¿purgar? no lo hace); race condition entre lookup y write no protegida |

### Personalización — soportes

| Archivo | Responsabilidad |
|---|---|
| `src/sectors/d-personalization/cohorts/definitions.ts` | `CohortId` enum, lista de cohorts |
| `src/sectors/d-personalization/cohorts/centroid-compute.ts` | `computeCohortCentroids` (cron) |
| `src/sectors/d-personalization/cohorts/assign.ts` | asignar cohort a un perfil/sesión |
| `src/sectors/d-personalization/multimode/dispatch.ts` | `fetchAllModesInBucket` (1-3 modos por bucket) |
| `src/sectors/d-personalization/multimode/recompute.ts` | k-means para re-clusterizar modos |
| `src/sectors/d-personalization/profile-mode.ts` | `getOrInitProfileMode` (single mode init) |
| `src/sectors/d-personalization/track-hook.ts` | `processEventForPersonalization` (hook del tracking pipeline) |
| `src/sectors/d-personalization/session/state.ts` | `readSessionState`, estado por session_id |
| `src/sectors/d-personalization/vector/effective.ts` | `effectiveUserVector(profile, session, nEvents)` — mezcla α dinámica |
| `src/sectors/d-personalization/co-occurrence/npmi-recompute.ts` | `recomputeNPMI` (cron) → `co_occurrence_top` |
| `src/sectors/d-personalization/co-occurrence/update.ts` | actualización incremental tras `purchase`/`add_to_cart` |

### LLM providers

| Archivo | Responsabilidad |
|---|---|
| `src/lib/llm/providers/index.ts` | `defaultProvider = deepseekFlashProvider` ⚠️ |
| `src/lib/llm/providers/deepseek-flash.ts` | DeepSeek adapter |
| `src/lib/llm/providers/anthropic-haiku.ts` | Anthropic Haiku adapter (dormant) |
| `src/lib/llm/types.ts` | `LLMProvider`, `ChatInput`, `ChatOutput` |

### Migraciones relevantes

```
supabase/migrations/0019_feed_rerank_cache.sql
supabase/migrations/0020_test_schema_replicate_3c.sql
```

Tabla: `feed_rerank_cache` (cache_key PK, user_profile_id FK CASCADE,
top10_json JSONB, prompt_version, ttl_until). Índices en
`(user_profile_id, ttl_until)` y `(ttl_until)`.

### Specs / planes / reports F3c

```
docs/superpowers/specs/2026-05-15-fase-3c-design.md       (725 líneas)
docs/superpowers/plans/2026-05-15-fase-3c-mmr-llm-reranker.md  (2535 líneas)
docs/superpowers/reports/2026-05-15-fase-3c-eval.md
docs/superpowers/reports/2026-05-15-fase-3c-audit-razones.md
docs/superpowers/reports/2026-05-15-fase-3c-cierre.md     ← lee esto primero
```

Master doc del proyecto: `MVP_Ecommerce_Personalizado_Documento_Maestro v2.md`
(sección 10 = Sector D Personalización; sección 14 = roadmap; sección 15 =
métricas y compuertas).

---

## 4. Decisiones / weak spots conocidos (bootstrap para el agente)

Esto es lo que **yo ya sospecho** que está mal o frágil. El agente debe
verificar, profundizar, encontrar más, y no quedarse aquí.

### 4.1 Calidad del LLM (DeepSeek vs Haiku)
- **Síntoma:** auditoría manual `eval:3c-audit-razones` produce ~10 razones
  idénticas para el cohort "hombre_adulto" ("Coincide con tu perfil de hombre
  adulto"). Otros cohorts diversifican mejor (~10/10).
- **Hipótesis:** DeepSeek menos creativo que Haiku para diversidad. Con el
  swap a Anthropic debería mejorar.
- **Compuerta master doc §15:** ≥80% razones coherentes en audit. Actualmente
  ~66% subjetivo.

### 4.2 Latencia
- **Síntoma:** `eval:personalization-3c` reporta p99 = 6534ms.
- **Compuerta:** p99 < 1500ms.
- **Causa:** DeepSeek cold call ~5-7s. Con Haiku + prompt caching ephemeral
  baja a ~700-1200ms (sin verificar).
- **Cache hit reduce a ~50-100ms** (verificado en `feed-3c-cache.test.ts`).

### 4.3 Baseline del eval cuantitativo está rota
- **Síntoma:** `eval:personalization-3c` reporta `Delta relativo: 0.0%` pese a
  que F3c entrega 33.6% nDCG vs baseline 0%.
- **Causa raíz:** baseline = `events últimos 7 días con event_type='product_view'`,
  pero el eval sintético siembra events en days -30 a -7. Ninguno cae en la
  ventana de 7d → baseline vacío → nDCG = 0 → division by zero corto a 0%.
- **Archivo:** `scripts/eval-personalization-3c.ts` líneas ~165-175.
- **Fix sugerido:** popular global sin window, o ajustar el sintético para
  que algunos events caigan en últimos 7d.

### 4.4 Fallback silencioso
- `feed.ts` líneas ~310-320: si `rerankWithLLM` throw, se mete `reason=""`
  para los 10 productos. **No se loguea métricamente** (solo
  `console.warn`). En producción no hay alerta si DeepSeek falla 100% del
  tiempo. Solo se ve por la ausencia de razones en la UI.
- **Verificar:** ¿hay observabilidad? ¿se cuenta el fallback rate?

### 4.5 Cache no invalida por evento de usuario
- Después de `purchase` o `dismiss`, el cache de rerank del usuario sigue
  fresco 4h. Si el usuario ya compró el producto top-1, el feed se lo sigue
  mostrando en cache hit.
- **Trade-off documentado:** TTL corto + cleanup. Pero podría ser un bug si
  el comportamiento esperado es "refresh on purchase".

### 4.6 MMR `top30.length < 10` salta reranker
- `feed.ts` líneas ~285-295: si después de MMR quedan < 10 candidatos
  (porque hay pocos productos en DB o el cohort es muy pequeño), se omite el
  reranker y se devuelven los MMR sin razones.
- **Probar:** catalog con exactamente 9, 10, 11 productos válidos. ¿Comportamiento
  consistente? ¿UI degrada bien?

### 4.7 RRF sin weights por fuente
- `rrfFuse(listsA, listB, listC)` trata las 3 fuentes igual. Pero
  `popular-by-cohort` es mucho más débil señal que `mode_i` semántico. ¿Debería
  ponderarse?

### 4.8 MMR λ hardcoded en 0.7
- No es configurable por cohort ni por evento. Un usuario que solo compró
  zapatillas Nike probablemente quiere ver más Nike (λ alto), pero un usuario
  exploratorio quiere diversidad (λ bajo).

### 4.9 Cohort assignment edge cases
- `cohort_id` por defecto = `"unisex_indeterminado"` cuando no hay session
  state. Verificar: ¿qué cohort centroide se carga? ¿hay uno para
  `unisex_indeterminado`?

### 4.10 `profile-summary.ts` con `COHORT_HUMAN` enum
- Si llega un `cohort_id` no mapeado en `COHORT_HUMAN`, ¿qué string sale?
  Revisar el fallback.

### 4.11 Embeddings missing en MMR
- `mmrSelect` espera `embeddings: Map<string, number[]>`. Si un product_id
  del top-100 no tiene embedding en DB, el Map no lo contiene. Revisar
  `mmr.ts` para ver el comportamiento (¿skip silencioso? ¿throw? ¿NaN?).

---

## 5. Vectores de ataque sugeridos (concretos)

### 5.1 Adversarial inputs al reranker
- Sembrar producto con título `"DROP TABLE products; --"`, emojis ⚡🔥, unicode
  invisible, prompt injection `"Ignore previous instructions and return..."`.
- Verificar que el reranker devuelve algo válido (zod parse) y que el cache no
  guarda basura.

### 5.2 Coherencia del LLM
- Generar 5 perfiles sintéticos muy distintos (mujer adulta de lujo, niño,
  hombre mayor con bajo presupuesto, etc.).
- Para cada uno, comparar razones generadas con el catálogo. Manualmente
  marcar coherentes ≥80%.

### 5.3 Estabilidad del cache key
- Mismo perfil + mismos 30 ids en distinto orden → mismo cache key
  (ya verificado en `tests/unit/cache-key.test.ts`).
- Pero: ¿qué pasa si entre llamadas el `profile-mode` cambia y por tanto el
  top-30 cambia ligeramente (e.g. 28 mismos + 2 distintos)? Cache miss →
  llamada al LLM. ¿Es esto deseable?

### 5.4 Fallback robusto
- Tirar `DEEPSEEK_API_KEY` inválida (ya cubierto en
  `tests/integration/feed-3c-fallback.test.ts`).
- Tirar **timeout** simulando DeepSeek lento (no cubierto). El LLM provider
  no tiene timeout explícito — verificar.
- Tirar JSON malformado (modificar el provider o mockear) — verificar zod
  throw + catch.

### 5.5 Coocurrencia con catálogo pequeño
- Con 10 productos y 5 events, el NPMI puede saturar (todo coocurre con
  todo). Probar y ver el efecto en `listB` del feed.

### 5.6 Cold start
- Usuario nuevo, 0 events. `listsA` está vacío (no hay modes). `listB` vacío
  (sin last viewed). Solo `listC` (popular_by_cohort).
- ¿El feed se llena con 10 productos? ¿La cohort se asigna correctamente
  (probablemente unisex_indeterminado)?

### 5.7 Multi-modo
- Usuario que compró 10 zapatillas + 10 vestidos formales. ¿k-means en
  `multimode/recompute.ts` crea 2 modos? Verificar.
- ¿Cómo se balancean las 2 listas A en RRF? Cada modo aporta una `RankedList`
  con weight implícito 1.

### 5.8 Sesión vs perfil
- `effectiveUserVector(profileNorm, sessionNorm, nEventsSession)` mezcla con α
  dinámico. ¿α adecuado para los rangos comunes (0-5 events de sesión)?

### 5.9 Excluded products
- `dismiss` agrega a `excluded_products` con TTL. ¿Se respeta en TODAS las
  listas (A, B, C)? Verificar query SQL en cada source.

### 5.10 Concurrencia
- Dos requests del mismo usuario en paralelo (cache miss + cache miss). Dos
  llamadas al LLM, dos writes. Verificar que `ON CONFLICT DO UPDATE` no
  cause inconsistencia.

### 5.11 Cleanup del cache
- `scripts/cron-rerank-cache-cleanup.ts` (cron `cron:rerank-cache-cleanup`).
  ¿Se está ejecutando? No hay scheduling configurado.

### 5.12 Auditoría del prompt
- Leer `RERANKER_SYSTEM_PROMPT` en `prompt.ts`. ¿Está bien escrito? ¿Da
  ejemplos? ¿Prohíbe genéricos? ¿Pide razones concretas y específicas?
- Few-shot examples están o no? Si no están, agregarlos podría subir audit.

---

## 6. Herramientas disponibles

### Scripts pnpm
```bash
pnpm test:unit                       # 176 tests, ~7s
pnpm test:integration                # 221 tests, ~9 min full (LLM real)
pnpm test:quality                    # AST checker, ~3s
pnpm typecheck                       # tsc --noEmit
MOCK_AGGREGATOR_ERROR_RATE=0 pnpm test:integration  # estable para CI

pnpm eval:personalization-3a         # ~30s
pnpm eval:personalization-3b         # ~1 min
pnpm eval:personalization-3c         # ~70s, cuesta ~$0.01 DeepSeek
pnpm eval:3c-audit-razones           # ~30s, cuesta ~$0.005

pnpm cron:catalog-fill --pages N     # llena catálogo (cuesta $0.04 × N)
pnpm cron:cohort-centroids           # local, gratis
pnpm cron:profile-recompute          # local
pnpm cron:npmi-recompute             # local
pnpm cron:rerank-cache-cleanup       # purga expirados

pnpm explain "<query>"               # debug búsqueda híbrida
pnpm health-check                    # verifica DB + voyage + deepseek
pnpm verify:supabase                 # verifica conexión Supabase
pnpm seed:fixture                    # carga fixture de 500 productos
```

### Helpers de testing

`tests/helpers/db.ts`:
- `withTestDb(async (pg) => …)` — abre/cierra conexión a `test_schema`.
- `truncateTestTables(["events", "products", …])` — limpia tablas en orden
  seguro de FKs.

`tests/helpers/seed.ts`:
- `seedProductWithEmbedding(pg, { title, metadata, price_cents?, … })` →
  inserta producto con embedding Voyage real (cuesta ~$0.00002 por seed).
- `seedProduct(pg, …)` — sin embedding.
- `createUser(pg, …)`, `createAnonymousSession(pg, …)`.

`tests/helpers/setup.ts` — bootstrapping vitest.

### Patrón de test integration típico

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "../helpers/db";
import { seedProductWithEmbedding } from "../helpers/seed";

beforeEach(async () => {
  await truncateTestTables(["feed_rerank_cache", "events", "products", …]);
});

test("…", async () => {
  await withTestDb(async (pg) => {
    // seed, run, assert
  });
}, 120_000);
```

### Mutation testing (manual)

```bash
sed -i 's|MMR_LAMBDA = 0.7|MMR_LAMBDA = 1.0|' src/sectors/d-personalization/retrieve/mmr.ts
npx vitest run tests/unit/mmr-personalization.test.ts
sed -i 's|MMR_LAMBDA = 1.0|MMR_LAMBDA = 0.7|' src/sectors/d-personalization/retrieve/mmr.ts
```

Ya verificados (test debe fallar al mutar, pasar al restaurar):
- `MMR_LAMBDA = 0.7 → 1.0`
- MMR signo `- → +`
- `cache-key` sin `.sort()`
- `PROMPT_VERSION` change
- zod `.length(10) → .min(5)`

### Variables de entorno requeridas (`.env.local`)

```
DATABASE_URL=postgres://postgres.qyvpkzjwofouquyvaoag:…
VOYAGE_API_KEY=…
DEEPSEEK_API_KEY=…          # ⚠️ provider activo
ANTHROPIC_API_KEY=…          # opcional, dormant
AUTH0_…                      # no relevante para este audit
```

---

## 7. Disciplina obligatoria (heredada del proyecto)

Estas son reglas duras del proyecto — están en CLAUDE.md / memoria y aplican
también a este audit:

1. **Tests reales obligatorios.** No mockear DB, no mockear LLM. El AST
   checker (`pnpm test:quality`) lo enforza.
2. **No weak assertions.** `expect(x).toBeDefined()` y
   `expect(x).not.toBeNull()` están prohibidos por el checker. Usar
   `expect(x === null).toBe(false)` o asserts concretos.
3. **DB identifiers en inglés.** Tablas/columnas/índices en inglés. UI puede
   ser español.
4. **Token frugality.** No tests de 5k tokens "para demostrar que el cache
   funciona". Solo gastar tokens en tests que capturen regresiones reales.
5. **Push después de cada commit.**
6. **Cada mock call = $ real.** Minimizar mock fallbacks. Este audit puede
   tirar mock calls intencionalmente, pero documentarlo y limpiar después.
7. **Ejecución directa post-plan.** Si haces un plan, ejecútalo tú mismo (no
   dispatches subagents). Edit/Write directo + test + commit + push.
8. **No mega-agent dispatches.** Si subdivides tareas, una por
   subagente, no todas en uno gigante.
9. **No commitear a main.** Trabajar en una branch nueva tipo
   `audit/ranker-pipeline-YYYY-MM-DD`. PR con findings, no merge automático.

---

## 8. Memoria persistente del proyecto

```
/home/codespace/.claude/projects/-workspaces-ecommerce-cuba/memory/MEMORY.md
```

Entradas relevantes:
- `feedback_use_context7.md` — usa Context7 MCP para docs de librerías.
- `feedback_no_mega_agents.md` — no dispatches mega-agents.
- `feedback_direct_execution_over_subagents.md` — ejecución directa.
- `feedback_db_english.md` — DB identifiers en inglés.
- `feedback_token_frugality.md` — tests frugales.
- `project_business_purpose.md` — reseller Cuba, cada mock = $.
- `project_fase3c_provider_swap.md` — DeepSeek vs Haiku, compuertas a re-medir.

---

## 9. Cómo arrancar el audit (recomendación)

1. **Leer en este orden, en frío:**
   - Este documento (handoff).
   - `docs/superpowers/reports/2026-05-15-fase-3c-cierre.md` (cierre F3c con
     compuertas no cerradas).
   - `docs/superpowers/specs/2026-05-15-fase-3c-design.md` (spec).
   - `src/sectors/d-personalization/feed.ts` (orquestador).
   - `src/sectors/d-personalization/reranker/rerank.ts` + `prompt.ts`.
   - `src/sectors/d-personalization/retrieve/mmr.ts`.

2. **Verificar entorno:**
   ```bash
   pnpm health-check
   pnpm test:unit              # 176/176
   pnpm test:quality           # 0 violations
   ```

3. **Crear branch:**
   ```bash
   git checkout -b audit/ranker-pipeline-2026-05-28
   ```

4. **Para cada hipótesis de bug:**
   - Escribir un test failing concreto en `tests/integration/audit-*.test.ts`
     o `tests/unit/audit-*.test.ts`.
   - Confirmar que el test falla en `main` actual (= demuestra el bug).
   - Documentar en notas.
   - **NO implementar el fix** salvo autorización explícita.
   - Commit del test fallido como `test(audit): expose [bug] in [component]`.
     Esto es legítimo TDD adversarial — el test no pasa pero documenta el bug.

5. **Reporte final:**
   `docs/superpowers/reports/2026-MM-DD-audit-ranker.md` con:
   - Lista P0/P1/P2 de findings.
   - Para cada uno: referencia al test fallido, archivo:línea del código
     sospechoso, impacto en producción, fix sugerido (1-2 líneas).
   - Métricas: # bugs encontrados, # tests escritos, % cobertura adicional.

6. **PR al final:**
   `gh pr create --title "audit: ranker pipeline findings" --body …`

---

## 10. Skills sugeridas para invocar

Si el entorno tiene Superpowers disponible:
- `superpowers:systematic-debugging` — para cada bug, no proponer fix sin Phase
  1 (root cause investigation).
- `superpowers:test-driven-development` — para escribir el failing test antes
  de cualquier fix.

Si MCP Sequential Thinking está disponible, úsalo para descomponer hipótesis
complejas (e.g. "¿por qué el reranker degrada con cohorts pequeños?").

---

## 11. Mentalidad: lo que cuenta como "buen finding"

✅ **Vale la pena reportar:**
- Test fallido reproducible que demuestra comportamiento inconsistente.
- Bug de coherencia (e.g. usuario que compró X recibe X en top-1 inmediatamente).
- Cache poisoning o race condition demostrable.
- Asunción no validada del prompt (e.g. el prompt asume formato JSON pero el
  LLM a veces lo envuelve en markdown — verificar `stripMarkdownWrapper`).
- Embedding/dimension mismatch.
- Comportamiento absurdo bajo edge case (catálogo de 5 productos, sesión sin
  cookies, cohort sin centroide).
- Falta de observabilidad en path crítico (silent fallback).

❌ **No vale la pena reportar:**
- "El código no tiene comentarios" (estilo).
- "Podría usarse async/await en lugar de .then" (refactor).
- "El nombre de la variable es confuso" (a menos que cause el bug).
- "Falta documentación" (a menos que cause asunción incorrecta).
- Optimizaciones prematuras sin medición.

---

## 12. Información de cierre

Hash actual: `d2c2f81` en `main`.
Último cierre formal: F3c (2026-05-28).
Próximas fases (no scope de este audit pero contexto): F4 admin completo,
F5 validación con eval set real.

El audit es **previo a F4/F5** — si encuentra bugs P0, deben fixearse antes
de iniciar F4. Si solo encuentra P2, F4 puede arrancar en paralelo.

Buena caza.
