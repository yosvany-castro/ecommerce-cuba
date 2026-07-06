# Apify Real Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Proveedores REALES de productos vía Apify (Amazon, AliExpress, Shein) enchufados al `AggregatorProvider` existente, con atributos reales (precio anterior, imágenes, colores/tallas, rating) persistidos y renderizados en Tuki, un cron diario budget-aware que mete productos nuevos, y la política de búsqueda ajustada para que la ingesta externa dispare de verdad.

**Architecture:** Un wrapper fino de apify-client + 3 mappers puros por fuente que emiten el `MockProduct` shape existente (source ∈ amazon|aliexpress|shein — el union YA calza). Registry mínimo en `provider.ts` seleccionado por env `AGGREGATOR_PROVIDER` (default `mock` → cero cambio de comportamiento hasta flippear). El enriquecimiento pasa a persistir `attributes` curados en `products.metadata.attrs`; la UI prefiere attrs reales con fallback per-field a `demoAttrs`. Costo real del run (`usageTotalUsd`) cae en `mock_calls.simulated_cost_cents` → el budget breaker existente funciona sin cambios.

**Tech Stack:** apify-client ^2.23 (nueva dep), pg, zod, vitest; sin cambios de esquema SQL (metadata es jsonb).

## Global Constraints

- **Token**: `APIFY_TOKEN` ya está en `.env.local` (gitignoreado). JAMÁS commitearlo ni imprimirlo en logs/reports. Añadirlo a `.env.example` como placeholder vacío.
- **Actores decididos** (investigación 2026-07-06):
  - amazon → `junglee/amazon-crawler`. Input: `{ categoryOrProductUrls: [{ url: "https://www.amazon.com/s?k=" + encodeURIComponent(q) }], maxItemsPerStartUrl: limit, proxyCountry: "US" }`. Output: `title, asin, url, price{value,currency}, listPrice, stars, reviewsCount, brand, thumbnailImage, description, variantAttributes`.
  - aliexpress → `devcake/aliexpress-products-scraper`. Input: `{ searchQueries: [q], maxProducts: limit }`. Output: `id/productId, title, precio actual y original, discount, rating, reviewsCount, orders, productUrl, imageUrl`.
  - shein → `api-empire/shein-search-products-scraper`. Input: `{ query: q, maxItems: limit, countryCode: "US" }`. Output estilo API cruda Shein: `goods_id, goods_name, goods_img, detail_image[], retailPrice/salePrice{amount, usdAmount}`. **Fallback aprobado si este falla en el smoke**: `axlymxp/Shein-scraper` (probado por Yosvany, funciona: input `{keywords, country:"US", currency:"USD", language:"en", limit, page}`, output con `relatedColorNew[]` de colores — PERO $40/mes de renta: no activarlo sin OK explícito del usuario).
  - temu → DIFERIDO (actores poco confiables hoy; YAGNI).
- **Costo real**: `ActorRun.usageTotalUsd` (USD float, puede venir null en pay-per-result ajeno) → `cost_cents = Math.ceil(((run.usageTotalUsd ?? estimateUsd) ) * 100)` donde `estimateUsd = items.length * PER_ITEM_USD[source]` (tabla: amazon 0.003, aliexpress 0.0015, shein 0.005). Nunca 0 si hubo run: mínimo 1 cent.
- **Presupuesto**: se respeta el breaker existente (`AGGREGATOR_DAILY_BUDGET_CENTS`, default 400). El cron NUEVO debe chequearlo antes de cada llamada (el catalog-fill viejo no lo hace — el nuevo sí).
- **MockProduct shape es el contrato**: mappers emiten `{ id, source, source_product_id, title, description, image_url, price_cents, brand, raw_category, attributes }` con `attributes` normalizado a: `{ colors?: {name,hex?}[]|string[], sizes?: string[], images?: string[], old_price_cents?: number, rating?: number, orders?: string|number, brand?: string }`.
- **Runs vivos de Apify SOLO en**: el smoke script (T3, límite ≤5 items/fuente) y la verificación final (T8). Los tests unitarios usan fixtures; NUNCA un test automatizado llama a Apify.
- **No tocar**: `g-agents`, la lógica de ranking del feed, el mock provider (queda como default e infraestructura de tests).
- **Commits en español**: `feat(apify): …`. Verificación por task: `pnpm typecheck` + test del task; lint sin errores nuevos (baseline actual 30 problemas).

