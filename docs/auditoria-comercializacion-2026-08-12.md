# Auditoría de comercialización — 2026-08-12

> Auditoría completa de los 6 subsistemas de cara a comercializar la tienda. Método: workflow
> dinámico de 12 agentes (6 lectores con salida estructurada + 6 auditores adversariales que
> intentaron REFUTAR cada sospecha leyendo el código real). Toda afirmación cita `archivo:línea`.
> Rama `main`, generado con Claude Fable 5.

## Veredicto global

- **Señal dura de salud:** `tsc --noEmit` limpio · **656/656 tests unitarios** pasan (84 archivos).
  El código compila y lo que está probado, funciona. Los problemas son de **cableado e integración**
  (caminos que nadie llama, flags que nadie define, UI que no pinta lo que el server computa) —
  exactamente lo que los tests unitarios no ven.
- **Hallazgos:** 61 verificados adversarialmente — **54 confirmados, 7 parciales, 0 refutados**.
  Ninguna sospecha de los lectores resultó falsa.
- **El motor (búsqueda, feed, slate, checkout server-side) es real y sólido.** El humo se concentra
  en: el agente (nunca ha corrido en producción y su palanca principal no se renderiza), el admin
  (inoperable: ni el dueño puede entrar), señales de personalización anunciadas que ningún emisor
  dispara, y copy de UI que promete cosas que el backend no hace.

## Plan priorizado para comercializar

### P0 — bloquea vender o cuesta dinero/confianza YA

| # | Qué | Dónde | Hallazgo |
|---|-----|-------|----------|
| 1 | `ADMIN_EMAILS` no existe → **nadie** (ni tú) puede entrar al admin ni registrar pesos medidos | `.env.local` | ADMIN_ENVIOS-1 |
| 2 | `/api/checkout/revalidate` sin auth ni rate-limit → cualquiera quema tu cuota RapidAPI de pago | `api/checkout/revalidate` | ADMIN_ENVIOS-15 |
| 3 | Todo pedido (incluso logueado) se cuelga del usuario sintético `demo\|anonymous_id` — no hay órdenes por cuenta real | `checkout-anonymous` | ADMIN_ENVIOS-2 |
| 4 | El Total del CartDrawer omite el tax 7.5% → el precio que el cliente ve salta al llegar al checkout (viola tu regla: el precio jamás cambia solo) | `CartDrawer.tsx` | ADMIN_ENVIOS-13 |
| 5 | 409 `totals_changed` espurio sistemático (peso con/sin description cliente vs server) + desglose de libras stale tras el 409 | `checkout-anonymous.ts` | ADMIN_ENVIOS-11 |
| 6 | Producto `is_active=false` sigue siendo comprable desde carrito viejo | `checkout-anonymous.ts` | ADMIN_ENVIOS-10 |
| 7 | Copy que miente al cliente: "comparamos reseñas" (no hay reseñas), "la IA ordena según lo que has mirado" (no), vía marítima anunciada sin tarifa, tarjeta 4242 precargada bajo "🔒 conexión segura", dirección demo mexicana precargada | `SearchView`, `ProductView`, `CheckoutFlow` | AGENTES-4, ADMIN_ENVIOS-5/3/6 |
| 8 | `CATEGORY_PROVIDER_MAP` muerto: cada ingesta consulta las 4 fuentes de pago siempre (el mapa que "corta el gasto ~50%" nunca matchea) | `b-catalog/provider.ts:88` | RANKING-1 |
| 9 | Voyage caído = búsqueda 500 (no degrada a BM25) y sin timeout (cuelga el request) | `search.ts:172`, `voyage.ts` | RANKING-5, VECTORES-11 |
| 10 | Feed páginas 2+ con usuario logueado usan `user_id null` → perfil equivocado, pierden exclusiones | `feed/page/route.ts` | PERSONALIZACION-11 |

### P1 — para que lo que anuncias sea verdad

- **Crons sin scheduler**: fatiga, popularidad 7d, NPMI, recompute de vectores solo corren si los lanzas a mano. Versionar crontab/GitHub Actions. (PERSONALIZACION-4)
- **`seen_at` solo existe en el hero**: los rieles (similar/cross_sell/upsell/cart_addons) jamás registran vistas → fatiga y atribución ciegas fuera del hero. (PERSONALIZACION-3)
- **La compra no alimenta el vector en tiempo real** (peso 5.0 solo vía recompute manual) y la exclusión "purchased" se guarda bajo el usuario demo → lo comprado te sigue persiguiendo. (PERSONALIZACION-2/12)
- **El merge de carrito al login nunca migra nada** (clave `cart:` vs `tuki_cart:`, `qty` vs `quantity`). (DAL-6)
- **`cron-profile-recompute` destruye el multi-modo** (escribe vectores idénticos en todos los modos). (VECTORES-9)
- **Home recargada re-sirve slate viejo tras búsqueda/shift** (TTL 300s; `expireLiveSlate` solo en product_view). (PERSONALIZACION-14)
- **Fallbacks de rieles violan su propio budget** (2+ roundtrips en 250ms → mueren justo cuando hacen falta). (PERSONALIZACION-13)
- **`/api/search` filtra filas crudas de DB** al navegador (description, metadata entero) y el cliente re-mapea a mano — el agujero del contrato. (DAL-3)
- **ETA PDP ≠ checkout** para AliExpress hidratados (provider days ignorados en checkout). (ADMIN_ENVIOS-12)
- **Pesar un producto invalida 20 vecinos sin piso de similitud** (una mancuernа puede anular el peso de un vestido). (ADMIN_ENVIOS-16)

### P2 — decisiones de producto / limpieza

- **Agente:** nunca ha corrido en producción (`AGENTS_ENABLED` indefinida; el cron de las 04:00 es un no-op y así lo confirma `logs/cron.log`). Antes de encenderlo: (a) la home/cart deben **renderizar** los slots 20-90 (hoy el server computa sus secciones y las tira — solo cross_sell de PDP se vería), (b) completar el gate v2.1 (4 seeds faltan; el 2.09× actual es 1 seed, no veredicto; el único gate completo dio 1.005 FAIL), (c) el flujo `request_pause` aprobado por SQL hace lo contrario de pausar. Coste si se enciende: ~$0.01-0.05/día (DeepSeek).
- **Vector de sesión NO existe** (escribe ceros, nadie lo lee) — la sesión influye por otras vías (shift de cohorte, views×3, pins). Decidir: implementarlo o dropear columnas.
- **Pago simulado**: no hay procesador; para vender de verdad hace falta cobro real o flujo manual explícito.
- Columnas/exports muertos: `prior_vector`, `cohort_id`, `interpretable_profile`, `TAU_SESSION_MINUTES`, `budget_queries`, `getCartPage`, `feed-snapshot.ts`, `/api/cart` + `/api/checkout` autenticado, rama `pdp` de slate/resolve.
- `costo_*_cents` en orders es 60% del precio inventado, persistido como si fuera costo real.
- Renombrar/corregir comentarios que mienten (Auth0→Supabase, "HNSW" en similar, `n_users_in_cohort`).

## Dónde ver y trackear al agente (respuesta directa)

- **En producción:** NO hay UI, endpoint ni script de reporte. Sus propuestas aceptadas quedan en
  `ui_placements` (`created_by='agent:merchandiser/v1'`, `proposal_meta` = rationale, run_id,
  metrics_hash); las rechazadas solo en `logs/cron.log`. Hoy trackear = SQL a mano + grep del log.
- **En simulador:** `eval-harness.ts` (--gate/--smoke/--aa), `gate-seeds.ts` (resumible, --verdict),
  `run-gate-parallel.sh`, `verify-ledger.ts` (recuento independiente), `adversarial.ts` (exploits),
  y `--dry-run` del cron ejercita todo sin escribir.
- **Falta construir** (seams ya declarados): `/api/admin/placements` + dashboard de placements
  vivos + UI de aprobación de `pending`.

## Dónde viven los knobs de envío (respuesta directa)

- **Tarifa aérea**: `src/lib/shipping.ts:12` — 350¢/lb default, override `NEXT_PUBLIC_SHIP_AEREO_CENTS_PER_LB`.
- **Marítima**: sin tarifa configurada (por eso el checkout la oculta; la PDP aún la anuncia — P0-7).
- **Tax**: `shipping.ts:53-58` — 7.5% default, override `NEXT_PUBLIC_SALES_TAX_PCT`.
- **Buffer**: `shipping.ts:42` — max(15%, 1 lb), hardcode puro sin env.
- **Tiempos**: `src/lib/delivery.ts` — `STORE_TO_HUB_DAYS` (amazon 3-7 … aliexpress 10-25) +
  `HUB_TO_CUBA_DAYS` (aéreo 7-15, marítimo 25-45), números de calibración admitidos como inventados;
  única fuente real: `provider_ship_min/max_days` de AliExpress (solo la PDP los usa).
- **Nada vive en DB ni tiene UI.** Cambiar un `NEXT_PUBLIC_*` exige rebuild+deploy (se inlinea en el
  bundle del cliente); cambiarlo sin rebuild ⇒ todos los checkouts caen en 409 hasta redeployar.

---
## Ranking y búsqueda

### Cómo funciona hoy

RANKING (request path real de /api/search): hybridSearch (src/sectors/c-search/search.ts:104) hace: (1) hash canónico sha256 de la query lowercased/sin diacríticos/tokens ordenados (cache/hash.ts:3-16); (2) lookup caché EXACTA en product_query_cache con TTL 24h (cache/exact.ts:4,29-39; hit retorna en search.ts:132-168 sin tocar LLM ni embeddings); (3) miss → embed de la query con Voyage voyage-4 1024d L2-normalizado (search.ts:171-172, lib/embeddings/voyage.ts:9-10,71); (4) lookup caché SEMÁNTICA: vecino más cercano por HNSW sobre query_embedding y umbral θ en JS, default 0.92, env SEMANTIC_CACHE_THRESHOLD validado a (0,1] (cache/semantic.ts:4,22-30,32-56; índice en supabase/migrations/0008_search.sql:31-32); (5) miss → normalización LLM con DeepSeek v4-flash, thinking disabled, temp 0, JSON mode, maxTokens 300 (normalizer/normalize.ts:10-25, lib/llm/providers/index.ts:15, lib/llm/providers/deepseek-flash.ts:13-31); fallo LLM → normalized=null y se degrada: rawQuery a BM25, sin filtros, sin ingesta (search.ts:231-235,239,309); (6) BM25 y coseno EN PARALELO con K=50 (search.ts:36,261-272): BM25 = ts_rank_cd(tsvector_es, websearch_to_tsquery('spanish', search_terms)) con filtros de categoría/género/edad/precio (retrieve/bm25.ts:24-52; tsvector generado en migrations/0004_products.sql:13-18, GIN :25-26); coseno = 1-(embedding <=> $1::vector) sobre pgvector con HNSW (retrieve/cosine.ts:16-43, 0004_products.sql:28-29); (7) fusión fuseRelevant = RRF k0=60 (retrieve/rrf.ts:1,20-44) + reorden "barato primero" score'=rrf_score×factor(precio) (×1.25 si ≤$15, hasta ×0.8 si ≥$120, excepción generadores/plantas eléctricas, retrieve/price-boost.ts:15-64) + PISO DE RELEVANCIA sobre lo devuelto: sobrevive solo lo que apareció en BM25 o con coseno ≥0.55 (price-boost.ts:110-139, decide/shouldCallMock.ts:11,60-65). NO hay reranker LLM ni MMR en este path (search.ts no los importa; viven en el feed de personalización: d-personalization/feed.ts:611,627 con MMR_LAMBDA=0.7 en retrieve/mmr.ts:3, y reranker LLM gateado OFF por LLM_RERANK_ENABLED en feed.ts:614-621). (8) DECISIÓN DE INGESTA EXTERNA: countStrongHits pre-fuse (BM25 léxico ∪ coseno≥0.55, search.ts:299-307) y shouldCallMock: dispara si strongHits<12 Y confidence>0.5 (o query-título >8 palabras o force=1 que puentea la confianza, shouldCallMock.ts:77-96, search.ts:310-313) Y la query no se refrescó en <24h (query_aggregator_log, decide/freshness.ts:14-41) Y el gasto 24h en mock_calls < AGGREGATOR_DAILY_BUDGET_CENTS (default 400¢, decide/budget.ts:8-23, search.ts:324-333). Si dispara, modo async default (SEARCH_ASYNC_INGEST!=='false', ingest-async.ts:17-19): devuelve lo local YA y queueExternalIngest corre de fondo con conexión propia + singleFlight por hash — fetch del provider activo, processProduct por ítem, DELETE de la caché exacta de esa query y registro de freshness (ingest-async.ts:28-109); calledMock=true marca que la llamada pagada se disparó (search.ts:336-353). (9) Escritura de caché exacta solo si hay productos y NO hay ingesta en vuelo (search.ts:428-448); log en searches con method/hit_cache/called_mock (persist/searches.ts:18-36, search.ts:450-464). PROVIDER ACTIVO: registry por AGGREGATOR_PROVIDER con default mock (b-catalog/provider.ts:97-103); hoy .env.local trae AGGREGATOR_PROVIDER=multi con MULTI_PROVIDER_SOURCES=amazon-prod,aliexpress-prod,shein-prod,walmart-prod → fan-out real apify+rapidapi con fallback (verificado empíricamente: activeProvider.name='multi'). CLIENTE: useTukiSearch pinta spinner adaptativo por flags reales (hit_cache 1.1s / called_mock 4.2s / local 2.2s) y si called_mock pollea /api/search hasta 10 veces ~3min haciendo append "+N nuevos" (components/tuki/useTukiSearch.ts:60-71,290-337). SUGGEST: /api/suggest es ILIKE sobre title ordenado por last_refreshed_at, sin embeddings ni LLM (app/api/suggest/route.ts:8-16).


### Respuestas a las preguntas del encargo

1) ¿BM25+cosine fusionados por RRF? SÍ, pero no RRF puro: BM25 con ts_rank_cd/websearch_to_tsquery('spanish') (retrieve/bm25.ts:24-52) y coseno pgvector (retrieve/cosine.ts:16-43) corren en paralelo con K=50 (search.ts:36,261-272); la fusión es fuseRelevant = RRF k0=60 (rrf.ts:1,20-44) + reorden 'barato primero' ×factor(precio) con excepción de generadores (price-boost.ts:15-64) + piso de relevancia 0.55 sobre lo devuelto (price-boost.ts:110-139). Verificado también que el stemmer 'spanish' normaliza acentos (probado en DB viva: 'portátil'→'portatil' matchea query sin acento del LLM), así que la instrucción 'sin acentos' del prompt no rompe BM25. 2) ¿Normalización DeepSeek en cada búsqueda? Corre en CADA miss de caché (search.ts:229-236) con deepseek v4-flash thinking-off (providers/index.ts:15, deepseek-flash.ts:24); se AHORRA en hit exacto (retorna en search.ts:132-168 antes de embed/LLM) y en hit semántico (search.ts:190-226) porque normalized_json viene guardado en product_query_cache. No hay caché dedicada del normalizador; DeepSeek cachea el system prompt server-side automático (deepseek-flash.ts:8-11). Fallo → degradación a rawQuery sin filtros y sin ingesta (search.ts:233-239,309). 3) ¿Doble caché funciona? SÍ estructural y operativamente: exacta por hash canónico TTL 24h (hash.ts:3-16, exact.ts:29-39) y semántica por HNSW + θ=0.92 default con env validada (semantic.ts:22-56, índice 0008_search.sql:31-32). Matices honestos: θ decretado no calibrado (comentario semantic.ts:10-21, anisotropía media 0.613); no se cachea resultado vacío ni requests con ingesta en vuelo (search.ts:428-448); el embed Voyage se paga en todo lo que no sea hit exacto (el orden es exacta→embed→semántica, search.ts:170-187). 4) ¿Reranker LLM top-10 y MMR λ=0.7 en producción? NO en el path de búsqueda — search.ts no los importa; el ranking de búsqueda termina en fuseRelevant. Viven en el FEED de personalización: MMR λ=0.7 SÍ corre en producción en el feed (mmr.ts:3, feed.ts:611,627); el reranker LLM está APAGADO por default con gate LLM_RERANK_ENABLED==='true' (feed.ts:614-621, decisión documentada: nunca ganó a RRF+MMR, ~8-10s/call), y esa env NO está en .env.local → apagado. 5) ¿Smart mock que inventa resultados? El generador existe (mock/aggregator.ts:82-100 + llm-generator.ts: productos sintéticos con placehold.co persistidos como reales vía processProduct) pero SOLO actúa si AGGREGATOR_PROVIDER falta o es inválido (default mock, provider.ts:97-103 — verificado empíricamente). HOY está apagado: .env.local AGGREGATOR_PROVIDER=multi con 4 cadenas reales apify+rapidapi (activeProvider.name='multi' verificado) y el catálogo vivo no tiene rastro mock (337 productos, 0 placehold, 0 ids estilo mock). Cuando no hay hits y la decisión dispara, se llama al proveedor REAL de fondo y la UI muestra lo local + poll '+N nuevos' (useTukiSearch.ts:290-337); si de verdad no hay nada, vacío honesto. OJO al humo alta: el ruteo por categoría dentro de 'multi' está muerto y consulta las 4 fuentes siempre. 6) ¿called_mock sigue inalcanzable? NO — arreglado con el piso de similitud: DEFAULT_STRONG_HIT_MIN_SCORE=0.55 (shouldCallMock.ts:11) y countStrongHits pre-fuse (search.ts:299-307); dispara con <12 hits fuertes + confianza>0.5 + freshness>24h + presupuesto <400¢/24h. Evidencia runtime en DB viva: searches tiene 43 filas called_mock=true vs 17 false, y mock_calls registra async_ingest/provider=multi. El mismo piso además filtra lo devuelto (fix del bug 'fan 20000mah'→mochilas). 7) ¿resolve-url (d6bb234)? Es la rama de URL pegada del buscador (modelo reventa): parseProductUrl client-side (re-export en lib/client/product-url.ts:8; useTukiSearch.ts:173-254) → POST /api/products/resolve-url: hit de catálogo por (source,source_product_id) gratis (route.ts:43-49); miss → reserva cuota aliexpress antes del fetch (route.ts:59-62) → detalle vivo con timeout 20s propio (route.ts:26, porque OTAPI shein tarda ~16s medidos; el commit d6bb234 también hizo que un throw/timeout se clasifique TRANSITORIO → 'pending', route.ts:69-76) → ok: processProduct + redirect a la ficha (route.ts:78-97); pending: 202 + reintentos de fondo 20/40/60s con singleFlight (resolve-retry.ts:23,65-109) mientras el cliente pollea ~65s el mismo endpoint y, agotado, cae a /api/search?q=<palabras del slug>&force=1 (slugQueryFromUrl url-resolver.ts:56-64), donde force=1 puentea el veto de baja confianza del normalizador para forzar la ingesta (route.ts:37, search.ts:57-59,310-313). URLs no reconocidas nunca se buscan como texto (useTukiSearch.ts:261-267). No toca las cachés de búsqueda (correcto: es otro camino).


