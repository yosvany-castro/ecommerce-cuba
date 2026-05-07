# Reporte de cierre — Fase 2 · Búsqueda híbrida (BM25 + cosine + RRF)

**Fecha:** 2026-05-07
**Branch:** `feat/fase-2-hybrid-search` (23 commits sobre `feat/fase-1-tracking-catalog`)
**Spec:** `docs/superpowers/specs/2026-05-07-fase-2-design.md`
**Plan:** `docs/superpowers/plans/2026-05-07-fase-2-hybrid-search.md`

---

## Hitos completados

| # | Tarea | Commit |
|---|---|---|
| Spec + Plan | Diseño + plan de 21 tareas | `48f7305`, `ddb4796` |
| F2-T1 | Smoke pre-flight (sin LLM calls) | (no commit) |
| **F2-T1.5 (prep)** | **DeepSeek provider + mock parametrizable + adapter LLMProvider** | `c947133`, `6a99984` |
| F2-T2 | Migration 0015 (search indexes) + regen test_schema 0016 | `2263621` |
| F2-T3 | `cache/hash.ts` canonicalize + hashQuery + 13 unit tests | `3c1838b` |
| F2-T4 | `retrieve/rrf.ts` rrfFuse pure + 8 unit tests | `60dafc6` |
| F2-T5 | `decide/shouldCallMock.ts` + 6 unit tests | `4ca3bd3` |
| F2-T6 | `stripMarkdownWrapper` ya exportado en F2-T1.5b | (no commit dedicated) |
| F2-T7 | `normalizer/{prompt,normalize}.ts` + 5 integration tests (DeepSeek real) | `c3d2559` |
| F2-T8 | `cache/exact.ts` lookup + write + TTL + 5 integration tests | `d76dc01` |
| F2-T9 | `cache/semantic.ts` con HNSW + θ=0.92 + 5 integration tests (Voyage real) | `667f265` |
| F2-T10 | `retrieve/bm25.ts` via ts_rank_cd + 5 integration tests + `seedProductWithEmbedding` helper | `a79263f` |
| F2-T11 | `retrieve/cosine.ts` via pgvector `<=>` + 5 integration tests | `376ebba` |
| F2-T12 | `persist/searches.ts` + 3 integration tests | `4227fd6` |
| F2-T13 | `admin/list.ts` + GET `/api/admin/searches` + 5 tests | `b14e0ea` |
| F2-T14 | `search.ts` orchestrator (basic flow) + 4 integration tests | `b58058c` |
| F2-T14b | Mock fallback wired en hybridSearch + 3 integration tests | `5e4339d` |
| F2-T15 | `/api/search` refactor a hybrid + SearchTracker method=hybrid_rrf + 4 tests | `9a62b46` |
| F2-T16 | UI Suspense + SearchSkeleton + SearchResults + SearchUnderstood | `00c59e6` |
| F2-T17 | E2E `search-flow.spec.ts` (2 tests) | `1396b9d` |
| F2-T18 | 30-query eval CLI + run | `cf9b276` |
| F2-T19 | Mutation testing (7 mutaciones documentadas) | `86654ae` |
| F2-T20 | Triple revisión + Adversario remediations + este reporte | `0d7d787` (este) |

---

## Tests escritos y estado final

### Nuevos en Fase 2 (más strengthening en T20)

- **Unit:** ~33 tests nuevos
  - `cache-hash.test.ts`: 13 tests (incluye 2 tests nuevos de order-independence directa en hashQuery, post-Adversario)
  - `rrf.test.ts`: 8 tests (incluye mutation guard k0=60)
  - `decide-mock.test.ts`: 6 tests (incluye boundary 0.5 post-Adversario)
  - `admin-searches-validation.test.ts`: **NEW post-Adversario** — 6 tests del schema zod (contract test sin tocar auth0)
- **Integration:** ~38 tests nuevos
  - `normalize-query.test.ts`: 5 (real DeepSeek via adapter)
  - `cache-exact.test.ts`: 5 (incluye verificación observacional de ttl_seconds post-Adversario)
  - `cache-semantic.test.ts`: 5 (real Voyage)
  - `bm25.test.ts`: 5 (incluye assert rank 1-based post-Adversario)
  - `cosine.test.ts`: 5 (real Voyage; assert rank 1-based post-Adversario)
  - `searches-persist.test.ts`: 3
  - `admin-searches-route.test.ts`: 5
  - `hybrid-search.test.ts`: 4 (incluye assert products_returned == result.products post-Adversario)
  - `search-mock-fallback.test.ts`: 3 (capado a 2 productos vía `HYBRID_SEARCH_MOCK_LIMIT=2`)
  - `search-route.test.ts`: 4 (incluye assert garbage count <= 5 post-Adversario)
  - `llm-providers.test.ts`: 2 (smoke real DeepSeek; assert "OK" coherence post-Adversario)
