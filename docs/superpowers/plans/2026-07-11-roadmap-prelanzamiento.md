# ROADMAP PRIORIZADO — Tuki (pre-lanzamiento, 4 tiendas reales activas)

## 1. Esta semana (pre-lanzamiento)

### 1.1 Mostrar productos locales de inmediato en búsqueda (no esconderlos detrás de un spinner falso)
- **Qué**: en `useTukiSearch.ts:104-123`, eliminar la animación fija de 4200ms y pintar `r1.products` de inmediato con `finish()`, sin importar `called_mock`. Si `called_mock=true`, arrancar después un poll de fondo (setTimeout cada ~2.5s, tope 5 intentos, reusa el guard `runId` ya existente) que solo hace `setCards`/`setMeta` (append, sin re-trackear ni reactivar el loader) cuando lleguen productos nuevos.
- **Por qué (UX)**: hoy el usuario espera 4.2s de spinner decorativo para ver exactamente lo mismo que ya estaba disponible desde el primer request (`search.ts:309-326` calcula `fused`/`productIds` ANTES de encolar la ingesta). Con 4 tiendas reales activas y catálogo chico, cada segundo de espera artificial pesa proporcionalmente más.
- **Archivos**: `src/hooks/useTukiSearch.ts` (único archivo). Opcional: chip "buscando en más tiendas…" en `SearchView.tsx` gateado por `meta?.called_mock` (mismo patrón que `cacheBadge`).
- **Esfuerzo**: S (un archivo, sin backend, sin migración).
- **Impacto costo**: ninguno directo, pero evita polls sin tope (cada poll dispara `normalizeQueryWithLLM`+`embed` real) — el tope de 5 intentos ya lo acota.

### 1.2 Saltar re-enriquecimiento (DeepSeek+Voyage) de productos sin cambios
- **Qué**: en `processProduct` (`enrichment/pipeline.ts:14-22`) — punto de entrada único usado por los 4 call-sites (`catalog-refresh.ts:148`, `catalog-fill.ts:73`, `ingest-async.ts:57`, `search.ts:363`) — agregar un `SELECT price_cents, title FROM products WHERE source=$1 AND source_product_id=$2` antes de llamar DeepSeek/Voyage; si no cambió nada, solo `UPDATE last_refreshed_at`. Fix en el punto compartido, no en cada llamador (root-cause, no symptom).
- **Por qué (dinero)**: es el único gasto de toda la tabla de costos **sin techo y sin auditoría** (`AGGREGATOR_DAILY_BUDGET_CENTS` no lo ve). El cron `catalog-refresh` trae básicamente las mismas top-queries día tras día → re-normaliza y re-embebe los mismos productos cada 24h indefinidamente.
- **Archivos**: `src/sectors/.../enrichment/pipeline.ts` (una función, un `SELECT`).
- **Esfuerzo**: S/M (una función, un query nuevo).
- **Impacto costo**: convierte un gasto que crece sin límite en un gasto proporcional a productos *nuevos* reales, no a corridas de cron.

### 1.3 Setear `HYBRID_SEARCH_MOCK_LIMIT` en producción
- **Qué**: definir `HYBRID_SEARCH_MOCK_LIMIT=5` u `8` (hoy vacío en `.env.example:41` → cae a 20 items/fuente por default, `apify/provider.ts:22`).
- **Por qué (dinero)**: knob que ya existe y ya está cableado, cero código.
- **Archivos**: ninguno de código — variable de entorno/deploy.
- **Esfuerzo**: S (minutos).
- **Impacto costo**: −60% a −75% del gasto de Apify en cada búsqueda que dispara ingesta viva.

### 1.4 Cerrar los dos huecos de cuota dura sin freno
- **Qué**: (a) en `rapidapi/sources/aliexpress-datahub.ts:62-76` insertar una fila en `mock_calls` (`source:'rapidapi_aliexpress_search'`) igual que ya hace `hydrate/route.ts:56-84`, para que el fallback `aliexpress-prod` cuente contra el mismo tope de 100/mes; (b) agregar a `cron/catalog-fill.ts` el mismo guard `budgetExceeded` que ya tiene `catalog-refresh.ts:112-117` (o borrarlo — hoy no está en `crontab -l`, solo vive como `pnpm cron:catalog-fill`).
- **Por qué (dinero)**: son las dos únicas rutas de gasto en toda la auditoría sin ningún freno de código — la cuota AliExpress DataHub es 100/mes sin recuperación hasta el mes próximo, y `catalog-fill` puede correrse a mano sin chequear el breaker.
- **Archivos**: `src/.../rapidapi/sources/aliexpress-datahub.ts`, `src/.../cron/catalog-fill.ts`.
- **Esfuerzo**: S (dos cambios chicos, mismo patrón ya existente en el repo).
- **Impacto costo**: evita quemar en minutos una cuota dura mensual, o gastar el breaker diario por un script legacy.