### Hallazgos verificados

**RANKING-1 · HUMO · severidad alta · veredicto: confirmado**

El ruteo de ingesta por categoría (CATEGORY_PROVIDER_MAP, comentado como 'corta el gasto ~50%') es código muerto en el wiring real: el filtro compara claves del registry ('shein-prod','amazon-prod'…) contra provider.name, pero los providers reales se llaman 'apify-amazon+fb:rapidapi-amazon' etc., así que el filtro nunca matchea y el fallback defensivo consulta TODAS las fuentes configuradas (4 cadenas por cada ingesta, incluidas las que el mapa excluye). El test unitario pasa porque fabrica providers nombrados con las claves del registry, enmascarando el bug.

- Evidencia: src/sectors/b-catalog/multi.ts:32-38 (mapa con claves 'shein-prod'…), :47 (filter por p.name), :48-51 (fallback defensivo a todos); src/sectors/b-catalog/fallback.ts:13 (name = `${primary.name}+fb:${fallback.name}`); src/sectors/b-catalog/apify/provider.ts:16 (name = `apify-${source}`); verificado empíricamente con tsx: PROVIDERS['amazon-prod'].name === 'apify-amazon+fb:rapidapi-amazon' ≠ 'amazon-prod'; tests/unit/multi-category-routing.test.ts:33-36 (providers falsos nombrados con las claves → test verde engañoso)

- Corrección sugerida: En provider.ts:88 conservar la clave del registry como name al construir multiSources: `.map((n) => ({ ...PROVIDERS[n], name: n }))` — con eso multi.ts:47 filtra por los mismos nombres que usa el mapa y el test deja de mentir.


**RANKING-2 · HUMO · severidad media · veredicto: confirmado**

El 'smart mock' que INVENTA productos con LLM (títulos/precios sintéticos, imagen placehold.co, source etiquetado amazon/aliexpress/shein) y los persiste en la tabla products como reales es el provider POR DEFECTO cuando AGGREGATOR_PROVIDER falta o tiene typo — un deploy sin esa env inventa catálogo en silencio. Hoy está APAGADO: .env.local trae AGGREGATOR_PROVIDER=multi (verificado activeProvider.name='multi') y el catálogo vivo está limpio (337 productos, 0 con placehold.co, 0 con source_product_id estilo mock).

- Evidencia: src/sectors/b-catalog/provider.ts:97-103 (default `|| mock`, warn y cae a mock ante typo; verificado con tsx sin env: activeProvider.name='mock'); src/sectors/b-catalog/mock/aggregator.ts:82-100 (modo auto usa LLM si hay query); src/sectors/b-catalog/mock/llm-generator.ts:7-22 (prompt 'simulador de la API de Amazon/AliExpress/Shein'); la persistencia como reales ocurre en src/sectors/c-search/search.ts:385-395 e ingest-async.ts:52-62 (processProduct); query en DB viva: placeholder_imgs=0, mock_style_ids=0, total=337

- Corrección sugerida: En provider.ts, tras la línea 98: `if (process.env.NODE_ENV === 'production' && (!envProvider || !PROVIDERS[envProvider])) throw new Error('AGGREGATOR_PROVIDER inválido o ausente en producción')` — mock solo por opt-in explícito en prod.


**RANKING-3 · HUMO · severidad baja · veredicto: confirmado**

persistSearch en los DOS hits de caché registra search_method='hybrid_rrf' hardcodeado, aunque el resultado cacheado se haya generado con cosine_only o bm25_only — la analítica de searches sobre-reporta 'hybrid_rrf'.

- Evidencia: src/sectors/c-search/search.ts:141 y :199 (search_method: 'hybrid_rrf' literal en los paths exact/semantic hit) vs deriveMethod (search.ts:89-93) que solo se usa en el miss path (:425)

- Corrección sugerida: Migración de 1 columna: `ALTER TABLE product_query_cache ADD COLUMN search_method text`; escribirla en writeExact (search.ts:437 pasa `method`) y usar el valor guardado en persistSearch/return de ambos hits.


**RANKING-4 · HUMO · severidad baja · veredicto: parcial**

El decisionReason del trace usa la constante deprecated FRESHNESS_THRESHOLD_HOURS (fija en 24) mientras la decisión real usa currentFreshnessThresholdHours() (env-overridable): con FRESHNESS_THRESHOLD_HOURS seteada ≠24 la razón mostrada en el trace puede contradecir la decisión tomada. Además, en el path de error de ingesta se registra costo hardcodeado de 4¢ (constante del mock) aunque el provider real fallido cueste otra cosa — el presupuesto cuenta un número inventado en errores.

- Evidencia: src/sectors/c-search/search.ts:317-321 (razón con FRESHNESS_THRESHOLD_HOURS) vs decide/shouldCallMock.ts:67-75,91-94 (decisión con currentFreshnessThresholdHours()); costo de error: search.ts:404-407 e ingest-async.ts:71-74 (simulated_cost_cents=4 literal; la constante real del mock está en mock/aggregator.ts:20)

- Corrección sugerida: search.ts:319: usar currentFreshnessThresholdHours() en vez de la constante (y borrar el export deprecated de shouldCallMock.ts:67-68); en los dos INSERT de error registrar 0 en vez de 4 (was_error=true ya es la señal; 4¢ solo aplica al mock).


**RANKING-5 · ROTO · severidad media · veredicto: confirmado**

Una caída de Voyage (error HTTP, o red caída dos veces) tumba TODA búsqueda que no sea hit de caché exacta con un 500: embed() lanza y hybridSearch no lo captura (a diferencia del normalizador LLM, que sí tiene try/catch con degradación). BM25 podría servir solo, pero ese camino de degradación no existe para el embedding.

- Evidencia: src/lib/embeddings/voyage.ts:63-65 (throw en !res.ok; :56-61 un solo retry y solo para fallo de red); src/sectors/c-search/search.ts:171-172 (await embed sin try/catch) en contraste con :229-235 (normalize sí degradado a null); app/api/search/route.ts:35-39 tampoco captura → 500 al cliente

- Corrección sugerida: En search.ts:172 envolver embed en try/catch → queryEmbedding=null; con null: saltar lookupSemantic, cos=[] sin llamar cosineSearch, y saltar writeExact (:435, requiere embedding) — deriveMethod ya devuelve bm25_only solo.



---

## Personalización / PageSlate (adaptación de página)

### Cómo funciona hoy

ADAPTACIÓN EN 3 CAPAS, todas verificadas en código:

(1) COMPOSICIÓN (qué secciones ve ESTE usuario ahora) — composePage (src/sectors/f-slate/compose.ts:48-101): lee contexto vivo en 1 query de session_vectors si hay sesión (cohorte actual, recipient, tamaño de ventana de señales; compose.ts:58-67), arma SlateRuleContext (hora, día, logueado, cart_item_count, ancla PDP; compose.ts:69-82) y carga config de ui_placements+ui_sections con caché in-process TTL 60s → stale si DB falla → DEFAULT_PLACEMENTS hardcodeado (config.ts:51,148-172). selectPlacements (select.ts:32-60) filtra por reglas fail-closed (rules/evaluate.ts:16-24: campo desconocido/malformado ⇒ false), resuelve colisiones de slot por scope user>segment>global y version, capa a 8 placements, y contiene filas de agente (nunca slots protegidos home:10/pdp:10/cart:10, select.ts:26,39).

(2) RESOLUCIÓN (qué productos van en cada sección) — resolveSections (f-slate/sections/resolve.ts:21-176): ejecuta placements en orden de prioridad, siembra un claim-set con las exclusiones del usuario (excluded_products vigentes: dismiss/fatiga/purchased; resolve.ts:29-40), cada resolver corre bajo withBudget (Promise.race con timer; resolve.ts:186-198) con budget_ms de ui_sections (hero 1500, cross_sell/similar/upsell 250, cart_addons 300; config.ts:60-64 y migración 0035), dedupe contra claims, min_items o la sección se oculta (below_min, resolve.ts:111-113), hidratación de todos los carruseles en UNA query (resolve.ts:130-146) e impresiones de carrusel con feed_request_id=composition_id y position=slot*100+idx (resolve.ts:151-172, impressions.ts:23-59). Sección que falla/timeout degrada a nada sin tumbar la página.

(3) HERO = SLATE MATERIALIZADO por sesión — serveFeedPage/generateFeedInternal (d-personalization/feed.ts:319-893): HIT si hay feed_slates vivo (expires_at>now, TTL blando 300s; slate/store.ts:60-75, constants.ts:22) → sirve rebanada del snapshot inmutable en ~2 queries filtrando exclusiones al servir; MISS → pipeline completo: fusión RRF de listas (views-categories ×2 [categorías de vistas del usuario, sesión actual ×3; retrieve/views-categories-source.ts:39-52], popular-global ×2, popular-por-cohorte, co-ocurrencia del último visto ×2; los vectores de perfil SOLO entran como fallback sin señal de categoría; feed.ts:555-572) + MMR + cola por popularidad + top-up barato-primero, ε-explore (EXPLORATION_EPSILON=0.1 default; feed.ts:173-176), churn-cap ≥70% de caras conocidas entre re-materializaciones (stabilizeSlate, feed.ts:685-694), pins inyectados, y persiste 100 posiciones + 50 spares (constants.ts:7-16). Cursor opaco slate_id+pos+version; cursor inválido/expirado regenera transparente deduplicado contra lo ya servido (feed.ts:829-893).

SEÑALES → EFECTO — el cliente encola eventos (track.ts:112-127; product_view/add_to_cart/remove urgent: ProductView.tsx:167, cart.tsx:85,109) → POST /api/track (batch ≤50) → insertEvent + processEventForPersonalization (track-hook.ts:97-263): infiere señal demográfica del producto, avanza cohorte de sesión (warmup 3 señales; shift-detection.ts:8), captura co-ocurrencia (view/cart/purchase), y en product_view PINEA el producto en el slate vivo y luego expireLiveSlate (track-hook.ts:163-178) ⇒ la PRÓXIMA home re-materializa con la vista fresca; SHIFT de cohorte y SEARCH hacen bumpSlateVersion (track-hook.ts:135-141, track/route.ts:101-107) ⇒ solo las páginas de cursor pendientes regeneran (loadLiveSlate NO compara version; documentado en store.ts:234-243). Si warmup completo, actualiza el vector del modo del perfil (pesos: view 1, cart 3, dwell 1.5, wishlist 2; vector/constants.ts). Compra (checkout.ts:122-149) inserta evento purchase directo + attributePurchaseAndExclude (attribution.ts): join a la última impresión 7d y exclusión 'purchased' 30d. Fatiga: IntersectionObserver ≥50%/1s → /api/feed/seen estampa seen_at (feed/seen/route.ts:39-50) → cron applyFatigueExclusions (≥3 vistas sin click en 7d ⇒ descanso 7d; exclusion/fatigue.ts:14-53). Crons npm manuales (package.json:16-25): popularity-7d, npmi (materializa co_occurrence_top), fatigue, profile-recompute (reconstruye vectores desde events con pesos, incluida compra 5.0), cohort-centroids, prune.


### Respuestas a las preguntas del encargo

1) SEÑALES → PARTES DE PÁGINA Y MECANISMO. product_view (urgent, ProductView.tsx:164-167): (a) pin del producto en el slate vivo (continuidad 'Seguías mirando', track-hook.ts:163-167, store.ts:147-164), (b) expireLiveSlate ⇒ la PRÓXIMA carga de home re-materializa el hero con views-categories donde la sesión actual pesa ×3 (track-hook.ts:173-178, views-categories-source.ts:41-52), (c) co-ocurrencia para cross_sell/cart_addons (visible solo tras el cron NPMI que materializa co_occurrence_top), (d) avanza cohorte de sesión (warmup 3 señales) que las reglas de composePage y popular-por-cohorte leen, (e) vector de modo +1.0 si warmup completo. add_to_cart: co-ocurrencia + vector +3.0; el carrito en sí cambia la COMPOSICIÓN del cart (regla cart_item_count>=1 activa cart_addons, config.ts:109) con los ids reales del body en el mismo request (slate/resolve/route.ts:64-70); NO invalida el slate de home. search: bumpSlateVersion ⇒ solo las páginas de cursor pendientes regeneran (track/route.ts:101-107); la home recargada re-sirve el snapshot hasta TTL 300s o próximo product_view (ver roto #4). purchase: exclusión 'purchased' 30d + fila de atribución inmediatas (attribution.ts) — con el bug de scope anónimo (roto #1) — y vector +5.0 SOLO vía recompute nocturno manual (humo #2). dismiss: maquinaria completa pero sin emisor UI (humo #1). Mecanismos: composePage decide QUÉ secciones (reglas sobre contexto vivo), el slate materializado por sesión decide el CONTENIDO del hero (HIT ~2 queries / MISS pipeline completo), los resolvers del registry deciden el contenido de cada riel por request, y la invalidación es dual: expireLiveSlate (event-driven, product_view) + bumpSlateVersion (cursors, search/shift) + TTL 300s.

2) FATIGA POR VIEWPORT: la cadena existe completa y es coherente — observeSeen ≥50%/1s una vez por card (seen-reporter.ts:75-106) → /api/feed/seen estampa seen_at solo en impresiones de la sesión dueña, primera vista gana (feed/seen/route.ts:39-50) → applyFatigueExclusions: ≥3 seen en 7d sin product_view del mismo usuario ⇒ excluded_products 'fatigue' 7d (fatigue.ts:14-53) → el feed y los rieles la aplican vía fetchExcludedIds/claims. PERO hoy solo funciona de verdad para el hero de la home: (a) el cron-fatigue no tiene scheduler en el repo — si nadie corre `npm run cron:fatigue`, nunca se excluye nada (humo #4); (b) los rieles jamás estampan seen (humo #3); (c) exige user_profile_id no nulo — impresiones de visitantes que aún no dispararon ningún evento trackeado quedan fuera (fatigue.ts:21, perfil nace en track-hook.ts:39-60).

3) RIELES EN PDP (sembrados en 0035, SSR vía getProductSections): 'similar' slot 8 — vecinos por embedding pgvector, 1 sola query con subquery (renuncia al HNSW, techo documentado registry.ts:114-127), aparece siempre que haya ≥3 candidatos con embedding; 'cross_sell' slot 10 — NPMI del ancla, y si <3 hits cae a populares de la CATEGORÍA COMPLEMENTARIA (mapa hardcodeado COMPLEMENT_CAT, registry.ts:22-29,64-67); 'upsell' slot 30 — misma categoría, precio 1.2-2.5× el ancla, mejor rating primero, min_items 2, sin candidatos en la banda ⇒ se oculta (honesto, registry.ts:134-153). Claims por prioridad (similar y cross_sell prio 1 — similar reclama primero por slot menor; upsell prio 2) deduplican entre sí y contra exclusiones (resolve.ts:43,110-115). En cart: 'cart_addons' (NPMI de todos los anchors del carrito, fallback complementarias de las categorías del carrito).