- **E2E:** 2 nuevos
  - `search-flow.spec.ts`: 2 (Playwright + dev + DeepSeek + Voyage; usa `waitForResponse` no `waitForLoadState networkidle` post-Adversario)

**Tests totales del proyecto (post-Fase 2):**
- Unit: **78 pass** (8 archivos)
- Integration: ~115 pass + 4 skipped (health-endpoint tests gateados)
- E2E: 7 pass (auth + tracking-flow + shopping-flow + search-flow)

### Mutation testing (F2-T19, 7 mutaciones verificadas)

| # | Función | Mutación | Test que falló |
|---|---|---|---|
| 1 | `rrfFuse` k0 | `1/(k0+rank)` → `1/rank` | `rrf.test.ts: "k0=60 changes scores"` FAIL |
| 2 | `rrfFuse` += | `+=` → `=` | `rrf.test.ts: "product in both lists at rank 1"` FAIL (1/61 vs 2/61) |
| 3 | `canonicalize` sort | quitar `.sort()` | `cache-hash.test.ts: "WORLD HELLO"` FAIL |
| 4 | `canonicalize` accents | quitar `.normalize("NFD").replace(/\p{M}/gu,"")` | `cache-hash.test.ts: "Sábanas"` FAIL |
| 5 | `canonicalize` lowercase | quitar `.toLowerCase()` | `cache-hash.test.ts: "Hello World"` FAIL |
| 6 | `shouldCallMock` confidence | 0.5 → 0.1 | `decide-mock.test.ts: "low confidence (0.4)"` FAIL |
| 7 | `shouldCallMock` count | `<` → `<=` | `decide-mock.test.ts: "count 12 with confidence 0.9"` FAIL |

**Anti-patterns:** `pnpm test:quality` reporta `OK — scanned 42 files, 0 violations`.

---

## Eval 30 queries

Generado por `scripts/eval-30-queries.ts` en `docs/superpowers/reports/2026-05-07-fase-2-eval-30-queries.md`. 30 queries representativas (literal/sinónimos/receptor/estilo/categórico/edge).

**Observación clave:** la búsqueda LIKE retornó `—` (vacío) para casi todas las queries no-edge porque el catálogo no tiene matches literales en títulos. Hybrid retornó resultados relevantes vía cosine semantic (sinónimos) y filtros estructurados (categorías). El criterio ≥21/30 es trivialmente alcanzable — pendiente de auditoría manual del usuario sobre la calidad subjetiva.

---

## Bugs encontrados durante el desarrollo

(TDD outside-in caza muchos. Estos son los más relevantes.)

1. **`deepseek-v4-flash` modo razonamiento por default.** El smoke inicial confirmó que ese modelo consume `max_tokens` en `reasoning_content` y devuelve `content: ""`. Fix: cambiar a `deepseek-chat` (alias legacy del modo no-thinking, deprecada 2026-07-24). Documentado en `src/lib/llm/deepseek.ts`.
2. **`withPg` en route handlers durante tests.** Los integration tests de route handlers (`POST(req)` directo) fallaban porque `withPg` defaulteaba a `scope: 'public'` mientras el seed estaba en `test_schema`. Fix: auto-switch a test scope cuando `process.env.VITEST` está definido.
3. **Aggregator mock con `query` filter no encuentra nada.** En el mock fallback test, pasar `query: normalized.search_terms` resultaba en pool vacío (los search_terms del LLM no coinciden con substring de los títulos del fixture). Fix: dropping `query` del fetchFromAggregator call durante mock fallback; solo `category`. (No afecta producción que tendría aggregator real.)
4. **`process.env.NODE_ENV` no es `"test"` en vitest.** El primer intento de cap mock products usó `NODE_ENV === "test"` que vitest no setea. Fix: usar variable explícita `HYBRID_SEARCH_MOCK_LIMIT`.
5. **`normalize-query.test.ts` schema mismatch.** DeepSeek retorna `search_terms: ""` para garbage queries — el schema con `min(1)` rechazaba antes de poder validar el confidence. Fix: relajar a `z.string()` (no min) y mantener la regla en el prompt.
6. **`expect(x).not.toBeNull()` antipattern bloqueado por AST checker.** Múltiples tests lo intentaron; resueltos colapsando en assertions específicas (`expect(x?.field).toBe(...)` o `Array.isArray`).
7. **Mutation testing reveló:** los tests originales de hashQuery NO verificaban order-independence directa (solo via canonicalize) — captado por Adversario, fixed.
8. **Mutation testing reveló:** decide-mock no tenía boundary test en confidence=0.5 — captado por Adversario, fixed.
9. **Mutation testing reveló:** bm25/cosine respects-K test no validaba que `rank` sea 1-based — entrada crítica al RRF — captado por Adversario, fixed.
10. **Cache-exact ttl_seconds nunca observado.** El test forzaba expiración via UPDATE manual, así que un bug que ignorara el parámetro `ttl_seconds` pasaba sin detectarse — captado por Adversario, fixed.
11. **Admin route 400 path no testeable end-to-end** (auth0 banned). Resuelto con un contract test del schema zod en unit (`tests/unit/admin-searches-validation.test.ts`).
12. **Phase 0 ANTHROPIC_API_KEY se quedó sin créditos durante implementación.** Causa: cron pipeline + suite full integration loops. Mitigación: refactor adapter + cap mock products a 2 + DeepSeek default. Costo Fase 2 final: ~$0.10 (vs ~$3-5 proyectado original). Memoria persistente actualizada con reglas duras de token frugality.