### 1.5 Test del breaker de presupuesto diario end-to-end
- **Qué**: extender el test de integración de búsqueda existente (mismo patrón que `search-mock-fallback.test.ts`, reusando `withTestDb`) con un caso que siembra `mock_calls` con `simulated_cost_cents` sumando ≥400¢ en 24h y verifica `decisionReason="daily_budget_exhausted"` al llamar `hybridSearch`.
- **Por qué**: `AGGREGATOR_DAILY_BUDGET_CENTS=400¢/día` es la regla dura más citada del proyecto y hoy tiene **cero** cobertura automatizada — `grep "daily_budget_exhausted" tests/` da 0 resultados.
- **Archivos**: `tests/integration/search-mock-fallback.test.ts` (o equivalente), `src/sectors/c-search/decide/budget.ts` (solo lectura).
- **Esfuerzo**: S (~30 min, un INSERT + una aserción, infraestructura ya existe).
- **Impacto costo**: ninguno directo — es el seguro más barato posible sobre el freno de gasto más importante del sistema.

---

## 2. Post-lanzamiento

Ordenado por valor:

1. **`MULTI_PROVIDER_SOURCES` por categoría** (`multi.ts:20-27`, `cron/catalog-refresh.ts:110-117`) — hoy pega a *todas* las fuentes configuradas para *cualquier* query; enrutar por `CATEGORY_QUERY` ya existente corta gasto redundante. Impacto medio-alto, esfuerzo medio.
2. **Programar los crons de personalización ya escritos** (`npmi-recompute`, `popularity-7d`, `cohort-centroids`) — sin esto, `co_occurrence_top` (cross-sell/cart-addons, ya sembrado y `approved` desde `0026`) sirve vacío o desactualizado indefinidamente. Requiere decidir scheduler (Vercel Cron / GH Action) primero, por eso no entra "esta semana".
3. **Placement `popular` adicional en home** (slot 20, `INSERT` en `ui_placements`, mismo patrón que `0026_ui_slate_seed.sql`) — variedad con catálogo creciendo, cero código nuevo.
4. **Tests de integración para las 4 rutas HTTP sin cobertura**: hidratación PDP (`hydrate/route.ts`), checkout revalidate (`checkout/revalidate/route.ts`), checkout HTTP autenticado (`api/checkout/route.ts`), provider registry (`provider.ts`) — cada uno ~15-30 líneas, mismo patrón que `checkout-anonymous.test.ts`.
5. **Mecanismo `pinned`/producto custom para el dueño**: columna `products.pinned boolean default false` + `ORDER BY p.pinned DESC` en `category-page.ts:35` + ruta admin `POST /api/admin/products/[id]/pin` (patrón de `requireAdmin`, ~20 líneas). El caso "home" requiere tocar `feed.ts` con más cuidado (reusar `injectPins` antes de la línea 617) — separarlo del resto porque toca el pipeline de fusión.
6. **Revisar el gate `hasCategorySignal`** (`feed.ts:509-511`) con el harness offline ya escrito (`scripts/eval-personalization-3c.ts`) contra los 146 productos reales — la calibración actual viene de un simulador sintético.
7. **Reconstruir el caso de checkout en Playwright** (`shopping-flow.spec.ts`, borrado explícitamente) — menor prioridad porque el integration test HTTP (punto 4) cubre el riesgo real más barato.

---

## 3. NO hacer todavía