4) BUDGET 250ms ⇒ 1 QUERY POR RESOLVER: withBudget (resolve.ts:186-198) es un race contra timer con los budget_ms de ui_sections. La medición citada en código (registry.ts:115-118): contra Supabase remoto 2 roundtrips reventaban 250ms y la sección moría en timeout — por eso 'similar' se colapsó a UNA query SQL (subquery para el vector ancla, seq scan sin HNSW). Implicaciones: cada resolver debe ser single-roundtrip; los fallbacks de cross_sell/cart_addons violan la regla (2+ roundtrips) y arriesgan timeout exactamente cuando NPMI escasea (roto #3); budget_queries en DB no se lee (humo #6); y el timeout no cancela la query — el Client compartido la sigue ejecutando y serializa lo demás (humo #7), así que el budget acota la espera de la sección, no la latencia de la página.

5) HOLDOUT A 0 EN LOCAL: .env.local:46 HOLDOUT_PERCENT=0 ⇒ isHoldout siempre false; la rama baseline del feed (policy='holdout', feed.ts:385-432) es inalcanzable y slate_decisions.holdout siempre false. Lo que la atribución de compra mide HOY (attribution.ts:26-52): para cada producto comprado, si hubo una impresión del feed en 7d de esa sesión/perfil y cuál (feed_request_id, posición, exploit|explore, policy — siempre 'default' —, seen), y las compras orgánicas quedan con columnas NULL. Es decir: TOUCH correlacional del feed sobre la compra + posición/fuente, NO lift causal — no existe denominador contrafactual porque nadie está en baseline. Lo único contrafactual que sobrevive con holdout=0 es el ε-greedy (ε=0.1 default) con propensities logueadas en feed_impressions, que habilita evaluación off-policy, no A/B.

6) LATENCIA DE REFLEJO DE UNA SEÑAL: MISMO REQUEST — composición (cart_item_count, ancla PDP, cohorte leída en 1 query) y contenido de rieles cart (ids del body); dismiss compactaría el slate en el mismo POST si existiera emisor. SIGUIENTE PÁGINA (segundos) — product_view es urgent y expira el slate: la próxima home re-materializa con la vista ya contada (views-categories lee events en vivo; popularidad usa la tabla materializada si el cron corrió, si no cae a agregación live — views-categories-source.ts:62-101); search/shift: la próxima página del SCROLL regenera (no la home recargada, roto #4); pin visible en la próxima re-materialización. TTL — sin evento invalidante, el hero cambia como máximo cada 300s (SLATE_SOFT_TTL_S, constants.ts:22). CRON (manual, sin scheduler) — co-ocurrencia→rieles cross-sell (cron:npmi), popularidad 7d (cron:popularity-7d), fatiga (cron:fatigue), compras y dwell al vector (cron:profile-recompute nocturno). La cohorte demográfica necesita 3 señales de warmup en la sesión antes de influir (shift-detection.ts:8).


### Hallazgos verificados

**PERSONALIZACION-1 · HUMO · severidad media · veredicto: confirmado**

Todo el pipeline de dismiss (exclusión 14d + compactación del slate con spares) es inalcanzable: ningún componente UI emite el evento dismiss

- Evidencia: track/route.ts:109-122 y exclusion/dismiss-handler.ts + slate/store.ts:173-204 implementan la maquinaria completa, pero grep de track("dismiss") y de 'dismiss' en src/components y src/app (fuera de api/) devuelve cero emisores; el cliente solo emite product_view, add_to_cart, remove_from_cart, search y category_click (ProductView.tsx:167, cart.tsx:85,109, useTukiSearch.ts:282, HomeFeed.tsx:204)

- Corrección sugerida: Añadir en ProductCard un affordance de descarte (p.ej. ✕ en menú contextual) que llame track("dismiss", { product_id: card.id }, { urgent: true }) — el backend ya hace todo el resto.


**PERSONALIZACION-2 · HUMO · severidad media · veredicto: confirmado**

El peso purchase=5.0 en tiempo real y la captura de co-ocurrencia por compra nunca se ejecutan: el checkout inserta el evento sin pasar por el hook de personalización

- Evidencia: checkout.ts:122-129 y checkout-anonymous.ts:156-167 llaman insertEvent directamente; processEventForPersonalization solo se invoca desde /api/track (grep: única llamada en track/route.ts:85) y la UI no emite track('purchase'); la compra solo entra al vector vía recompute nocturno manual (recompute-nightly.ts:68 con EVENT_WEIGHTS)

- Corrección sugerida: En ambos checkouts, tras insertEvent y dentro de un try/catch best-effort (como el de track/route.ts:83-98), llamar processEventForPersonalization con el envelope purchase — el hook ya maneja purchase (track-hook.ts:85-91, 145-158).


**PERSONALIZACION-3 · HUMO · severidad media · veredicto: confirmado**

Las impresiones de rieles (PDP similar/cross_sell/upsell y cart_addons) jamás reciben seen_at: la fatiga y el flag 'seen' de atribución solo funcionan para el hero de la home

- Evidencia: ProductView.tsx:49 renderiza ProductCard sin seenSlate/seenPos (igual CartDrawer.tsx:101); impressions.ts:12-13 lo declara como deuda ('seen_at queda NULL hasta el beacon cliente'); fatigue.ts:19 filtra seen_at IS NOT NULL ⇒ productos de rieles nunca fatigan

- Corrección sugerida: Propagar composition_id (ya viaja en StorefrontPage, contract.ts:42) y la position slot*100+idx+1 hasta las cards de rieles como seenSlate/seenPos — /api/feed/seen ya acepta cualquier feed_request_id de la sesión (seen/route.ts:41-48).


**PERSONALIZACION-4 · HUMO · severidad media · veredicto: confirmado**

Ningún cron tiene scheduler en el repo: fatiga, popularidad 7d, NPMI (co_occurrence_top) y recompute nocturno de vectores solo ocurren si alguien ejecuta los npm scripts a mano

- Evidencia: package.json:16-25 define cron:* como scripts tsx; .github/workflows/ci.yml no contiene 'schedule:' y no existe vercel.json; los comentarios prometen cadencia ('every 10-15 min' cron-popularity-7d.ts:3, 'every 1-6h' cron-fatigue.ts:5) que nada dispara

- Corrección sugerida: Añadir un workflow de GitHub Actions con 'schedule:' (o crontab del host) que ejecute pnpm cron:fatigue / cron:popularity-7d / cron:npmi-recompute / cron:profile-recompute con SUPABASE_DB_URL en secrets.


**PERSONALIZACION-5 · HUMO · severidad media · veredicto: confirmado**

Con HOLDOUT_PERCENT=0 local, la rama holdout del feed es inalcanzable y slate_decisions.holdout es siempre false: cualquier lectura 'personalizado vs baseline' compara contra 0 usuarios

- Evidencia: .env.local:46 HOLDOUT_PERCENT=0 (verificado =0); holdout.ts:22-36 devuelve false con pct 0; feed.ts:385-432 (rama policy='holdout') y home.ts:19 (flag en logSlateDecision) quedan sin efecto

- Corrección sugerida: Antes de cualquier medición personalizado-vs-baseline, borrar la línea HOLDOUT_PERCENT=0 de .env.local (o ponerla en 10).


**PERSONALIZACION-6 · HUMO · severidad baja · veredicto: confirmado**

ui_sections.budget_queries es un knob muerto: se siembra en DB pero ningún código lo lee; el único enforcement real es budget_ms

- Evidencia: 0035_sections_similar_upsell.sql:9,13,16 lo inserta (similar=2, upsell=1); grep 'budget_queries' en src/ devuelve 0 resultados; el SELECT del loader (config.ts:124-133) no incluye la columna

- Corrección sugerida: Migración de una línea: ALTER TABLE ui_sections DROP COLUMN budget_queries (y quitarla de los seeds).


**PERSONALIZACION-7 · HUMO · severidad baja · veredicto: parcial**

withBudget corta la espera pero no cancela la query: un resolver que 'timeoutea' sigue ocupando el mismo Client pg y serializa las queries siguientes de la página, así que el budget por sección no acota la latencia total

- Evidencia: resolve.ts:186-198 hace Promise.race con setTimeout sin cancelar la query; todas las secciones y la hidratación comparten el mismo Client (resolve.ts:21-26,130) que en node-postgres encola queries secuencialmente

- Corrección sugerida: Si los ~2.5s de cola residual molestan, emitir SET LOCAL statement_timeout = budget_ms antes de cada resolver; si no, nada — el tope server-side ya existe.


**PERSONALIZACION-8 · HUMO · severidad baja · veredicto: confirmado**

Pesos product_dwell (1.5) y add_to_wishlist (2.0) sin emisor en la UI: figuran como señales del vector pero nunca llegan

- Evidencia: vector/constants.ts define los pesos; grep de track("product_dwell") y wishlist en src/components devuelve 0 (el único 'dwell' es el timer del seen-reporter, seen-reporter.ts:24)

- Corrección sugerida: O emitir track('product_dwell', {product_id, ms}) al abandonar el PDP (un useEffect con Date.now() en ProductView), o borrar ambos pesos de EVENT_WEIGHTS hasta que exista emisor — hoy son señal fantasma.


**PERSONALIZACION-9 · HUMO · severidad baja · veredicto: confirmado**

La rama pdp de /api/slate/resolve no tiene consumidor (el PDP es SSR) y el comentario del route describe un lazy-load que ya no existe

- Evidencia: slate/resolve/route.ts:14-17 dice 'PDP cross-sell (lazy, below the fold)'; el único consumidor UI es CartDrawer.tsx:93-101 con surface 'cart'; el PDP resuelve rieles server-side en app/(tuki)/products/[id]/page.tsx:20-23 vía getProductSections

- Corrección sugerida: Corregir el comentario del route (el PDP es SSR) y, si no se piensa reusar, quitar 'pdp' del enum del bodySchema junto con su rama y test.


**PERSONALIZACION-10 · HUMO · severidad baja · veredicto: confirmado**

Comentarios y nombres 'Auth0' en el route de track cuando el auth real es Supabase (docs de junio desactualizados replicados en código)

- Evidencia: track/route.ts:58,64 ('auth0Session', 'Resolve user_id from Auth0 session') vs src/lib/auth/index.ts:25-26 que usa createClient de @/lib/supabase/server y supabase.auth.getClaims()

- Corrección sugerida: Renombrar auth0Session→authUser y reescribir el comentario de la línea 64 ('Supabase session').


**PERSONALIZACION-11 · ROTO · severidad media · veredicto: confirmado**

La exclusión 'purchased' (lo comprado deja de perseguirte) es inerte en el flujo de compra anónimo/demo: se guarda bajo el user_id del usuario demo sintético, pero ninguna identidad de lectura del feed resuelve jamás ese user_id

- Evidencia: attribution.ts:54-63 inserta excluded_products solo con user_id ($1); checkout-anonymous.ts:59-65 crea el usuario demo|anonymous_id; pero la lectura excluye por (user_id=$1) OR (user_id IS NULL AND anonymous_id=$2) (feed.ts:109-114, resolve.ts:30-36) y la identidad del visitante anónimo siempre lleva user_id null (feed/page/route.ts:40; resolveIdentity solo setea user_id con sesión Supabase real, identity.ts:12-18) ⇒ el producto comprado sigue apareciendo en home y rieles

- Corrección sugerida: En attributePurchaseAndExclude, insertar la exclusión como (user_id=NULL, anonymous_id=$anon) cuando el comprador es el user sintético (espejo exacto del patrón de dismiss-handler.ts:16), pasando un flag desde checkout-anonymous.


**PERSONALIZACION-12 · ROTO · severidad media · veredicto: confirmado**

Para un usuario logueado, las páginas 2+ del scroll y la regeneración por cursor usan la identidad equivocada: /api/feed/page hardcodea user_id null, así que resuelven OTRO perfil (el anónimo) y pierden las exclusiones user-scoped (dismiss durable y purchased)

- Evidencia: feed/page/route.ts:40 pasa user_id: null incondicionalmente; dismiss-handler.ts:9-17 guarda la exclusión contra user_id cuando hay login; getProfileIdForFeed (feed.ts:90-101) con user_id null cae al perfil por anonymous_id ⇒ página 1 SSR (resolveIdentity con user_id real) y páginas 2+ aplican conjuntos de exclusión y perfiles distintos

- Corrección sugerida: En feed/page/route.ts resolver el user_id igual que el track route (getAuthUser + getOrCreateUserBySub dentro del withPg) y pasarlo a serveFeedPage en lugar de null.


**PERSONALIZACION-13 · ROTO · severidad media · veredicto: confirmado**

El fallback de rieles cross_sell/cart_addons (categoría complementaria cuando NPMI escasea) ejecuta 2+ roundtrips secuenciales dentro de budgets de 250/300ms — el patrón que el propio código documenta como mortal contra Supabase remoto: el riel muere por timeout justo en el caso que el fallback existe para salvar

- Evidencia: registry.ts:114-118 (comentario de la corrección de 'similar'): 'contra Supabase remoto, 2 roundtrips reventaban el budget_ms de 250 y la sección moría en timeout'; cross_sell hace query NPMI + popularOfCategory secuenciales (registry.ts:55-67) y cart_addons hasta 2+N queries (registry.ts:79-102) bajo budget 300 (config.ts:63); withBudget aborta en resolve.ts:106-109

- Corrección sugerida: Colapsar cada fallback en UNA query (NPMI LEFT JOIN LATERAL populares-de-categoría-complementaria, mismo remedio aplicado a 'similar' en registry.ts:119-127), o subir budget_ms de esas filas en ui_sections.


**PERSONALIZACION-14 · ROTO · severidad baja · veredicto: confirmado**

Tras una búsqueda o un shift de cohorte, una RECARGA de la home dentro del TTL de 300s re-sirve el snapshot viejo: bumpSlateVersion solo invalida cursors en vuelo porque loadLiveSlate no compara version

- Evidencia: store.ts:61-75 (loadLiveSlate filtra solo por expires_at, ignora version); el propio código lo documenta en store.ts:240-243 ('bumpSlateVersion no servía para esto… el HIT re-servía el mismo snapshot hasta expirar'); search y shift solo hacen bump (track/route.ts:101-107, track-hook.ts:135-141), únicamente product_view hace expireLiveSlate (track-hook.ts:173-178)

- Corrección sugerida: En la rama search de track/route.ts (y el shift de track-hook.ts:135-141) llamar también expireLiveSlate(session_id, pg) — el mismo remedio de una línea que ya se aplicó a product_view.



---

## Vectores y embeddings

### Cómo funciona hoy

EMBEDDINGS DE PRODUCTO: voyage-4, 1024 dims, dtype float, re-normalizados L2 defensivamente (src/lib/embeddings/voyage.ts:9-10,48-49,69-71). Se generan en la INGESTA, no en un cron dedicado: processProduct construye texto canónico y llama embed() con inputType document, guardando en products.embedding vector(1024) (src/sectors/b-catalog/enrichment/pipeline.ts:65-69,101,115). Fast-path anti-regasto: si el producto existe y ni title ni image_url cambiaron, NO se re-embebe, solo refresca precio/url/peso (pipeline.ts:43-63). Llamadores de processProduct: ingesta asíncrona disparada por búsqueda (src/sectors/c-search/ingest-async.ts:57), crons de catálogo (src/sectors/b-catalog/cron/catalog-fill.ts:92, catalog-refresh.ts:148), resolve-url (src/app/api/products/resolve-url/route.ts:95) y resolve-retry.ts:96. Índice HNSW real: products_embedding_hnsw_idx USING hnsw (embedding vector_cosine_ops) (supabase/migrations/0004_products.sql:28-29), más GIN sobre tsvector_es (0004:25-26) y metadata (0004:31-32).

VECTOR DE USUARIO: multi-modo PinnerSage-lite por bucket (user_profile, recipient, cohort). Estado = (vector_unnormalized 1024, weight_sum) en user_profile_modes (migrations/0006_personalization.sql:21-31, unicidad ampliada con cohort_id en 0017:16-18). Matemática: decay exponencial exp(-Δt/τ) con τ=60 días + acumulación ponderada por tipo de evento (src/sectors/d-personalization/vector/update.ts:28-41; pesos purchase 5.0 … product_view 1.0 en vector/constants.ts:9-23). Shrinkage bayesiano: init unnorm=κ·prior, weight=κ=10, prior = centroide de cohorte o fallback media de 200 productos (vector/init.ts:11-18, profile-mode.ts:35-49,86-89). NO hay α dinámico de mezcla sesión/perfil: ese diseño (F3a) se retiró (feed.ts:469-471). Multi-modo: umbrales 5/20/100 eventos → 1/2/3 modos (multimode/thresholds.ts:9-14); al cruzar umbral se corre k-means (ml-kmeans, distancia 1-cosine, pesos por replicación cap 5000) SINCRÓNICO dentro del request de track (track-hook.ts:244-255, vector/kmeans.ts:24-62, multimode/recompute.ts:63-133). Dispatch de evento al modo más cercano por cosine (multimode/dispatch.ts:57-80, track-hook.ts:199-232).

ONLINE vs CRON: online en el request de track corre todo el update del vector (decay+acumulación, dispatch, k-means al cruzar umbral) vía processEventForPersonalization (src/app/api/track/route.ts:85, track-hook.ts:97-263). Online en el request de feed: lectura de session state, fetch de modos, retrieval pgvector (retrieve.ts:12-45 ORDER BY embedding <=> $1), fusión RRF (retrieve/rrf.ts), MMR con embeddings de producto (feed.ts:607-611, retrieve/mmr.ts). Online en búsqueda: embed() del query (LLAMADA DE RED a Voyage por cada búsqueda sin caché, search.ts:172), caché semántica HNSW θ=0.92 default/env SEMANTIC_CACHE_THRESHOLD (cache/semantic.ts:4,22-30,32-56, índice hnsw en 0008_search.sql:31-32), cosineSearch+bm25 en paralelo (search.ts:262-272). CRON (scripts npm, package.json:16-25): cron-profile-recompute → recomputeProfileModes (recompute-nightly.ts:38-111) y cron-cohort-centroids → computeCohortCentroids que promedia embeddings de PRODUCTOS por cohorte demográfica como prior (cohorts/centroid-compute.ts:17-61). OJO: ningún scheduler en el repo (sin vercel.json, sin schedule en .github/workflows/ci.yml); cron-catalog-refresh.ts:46-48 imprime un "crontab sugerido" — la programación es externa/manual.

VECTOR DE SESIÓN: NO EXISTE como vector. session_vectors conserva las columnas legado vector_unnormalized/weight_sum (0006:36-42) pero se escriben con VECTOR CERO en cada upsert y nada las lee (session/state.ts:50-58 lo confesa: "jamás se pobló; la señal de sesión validada entra por views-categories"). La sesión SÍ influye en el ranking por 4 vías no vectoriales: (1) shift de cohorte con ventana de 5 señales y umbral 3 que cambia el bucket del vector y bumpea el slate (session/shift-detection.ts:8-62, track-hook.ts:119-141); (2) views-categories con peso ×3 a las vistas de la sesión actual (retrieve/views-categories-source.ts:39-53); (3) lista co-occurrence del último producto visto de la sesión (feed.ts:505-527); (4) pins + expiración del slate vivo en cada product_view (track-hook.ts:163-178).

QUÉ USA CADA SUPERFICIE: Buscador = embedding del query + HNSW products (cosineSearch retrieve/cosine.ts:16-44) fusionado con BM25 (search.ts:262-278) + caché semántica vectorial. Feed home = slate materializado cuya fusión ganadora es views-categories(×2) + popular-global(×2) + co-occurrence(×2) + popular-cohorte; las listas del VECTOR de usuario (modos) SOLO entran cuando el usuario no tiene ninguna vista categorizada (feed.ts:563-572: hasCategorySignal ⇒ listsA fuera), aunque el vector se sigue actualizando en cada evento; MMR sí usa embeddings de producto para diversidad (feed.ts:607-611); prior de popularidad multiplicativo FEED_POP_PRIOR_STRENGTH default 1 (feed.ts:184-187,472-499). Rieles PDP = 'similar' es vecinos por embedding con subquery del ancla (f-slate/sections/registry.ts:108-130); 'upsell' es SQL de banda de precio sin vectores (registry.ts:134-153); cross_sell/cart_addons = NPMI co-occurrence con fallback a populares de categoría complementaria (registry.ts:49-104); hero_grid = serveFeedPage (sections/resolve.ts:59-70). Gift suggest = heurística demográfica pura, sin vectores (gift/suggest.ts:50-63).


### Respuestas a las preguntas del encargo

1) EMBEDDINGS DE PRODUCTO: sí, voyage-4 con output_dimension=1024 pinned y L2-normalize (voyage.ts:9-10,48,71). Se generan EN LA INGESTA (processProduct, pipeline.ts:69), disparada por: búsqueda con pocos strong hits (ingest-async.ts:57), crons de catálogo catalog-fill/refresh (scripts manuales/crontab externo), resolve-url y resolve-retry. No hay cron de backfill de embeddings; con title+image sin cambios se salta el re-embed (pipeline.ts:43-63). 2) VECTOR DE USUARIO: multi-modo PinnerSage-lite, NO vector único: buckets (perfil, recipient, cohorte) con 1-3 modos según 5/20/100 eventos (thresholds.ts:9-14), split k-means con distancia coseno y pesos por replicación (kmeans.ts:24-62), dispatch por cosine al modo más cercano (dispatch.ts:57-80). Cada modo lleva decay exp(-Δt/τ) τ=60d + shrinkage bayesiano κ=10 sobre prior de cohorte (update.ts:28-41, init.ts:11-18). NO existe α dinámico de mezcla sesión/perfil — se retiró con el vector de sesión (feed.ts:469-471). 3) ONLINE vs CRON: online por evento de track corre TODO el update (decay, dispatch, incluso k-means inline al cruzar umbral, track-hook.ts:196-256); online por request de feed solo LEE modos y hace retrieval pgvector+RRF+MMR; online por búsqueda embebe el query. cron-profile-recompute (replay 90d) y cron-cohort-centroids (priors desde embeddings de productos por cohorte demográfica) son scripts npm SIN scheduler en el repo — ejecución manual o crontab externo. 4) VECTOR DE SESIÓN: NO existe (el P0 de junio no se implementó como vector): session_vectors.vector_unnormalized se escribe con ceros y nada lo lee (state.ts:50-58). PERO la sesión actual SÍ influye en el ranking por vías no vectoriales: shift de cohorte (ventana 5/umbral 3) que cambia el bucket y bumpea el slate, views-categories con peso ×3 a vistas de la sesión, co-occurrence del último visto, y pins+expiración del slate en cada vista (track-hook.ts:119-178, views-categories-source.ts:41-52). 5) ÍNDICES: HNSW reales sobre products.embedding (0004:28-29) y product_query_cache.query_embedding (0008:31-32) con vector_cosine_ops; GIN reales sobre products.tsvector_es (0004:25-26) y products.metadata (0004:31-32); réplicas en test_schema (0016) y thesis (0021). user_profile_modes NO tiene índice ANN (solo btree por perfil, 0006:33-34) — correcto porque se busca por clave. El riel 'similar' NO aprovecha el HNSW (subquery→seq scan, registry.ts:116-118). 6) QUIÉN USA QUÉ: buscador = embedding de query + HNSW (cosineSearch) fusionado RRF con BM25, más caché semántica vectorial θ=0.92; feed = views-categories+popularidad+co-occurrence, con las listas del vector de usuario SOLO como fallback sin vistas categorizadas (feed.ts:563-572) y embeddings para MMR de diversidad; rieles = 'similar' por embedding del ancla PDP, el resto (upsell, cross_sell, cart_addons, popular) sin vectores. 7) VECTORES MUERTOS: session_vectors.vector_unnormalized/weight_sum (ceros, sin lectores), user_profiles.prior_vector (columna vector(1024) sin ningún uso en código), thesis.item_vectors/item_chunk_vectors + voyage-context-3 (solo estudios offline de tesis), TAU_SESSION_MINUTES (constante huérfana), y user_profiles.cohort_id/interpretable_profile (no-vector pero muertas en la misma tabla).