---

### Task 1: Wrapper de Apify + dep

**Files:**
- Create: `src/sectors/b-catalog/apify/client.ts`
- Modify: `package.json` (dep `apify-client`), `.env.example` (`APIFY_TOKEN=`)
- Test: `tests/unit/apify-client.test.ts` (solo lógica pura: conversión de costo y paginación con cliente inyectado/fake)

**Interfaces:**
- Produces:

```ts
export interface ApifyRunResult { items: unknown[]; costCents: number; latencyMs: number }
export interface RunActorOpts { limitItems: number; timeoutSecs?: number; estimatePerItemUsd: number }
export function runActorGetItems(actorSlug: string, input: Record<string, unknown>, opts: RunActorOpts): Promise<ApifyRunResult>;
export function costCentsFromRun(usageTotalUsd: number | null | undefined, itemCount: number, perItemUsd: number): number; // pura, testeable
```

- Implementación: `new ApifyClient({ token: process.env.APIFY_TOKEN })` module-level lazy; `client.actor(slug).call(input, { waitSecs: timeoutSecs ?? 180, memory: 1024 })` (SIEMPRE waitSecs explícito); si status ≠ SUCCEEDED lanzar con detalle; leer dataset con loop `listItems({ limit: 1000, offset })` hasta agotar `total` o `limitItems`; `costCents = costCentsFromRun(run.usageTotalUsd, items.length, estimatePerItemUsd)` = `Math.max(1, Math.ceil((usageTotalUsd ?? itemCount*perItemUsd) * 100))`.

- [ ] **Step 1**: `pnpm add apify-client` + `.env.example`.
- [ ] **Step 2**: Test que falla — `costCentsFromRun(0.0421, 10, 0.003) === 5`; `costCentsFromRun(null, 10, 0.003) === 3`; `costCentsFromRun(null, 0, 0.003) === 1`; paginación: con un fake dataset client de 2 páginas devuelve items concatenados y corta en `limitItems`.
- [ ] **Step 3**: Implementar → verde → `pnpm typecheck`.
- [ ] **Step 4**: Commit `feat(apify): cliente wrapper con costo real y paginación (T1)`.

---

### Task 2: Mappers por fuente + registry de providers

**Files:**
- Create: `src/sectors/b-catalog/apify/sources/amazon.ts`, `.../aliexpress.ts`, `.../shein.ts` (cada uno: `ACTOR_SLUG`, `PER_ITEM_USD`, `buildInput(opts: FetchOptions)`, `mapItem(raw: unknown): MockProduct | null` — null si el item no trae lo mínimo id+title+precio)
- Create: `src/sectors/b-catalog/apify/provider.ts` (`makeApifyProvider(source)` → `AggregatorProvider` que usa `runActorGetItems` + mapea + filtra nulls + devuelve `FetchResult {products, cost_cents, latency_ms}`)
- Modify: `src/sectors/b-catalog/provider.ts` — registry: `const PROVIDERS = { mock, "apify-amazon", "apify-aliexpress", "apify-shein" }`; `export const activeProvider = PROVIDERS[process.env.AGGREGATOR_PROVIDER ?? "mock"] ?? mock`. Cero cambios en call-sites.
- Test: `tests/unit/apify-mappers.test.ts` — fixtures sintéticos EXACTOS a los outputs investigados (arriba en Global Constraints); asserts: price_cents entero correcto desde USD float, old_price_cents solo si > precio, images[], colors de `relatedColorNew`/`variantAttributes` cuando existan, source_product_id = asin/goods_id/id, item basura → null.