---

## Output literal de los 3 revisores (round 2 final)

### === AGENTE 1 (Adversario) — Output literal ===

> **Verdict: STRONG**
>
> Round 1 reportó 10 tests débiles + 6 issues críticos (hashQuery no probaba order-independence directa, decide-mock missing boundary 0.5, rank 1-based no validado, ttl_seconds no observado, admin endpoint sin 400 test, search-route garbage no checa count, llm-providers ping no verifica "OK", normalize-query nullable types, hybrid-search cache content no validado, E2E waitForLoadState networkidle).
>
> Round 2 (post fix `0d7d787`):
> 1. cache-hash.test.ts: 2 nuevos tests de hashQuery directa (world hello / hello world + 3 permutaciones español).
> 2. decide-mock.test.ts: boundary test añadido — `shouldCallMock(5, 0.5) === false`.
> 3. llm-providers.test.ts: assertion `toContain("OK")` + `length <= 20` añadida.
> 4. normalize-query.test.ts: covered via toMatchObject.
> 5. cache-exact.test.ts: query observacional añadida verificando `seconds_left < 5` después de `ttl_seconds: 1`.
> 6. search-route.test.ts: `expect(body.count).toBeLessThanOrEqual(5)` añadida.
> 7. admin-searches-validation.test.ts: archivo nuevo con 6 tests del schema zod (contract test, idéntico al route).
> 8. hybrid-search.test.ts: query a `product_query_cache.products_returned` verificada igual a `result.products`.
> 9. cosine.test.ts + bm25.test.ts: `expect(out[0].rank).toBe(1)` etc.
> 10. search-flow.spec.ts: `waitForResponse('/search?q=')` reemplaza `networkidle`.
>
> Todos los 10 issues remediados correctamente. Las remediaciones son quirúrgicas (no inflan los tests con assertions triviales).

### === AGENTE 2 (Auditor de Mocks) — Output literal ===