### Hallazgos verificados

**VECTORES-1 · HUMO · severidad media · veredicto: confirmado**

El VECTOR DE SESIÓN (P0 de junio) no existe: session_vectors escribe un vector cero hardcodeado en cada upsert y ninguna lectura lo consume; la tabla y sus columnas NOT NULL aparentan un vector de sesión que jamás se pobló

- Evidencia: src/sectors/d-personalization/session/state.ts:50-58 (comentario 'jamás se pobló' + zeroVec) y feed.ts:469-471 ('el vector de sesión α-mixing de F3a jamás se escribió en producción'); readSessionState (state.ts:22-27) y admin/user-debug.ts:77-84 solo leen cohorte/ventana. La sesión influye por otras vías (shift de cohorte, views-categories ×3, co-occurrence del último visto)

- Corrección sugerida: Migración: ALTER TABLE session_vectors DROP COLUMN vector_unnormalized, DROP COLUMN weight_sum (y réplica test_schema de 0016/0018); borrar zeroVec y esas dos columnas del INSERT de persistSessionState (state.ts:53-58)


**VECTORES-2 · HUMO · severidad media · veredicto: confirmado**

El vector de usuario multi-modo se actualiza online en CADA evento (decay, dispatch, k-means inline) pero la home lo DESCARTA siempre que el usuario tenga ≥1 vista categorizada: las listas de modos solo entran al feed como fallback frío — costo por evento sin efecto en el ranking del caso común (decisión exp-K documentada, pero el aparato aparenta más de lo que rankea)

- Evidencia: src/sectors/d-personalization/feed.ts:563-572 (hasCategorySignal ⇒ listsA excluidas de la fusión) vs track-hook.ts:196-256 (update completo por evento); views-categories devuelve items con una sola vista categorizada (views-categories-source.ts:39-58)

- Corrección sugerida: En feed.ts calcular listD antes del bloque de modos y saltar el retrieve por modo cuando hasCategorySignal (mover el if de 565 arriba de 435) — elimina el cómputo muerto sin cambiar el ranking


**VECTORES-3 · HUMO · severidad media · veredicto: parcial**

Los crons de vectores (cron-profile-recompute, cron-cohort-centroids) existen solo como scripts npm: no hay NINGÚN scheduler en el repo (sin vercel.json, sin schedule en CI); si nadie los corre a mano/crontab externo, priors y recompute jamás ocurren

- Evidencia: package.json:18-19 los define; búsqueda de 'schedule:' en .github/workflows/ci.yml vacía; no existe vercel.json; scripts/cron-catalog-refresh.ts:46-48 imprime un 'crontab sugerido' en vez de estar programado

- Corrección sugerida: Versionar el crontab en el repo (p.ej. ops/crontab + una línea de instalación en README) para que el scheduler sea auditable desde el código


**VECTORES-4 · HUMO · severidad baja · veredicto: confirmado**

Columnas muertas en user_profiles: prior_vector, cohort_id e interpretable_profile no tienen ni un lector ni un escritor en src/ (el prior real vive en cohort_centroids); last_recompute_at se LEE en el admin debug pero nada lo escribe → siempre null

- Evidencia: supabase/migrations/0006_personalization.sql:6-9 define las columnas; grep de prior_vector/interpretable_profile en src/ y scripts/ devuelve cero usos; recompute-nightly.ts:102-109 solo actualiza user_profile_modes; admin/user-debug.ts:70-74 muestra last_recompute_at que nunca se escribe

- Corrección sugerida: Migración DROP de cohort_id/prior_vector/interpretable_profile; para last_recompute_at: o escribirla al final del loop de recomputeProfileModes (un UPDATE user_profiles por perfil tocado) o droparla y quitarla de user-debug/UserDebugView


**VECTORES-5 · HUMO · severidad baja · veredicto: confirmado**

TAU_SESSION_MINUTES=30 exportado y jamás importado — constante huérfana del vector de sesión retirado

- Evidencia: src/sectors/d-personalization/vector/constants.ts:26; grep en src/ solo encuentra la definición

- Corrección sugerida: Borrar la línea vector/constants.ts:26


**VECTORES-6 · HUMO · severidad baja · veredicto: confirmado**

Tablas de vectores que la tienda no lee: thesis.item_vectors e item_chunk_vectors (y el wrapper voyage-context-3) son maquinaria offline de tesis — ningún camino de request los consulta