- **Activar el agente merchandiser** (`AGENTS_ENABLED=true`) — sin breaker de costo LLM ni UI de aprobación de placements, y con 146 productos casi todas las puertas de confianza (`MIN_SESSIONS_PER_ARM=30`, etc.) van a devolver `null`/`low_sample`. Gastaría LLM real sin producir nada útil.
- **Conectar `gift/suggest.ts`** — cero llamadores hoy fuera de eval; no hay decisión de producto de "modo regalo" explícito que lo requiera.
- **Revivir el reranker LLM** — ya evaluado y descartado por latencia (8-10s vs gate p99<1.5s) y costo, decisión ya documentada (`docs/decision-llm-reranker-2026-06-10.md`).
- **SSE/WebSockets para progreso de ingesta** — es un job de fondo único de ~10-30s, no un stream de eventos; el polling con `setTimeout` (item 1.1) resuelve lo mismo sin transporte nuevo ni reconexión.
- **Tabla/endpoint nuevo de "job status"** — `called_mock` + la invalidación de `product_query_cache` ya son la señal de fin, inventar infraestructura nueva es gasto especulativo.
- **Cassettes/VCR de red real Apify/RapidAPI en CI** — el smoke manual (`apify-smoke.ts`) + fixtures ya cubren los parsers; grabar cassettes paga ese costo en cada corrida de CI para nada nuevo.
- **Matriz e2e multi-browser para checkout** — un dueño único que compra manual no necesita esa cobertura.

---

## 4. Números de costo

| Operación | Costo unitario | Piso/límite oculto |
|---|---|---|
| Apify amazon | $0.003/item, limit default 20 | ninguno |
| Apify aliexpress | $0.0015/item, pero `maxProducts=max(50,limit)` | **piso de 50 items siempre** — con `limit=10` se paga 7.5¢/llamada igual |
| Apify shein | $0.005/item, timeout 420s | fuente más cara por item |
| RapidAPI (5 fuentes) | $0 directo | cuota fija: AliExpress DataHub **100/mes**, Pinto Shein **10/mes** — sin recuperación hasta el mes siguiente |
| DeepSeek (enriquecimiento) | ~$0.00003–0.0001/producto | corre en el 100% de productos de cada fetch, **sin caché de "ya enriquecido"**, invisible al breaker de $400¢/día |
| Voyage (embeddings) | no documentado en repo (no verificable sin salir a internet) | mismo problema: sin caché, invisible al breaker |
| Cron `catalog-refresh` (default, solo amazon) | ~5 llamadas/día ≈ 15¢/día | ~**$4.50/mes** — conservador tal cual está |
| Cron `catalog-refresh` (3 fuentes, si se activaran) | ~15 llamadas/día ≈ 77.5¢/día | ~**$23.25/mes** — protegido por breaker |
| `cron:catalog-fill` (legacy) | mismas fuentes, mismo mecanismo | **sin ningún guard de breaker** — hoy no está en `crontab -l`, pero sigue expuesto como comando manual |
| Búsqueda viva (ingesta por hit fuerte) | variable según tráfico | tope duro del breaker: **$120/mes** en el peor caso (400¢/día × 30) |

**Estimado mensual — actual (config default, sin tocar nada):**
Cron: ~$4.50/mes (solo amazon) + búsqueda viva: 0 a $120/mes según tráfico (tope del breaker) + DeepSeek/Voyage: **sin techo, no cuantificable con precisión** porque re-procesa las mismas top-queries cada 24h sin caché — es el único renglón que crece con el tiempo sin relación al tráfico real.

**Estimado mensual — optimizado (con los 5 items de esta semana aplicados):**
- Cron sin cambio (~$4.50/mes, ya conservador).
- Búsqueda viva: −60% a −75% por `HYBRID_SEARCH_MOCK_LIMIT` (item 1.3) → tope efectivo baja de $120/mes a ~$30-48/mes en el peor caso.
- DeepSeek/Voyage: pasa de "sin techo, crece con el cron" a "proporcional a productos nuevos reales" (item 1.2) — el gasto queda atado al crecimiento del catálogo, no a repeticiones diarias de las mismas queries.
- Cuota AliExpress DataHub (100/mes) y `catalog-fill` legacy: pasan de "sin freno" a "protegidos por el mismo patrón de guard ya usado en el resto del sistema" (item 1.4) — esto no reduce el promedio pero elimina el riesgo de un pico que queme el mes en minutos.

No se pudo cuantificar Voyage con precisión (precio no documentado en el repo) ni el gasto exacto histórico de DeepSeek — honestamente, ninguno de los dos se audita hoy, que es justo el hallazgo central del informe de costos.