**Notas de mapeo:** Amazon `price.value` USD float → `Math.round(v*100)`; `listPrice` → old si > price. Shein: usar `salePrice.usdAmount ?? retailPrice.usdAmount` (strings numéricos → parseFloat); `retailPrice` como old si difiere. AliExpress: campos de precio pueden venir con símbolo — parsear dígitos/punto. `raw_category`: lo que traiga el item (`cate_name`, breadcrumb, o el query como fallback). `description`: usar la del item o `title` si falta (products.description es NOT NULL DEFAULT '').

- [ ] **Step 1**: Test con fixtures → RED. **Step 2**: mappers + provider factory → GREEN. **Step 3**: registry en provider.ts (default mock; con `AGGREGATOR_PROVIDER=mock` la suite entera debe seguir verde: `pnpm test:unit`). **Step 4**: Commit `feat(apify): mappers amazon/aliexpress/shein y registry de providers (T2)`.

---

### Task 3: Smoke live + captura de fixtures reales

**Files:**
- Create: `scripts/apify-smoke.ts` — CLI: `--source amazon|aliexpress|shein|all --query "..." --limit 5 [--ingest]`. Sin `--ingest`: corre el provider, imprime tabla (title, price, old, imgs#, colors#, sizes#, costCents, latencyMs) y guarda los items CRUDOS en `tests/fixtures/apify/<source>-sample.json` (para endurecer los mappers con datos reales). Con `--ingest`: además pasa cada producto por `processProduct` (requiere T4 para attrs; sin T4 igual funciona, solo que attrs no persisten aún).
- npm script: `"apify:smoke": "tsx scripts/apify-smoke.ts"`.

- [ ] **Step 1**: Implementar script. **Step 2**: CORRERLO live (esto gasta centavos, está autorizado): `pnpm apify:smoke --source all --query "audifonos bluetooth" --limit 5`. Pegar la tabla en el report. Si una fuente falla (actor roto/input inválido): investigar el input schema real del actor vía `https://apify.com/<slug>/input-schema`, ajustar `buildInput`/mapper y reintentar UNA vez; si sigue fallando, reportarlo con el error y seguir con las otras (Shein tiene fallback documentado pero NO activarlo — es de pago mensual, decisión del usuario).
- [ ] **Step 3**: Ajustar mappers con lo aprendido de los items reales + actualizar los tests con los fixtures capturados (reemplazar sintéticos donde difieran). Verde.
- [ ] **Step 4**: Commit `feat(apify): smoke live + fixtures reales de las 3 fuentes (T3)` (los fixtures SÍ se commitean; revisar que no traigan nada sensible — son productos públicos).

---

### Task 4: Persistir attributes reales en metadata

**Files:**
- Modify: `src/sectors/b-catalog/enrichment/pipeline.ts` — tras `normalizeWithLLM`, `metadata = { ...normalized, attrs: curateAttrs(raw.attributes) }`.
- Create función pura `curateAttrs` (en pipeline.ts o archivo hermano): whitelist de claves (`colors, sizes, images, old_price_cents, rating, orders, brand`), valida tipos toscamente, descarta lo demás; devuelve `undefined` si queda vacío (no ensuciar metadata del mock viejo).
- Test: ampliar `tests/integration/` del pipeline si existe, o unit de `curateAttrs` + un caso en la integración de enrichment que verifique `metadata.attrs.colors` persistido tras `processProduct` con un raw que traiga attributes.

- [ ] Steps: test RED → implementar → GREEN → `pnpm test:unit && pnpm test:integration` (los productos del mock viejo no traen esas claves en attributes → `attrs` undefined → cero regresión). Commit `feat(apify): attributes reales curados persistidos en products.metadata.attrs (T4)`.

---

### Task 5: UI — attrs reales con fallback + imágenes renderizadas

**Files:**
- Modify: `src/storefront/contract.ts` — `StorefrontCard.attrs?: { colors?: {name:string,hex?:string}[]; sizes?: string[]; images?: string[]; old_price_cents?: number; rating?: number; sold?: string }`.
- Modify: `src/storefront/map.ts` `toCard` — mapear `metadata.attrs` (colors string[] → `{name}`; orders numérico → sold formateado tipo "1.2k").
- Modify UI (frontera intacta): en `ProductCard.tsx`, `ProductView.tsx`, `HomeFeed.tsx`, `Listing.tsx`: `const da = demoAttrs(...)` pasa a `const a = { ...da, ...pick(card.attrs) }` — precedencia per-field real>demo (un producto con colors reales pero sin rating usa rating demo). `cart-core` weight queda demo (ninguna fuente trae peso).
- **Imágenes**: `ProductCard.tsx` HOY NO renderiza `image_url` (solo placeholder + stripe) — añadir `<img src={card.image_url} …objectFit cover>` con fallback al stripe cuando null (mismo patrón que ProductView:144, incluyendo el eslint-disable de no-img-element). `ProductView` galería: usar `card.attrs?.images` para las 4 miniaturas si existen.
- Test: unit del merge de precedencia (función pura `mergeAttrs(da, attrs)` en `tuki/lib.ts` + test).

- [ ] Steps: test RED → implementar → GREEN → `pnpm typecheck` + boundary test + `pnpm dev` con curl / (sin productos reales aún se ve igual que antes: fallback intacto). Commit `feat(apify): attrs reales con fallback a demo + imágenes en cards (T5)`.

---

### Task 6: Cron diario budget-aware de catálogo

**Files:**
- Create: `scripts/cron-catalog-refresh.ts` + core en `src/sectors/b-catalog/cron/catalog-refresh.ts`
- npm script: `"cron:catalog-refresh": "tsx scripts/cron-catalog-refresh.ts"`

**Lógica (core testeable, conexión inyectada):**
1. Queries candidatas: top `raw_query` de `searches` de los últimos 7 días (GROUP BY, ORDER BY count DESC LIMIT `--queries` default 5, excluir vacías) — si no hay suficientes, completar con rotación de las 6 categorías (`ropa` → query "ropa mujer", etc. mapa fijo).
2. Por cada query × cada fuente habilitada (`APIFY_CRON_SOURCES` env, default `amazon`): chequear `fetchSpentLast24h` contra `AGGREGATOR_DAILY_BUDGET_CENTS` ANTES de cada llamada — si excede, log y stop limpio.
3. `provider.fetch({ query, limit: --limit default 10 })` → log a `mock_calls` (params `{source:"catalog_refresh", provider, query}`, costo real) → dedupe por `source:source_product_id` → `processProduct` en chunks de 3 (mismo patrón que catalog-fill.ts:62-78).
4. Resumen JSON al final (queries corridas, productos nuevos/actualizados, gasto del día, saltadas por budget).
- Test: unit de la selección de queries (con pg fake/fixture) + budget-stop; NO llama a Apify en tests (provider inyectable — el core recibe `provider: AggregatorProvider` como parámetro, el script le pasa el real).
- **Scheduling**: añadir al final del script un log con la línea crontab sugerida (`0 6 * * * cd /home/yosvany/ecommerce-cuba && pnpm cron:catalog-refresh >> logs/catalog-refresh.log 2>&1`) y documentarla en el plan/README corto. No instalar crontab automáticamente.

- [ ] Steps: test core RED→GREEN → script → probar UNA corrida live con `--limit 5 --queries 2` (gasta centavos, autorizado) y pegar resumen en report → Commit `feat(apify): cron diario de catálogo budget-aware desde búsquedas reales (T6)`.

---

### Task 7: Política de "hits fuertes" para disparar ingesta externa

**Contexto:** hoy `shouldCallMock(fused.length, …)` nunca dispara porque el coseno devuelve ~40-50 vecinos top-K sin piso de similitud (verificado en vivo 2026-07-05). Con proveedores reales esto dejaría la ingesta por búsqueda muerta. Cambio de política F4 — mantenerlo pequeño, medible y reversible por env.

**Files:**
- Modify: `src/sectors/c-search/search.ts` — calcular `strongHits` = cuántos resultados fusionados tienen score de coseno ≥ `SEARCH_STRONG_HIT_MIN_SCORE` (env, default `0.55`) O vienen de BM25 (match léxico = fuerte por definición); pasar `strongHits` en vez de `fused.length` a `shouldCallMock`. Con `SEARCH_STRONG_HIT_MIN_SCORE=0` se recupera el comportamiento viejo exacto (todos cuentan).
- Los scores de coseno ya existen en el retrieve (`1 - (embedding <=> $1)` — retrieve/cosine.ts:17); hay que propagarlos hasta el punto de decisión si el fuse los descarta (mirar rrf.ts).
- Test: unit de la función de conteo de strong hits (pura) + caso: 40 vecinos flojos (score .3) + confidence alta → shouldCallMock true; 15 fuertes → false; env=0 → comportamiento viejo.
- Modify: `.env.example` con la nueva var comentada.

- [ ] Steps: TDD → implementar → suite integration de search en verde (los tests existentes de F4 no deben romperse: si alguno asume el conteo viejo, setear env=0 en ese test y anotarlo en el report) → Commit `feat(f4): ingesta externa por hits fuertes — piso de similitud configurable (T7)`.

---

### Task 8: Verificación end-to-end live + flip

**Sin archivos nuevos** (solo `.env.local` del usuario y report).

- [ ] **Step 1**: `AGGREGATOR_PROVIDER=apify-amazon pnpm dev` (env inline o en .env.local). Búsqueda nicho en la UI/API (`curl "localhost:3000/api/search?q=telescopio+refractor"`) → verificar `called_mock: true` (con T7 activo), esperar ~30-60s, repetir la búsqueda → deben aparecer productos REALES de Amazon con `image_url` poblado.
- [ ] **Step 2**: Verificar en la UI (`/search?q=telescopio refractor`): el loader de 4 etapas corre completo, la segunda pasada muestra productos con imágenes reales renderizadas y precio anterior/rating reales donde existan.
- [ ] **Step 3**: `pnpm cron:catalog-refresh --limit 5 --queries 2` → resumen con gasto real; verificar `mock_calls` registra costos reales y el breaker responde.
- [ ] **Step 4**: Suite completa (`pnpm typecheck && pnpm test:unit && pnpm test:integration && pnpm test:e2e`) con `AGGREGATOR_PROVIDER` SIN setear (default mock — los tests no gastan). Reportar TODO con evidencia. Commit final si hubo ajustes: `feat(apify): verificación e2e proveedores reales (T8)`.
- [ ] **Step 5**: DECISIÓN DEL USUARIO documentada en el report: ¿dejar `AGGREGATOR_PROVIDER=apify-amazon` como default en `.env.local`? (el plan NO lo flippea permanente por sí solo).

---

## Omitido a propósito (YAGNI)

- Temu (actores poco confiables — reevaluar cuando maduren).
- Dedup cross-provider (T5 de F4): sigue diferido hasta que DOS fuentes estén activas simultáneamente en producción de verdad.
- next/image + remotePatterns: la UI usa `<img>` plano; optimizar solo si CLS/perf duele.
- Actor de detalle por producto (tallas Shein requieren segunda llamada por SKU): las tallas reales llegan solo de Amazon (variantAttributes) por ahora; el resto usa fallback demo per-field.
- Renta de `axlymxp/Shein-scraper` ($40/mes): solo con OK explícito de Yosvany si `api-empire` falla el smoke.