- Evidencia: supabase/migrations/0022_thesis_embeddings.sql:6-23; src/lib/embeddings/voyage-context.ts solo importado por scripts/thesis/embedders/build-context3.ts y build-chunk-embeddings.ts; item_vectors solo en scripts/thesis/* y src/thesis/eval/unified-cases.ts (evaluación offline)

- Corrección sugerida: Ninguna necesaria en la tienda: el propio 0022 declara el uso offline. Si molesta la ambigüedad, mover src/thesis/eval/ a scripts/thesis/ para sacarlo del árbol servible


**VECTORES-7 · HUMO · severidad baja · veredicto: confirmado**

El riel 'similar' se anuncia como 'vecinos por embedding (pgvector HNSW)' pero el patrón subquery fuerza seq scan sin usar el índice HNSW (auto-admitido en comentario ponytail; correcto al tamaño actual del catálogo)

- Evidencia: src/sectors/f-slate/sections/registry.ts:106-107 (docstring HNSW) vs 116-118 ('el subquery fuerza seq scan (sin HNSW)') y la query 119-127

- Corrección sugerida: Quitar '(pgvector HNSW)' del docstring registry.ts:106 — el comentario de :116-118 ya documenta el techo y el camino de upgrade


**VECTORES-8 · HUMO · severidad baja · veredicto: confirmado**

cohort_centroids.n_users_in_cohort guarda el conteo de PRODUCTOS promediados, no de usuarios — el nombre de la columna miente sobre la semántica del prior

- Evidencia: src/sectors/d-personalization/cohorts/centroid-compute.ts:38-47 (count por producto) y 49-58 (INSERT n_users_in_cohort = count de productos); 0006_personalization.sql:47

- Corrección sugerida: ALTER TABLE cohort_centroids RENAME COLUMN n_users_in_cohort TO n_products_in_cohort (+ actualizar el INSERT en centroid-compute.ts:52-56); rename gratis: cero lectores


**VECTORES-9 · ROTO · severidad media · veredicto: confirmado**

cron-profile-recompute COLAPSA los buckets multi-modo: para cada modo del mismo (perfil, cohorte) replay-ea el MISMO conjunto de eventos (sin filtrar por pertenencia a cluster ni por recipient_id) y escribe vectores IDÉNTICOS en los 2-3 modos — destruye la separación k-means de PinnerSage hasta el próximo cruce de umbral

- Evidencia: src/sectors/d-personalization/recompute-nightly.ts:38-111 — el SELECT de eventos (57-64) y el filtro (66-99) solo miran cohorte, no mode_index/cluster ni m.recipient_id; el UPDATE 102-109 pisa vector_unnormalized de cada modo con el mismo acumulado. Contrastar con multimode/recompute.ts:90-112 que sí asigna por cluster

- Corrección sugerida: En recomputeProfileModes agrupar por bucket: si el bucket tiene >1 modo, llamar recomputeModesForBucket({target_modes: n_modos_actuales}) (re-k-means); dejar el replay plano solo para buckets de 1 modo


**VECTORES-10 · ROTO · severidad baja · veredicto: confirmado**

Carrera en getOrInitProfileMode: SELECT-then-INSERT sin ON CONFLICT, y la UNIQUE (user_profile_id, recipient_id, cohort_id, mode_index) NO bloquea duplicados cuando recipient_id IS NULL (NULLs distintos en Postgres) — dos primeros eventos concurrentes del mismo bucket crean modos mode_index=1 duplicados que fetchAllModesInBucket luego trata como multi-modo falso

- Evidencia: src/sectors/d-personalization/profile-mode.ts:61-104 (SELECT en 61-71, INSERT plano en 90-104); supabase/migrations/0017_personalization_3a.sql:16-18 (UNIQUE estándar, sin NULLS NOT DISTINCT ni índice parcial); track-hook.ts:31-38 documenta y arregla exactamente esta clase de carrera para user_profiles pero no aquí

- Corrección sugerida: Migración: recrear user_profile_modes_uniq como UNIQUE NULLS NOT DISTINCT (PG15+) y en getOrInitProfileMode usar INSERT ... ON CONFLICT DO NOTHING + re-SELECT (el mismo patrón de getOrCreateProfile en track-hook.ts:44-59)


**VECTORES-11 · ROTO · severidad baja · veredicto: confirmado**

Toda búsqueda sin caché hace una llamada de red síncrona a Voyage para embeber el query en el camino del request (search.ts:172) con un único retry solo ante fallo de red y sin timeout — un cuelgue de Voyage cuelga la búsqueda (los errores HTTP no se reintentan y no hay AbortController)

- Evidencia: src/sectors/c-search/search.ts:170-183 llama embed() antes de la caché semántica; src/lib/embeddings/voyage.ts:37-61 (fetch sin timeout/AbortSignal, retry único de red)

- Corrección sugerida: En voyage.ts añadir signal: AbortSignal.timeout(10_000) al fetch y tratar el AbortError como el mismo caso de retry de red



---

## DAL / Storefront Contract (abstracción para el frontend)

### Cómo funciona hoy

La DAL vive en src/storefront/ y tiene 4 piezas. (1) contract.ts:1-45: tipos puros sin imports (StorefrontCard, StorefrontSection, StorefrontPage) — es "the only module the visual layer imports". StorefrontCard NO es una fila de DB: campos curados (price_cents, image_url ya redimensionada, attrs curado, weight_grams) sin description/created_at/metadata crudo. (2) identity.ts:8-20: resolveIdentity() lee cookies anonymous_id/session_id y, si hay sesión Supabase (getAuthUser via getClaims, src/lib/auth/index.ts:23-39), upserta users por auth_sub (getOrCreateUserBySub) para obtener el user_id interno — un roundtrip a DB por render para usuarios logueados. (3) map.ts: toCard (41-73) es EL mapper único producto→card (aplica imgSrc 350/640 de src/lib/img.ts para 3G, extrae metadata.category y metadata.attrs curado, formatea sold en formatSold 10-16); toSection (75-86) y toPage (88-90) envuelven las secciones resueltas de f-slate. (4) pages/{home,cart,product}.ts: cada uno tiene un núcleo testeable (homePage/cartPage/productSections) que orquesta composePage + resolveSections + logSlateDecision del sector f-slate, y un wrapper get* que resuelve identidad y abre withPg. La frontera del lado componentes es una REGLA EJECUTABLE: tests/unit/storefront-boundary.test.ts escanea src/components/tuki/** y solo permite @/storefront/contract, hermanos tuki, @/lib/client/*, libs puras (weight/delivery/shipping/img), @/lib/supabase/client y react/next — pasa hoy (3 files, 5 tests OK). src/lib/client/ es el kit del navegador: track.ts (cola batched con sendBeacon y backoff → POST /api/track), seen-reporter.ts (IntersectionObserver → /api/feed/seen), product-url.ts (re-export puro de parseProductUrl del sector b-catalog para no violar la frontera, comentado en 1-8), track-queue-core.ts (interno de track), feed-snapshot.ts (SIN consumidores, ver humo). src/proxy.ts es el middleware de Next 16 (convención proxy.ts; next 16.2.5 en package.json): refresca sesión Supabase y emite cookies anónimas sin tocar DB (ver respuestas_especificas). El sector f-slate importa toCard DESDE storefront (resolve.ts:7,71,138) y category-page.ts del sector importa imgSrc (línea 3,57) — la dependencia se invierte en dos puntos: el "backend" conoce el módulo de presentación.


### Respuestas a las preguntas del encargo

1) ¿AÍSLA DE VERDAD? A medias, y la parte que aísla está bien hecha. Lo sólido: contract.ts es 100% tipos propios sin filas de DB (sin description/created_at/metadata crudo), toCard es el mapper único (map.ts:41-73), y la frontera de componentes es una regla ejecutable que pasa (tests/unit/storefront-boundary.test.ts: components/tuki/** solo contrato+lib/client+libs puras; verificado con grep y corriendo vitest: 5 tests OK). Los agujeros: (a) /api/search entrega ProductListRow crudo al navegador (search/route.ts:41-44 + c-search/search.ts:80) y el cliente re-implementa toCard (useTukiSearch.ts:73-84); (b) las RSC pages de app/(tuki) NO están cubiertas por el test de frontera e importan sectores directo (ver pregunta 3); (c) /api/products/[id]/weight y /hydrate devuelven shapes del sector (getOrEstimateWeight, CuratedAttrs) que ProductView tipea a mano (WeightInfo, Partial<CardAttrs>); (d) la dependencia se invierte en dos puntos: f-slate/sections/resolve.ts:7 importa toCard de storefront y b-catalog/repository/category-page.ts:3,57 aplica imgSrc (presentación) dentro del sector. 2) ¿QUÉ UI SIRVE MAIN? Tuki está integrada en main y ES la única UI pública: commit 65a31bf en main ('Merge feat/tuki-ui — Tuki como única UI pública conectada al backend real', verificado git branch --contains 65a31bf → main), la UI (shop) vieja fue retirada en d8921c0, la ruta raíz es src/app/(tuki)/page.tsx (route group no afecta URL) y src/components/tuki/* existe completo en main. La rama feat/tuki-ui ya no es la portadora. Resto de superficies en main: (auth) login/signup/otp/profile (Supabase), /admin (usa sectores directo, fuera del contrato a propósito), /auth callback/confirm/signout. 3) ¿COMPONENTES QUE SE SALTAN EL CONTRATO? Dentro de src/components/tuki/**: ninguno (test + grep: cero imports de @/sectors). Fuera del alcance del test: src/app/(tuki)/products/[id]/page.tsx:3 importa getById de b-catalog (bypass deliberado, documentado en pages/product.ts:1 'the product itself comes from getById in the PDP page') y arma el card de PDP a mano (líneas 55-57); src/app/(tuki)/c/[category]/page.tsx:4-7 importa fetchCategoryPage del sector y construye StorefrontCard inline (50-58, sin toCard — el resize 3G lo hace el repo del sector en category-page.ts:57); src/components/UserDebugView.tsx:1 y SearchTraceView.tsx:1-2 importan tipos de sectores (solo type-imports, superficies admin/debug). 4) ¿PROXY? src/proxy.ts es el middleware por convención de Next 16 (next 16.2.5). Hace: (a) createServerClient de Supabase con getAll/setAll sobre req/res (líneas 23-41; setAll re-crea la response y propaga headers anti-caché para que ningún CDN cachee un Set-Cookie de sesión); (b) supabase.auth.getClaims() (línea 45) — valida firma del JWT y, si el access token expiró, dispara el refresh y lo persiste vía setAll; es el ÚNICO lugar que puede escribir el token refrescado (los Server Components no escriben cookies; lib/supabase/server.ts:22-24 ignora ese fallo contando con el proxy); (c) DESPUÉS del refresh, ensureAnonymousId y ensureSession (líneas 50-51; a-tracking/identity.ts) emiten cookies anonymous_id (1 año, httpOnly:false para que JS la lea) y session_id sin tocar DB — cookie-only, el primer writer de filas es /api/track; (d) NO redirige a /login (anonymous-first); matcher excluye _next/static, _next/image, favicon.ico, api/health, api/cron (líneas 56-58). 5) FUNCIONES PÚBLICAS DEL CONTRATO Y QUIÉN USA CADA UNA: contract.ts tipos → toda components/tuki (HomeFeed, ProductCard, ProductView, CartDrawer, Listing, CategoryView, lib, filters, useTukiSearch) + api/feed/page + api/slate/resolve + c/[category]; identity.ts resolveIdentity() → solo interno del DAL (home.ts:26, cart.ts:20, product.ts:25); map.ts toCard() → api/feed/page/route.ts:44, app/(tuki)/products/[id]/page.tsx:55, f-slate/resolve.ts:71,138; toSection() → pages/product.ts:21 y dentro de toPage; toPage() → pages/home.ts:22, pages/cart.ts:16; pages/home.ts getHomePage() → app/(tuki)/page.tsx:10 (home SSR), homePage() núcleo → tests; pages/product.ts getProductSections() → products/[id]/page.tsx:21 (rieles en Suspense), productSections() → api/slate/resolve/route.ts:72 (pdp lazy); pages/cart.ts cartPage() → api/slate/resolve/route.ts:65 (upsell del drawer), getCartPage() → NADIE (muerto); lib/client: track() → cart.tsx, Shell, ProductView, HomeFeed, useTukiSearch; observeSeen() → HomeFeed.tsx:7; parseProductUrl → useTukiSearch.ts:23; feed-snapshot → NADIE; track-queue-core → interno de track.ts. 6) ¿QUÉ LE FALTA PARA OTRA UI SIN LEER EL BACKEND? (a) Un getProduct(id) del DAL: hoy la PDP exige conocer getById del sector y el shape ProductListRow (description, provider_ship_min/max_days se leen crudos en products/[id]/page.tsx:54-64); (b) un getCategoryPage del DAL (hoy repo del sector + card inline); (c) tipar y mapear la respuesta de /api/search al contrato (hoy el 'tipo' ApiRow vive copiado dentro de useTukiSearch, con metadata unknown que hay que saber espulgar); (d) tipos de las envolturas HTTP: {items,next_cursor,slate_id} de /api/feed/page, {products,count,hit_cache,called_mock,method,normalized} de /api/search, {status,fallback_query,product_id} de resolve-url, ItemResult de /api/checkout/revalidate y los 409 price_changed/totals_changed + 503/retry-after — todos definidos en cada route, ninguno exportado en un módulo de contrato; (e) el contrato de eventos de track(): event_type y payload son strings/Record libres — otra UI no sabe qué eventos alimentan la personalización (product_view con source, add_to_cart urgent, search, seen positions) sin leer los consumidores; (f) el contrato de identidad del navegador: cookies anonymous_id/session_id legibles por JS, claves de localStorage (tuki_cart:{anonId}, tuki_recents, track_*) — convenciones implícitas; (g) una sola regla de imgSrc: hoy la presentación de imágenes se aplica en map.ts (server), useTukiSearch (client), category-page.ts (sector) y FALTA en hydrate — otra UI tendría que redescubrir dónde sí y dónde no; (h) las variables de entorno públicas que la UI necesita (NEXT_PUBLIC_SHIP_*_CENTS_PER_LB, NEXT_PUBLIC_SALES_TAX_PCT en .env.example) que alimentan lib/shipping para mostrar el mismo número que cobra el server.


### Hallazgos verificados

**DAL-1 · HUMO · severidad media · veredicto: confirmado**

feed-snapshot.ts es una feature anunciada (C6: 'pages 2+ and scroll position survive the PDP→back round-trip with ZERO network') que ninguna UI usa: la home Tuki re-descarga el feed al volver de la PDP, exactamente el gasto que el módulo dice evitar

- Evidencia: src/lib/client/feed-snapshot.ts:1-10 (docstring de la feature); grep de shouldRestoreSnapshot/feed-snapshot en src/ solo matchea el propio módulo; HomeFeed.tsx no contiene snapshot/sessionStorage (grep líneas 3,274,336 son otra cosa); único consumidor: tests/unit/feed-snapshot.test.ts

- Corrección sugerida: Cablearlo en HomeFeed (guardar {slate_id, items, cursor, scroll_y} en sessionStorage antes del router.push a PDP; al montar, restaurar con parseSnapshot+shouldRestoreSnapshot) o borrar feed-snapshot.ts + tests/unit/feed-snapshot.test.ts.


**DAL-2 · HUMO · severidad media · veredicto: confirmado**

/api/cart (GET/PUT/DELETE) y /api/checkout autenticado son superficie muerta de la UI (shop) retirada: cero llamadores en src; el carrito real de Tuki vive en localStorage y el checkout usa /api/checkout/anonymous — cart_items solo se escribiría vía /api/cart/merge (que además nunca migra nada, ver roto) y nadie la lee

- Evidencia: grep 'api/cart' en src fuera de app/api solo da IdentityMergeOnLogin.tsx:25 (merge); grep '"/api/checkout"' sin resultados; CheckoutFlow.tsx:81,203 usa solo revalidate y anonymous; UI vieja retirada en commit d8921c0 'retira la UI (shop) vieja'

- Corrección sugerida: Borrar src/app/api/cart/route.ts y src/app/api/checkout/route.ts junto con createCheckoutOrder y las funciones de cart-repo que solo ellos usan; conservar /api/cart/merge únicamente si se arregla el hallazgo del merge (clave+shape).


**DAL-3 · HUMO · severidad media · veredicto: confirmado**

El aislamiento que promete el contrato tiene un agujero de datos: /api/search manda al navegador filas de DB crudas (description completa, metadata JSONB entero con attrs sin curar, created_at, url) en vez de StorefrontCard — el cliente re-mapea a mano y re-aplica el resize 3G, duplicando toCard

- Evidencia: src/app/api/search/route.ts:41-44 devuelve result.products tal cual; hybridSearch retorna ProductListRow (src/sectors/c-search/search.ts:63,80: SELECT ... metadata, created_at); el cliente lo admite en src/components/tuki/useTukiSearch.ts:79 ('los resultados de búsqueda no pasan por toCard del server → mismo resize 3G acá') y define ApiRow con metadata/created_at en 26-35

- Corrección sugerida: En /api/search/route.ts importar toCard y devolver products: result.products.map((p) => toCard(p)); en useTukiSearch borrar ApiRow/toCards y consumir StorefrontCard[] directo.


**DAL-4 · HUMO · severidad baja · veredicto: confirmado**

getCartPage es un export muerto: ningún llamador en src ni tests; el camino real del carrito es /api/slate/resolve → cartPage (el núcleo)

- Evidencia: src/storefront/pages/cart.ts:19-22; grep getCartPage en src+tests solo matchea su definición; el drawer usa CartDrawer.tsx:93 → /api/slate/resolve → cartPage (route.ts:65)

- Corrección sugerida: Borrar getCartPage (cart.ts:19-22) y los imports que solo él usa (withPg, resolveIdentity).


**DAL-5 · HUMO · severidad baja · veredicto: parcial**

El comentario 'SectionCardDTO ≡ StorefrontCard (structural)' es inexacto: SectionCardDTO no tiene weight_grams, url ni attrs; el typecheck pasa porque esos campos son opcionales, y los datos llegan a la UI solo porque toCard los puso en runtime — el tipo del sector miente sobre lo que viaja

- Evidencia: src/storefront/map.ts:82 (comentario) vs src/sectors/f-slate/sections/types.ts:7-18 (SectionCardDTO sin weight_grams/url/attrs); resolve.ts:71,138 construye con toCard que sí los incluye (map.ts:58-72)

- Corrección sugerida: Añadir a SectionCardDTO los opcionales que sí viajan (weight_grams?, attrs?) y cambiar el comentario de map.ts:82 a '⊆ StorefrontCard'; si se quiere url en secciones, añadir la columna a los SELECT de resolve.ts:133 y feed.ts:237.


**DAL-6 · ROTO · severidad media · veredicto: confirmado**

El merge del carrito al iniciar sesión nunca migra nada: IdentityMergeOnLogin lee localStorage 'cart:{anonId}' pero el carrito Tuki se guarda en 'tuki_cart:{anonId}' — cartRaw siempre null y el POST /api/cart/merge jamás se dispara; y aunque la clave coincidiera, TukiCartItem usa 'qty' mientras mergeLocalCartIntoUser exige 'quantity', así que el 100% de items caería en skipped. El comentario del componente promete 'fusiona la identidad anónima (eventos, carrito)' — la mitad del carrito es falsa

- Evidencia: src/components/IdentityMergeOnLogin.tsx:21,30 (clave 'cart:') vs src/components/tuki/cart.tsx:26 (clave 'tuki_cart:'); shape: src/components/tuki/cart-core.ts:5-14 (qty) vs src/sectors/a-tracking/cart-repo.ts:69-77 (item.quantity number, si no → skipped++). Impacto usuario hoy bajo (el carrito sigue visible por localStorage y nadie lee cart_items), pero el flujo anunciado no ocurre

- Corrección sugerida: En IdentityMergeOnLogin.tsx:21 leer `tuki_cart:${anonId}` y postear items.map(i => ({ product_id: i.product_id, quantity: i.qty })) (y remover esa clave al ok); o, dado que nadie lee cart_items, borrar el bloque de carrito y ajustar el comentario a solo eventos.


**DAL-7 · ROTO · severidad baja · veredicto: confirmado**

La respuesta de POST /api/products/[id]/hydrate devuelve attrs con URLs de imagen crudas del proveedor (sin imgSrc): en la primera visita que dispara la hidratación, ProductView mete esas URLs full-size (92-343KB medidos según img.ts) en galería/variantes, saltándose la política 3G que map.ts aplica en el mismo dato cuando viene de DB (variante 640)

- Evidencia: src/app/api/products/[id]/hydrate/route.ts:141 devuelve freshAttrs crudo (CuratedAttrs de DB, sin mapear); src/components/tuki/ProductView.tsx:193-206 lo mergea directo a liveAttrs y no importa imgSrc (imports líneas 7-16); la política está en src/storefront/map.ts:20-31 (img640 sobre attrs.images y variants) y los pesos originales en src/lib/img.ts:4-5,20-22. Solo afecta la visita que hidrata; la siguiente ya pasa por toCard

- Corrección sugerida: Exportar toCardAttrs en map.ts y en hydrate/route.ts:140 devolver { ok: true, attrs: toCardAttrs(freshAttrs, row.source) } (el route es server, el import 'server-only' no estorba).



---

## Agente merchandiser (vendedor)

### Cómo funciona hoy

AGENTE: es un deep agent de LangGraph construido con la librería `deepagents` v1.10.2 (package.json:70) en src/sectors/g-agents/runtime/merchandiser.ts:179-186 (createDeepAgent). Modelo del loop: DeepSeek v4-flash con thinking high, maxTokens 8192 (llm.ts:38-44); subagente "critic": DeepSeek v4-pro thinking max, 16384 (llm.ts:48-54). Anthropic NO se usa aquí. Tools reales: read_metrics (reporte JSON de funnels por placement, vs_holdout, categorías — merchandiser.ts:121-133), read_catalog (productos activos con popularidad 7d — merchandiser.ts:134-144) y propose_placement (merchandiser.ts:148-159). Los builtins de deepagents (ls/read_file/write_todos…) están ocultos y neutralizados con middleware (merchandiser.ts:20-58). Un stub deshabilita el subagente general-purpose (merchandiser.ts:171-177). QUÉ DECIDE: colocar/reemplazar carruseles de sección en home/pdp/cart, slots 20-90, SOLO tipos popular|cross_sell|cart_addons (write/schema.ts:17-18, 27-44), pausar sus propias filas, o pedir pausa de filas humanas (siempre pending). No elige productos individuales: elige sección+params (p.ej. popular mode=cohort limit=12) y los productos los resuelven los resolvers de producción. El tier de riesgo lo computa el sistema, nunca el LLM (write/tier.ts:18-25): low=se aplica solo con TTL≤168h; medium=pending salvo AGENT_MEDIUM_AUTOAPPLY=true (write/caps.ts:23-25); high (tocar slot protegido/fila humana)=pending SIEMPRE. Caps: 5 propuestas/run, 10 INSERTs/24h, 3 vivas por surface, 12 vivas total, cooldown 48h por slot (write/caps.ts:13-16, enforcement backend-pg.ts:54-91). El hero (home:10/pdp:10/cart:10) es intocable por doble candado: tier high al proponer (tier.ts:21) y el selector de servicio descarta filas agente en slots protegidos (f-slate/select.ts:26,39). ESCRITURA: filas en ui_placements con created_by='agent:merchandiser/v1', proposal_key idempotente por día (sha256, migración 0030_agent_surface.sql:3-15) y proposal_meta={rationale, run_id, metrics_hash, supersedes} (backend-pg.ts:152-176). SERVICIO: composePage carga solo status='approved' con TTL vigente (f-slate/config.ts:130-133) y selectPlacements es la única función selectora compartida por prod y simulador (select.ts:5-8). ESTADO REAL: apagado fail-closed — el cron sale en el acto si AGENTS_ENABLED!=true (scripts/cron-agent-merchandiser.ts:32-35) y esa variable no existe en .env.local ni en .env.example.


### Respuestas a las preguntas del encargo

(1) QUÉ HACE: agente merchandiser one-shot (sin checkpointer) construido con deepagents/LangGraph sobre DeepSeek (loop v4-flash thinking-high, critic v4-pro thinking-max — llm.ts:38-54; NO Anthropic). Tools: read_metrics, read_catalog, propose_placement (merchandiser.ts:120-159) + subagente critic que verifica que los números citados existan (CRITIC_PROMPT, merchandiser.ts:106-115). Decide QUÉ carrusel (popular/cross_sell/cart_addons) va en QUÉ slot (20-90) de home/pdp/cart, con params validados, TTL≤7 días y rationale citando métricas; puede pausar lo suyo y pedir pausa de lo humano. No toca productos ni precios ni el hero. Efecto visible HOY: solo los rails cross_sell del PDP renderizarían; home y cart ignoran sus filas (ver ROTO alta). (2) REGISTRO: NO existe tabla de runs. Todo queda en (a) ui_placements (0025_ui_slate.sql:37, columnas del agente añadidas en 0030_agent_surface.sql:11-13): created_by='agent:merchandiser/v1', proposal_key idempotente y proposal_meta {rationale, run_id ('agent-run-YYYY-MM-DD-xxxx', backend-pg.ts:43), metrics_hash, supersedes} — solo para propuestas ACEPTADAS; (b) stdout del cron → logs/cron.log (las rechazadas solo viven aquí, cron-agent-merchandiser.ts:45-56); (c) artefactos de simulador: scripts/agents/cache/*.json (transcripts) y scripts/agents/results/*.ndjson+json. (3) TRACKING DEL RENDIMIENTO: en producción NO hay UI admin, ni endpoint, ni script de reporte — la única vía es SQL a mano sobre ui_placements/proposal_meta y grep de logs/cron.log (src/app/admin solo tiene users, co-occurrence y search/explain). Lo que SÍ existe es evaluación en simulador: eval-harness.ts (--gate/--smoke/--aa), gate-seeds.ts (resumible, --verdict), run-gate-parallel.sh, verify-ledger.ts (recuento independiente sin importar src/) y adversarial.ts (suite de exploits). También --dry-run del cron ejercita el pipeline completo sin INSERT. (4) ¿CORRE?: el crontab lo lanza cada noche a las 04:00, pero AGENTS_ENABLED no está definida en ningún sitio (ni .env.local ni .env.example), así que sale en la línea 33 sin hacer nada — logs/cron.log lo confirma en cada ejecución y no contiene ni una línea 'run='. Nunca ha corrido contra la DB real. Sí corrió mucho en el simulador (junio-julio): ~90 transcripts en cache/, gate v1 completo (FAIL: Ĝ=1.0054, invalid) y gate v2.1 con 1/5 seeds (ratio 2.09, no veredicto). Está apagado esperando completar el gate v2. (5) SPINNER: no existe UI del merchandiser; la animación de 'agente' que ve el usuario es el loader de búsqueda. Es teatro DECLARADO en el código ('teatro', useTukiSearch.ts:2-18) pero calibrado con señales reales: la duración se decide con la respuesta real (hit_cache→1100ms, called_mock→4200ms, resto 2200ms, useTukiSearch.ts:60-66), descuenta lo que ya tardó la red y pinta al instante si la red superó el teatro (líneas 318-332). La barra de progreso y las etapas 'rastrear tiendas/leer precios/comparar/ordenar' NO son progreso backend: son i/steps de un setInterval y umbrales sobre ese número (SearchView.tsx:18,29-39). En cambio, el banner 'buscando en Amazon, AliExpress y Shein en vivo… +N nuevos' SÍ es real: aparece solo cuando called_mock=true (ingesta Apify de fondo) y el poll con backoff (~3min, useTukiSearch.ts:71) trae productos reales. Mancha: frases del loader prometen 'reseñas' y orden personalizado que el backend de búsqueda no hace (HUMO media). (6) COSTO POR RUN: DeepSeek, no Anthropic. Precios documentados en deepseek.ts:9-11: v4-flash $0.14/M input (miss), $0.0028/M con caché de contexto, $0.28/M output; el critic usa v4-pro (más caro por token). Los prompts son byte-estables a propósito para maximizar el caché (hit 50× más barato, 'factor #1 de coste' — merchandiser.ts:16-17). Referencia medida propia: el smoke del harness con 3 runs de frontera LLM costó ~$0.03 (eval-harness.ts:8) ⇒ ~$0.01 por run; con timeout 600s y recursionLimit 40 el peor caso razonable es unos centavos. Encendido en cron diario: ~$0.01-0.05/día ≈ $0.30-1.50/mes. Apagado: $0 exacto (ni siquiera importa LangChain, import diferido en cron-agent-merchandiser.ts:37-40).


### Hallazgos verificados

**AGENTES-1 · HUMO · severidad alta · veredicto: confirmado**

El agente 'corre' cada noche pero es un no-op permanente: el cron está instalado y ejecutándose a las 04:00, pero AGENTS_ENABLED no está definida en .env.local, no existe en .env.example, y no hay ningún otro sitio que la encienda — el sistema completo de 26 archivos jamás ha escrito una fila real en la DB de producción

- Evidencia: scripts/cron-agent-merchandiser.ts:32-35 (fail-closed); crontab -l línea '0 4 * * * … cron:agent-merchandiser'; .env.local sin AGENTS_ENABLED (verificado por nombres); grep AGENTS_ENABLED en .env.example = 0 resultados; logs/cron.log: todas las ocurrencias (líneas 5119…10151) dicen 'AGENTS_ENABLED!=true — disabled, exiting 0' y cero líneas 'run='

- Corrección sugerida: Documentar AGENTS_ENABLED=false en .env.example con nota 'pendiente gate v2.1 completo' y quitar la entrada del crontab hasta entonces (hoy solo levanta un tsx diario para imprimir 'disabled')


**AGENTES-2 · HUMO · severidad alta · veredicto: confirmado**

El ratio 2.09x del gate v2.1 NO es un veredicto válido: solo existe 1 de los 5 seeds pre-registrados (seed 42); el veredicto exige N≥5, Ĝ≥2.0, CI95-low>1 y unanimidad. El único gate completo (junio, sim-world-v1) dio geomMean=1.0054, pass=false e invalid=true — hoy no hay evidencia válida de que el agente supere al motor congelado, y por eso sigue apagado

- Evidencia: scripts/agents/results/gate-seed-42.json (ratio 2.0936, único gate-seed-*.json en el directorio); src/sectors/g-agents/sim/stats.ts:5-9,36 (PASA ⇔ N≥5…, GATE_MIN_SEEDS=5); scripts/agents/results/gate-llm-2026-06-18T05-40-02-802Z.json (.verdict.geomMean=1.0053, .verdict.pass=false, .invalid=true); logs/gate-nocturno.log muestra seed 7 en curso sin JSON guardado

- Corrección sugerida: Correr los 4 seeds restantes (tsx scripts/agents/gate-seeds.ts reanuda saltando el 42 guardado, o bash scripts/agents/run-gate-parallel.sh 7 2026 31337 777) y emitir el veredicto con gateVerdict; hasta entonces no citar 2.09x como resultado del gate


**AGENTES-3 · HUMO · severidad alta · veredicto: confirmado**

El 2.09x se midió en un simulador cuyo modelo de exposición asume que los placements del agente se sirven al usuario; la tienda real no renderiza su palanca principal (carruseles home) ni cart extra — el número del gate no es transferible a la tienda tal como está el frontend hoy

- Evidencia: src/sectors/g-agents/sim/sections.ts:8-30 ('resolvers sim espejo 1:1 de producción' con exposición en el slate simulado) vs src/app/(tuki)/page.tsx:11-18 (solo hero_grid) y CartDrawer.tsx:100-101 (solo sections[0]); el prompt vende home como 'tu MAYOR palanca' (runtime/merchandiser.ts:64-70)

- Corrección sugerida: Antes de encender agentes: renderizar el slate completo (home: mapear todas las page.sections en page.tsx; cart: mapear body.sections en CartDrawer) — o re-medir el gate con un mundo cuya exposición refleje la UI que existe


**AGENTES-4 · HUMO · severidad media · veredicto: confirmado**

Copy del loader de búsqueda afirma capacidades que el backend no tiene: 'también comparamos reseñas, no solo precios' y 'leyendo precios y reseñas…' (no existen reseñas en el catálogo), y 'dato: la IA ordena resultados según lo que has mirado' (hybridSearch no reordena por historial del usuario: user_id/anonymous_id solo se usan para persistir el log de búsqueda)

- Evidencia: src/components/tuki/SearchView.tsx:11-13,25 (SEARCH_TIPS y frases); src/components/tuki/ProductView.tsx:20 (comentario: 'Sin reseñas reales en el catálogo aún — antes había 2 testimonios fijos falsos'); src/sectors/c-search/search.ts:137,195,454 (user_id solo en persistSearch)

- Corrección sugerida: Reescribir las 3 frases de SearchView.tsx a capacidades reales (p.ej. 'comparando precios tienda por tienda…', 'verificando stock…') y eliminar el tip de personalización


**AGENTES-5 · HUMO · severidad baja · veredicto: confirmado**

read_catalog presenta margin_pct=0.6 idéntico y hardcodeado para TODOS los productos como si fuera dato por producto — el agente 'razona' sobre márgenes que son una constante inventada

- Evidencia: src/sectors/g-agents/runtime/backend.ts:17 (PROD_MARGIN_PCT=0.6) y backend-pg.ts:300-303 (se inyecta a cada fila del catálogo)

- Corrección sugerida: Sacarlo de las filas y ponerlo una vez como campo explícito del summary: return JSON.stringify({ margin_pct_assumed: PROD_MARGIN_PCT, products: r.rows, categories }) en backend-pg.ts:300-305


**AGENTES-6 · HUMO · severidad media · veredicto: confirmado**

El comentario del backend describe 'el endpoint de aprobación ejecuta la pausa' para las filas pending de request_pause, pero ese endpoint no existe en el repo — la mitad humana del flujo human-in-the-loop es una feature documentada solo en un comentario

- Evidencia: src/sectors/g-agents/runtime/backend-pg.ts:231-233; grep 'approve' en src/app = 0 rutas; src/app/admin solo contiene users/[id], co-occurrence/top y search/explain

- Corrección sugerida: Reescribir el comentario en backend-pg.ts:231-232: 'endpoint de aprobación AÚN NO EXISTE (futuro /api/admin/placements); aprobar manualmente = pausar el target (ver runbook), jamás aprobar esta fila'


**AGENTES-7 · ROTO · severidad alta · veredicto: parcial**

Si el dueño enciende AGENTS_ENABLED hoy, las propuestas tier-low en home (slots 20-90) y en cart se aplican en DB (approved+TTL) pero JAMÁS se pintan: la home Tuki descarta todo lo que no sea hero_grid y el cart usa solo sections[0] (el seed de slot 10). Consecuencia ejecutable: filas y caps consumidos, resolveSections computa las secciones en el servidor y las tira, slate_decisions las registra como compuestas, nunca llegan impresiones → el funnel del placement sale null+flag y el protocolo del agente (esperar ante flags) lo deja ciego en un loop de proponer/expirar sin efecto. Solo los cross_sell de PDP tendrían salida visual real

- Evidencia: src/app/(tuki)/page.tsx:11-18 (find hero_grid, resto descartado); src/components/tuki/CartDrawer.tsx:100-101 (sections[0]); src/app/(tuki)/products/[id]/page.tsx:19-22 (RAIL_TYPES incluye cross_sell, no popular); f-slate/config.ts:130 y select.ts:33-49 sí los seleccionan; prompt en merchandiser.ts:64-76 ordena priorizar exactamente los slots que no renderizan; protocolo de flags en merchandiser.ts:89-91

- Corrección sugerida: Pintar lo que se resuelve (home: mapear todas las page.sections; cart: mapear todas las sections) — y mientras no se pinte, no resolver/loguear secciones invisibles: hoy generarían además impresiones fantasma (served sin pantalla, y add_to_cart atribuible sin seen — queries.ts:19)


**AGENTES-8 · ROTO · severidad media · veredicto: confirmado**

El flujo request_pause produce un resultado incorrecto con la única vía de aprobación que existe (SQL a mano): la fila pending lleva surface/slot del objetivo con params={} y rule=null; como no existe el endpoint que 'ejecute la pausa', aprobarla flipando status='approved' NO pausa el objetivo — lo deja compitiendo por el mismo slot con una sección de params vacíos, el efecto contrario al pedido

- Evidencia: src/sectors/g-agents/runtime/backend-pg.ts:233-263 (INSERT pending con params {} sobre surface/slot del target, proposal_meta.action='pause_target') + ausencia verificada de endpoint/UI de aprobación (grep 'approve' y 'pending' en src/app sin resultados de placements)

- Corrección sugerida: Aprobar un work-item pause_target = UPDATE ui_placements SET status='paused' WHERE id=<target_placement_id> + archivar la fila pending (nunca aprobarla); dejar ese runbook escrito junto al comentario de backend-pg.ts:231 hasta que exista /api/admin/placements



---

## Administración, precios y tiempos de envío

### Cómo funciona hoy

ADMIN. No hay sector de administración: src/sectors/e-admin/ contiene solo .gitkeep (0 archivos de código). Lo que existe son 3 páginas RSC y 2 APIs sueltas. Páginas: /admin/co-occurrence/top (src/app/admin/co-occurrence/top/page.tsx:8-52, tabla top-50 NPMI, solo lectura), /admin/search/explain (src/app/admin/search/explain/page.tsx:9-46, corre hybridSearch con trace:true y pinta SearchTraceView), /admin/users/[id] (src/app/admin/users/[id]/page.tsx:9-34, debug de un usuario POR UUID — no existe página índice para listar usuarios). APIs: GET /api/admin/searches (src/app/api/admin/searches/route.ts:37-60, lista búsquedas con filtros; NINGUNA página la consume — grep sin resultados) y POST /api/admin/products/[id]/weight (src/app/api/admin/products/[id]/weight/route.ts:16-56, fija weight_source='measured' e invalida los 20 vecinos LLM por embedding, líneas 42-53). El gate es requireAdmin (src/lib/auth/index.ts:93-97): allowlist por env ADMIN_EMAILS, fail-closed (lista vacía/ausente ⇒ nadie es admin, línea 86). ADMIN_EMAILS NO está ni en .env.local ni en .env.example (grep: solo aparece en auth/index.ts) ⇒ en el entorno actual NADIE es admin: las 3 páginas redirigen a "/" y el endpoint de peso responde 403 siempre.

PRECIO DE ENVÍO. src/lib/shipping.ts es la aritmética única compartida cliente/servidor: tarifa aérea DEFAULT_AEREO_CENTS_PER_LB=350 hardcode (línea 12) con override env NEXT_PUBLIC_SHIP_AEREO_CENTS_PER_LB (línea 23); marítimo SOLO por env NEXT_PUBLIC_SHIP_MARITIMO_CENTS_PER_LB, sin default — sin knob la vía queda oculta (línea 24, filtrada en checkout-core.ts:30); buffer = max(15% del estimado, 1 lb) FÓRMULA HARDCODE sin knob (línea 42); cobrable = ceil(est+buffer) (línea 43); tax DEFAULT_TAX_PCT=7.5 hardcode (línea 13) con override NEXT_PUBLIC_SALES_TAX_PCT (líneas 53-58), aplicado SOLO al subtotal de productos (línea 61-63). Nada vive en DB, no hay UI para cambiarlos. Hoy los env de envío/tax NO están seteados en .env.local (solo listados en .env.example) ⇒ rigen los defaults hardcodeados.

TIEMPOS DE ENTREGA. src/lib/delivery.ts modela 2 tramos: STORE_TO_HUB_DAYS por tienda (líneas 19-25: amazon 3-7, walmart 3-8, shein 8-15, aliexpress 10-25, default 8-20) y HUB_TO_CUBA_DAYS por vía (líneas 28-31: aéreo 7-15, marítimo 25-45). Son constantes de calibración de negocio hardcodeadas, admitido en el comentario (líneas 11-13: "se ajustan con la experiencia real... mover a DB/admin cuando exista el admin") — números inventados-honestos, no medidos, siempre etiquetados "estimado" en UI. Excepción real: provider_ship_min/max_days por producto (AliExpress) persistidos por el hydrate (src/app/api/products/[id]/hydrate/route.ts:87-92, migración 0036) y usados en la PDP (src/app/(tuki)/products/[id]/page.tsx:61-64 → ProductView.tsx:243-244). Se muestran: PDP línea de compra ("llega entre el X y el Y", ProductView.tsx:376), accordion Envío con ambas vías y tarifa/lb (292-294), checkout paso 2 etaLine por vía (CheckoutFlow.tsx:447), review (559) y resumen (629). El carrito multi-tienda toma el ítem más lento (delivery.ts:58-65) y avisa multi-entrega (CheckoutFlow.tsx:418-423, CartDrawer).

PESO. Cascada real con precedencia impuesta EN ESCRITURA: measured jamás se pisa (hydrate route.ts:82 `weight_source <> 'measured'`; weight-graph.ts:172-173 solo pisa NULL/llm), provider lo escribe el hydrate (route.ts:79-85, packageDetail de AliExpress ya empaquetado), llm lo escribe el grafo LangGraph flash→pro con validación de verosimilitud y vecinos MEDIDOS como calibración en el prompt (src/sectors/b-catalog/weight-graph.ts:85,102-110,130-138), heurística pura compartida como último eslabón (src/lib/weight.ts:95-107: inline→keyword→categoría, + pad de empaque 128-131). Lectura: getOrEstimateWeight (src/sectors/b-catalog/weight-estimate.ts:29-53) responde weight_grams persistido o heurística al instante y encola el refinado LLM fire-and-forget con singleFlight (gated por DEEPSEEK_API_KEY presente y WEIGHT_LLM≠false, líneas 24-26 — hoy ENCENDIDO). El feedback admin (peso en báscula) invalida los 20 vecinos LLM más cercanos por embedding para re-estimarlos con el medido como ancla (admin weight route.ts:42-53 + weight-graph.ts:106-108 usa mediana de vecinos como ancla). Código correcto y testeado, PERO hoy inoperable: sin ADMIN_EMAILS el endpoint da 403 y NO existe ninguna UI que lo llame (grep "admin/products" en componentes: 0) — la rama measured y la calibración por vecinos nunca se ejecutan.

CHECKOUT. El ÚNICO flujo en uso es el anónimo: CheckoutFlow.tsx:203 POSTea a /api/checkout/anonymous; /api/checkout (autenticado, src/app/api/checkout/route.ts) no tiene ningún caller (grep fetch("/api/checkout") solo encuentra revalidate y anonymous) y además NO calcula envío/tax ni guarda orders.shipping (src/sectors/a-tracking/checkout.ts:92-97). El server anónimo re-lee precios de products (jamás del cliente), valida variante color/talla contra metadata.attrs.variants (checkout-anonymous.ts:82-88), compara precio mostrado vs calculado → PriceChangedError→409 price_changed (94-103), recalcula envío por libra con la MISMA aritmética y el peso de DB (113-119) y tax (120), compara contra lo que la UI mostró → TotalsChangedError→409 totals_changed (121-126), todo ANTES de insertar (ROLLBACK en catch, 189-192). El cliente maneja ambos 409 visiblemente y pide re-confirmar (CheckoutFlow.tsx:230-258). Revalidación de precio vivo al montar y en cambios de carrito vía /api/checkout/revalidate (CheckoutFlow.tsx:73-124), que pega a RapidAPI REAL (RAPIDAPI_KEY en .env.local; revalidate.ts:246-260, freshness 6h) y actualiza products.price_cents (revalidate/route.ts:97-104). Kill-switches: CHECKOUT_REVALIDATE=false (route.ts:24-26) y HYDRATE_DETAIL=false — ninguno seteado, ambos activos.


### Respuestas a las preguntas del encargo

(1) QUÉ ADMINISTRA EL DUEÑO HOY DESDE UI: en teoría (con ADMIN_EMAILS seteado) solo puede VER: top-50 de co-ocurrencia NPMI (/admin/co-occurrence/top), traza de búsqueda (/admin/search/explain?q=) y debug de UN usuario si conoce su UUID (/admin/users/[id] — no hay listado de usuarios). No existe NINGUNA página /admin/products ni /admin índice. Cero capacidad de escritura desde UI: precios, tarifas de envío, tax, pesos, productos, rangos de entrega y catálogo requieren tocar código/env/DB o curl con sesión admin. En la práctica HOY ni eso: sin ADMIN_EMAILS en el env nadie es admin (auth/index.ts:86 fail-closed) y las 3 páginas redirigen a "/". (2) DÓNDE VIVEN $3.50/lb, BUFFER Y TAX 7.5%: los tres en src/lib/shipping.ts como hardcode con override por env: 350¢/lb default (línea 12) overrideable por NEXT_PUBLIC_SHIP_AEREO_CENTS_PER_LB (23); tax 7.5 default (13) overrideable por NEXT_PUBLIC_SALES_TAX_PCT (53-58); el buffer max(15%, 1 lb) es fórmula pura hardcode SIN env (42). Nada en DB. ¿Cambiarlos sin deploy? NO de forma limpia: los env NEXT_PUBLIC_* se inlinean en el bundle cliente al build — cambiar el env solo re-lee el server en runtime, el cliente conserva el valor compilado y cada checkout cae en 409 totals_changed hasta rebuild (la red de seguridad lo hace visible y recuperable, pero es fricción en cada orden). Hoy ninguno de los 3 env está seteado en .env.local: rigen los defaults. (3) TIEMPOS DE ENTREGA: delivery.ts usa STORE_TO_HUB_DAYS hardcode (amazon 3-7, walmart 3-8, shein 8-15, aliexpress 10-25, default 8-20) + HUB_TO_CUBA_DAYS (aéreo 7-15, marítimo 25-45). Son inventados-calibración (el propio comentario líneas 11-13 lo admite: conocimiento de negocio a ajustar), con UNA fuente real: provider_ship_min/max_days por producto que AliExpress reporta y el hydrate persiste (hydrate/route.ts:87-92) — solo la PDP los usa; el checkout los ignora (inconsistencia listada en roto). Se muestran al usuario como fechas concretas etiquetadas estimadas: PDP (línea de compra :376 y accordion Envío :292-294), checkout paso 2/review/resumen (etaLine). (4) CASCADA DE PESO: sí funciona a nivel código y la precedencia es correcta por escritura (measured intocable: hydrate:82 y weight-graph:172-173 lo respetan; provider por hydrate:79-85; llm por grafo con validación flash→pro y vecinos medidos como calibración weight-graph.ts:85,102-110,130-138; heurística compartida cliente/server). El feedback admin SÍ invalida 20 vecinos LLM como se diseñó (admin weight route:42-53). PERO hoy la rama measured es letra muerta: el endpoint responde 403 para todos (sin ADMIN_EMAILS) y NO EXISTE UI para meter peso medido — sería curl, y ni curl funciona sin la variable. El refinado LLM sí está encendido (DEEPSEEK_API_KEY presente, WEIGHT_LLM unset). 49 tests unitarios de weight/shipping/delivery/checkout pasan. (5) CHECKOUT: el recálculo server-side + 409 cierra bien los tres vectores principales — precio viejo del carrito (revalidación al montar + PriceChangedError al confirmar, ambos visibles), peso que cambió (TotalsChangedError con re-confirmación del total del server), knob cambiado (mismo 409). Huecos concretos: (a) via marítima del schema → 500 bad_via sin mapear; (b) productos is_active=false siguen comprables (SELECT sin filtro); (c) 409 espurio sistemático para productos con peso inline solo en descripción (cliente estima CON descripción vía /weight, server SIN ella) y, tras ese 409, el desglose de libras en pantalla queda desincronizado del total cobrado; (d) /api/checkout/revalidate sin auth ni rate-limit permite quemar cuota RapidAPI ajena al checkout; (e) el flujo autenticado /api/checkout no lo usa nadie y no calcula envío/tax — todo pedido, logueado o no, termina en el usuario demo sintético. (6) PROTECCIÓN /admin: sí, doble capa por página y por API — getAuthUser (401/redirect a login) + requireAdmin con allowlist ADMIN_EMAILS case-insensitive fail-closed (users/[id]/page.tsx:14-16, co-occurrence:9-13, explain:14-16, searches route:38-44, weight route:17-23; proxy.ts:18 confirma que no hay middleware, las páginas se protegen solas). Nadie sin sesión + email en la allowlist entra; el estado actual es el extremo opuesto al agujero: NADIE entra, ni el dueño. ERRORES CONCRETOS EN CÁLCULOS DE ENVÍO/TIEMPOS: 500 bad_via; 409 espurio por divergencia description cliente/server; desglose de libras stale tras totals_changed; Total del CartDrawer sin tax (difiere ~7.5% del checkout); ETA PDP≠checkout para AliExpress hidratados (provider days ignorados en checkout-core.ts:32); PDP anuncia vía marítima con fechas y precio 'más económico' que el checkout no ofrece.


### Hallazgos verificados

**ADMIN_ENVIOS-1 · HUMO · severidad alta · veredicto: confirmado**

Todo el subsistema admin (3 páginas + feedback de peso medido) es inoperable en el entorno actual: ADMIN_EMAILS no existe en .env.local ni en .env.example, y el gate es fail-closed — ni el dueño puede entrar; el endpoint de peso medido da 403 siempre y además NO existe UI que lo llame, así que la rama 'measured' de la cascada y la calibración por vecinos jamás se ejecutan

- Evidencia: src/lib/auth/index.ts:86 (allowlist vacía ⇒ false) y :93-97; grep ADMIN_EMAILS: solo auth/index.ts; .env.local y .env.example sin la variable; páginas redirigen (admin/users/[id]/page.tsx:16, co-occurrence/top/page.tsx:13, search/explain/page.tsx:16); src/app/api/admin/products/[id]/weight/route.ts:21-23; grep 'admin/products' en src/components: 0 callers

- Corrección sugerida: Añadir ADMIN_EMAILS=<email del dueño> a .env.local (y documentarla en .env.example); mientras no haya UI, el pesaje se dispara con curl al endpoint ya existente


**ADMIN_ENVIOS-2 · HUMO · severidad media · veredicto: confirmado**

El checkout autenticado /api/checkout es un camino muerto presentado como feature: ningún componente lo llama (el único flujo real es el anónimo), y si se llamara crearía órdenes SIN envío, SIN tax y SIN orders.shipping; consecuencia: los usuarios logueados compran por el flujo anónimo y su orden se cuelga de un usuario sintético demo|anonymous_id, no de su cuenta

- Evidencia: grep fetch("/api/checkout" en src: solo /revalidate y /anonymous (CheckoutFlow.tsx:81,203); src/sectors/a-tracking/checkout.ts:92-97 (INSERT orders sin shipping); checkout-anonymous.ts:59-64 (usuario demo|anonymous_id)

- Corrección sugerida: En createAnonymousOrder, si hay sesión (getAuthUser en la ruta), colgar la orden del usuario real (getOrCreateUserBySub con su sub) en vez del demo|; y borrar /api/checkout + checkout.ts o conectarlos de verdad


**ADMIN_ENVIOS-3 · HUMO · severidad media · veredicto: confirmado**

El pago es simulado: campos de tarjeta precargados con 4242 4242 4242 4242, el número/CVV nunca viajan al server, no hay procesador — la orden queda 'pendiente' sin cobro, mientras la UI dice 'Pago fácil · 🔒 conexión segura'

- Evidencia: CheckoutFlow.tsx:133-135 (defaults), :210-223 (el body solo manda pago:'tarjeta', jamás la tarjeta), :317-318 (copy); checkout-anonymous.ts:130 (status 'pendiente', sin cobro)

- Corrección sugerida: Vaciar los defaults de tarjeta y etiquetar el paso como pago-al-confirmar/demo; retirar '🔒 conexión segura' mientras ningún dato de pago viaje


**ADMIN_ENVIOS-4 · HUMO · severidad media · veredicto: confirmado**

total_cost_cents y unit_cost_cents son un 60% inventado del precio, persistidos en orders/order_items como si fueran costo real de negocio

- Evidencia: checkout-anonymous.ts:106 (totalCost = Math.round(totalCharged*0.6)) y :147; checkout.ts:90 y :110

- Corrección sugerida: Persistir NULL en *_cost_cents hasta capturar el costo real de la compra al proveedor (o renombrar a estimated_cost_cents)


**ADMIN_ENVIOS-5 · HUMO · severidad media · veredicto: confirmado**

La PDP promete la vía marítima con fechas y 'más económica, ideal para pedidos pesados', pero marítimo no tiene tarifa configurada (NEXT_PUBLIC_SHIP_MARITIMO_CENTS_PER_LB ausente, sin default) y el checkout la oculta — se anuncia una opción que no se puede elegir

- Evidencia: ProductView.tsx:292-294 (deliveryPhrase(sea) + copy); shipping.ts:24 (marítimo sin knob → null); checkout-core.ts:30 (filter shipRateCentsPerLb !== null); .env.local sin la variable

- Corrección sugerida: Condicionar la frase marítima de ProductView.tsx:292-294 a shipRateCentsPerLb("maritimo") !== null


**ADMIN_ENVIOS-6 · HUMO · severidad media · veredicto: confirmado**

El formulario de checkout llega precargado con datos demo mexicanos (Dani Torres, Av. Siempre Viva 742, Ciudad de México, CP 06100, RFC) en una tienda para Cuba — órdenes reales pueden confirmarse con dirección inventada sin que el usuario toque nada salvo el CI

- Evidencia: CheckoutFlow.tsx:126-137 (useState con defaults 'demo, dc.html script 990-991' según comentario líneas 4-5)

- Corrección sugerida: Vaciar los defaults de f/fb en CheckoutFlow.tsx:126-137 y usar placeholders


**ADMIN_ENVIOS-7 · HUMO · severidad baja · veredicto: confirmado**

GET /api/admin/searches existe pero ninguna página lo consume — superficie admin a medias (API sin UI); y su comentario 'TODO Phase 4: admin role check (currently any logged-in user accesses)' es falso: el check requireAdmin SÍ está en las líneas 42-44 — doc interna desactualizada

- Evidencia: src/app/api/admin/searches/route.ts:7 (comentario) vs :42-44 (requireAdmin real); grep 'api/admin/searches' en *.tsx: 0 callers

- Corrección sugerida: Borrar el comentario desactualizado de la línea 7


**ADMIN_ENVIOS-8 · HUMO · severidad media · veredicto: confirmado**

src/sectors/e-admin/ está VACÍO (solo .gitkeep del 1-jul) — el sector de administración planificado en la arquitectura por sectores no existe; los helpers admin reales viven dispersos en c-search/admin/ y d-personalization/admin/, y f-slate/write.ts referencia un '/api/admin/placements' futuro que tampoco existe. Implica: no hay módulo donde vivan tarifas/pesos/productos administrables, exactamente lo que delivery.ts:13 pospone ('mover a DB/admin cuando exista el admin')

- Evidencia: ls -la src/sectors/e-admin/ → solo .gitkeep 0 bytes; src/sectors/f-slate/write.ts:9-10; delivery.ts:11-13

- Corrección sugerida: Hueco arquitectónico, no bug ejecutable: lo más corto es quitar la referencia futura en write.ts:9-10 o crear /api/admin/placements mínimo con requireAdmin sobre el write ya compartido


**ADMIN_ENVIOS-9 · ROTO · severidad media · veredicto: confirmado**

POST /api/checkout/anonymous con via:'maritimo' (permitido por el schema zod) devuelve 500 en vez de 4xx: shipQuote da null por vía sin tarifa y el throw new Error('bad_via') no está mapeado en el catch de la ruta

- Evidencia: src/app/api/checkout/anonymous/route.ts:21 (z.enum(['aereo','maritimo'])) y :69-81 (catch sin caso bad_via → rethrow 500); checkout-anonymous.ts:118-119 (throw)

- Corrección sugerida: Añadir en el catch de la ruta: `if (e instanceof Error && e.message === "bad_via") return NextResponse.json({ error: "bad_via" }, { status: 400 })`


**ADMIN_ENVIOS-10 · ROTO · severidad media · veredicto: confirmado**

Un producto desactivado (is_active=false) sigue siendo comprable: el SELECT del checkout anónimo no filtra is_active, así que un carrito viejo en localStorage puede ordenar un producto retirado del catálogo (la PDP y el endpoint de peso sí filtran, el checkout no)

- Evidencia: checkout-anonymous.ts:70-74 (SELECT ... FROM products WHERE id = ANY($1) sin is_active); contraste: weight-estimate.ts:38 (AND is_active = true)

- Corrección sugerida: Añadir `AND is_active = true` al SELECT de checkout-anonymous.ts:72 y tratar el id pedido-y-no-devuelto como 'unavailable' (409) en vez del `continue` silencioso de :84


**ADMIN_ENVIOS-11 · ROTO · severidad media · veredicto: parcial**

409 totals_changed espurio garantizado para productos con peso inline en la DESCRIPCIÓN y sin weight_grams persistido: la PDP calcula y guarda en el snapshot el peso CON description (getOrEstimateWeight pasa description), pero el recálculo del checkout re-estima SIN description — pesos distintos → ship_cents distinto → 409 en el primer confirm aunque nada cambió; además, tras el 409 la línea 'tu caja pesa X lb' y el desglose ('N lb estimadas + M de colchón') siguen mostrando los números viejos del cliente mientras el total usa los centavos del server: desglose inconsistente con el total cobrado

- Evidencia: weight-estimate.ts:51 (heurística CON description) → ProductView.tsx:231 (snapshot weight_grams = weight?.grams); checkout-anonymous.ts:115 (estimateWeightGrams({title, category}) SIN description); CheckoutFlow.tsx:141-147+237-244 (serverTotals solo pisa ship/tax), :417 (wS del cliente) y :616-618 (desglose de cur.quote local)

- Corrección sugerida: Pasar prod.description (ya seleccionada en :71) a estimateWeightGrams en checkout-anonymous.ts:115; y tras un 409 totals_changed ocultar o reconciliar el desglose local de libras


**ADMIN_ENVIOS-12 · ROTO · severidad baja · veredicto: confirmado**

ETA inconsistente PDP vs checkout para productos AliExpress hidratados: la PDP acorta el rango con provider_ship_min/max_days pero shipOptions/estimateDeliveryForCart los ignora (los ítems del carrito no llevan esos días) — el mismo producto muestra p.ej. 12-20 días en la PDP y 17-40 en el checkout

- Evidencia: src/app/(tuki)/products/[id]/page.tsx:61-64 + ProductView.tsx:243-244 (usa providerShipDays) vs checkout-core.ts:32 (estimateDeliveryForCart(sources, via) sin providerShipDays; delivery.ts:58-65 solo acepta sources)

- Corrección sugerida: Guardar provider_ship_min/max_days en el snapshot del carrito (CardSnapshot/TukiCartItem) y aceptar providerShipDays por ítem en estimateDeliveryForCart


**ADMIN_ENVIOS-13 · ROTO · severidad baja · veredicto: confirmado**

El 'Total' del CartDrawer omite el tax: suma subtotal + envío, así que difiere del total real del checkout en 7.5% del subtotal — el número que el usuario ve al pasar al checkout salta hacia arriba

- Evidencia: CartDrawer.tsx:117-119 (totF = fmt(subtotal + ship), sin taxCents) vs CheckoutFlow.tsx:164 (totalCents = subtotal + tax + ship)

- Corrección sugerida: Incluir taxCents(subtotal) en totF y añadir la línea de impuestos al footer del drawer (CartDrawer.tsx:117-119)


**ADMIN_ENVIOS-14 · ROTO · severidad media · veredicto: confirmado**

/api/checkout/revalidate no tiene auth ni rate-limit y cualquier anónimo puede POSTear uuids de productos para quemar cuota RapidAPI (llamadas pagas reales, key presente) y disparar UPDATEs de products.price_cents; el único freno es la frescura de 6h por producto (rotando productos se escala al tamaño del catálogo cada 6h)

- Evidencia: src/app/api/checkout/revalidate/route.ts:53-60 (sin getAuthUser/requireAdmin/limit) y :97-104 (UPDATE price_cents); revalidate.ts:246-252 (freshness 6h); rapidapi/client.ts:18-19 + RAPIDAPI_KEY en .env.local (llamadas reales)

- Corrección sugerida: Exigir cookie anonymous_id válida (mismo patrón que anonymous/route.ts:45-48) + throttle por identidad/IP, o un tope diario global de llamadas al estilo AGGREGATOR_DAILY_BUDGET_CENTS antes de revalidateProduct


**ADMIN_ENVIOS-15 · ROTO · severidad baja · veredicto: confirmado**

La invalidación de vecinos tras un pesaje no tiene piso de similitud: invalida los 20 productos LLM más cercanos por embedding SIN umbral de distancia — en un catálogo chico pesar una mancuerna puede anular el peso estimado de un vestido y forzar re-estimaciones (y costos LLM) sin relación real

- Evidencia: src/app/api/admin/products/[id]/weight/route.ts:42-53 (ORDER BY embedding <=> ... LIMIT 20, sin WHERE de distancia); mismo patrón sin piso que el hallazgo called_mock del cosine en memoria del proyecto

- Corrección sugerida: Añadir piso al subquery: `AND embedding <=> (SELECT embedding FROM products WHERE id = $1) < <umbral>` (mismo criterio de piso coseno que SEARCH_STRONG_HIT_MIN_SCORE)


**ADMIN_ENVIOS-16 · ROTO · severidad baja · veredicto: parcial**

Cambiar tarifa/tax por env SIN rebuild rompe la coherencia cliente/servidor: NEXT_PUBLIC_* se inlinea en el bundle del cliente en build, así que el server recalcula con el valor nuevo y el cliente muestra el viejo → TODOS los checkouts caen en 409 totals_changed (recuperable con re-confirmación visible, pero fricción sistémica hasta redeployar)

- Evidencia: shipping.ts:8 (comentario 'Knobs NEXT_PUBLIC_ para que cliente y server vean el mismo número' — solo cierto si build y runtime coinciden); shipping.ts:15-25,53-58 (lectura process.env en código compartido usado por CheckoutFlow.tsx:13 en cliente y checkout-anonymous.ts:7 en server); CheckoutFlow.tsx:237-244 (el 409 es la red de seguridad)

- Corrección sugerida: Leer los knobs de envío con acceso estático (process.env.NEXT_PUBLIC_SHIP_AEREO_CENTS_PER_LB y ..._MARITIMO_... literales, como ya hace taxPct) para que se inlineen, y regla operativa: cambiar knob ⇒ rebuild+deploy



---

# ANEXO — Prueba en vivo con navegador real (2026-08-12, tarde)

> Sesión de pruebas destructivas con Claude in Chrome contra `next start` (build de producción),
> jugando tres roles: cliente bruto con conexión mala, saboteador, y dueño que paga cada API call.
> Costo total de la sesión: ~9¢ contabilizados en `mock_calls` (2 ingestas) + hydrates/revalidate a 0¢.

## Corrección honesta sobre un hallazgo intermedio

Durante la primera prueba el servidor quedó clavado a 100% CPU y "la tienda entera murió durante la
ingesta". **Eso fue artefacto del harness de prueba, no bug del producto**: lancé `pnpm start | head -50`,
el pipe se cerró a las 50 líneas y cada log de Apify explotó en EPIPE → Next parsea/imprime el error →
EPIPE otra vez → bucle infinito (perfilado con el inspector V8: `patch-error-inspect.js` + `parseGecko`).
Reiniciado con log a archivo, quedó demostrado lo contrario: **la app se mantiene 100% viva durante la
ingesta** (suggest constante a 48–97ms mientras corrían los actores).

## Lo que FUNCIONA (verificado en vivo)

- **Perf 3G**: home = 406KB transferidos (~8s a 400kbps), imágenes 42KB total (peor: 13KB). TTFB 111ms,
  DCL 2.2s, load 3.5s local. El trabajo de optimización 3G es real.
- **Búsqueda→ingesta async**: query sin resultados responde en 2.6s con `called_mock:true`, los actores
  corren de fondo, el poll del cliente trae "+N nuevos". "olla arrocera": 0 → 6 → 14 productos reales
  en ~3-4 min (Amazon 16 items/2 páginas, AliExpress, Shein OTAPI 0→fallback pinto).
- **Personalización reacciona**: tras ver/comprar la olla, la home pasó de "Pasillo de ropa" a
  "Pasillo de hogar — elegido para ti" con la olla primero. El loop view→slate→re-materialización es visible.
- **Checkout server-side**: doble clic en Confirmar NO duplica pedidos (quedó exactamente 1 fila);
  el 409 `totals_changed` disparó y protegió la coherencia; validación de CI correcta (letras filtradas,
  vacío bloqueado con mensaje); marítimo correctamente oculto en el paso Entrega.
- **Teatro del spinner**: calibrado con flags reales (hit_cache/called_mock), banner de ingesta viva real.
- **"Efectivo al recibir"** existe como método — el único viable de verdad para Cuba hoy.

## Hallazgos NUEVOS del test en vivo (no estaban en la auditoría estática)

**V1 · CRÍTICO NEGOCIO — El peso inflado mata la venta y el server la remata en silencio.**
Olla de 1.8L: "peso estimado 7.7 lb (3500g)" (real ~2.6 lb). Carrito 2×$8.13 = $16.26 → envío $63.00
(388% del subtotal), total $79.26. Al confirmar, el server re-estima SIN descripción (bug ya
documentado) y baja a $35.00/total $52.48 — **la UI cambia los números sin ningún mensaje**: el flujo
del 409 re-renderiza montos y botón sin explicación visible. Cliente bruto ni lo ve; cliente atento
huye. Cadena completa verificada: drawer $79.26 (sin tax) → checkout $80.48 (aparece tax) → 409 →
$52.48 → success con TERCERA fecha de entrega distinta (27 ago–16 sep vs 29 ago–21 sep del review).

**V2 · CRÍTICO NEGOCIO — La contabilidad es ficción.** El pedido creado registró
`total_charged_cents=1626` ($16.26, solo subtotal) cuando al cliente se le cobrará $52.48 en la puerta:
envío y tax solo viven en el jsonb `shipping`. `margin_cents=650` se computa contra
`total_cost_cents=976` (el 60% inventado). Ni ingresos ni costos ni margen reales.

**V3 · CRÍTICO PRODUCTO — Un typo = tienda vacía + dinero quemado.** "olla arocera" (falta la r):
0 resultados con 14 ollas en catálogo. Causa raíz: títulos en inglés → BM25 español inútil → todo
cuelga del coseno con piso 0.55, y **el pipeline embebe la query CRUDA antes de normalizar** — la
corrección del typo que DeepSeek sí hace nunca llega al vector. Encima el typo disparó SU PROPIA
ingesta pagada (freshness dedupe por hash crudo, fetch con texto corregido → doble pago por la misma
búsqueda corregida) y 15 min después sigue mostrando "nada por aquí" — pagado y vacío, bloqueado 24h.
El suggest (ILIKE literal) tampoco ayuda con typos.

**V4 · CRÍTICO CONFIANZA — Copy que miente, inventariado en pantalla:**
banner "envío estándar gratis desde $50 — siempre" (el checkout cobra por libra SIEMPRE);
banner "el envío rápido llega en 1–2 días" (delivery.ts: 7–15 días solo depósito→Cuba);
banner "la factura llega sola a tu correo" (el checkout jamás pide email; no hay mailer);
"devolución gratis 30 días / la recogemos en tu puerta" (PDP+loader; imposible desde Cuba);
"se te acredita al saldo" (no existe sistema de saldo); "Garantía tuki de 12 meses";
"comparamos reseñas" (no hay reseñas en el catálogo); vía marítima con fechas en PDP que el
checkout no ofrece; "la que más eligen" como badge de la ÚNICA opción; "(FL 7.5%)" filtrando
Florida al cliente cubano; "✦ encaja con lo que has estado mirando" en la primera visita;
"tu feed ya aprendió de esta compra" (la compra NO alimenta el vector en tiempo real).

**V5 · ALTO — Rieles complementarios absurdos con imágenes rotas.** "Combina con esto — quienes lo
llevaron, sumaron esto" y "y esto le encanta a gente como tú" muestran CÁMARAS ESPÍA junto a ollas
arroceras (fallback de categoría complementaria inventando relaciones + copy que afirma compras
reales inexistentes). Varias cards de addons y thumbnails de galería PDP salen como placeholders
rayados (imágenes rotas).

**V6 · ALTO — Sin geografía cubana.** El checkout aceptó "Av. Siempre Viva 742, Ciudad de México"
sin objeción (datos demo precargados que sobreviven hasta el pedido confirmado). No hay selector de
provincia/municipio; la dirección es texto libre. La paquetería real no puede operar así.

**V7 · MEDIO — El contador de gasto pierde ingestas que mueren.** La ingesta de "mochila" corrió
actores de Apify (dinero real) pero el proceso murió antes de escribir `mock_calls` → el freno de
presupuesto de 400¢/día subcuenta. La fila de costo se escribe al FINAL del job.

**V8 · MEDIO — /admin devuelve 404** (sin `ADMIN_EMAILS` ni siquiera el dueño ve las 3 páginas).
Confirmación en vivo del hallazgo estático.

**V9 · BAJO — Agregar al carrito no da feedback.** El drawer no se abre ni hay toast; solo cambia
el badge. El doble-Agregar del bruto mergea bien a qty 2 (correcto), pero la falta de confirmación
invita a clicks repetidos.

**V10 · Pendientes no probados**: vista móvil real (el resize de ventana no surtió efecto en esta
sesión), login/OTP Supabase (config de dashboard pendiente), páginas 2+ del feed con scroll.

## El camino recomendado (orden de ejecución)

**Semana 1 — que los números sean verdad (sin esto no hay negocio):**
1. Pesos: pasar description al recálculo del checkout (1 línea, mata el 409 espurio) + activar
   `ADMIN_EMAILS` + UI mínima de pesar (la cascada measured ya existe) + revisar los outliers
   groseros del LLM (olla 3.5kg). El peso ES el precio en este modelo.
2. Contabilidad: `total_charged_cents` = subtotal+envío+tax; costo real NULL hasta capturarlo
   (o `estimated_`); el margen que muestre la verdad.
3. Tax en el CartDrawer (que el total nunca salte).
4. Banner del 409: "el envío se ajustó de $X a $Y porque re-pesamos tu caja" — visible.
5. Pedido colgado del usuario logueado si hay sesión.
6. Borrar/reescribir TODO el copy mentiroso (V4 es una lista de tachado, 1-2 horas).
7. `is_active=false` fuera del checkout + auth en `/api/checkout/revalidate`.

**Semana 2 — que el cliente encuentre y confíe:**
8. Typos: embeber la query NORMALIZADA (reordenar 2 llamadas en search.ts) + pg_trgm en suggest.
9. Freshness de ingesta por query corregida (no cruda) — corta el doble pago.
10. CATEGORY_PROVIDER_MAP: arreglar el name del registry (1 línea, ~50% menos gasto por ingesta).
11. Piso de similitud en rieles complementarios o esconder la sección sin datos NPMI reales
    (fuera cámaras espía con ollas) + arreglar imágenes rotas de addons/galería.
12. Provincia/municipio cubanos en el checkout; fuera datos demo precargados.
13. Voyage con timeout + degradación a BM25 (que una caída no tumbe la búsqueda).

**Semana 3+ — operación y crecimiento:**
14. Scheduler real de crons (crontab versionado o GitHub Actions).
15. Dashboard admin mínimo: pedidos del día (con totales VERDADEROS), pesar paquetes, placements.
16. Identidad: feed páginas 2+ con user real, merge de carrito al login, exclusión purchased.
17. Agente: solo cuando la home pinte slots 20-90; gate v2.1 completo antes de encender.
18. Pago: definir el flujo real (efectivo/transferencia manual confirmada) y quitar la tarjeta 4242.