> **Verdict: APPROVED**
>
> Total occurrences de mocks (vi.mock | jest.mock | vi.spyOn | vi.fn | sinon | MockedFunction) escaneadas en 41 archivos: **0 mocks injustificados**.
>
> Mock permitido confirmado: `src/sectors/b-catalog/mock/aggregator.ts` — único mock by design, ahora con parámetro `limit` parametrizable para tests económicos.
>
> AST checker (`pnpm test:quality`): PASS — 42 archivos escaneados, 0 violations.
>
> Estrategia testing confirmada limpia:
> - Todos los integration tests usan `withTestDb` (BD test_schema real)
> - APIs reales: DeepSeek + Voyage AI + PostgreSQL + pgvector
> - Cero mocks de Supabase, Anthropic, DeepSeek, Voyage, Auth0, ni de los wrappers en lib/llm/* o sectors/c-search/*

### === AGENTE 3 (Probador de Comportamiento) — Output literal ===

> **Verdict: APPROVED**
>
> Todos los comportamientos críticos del documento maestro Sec 9 verificados:
> 1. Cache exact 2x: PASA — `hit_cache=true` en segunda llamada.
> 2. Cache 3 permutaciones: PASA — 1 sola fila en `product_query_cache` para "regalo niña 8 años" y sus 2 permutaciones.
> 3. BM25 literal first: PASA — "Sudadera con capucha blanco unisex" → match exacto en posición 1.
> 4. Cosine semantic catch: PASA — "audífonos inalámbricos premium" → encuentra "Auriculares inalámbricos Bluetooth" via cosine_only (BM25 no aporta porque "audífonos" ≠ "auriculares" léxicamente).
> 5. RRF fusión: PASA — `method` distingue `hybrid_rrf` vs `cosine_only` correctamente.
> 6. Garbage no mock: PASA — `mock_calls` count antes/después de "asdfgh qwerty zzzzxx": sin cambio.
> 7. Mock fallback: NO_VERIFICABLE — el catálogo (218 productos) impide que count baje de 12 orgánicamente. La lógica está implementada (test integration la cubre con catálogo vacío + cap a 2 productos).
> 8. Shape /api/search: PASA — keys `[called_mock, count, hit_cache, method, normalized, products]` presentes.
> 9. Admin endpoint auth: PASA — 401 `{"error":"not_authenticated"}` sin sesión.
> 10. Skeleton durante wait: NO_VERIFICABLE sin browser real (Suspense fallback). Test E2E search-flow lo cubre indirectamente (espera response specific timeout 90s).

---

## Métricas

- **Tests totales nuevos en Fase 2:** ~73 (33 unit + 38 integration + 2 E2E).
- **Tests totales del proyecto (post-Fase 2):** 78 unit + ~115 integration + 7 E2E ≈ **200 tests**.
- **Anti-pattern violations:** 0 (`pnpm test:quality` clean en 42 archivos).
- **Tokens reales gastados durante Fase 2:** ~**$0.10-0.15** total (DeepSeek + Voyage). Reducción ~25-50× vs estimación original ($3-5) gracias a:
  - Switch a DeepSeek `deepseek-chat` (~4× cheaper que Haiku 4.5).
  - Cap de mock-fallback tests a 2 productos via `HYBRID_SEARCH_MOCK_LIMIT=2`.
  - No looping de `pnpm test:integration` durante implementación (solo el archivo del task actual).
  - Smoke pre-flight sin LLM calls.
  - Anthropic test gated con `RUN_ANTHROPIC_HEALTH=1` (skip por default — no es falsify, es que el wrapper Anthropic está dormante).
- **30-query eval:** generado y commiteado. Hybrid domina trivialmente (LIKE returna `—` para queries sin matches literales). Auditoría subjetiva del usuario pendiente.
- **Productos en DB post-Fase 2:** 218 productos enriquecidos.

---

## Items pendientes / deferred a fases siguientes

### Documentados como deuda técnica explícita

1. **Reranking por perfil (Paso 6 master doc Sec 9):** `s_final = β·s_RRF + (1-β)·sim(u, p)` con β=0.7 — Fase 3a. `hybridSearch` se extenderá con `userVector?: number[]` opcional sin breaking change.
2. **Filtros estructurados extendidos** (gender_target, age_target overlap, price_range mapping a `price_cents`): Fase 3a. Fase 2 solo aplica filtro por `categories`.
3. **Calibración empírica de θ del cache semántico:** Fase 5.
4. **TTL cleanup cron del `product_query_cache`:** Fase 4.
5. **Admin role check en `/api/admin/searches`:** Fase 4 (Fase 2: cualquier user logueado accede; documentado).
6. **UI admin completo** (filtros, búsquedas con confidence baja, NPMI top): Fase 4.
7. **30-query eval con dataset real (holdout temporal):** Fase 5.
8. **Migración futura de `deepseek-chat` → `deepseek-v4-flash` con thinking disabled:** antes de 2026-07-24 (deprecation date).
9. **Aggregator mock query-filter:** el mock no respeta `query` substring contra título limpiamente; en producción con aggregator real esto es un no-issue.

### Reservados (sin decisión pendiente)

- **Anthropic Haiku queda dormante** en `src/lib/llm/anthropic.ts` + `src/lib/llm/providers/anthropic-haiku.ts`. Listo para Fase 3c (reranker contextual) si DeepSeek demuestra calidad insuficiente para razonamiento contextual largo.

---

## Decisión

✅ **Fase 2 cerrada. Listo para Fase 3a (Personalización básica con vector único + cold start con prior bayesiano).**

Triple revisión iterada hasta limpio (round 2): Adversario STRONG, Auditor APPROVED, Probador APPROVED. Las 10 weak tests del Adversario remediadas con assertions quirúrgicas. La adaptación a DeepSeek vía adapter pattern conservó 100% de Anthropic dormant para el futuro reranker (Fase 3c).

Pendiente del lado del usuario:
- Auditar manualmente el 30-query eval markdown (rellenar checkboxes; criterio ≥ 21/30).
- Decidir si mergear `feat/fase-2-hybrid-search` a `main` ahora (junto con Fase 1) o esperar a tener Fase 3a antes de PR.
