# Web dinámica per-usuario — PageSlate + Slate materializado (Fase 1, lista para agentes en Fase 2)

> **Estado: APROBADO por el usuario (2026-06-10).** Decisiones cerradas: holdout **10%** de perfiles
> con baseline no personalizada (reducible a 5% cuando el tráfico crezca); modo ahorro de datos
> default-ON; adaptación per-usuario; agentes = Fase 2 backend-first.
> Origen: análisis de 13 agentes (2 enumeradores + cartógrafo + 9 deep-dives + crítico),
> journal `wf_b6508bd0-86f`. Plan ejecutable: etapas A-F al final de este documento.

## Contexto

La visión: una tienda que actúa como vendedor personalizado — la web se adapta por individuo (qué productos, qué secciones, cross-sell, add-ons), cambia entre visitas y DURANTE la visita, con scroll infinito y carga progresiva, rápida en red cubana (RTT 300-600ms, datos caros, dispositivos modestos). En Fase 2, agentes de IA escribirán las decisiones de merchandising (probados primero en backend). Hoy: layout 100% hardcodeado, sin paginación, sin cross-sell en PDP, config solo env-vars, y fundaciones rotas (sin `pg.Pool`, proxy con upserts por request, admin sin role check).

Este plan sale de un análisis exhaustivo (2 enumeradores + 9 deep-dives + crítico de completitud, todos aterrizados al código real). El diseño tiene DOS objetos de primera clase:
1. **El slate materializado** (`feed_slates`): snapshot inmutable post-exploración top-100 por sesión — de él cuelgan el cursor del scroll infinito, la estabilidad anti-flicker, la adaptación por versión y el camino hit que convierte los ~850ms del feed en ~50-80ms.
2. **composePage** (UI server-driven): registro de secciones + placements con reglas evaluadas per-usuario, presupuestos y degradación — el tablero que los agentes usarán en Fase 2.

Más una **arquitectura de cliente** load-bearing (cola de eventos, restauración de scroll, modo ahorro) que el borrador inicial omitía.

**Decisiones del usuario:** adaptación PER-USUARIO; UI server-driven con catálogo de secciones (no generativa); agentes = Fase 2 backend-first; autonomía futura híbrida por riesgo; render síncrono primero.

## Capa 0 — Fundaciones (prerrequisitos unánimes de los 9 dives)

- **`pg.Pool` singleton** (`src/lib/db/pg.ts`): lazy, `max=3`, `idleTimeoutMillis=30s`, `connectionTimeoutMillis=2s`, `query_timeout=2.5s`. Runtime → pooler puerto 6543 (transaction mode); crons/tests/thesis → directa 5432. `search_path` vía `ALTER ROLE ... SET search_path` (una vez, por entorno) — NO `SET` por query (no sobrevive transaction mode); smoke test `SHOW search_path`. `statement_timeout` para presupuesto real (cancela server-side).
- **Identidad fuera del proxy** (`src/proxy.ts`): cookies UUID firmadas HMAC, CERO DB en el proxy; el primer escritor es `/api/track` (persistSessionState ya hace ON CONFLICT; readSessionState ya degrada con fila ausente). Visitante que rebota = 0 escrituras. Arreglar la carrera de `user_profiles_anon_uniq` (dos requests concurrentes de visitante nuevo → 500 hoy). `session_end` se deriva offline. Excluir `/api/*` correctamente en el matcher (hoy cada fetch de API paga los upserts).
- **`requireAdmin()`** (`src/lib/auth.ts`, allowlist por env) en TODAS las rutas admin existentes — prerrequisito de cualquier write-path de placements.
- **Wrapper de resolvers + `error.tsx`**: hoy un fallo de cualquier SELECT tumba la home entera (cero error.tsx en src/app). Patrón `{ok,...}|{error,reason}` + cascada de degradación + log estructurado (un solo punto de instrumentación).
- **Circuit breaker DB** (`dbHealth()`): distingue lag de pooler (1 retry) de proyecto pausado (free-tier auto-pausa); `composePage` con `dbHealth()!=='ok'` → cascada de caché directa; `/api/track` → 503 rápido (la cola cliente reintenta).
- **Instrumentación primero**: `composePage` acumula `[{name,dur,hit}]` → Server-Timing en route handlers + persistencia muestreada vía `after()` en páginas. Sin medir, el orden de las palancas es adivinanza. Gate de despliegue: home hit p99 ≤400ms, miss ≤1.5s, página-2 ≤150ms.

## Capa 1 — Slate materializado + scroll infinito

- **`feed_slates`** (jsonb por slate): snapshot **post-exploración a profundidad 100** (la exploración se fija al materializar; el explore pool se amplía a la cola de la fusión, hoy descartada en `slice(0,100)` de feed.ts). Keyed por (profile, session); +`slate_version`, pins, spares.
- **Contrato nuevo de `generateFeed`**: `{ items, feed_request_id, next_cursor }`. **Cursor = `{slate_id, last_absolute_position, config_version, seed}`** — la posición ABSOLUTA a través de páginas es irrecuperable si no entra en v1 (curva de examinación θ̂(p), OPE).
- **Página 2+**: Route Handler JSON slim (~2-3KB gz) render client-side con el mismo card component (compartido client-compatible — resolución del crítico); 1 query pooled ~10-30ms. 20 items SSR inicial / **12 por fetch** / sentinel IntersectionObserver ~800px con respeto a `saveData` / cap 200 (100 slate + 100 refill popular) / fin-de-feed explícito. Nunca 410: cursor inválido → regeneración transparente con dedupe contra `feed_impressions` de la sesión.
- **Expiración compuesta**: sesión (vida máx) + shift de cohort (semántica, reusa `shift-detection.ts` 3-de-5) + soft-TTL **300s** (única política de staleness, compartida con el cliente — resolución del crítico sobre el conflicto 300s vs 10min). Evaluación lazy en el request de página.
- **Invalidación por evento (pull, nunca push ni polling)**: dismiss y shift bumpean `slate_version` (1 UPDATE en el track-hook); la señal viaja piggy-backed en la respuesta de `/api/track` y en la página siguiente del cursor. Dismiss compacta lo NO servido del slate vigente (invariante en dos tiempos: filtros de ranking solo pre-rrfFuse; compactación solo sobre no-servido).
- **Pins**: ítems clickeados quedan pineados intra-sesión (cap 4, prioridad clickeados-no-carted), exentos de fatiga.
- **Reload misma sesión = mismo slate** (hit ~50-80ms): estabilidad y ahorro son el mismo mecanismo.
- **SEO**: lo personalizado es efímero y NO indexable; rutas `/c/*` de catálogo SSR no personalizadas con paginación real (cacheables, baratas, anti-cloaking: bots sin cookies ven la variante fría determinista).

## Capa 2 — composePage + secciones

- **`ui_sections`** crece con columnas explícitas (CHECK) para todo lo que composePage LEE: `layout` (contrato anti-CLS único para renderer/skeleton/reserva), `budget_ms`, `budget_queries`, `freshness_policy` (`per_session_snapshot|per_request|per_visit|nightly`), `priority` (orden de sacrificio: feed=0 jamás, cross-sell=1, hero=2, descubrimiento=3+), `min_items` (default por tipo + override acotado por Zod), `title_template`. jsonb solo para `params` y `rule`.
- **`ui_placements`**: como el borrador (surface, slot, section_type, params, rule, scope global|segment|user, status, **risk_tier**, experiment_id, ttl_until, created_by, version) + lifecycle: validación Zod al escribir Y al evaluar; fallos → `paused` automático (high/medium al primer fallo; low con umbral 3/10min); **kill-sentinel piggybacked** para risk_tier high (TTL 30-60s no basta como kill-switch); `killed` irreversible por constraint, no por convención.
- **Resolvers devuelven CANDIDATOS k×2, no slates hidratados** (todos beben de los mismos pools): el compositor ve todo → **dedupe por claim greedy en orden de priority** (feed recibe su top-k intacto; hero al final con over-fetch ×3); flag `allow_claimed` solo para tipos deliberadamente redundantes ("vuelve a verlo"). Hidratación de productos UNA vez.
- **MMR en dos alcances**: el feed congelado conserva su MMR de materialización; composePage aplica MMR-seed cross-sección por composición (~1-2ms) sin re-MMRear el slate.
- **Popularidad materializada**: `product_popularity_7d` (+ por categoría) refrescada cada 10-15min por cron — `fetchPopularGlobal`/`views-categories` re-agregan 7 días de events POR REQUEST hoy; esta tabla es la palanca de presupuesto más barata.
- **Presupuesto de queries como contrato**: home ≤4 round-trips bloqueantes (+1 fire-and-forget), página-2 ≤1, PDP ≤1 + lazy. UNA tabla de presupuestos (módulo de constantes con unidades nombradas: `PAGE_SIZE_CURSOR=12`, `MAX_ITEMS_COMPOSITION=60`, `MAX_DEPTH=200`...).
- **Límites duros del compositor** no violables por ningún placement (clamp runtime + validación de escritura).
- **DSL de reglas**: como el borrador (whitelisted plano, fail-closed), campos desde el contexto consolidado (1-2 SELECTs con JOIN — generateFeed ya construye casi todo).
- **Streaming Suspense: DEGRADADO a mecanismo condicionado** — umbral: p99 home >600ms sostenido 7 días O sección below-fold con budget >250ms. Con slate-hit de 50-80ms el skeleton sería parpadeo. El contrato de resolvers no cambia si se activa.

## Capa 3 — Adaptación viva (la página "cambia durante la visita")

- **Regla dura anti-flicker como contrato del SERVIDOR** (solo dos verbos: componer página nueva / appendear al snapshot). Única mutación above-fold permitida: dismiss (gesto del usuario).
- **Ningún ítem visible cambia de posición sin rótulo**: todo cambio entra como sección nueva rotulada ("Porque viste X"); `reason` por tarjeta solo para ε-explore y el ancla.
- **Ancla de continuidad**: "Seguías mirando" SIEMPRE primero si hay view ≤7 días; objetivo ≥50% overlap en top-8 entre visitas sin shift; tras shift, el cambio es el mensaje.
- **Cadencia**: navegación recompone (con hit de slate); dentro del scroll, la frescura viaja en la respuesta de track y la siguiente página del cursor. Pull-to-refresh = re-roll explícito (política propia ε=0.3 marcada en `policy` — ε constante DENTRO de cada política).
- **Churn cap 30%** entre composiciones = presupuesto que la rotación gasta (~2 ε-explore + ~4 novelty quota post-MMR con posiciones fijas).
- **Fatiga**: `excluded_products` con `reason='fatigue'`, N=3 impresiones de **viewport** (jamás servidas) sin click en 7d, TTL 7d; por categoría solo DEMOTER (nunca excluir categoría entera); precedencia documentada con views-categories.
- **PDP→back**: la adaptación ganada en el PDP entra como sección inyectada DEBAJO del scroll restaurado (payload ligero piggy-backed en el track del view), nunca mutando lo visto.
- **Búsqueda como señal (gap del crítico)**: `EVENT_WEIGHTS.search=0` y track-hook ignora 'search' hoy — darle peso y procesar la query en el signal_window para que buscar "audífonos" recomponga el home. (La página de resultados como superficie PageSlate completa queda para una iteración posterior.)
- **Anti-rebote vs momento-wow (resolución del conflicto)**: `product_view` se emite on-mount (la 2ª página refleja el 1er view — cold start wow), con `dwell_ms` adjunto al salir; el umbral de 3s aplica solo al trigger de OVERLAY (secciones "porque viste X"), no al evento ni al perfil.
- **Recomputes nocturnos**: swap atómico por metadato; las sesiones activas no ven el corte (snapshot).

## Capa 4 — Cliente (load-bearing, faltaba en el borrador)

- **Cola unificada de eventos**: localStorage, `client_event_id` OBLIGATORIO en cliente (la idempotencia server ya existe y hoy nadie la usa — un retry duplica eventos), batch de N eventos por POST, **flush por eventos no por reloj** (≥20 items O pagehide/visibilitychange vía sendBeacon O idle), backoff, clave por pestaña + adopción de huérfanas, bfcache-compatible (pagehide/pageshow), prioridad de red: contenido primero, tracking en huecos.
- **Impresiones por viewport** (`seen_at` en feed_impressions): IO ≥50%/≥1s, una vez por card por pageload, batch ~0.3KB por pantalla — **prerrequisito duro** de fatiga honesta y denominadores de guardrails (resolución del crítico: entra YA, el presupuesto de red lo absorbe).
- **Back instantáneo**: Next 16 reusa segmentos en back/forward CON scroll; lo que falta es supervivencia de páginas 2+ → snapshot en sessionStorage keyed por slate_id; restauración pre-paint (useLayoutEffect + scrollTo + ancla). <5min = restaurar idéntico; >5min = restaurar todo + refrescar solo lo no visto por debajo, en background.
- **Dismiss outbox**: NUNCA revert por fallo de red (corrige bug actual de ProductCard); oculto optimista + cola + backfill del slot desde spares (sin red).
- **Imágenes — custom loader** (resolución del crítico: nunca el optimizer de Vercel): sufijos nativos Amazon/Ali + wsrv.nl fallback; 2 variantes (300w q60 grid / 800w q70 PDP), DPR cap 1.5; `priority` solo cards 0-3; **modo ahorro default-ON** con toggle en cookie (server-side en RSC), Save-Data como floor.
- **`FeedCardDTO` slim** (~0.45KB gz/10 items, invariante al catálogo real); toda respuesta de sección es estado completo idempotente (no diffs).
- **Link prefetch={false}** en ProductCard YA (elimina el peor multiplicador de conexiones).
- **Presupuestos de red**: home 1ª carga ≤250KB (saver); página scroll ≈3KB + imágenes lazy; tracking ≤6 flushes/sesión típica; RUM mínimo (TTFB/FCP/bytes) piggy-backed, con flag de freeze como regla más del contexto.

## Capa 5 — Tracking, atribución y medición

- **UNA migración consolidada de `feed_impressions`** (dueño único — riesgo de migraciones contradictorias detectado): `seen_at`, `page_request_id`, `section_id`, `placement_version`, `policy`, `experiment_id`, `unique(feed_request_id, position)` (retry-safe). + tabla `slate_decisions` (composición servida: slate_id, placements, config_version, holdout/experiment flags).
- **Atribución de COMPRA (gap del crítico)**: el evento purchase y `orders` deben portar `feed_request_id`/atribución de origen (checkout.ts hoy no une orders con impresiones — sin esto el reward de conversión es irreconstruible).
- **Post-compra (gap del crítico)**: producto comprado → exclusión temporal del feed (`excluded_products` reason='purchased', TTL corto) + es el anchor natural de cross-sell.
- **Deriva de precios (gap del crítico — reseller sin stock)**: el precio vive congelado en 5 capas (slate, sessionStorage, bfcache, PDP ISR, cart). Política: el checkout SIEMPRE re-lee el precio actual y muestra delta si difiere del carrito; `price_refreshed_at` en el catálogo; las capas congeladas son aceptables para display, nunca para cobro.
- **Experimentación mínima**: hash determinista salteado por profile_id (sin tabla de asignaciones), holdout persistente (% a confirmar) excluido jerárquicamente de experimentos, guardrails con denominador `seen` (nunca `served`), kill irreversible en datos. Experimentos SOLO en superficies user-scoped (las cacheadas por segmento son baseline por definición). **Realismo estadístico**: la maquinaria pesada (curvas, CIs) se activa cuando el tráfico la alimente; v1 loguea TODO (barato e irreversible) pero solo opera guardrails simples.
- **Retención**: poda de feed_impressions/slate_decisions (free-tier) — cron con ventana (p.ej. 90d crudo, agregados para siempre).

## Etapas de implementación (orden por commits)

**Etapa A — Fundaciones (commits 1-5):** pool+search_path+timeouts → identidad fuera del proxy (+fix carrera user_profiles) → requireAdmin → wrapper resolvers + error.tsx + breaker → instrumentación Server-Timing/persistencia. *Gate: TTFB home baja ~200-400ms; suites verdes.*

**Etapa B — Columna vertebral de datos (commits 6-8):** migración consolidada feed_impressions + slate_decisions + feed_slates + ui_sections/ui_placements (+ seed = página actual) + product_popularity_7d + cron. *Es el punto irreversible: el cursor/atribución no se retro-fitea.*

**Etapa C — Slate + cursor + cliente mínimo (commits 9-13):** generateFeed→{items, feed_request_id, next_cursor} + materialización → Route Handler página-2 + card client-compatible → sentinel + cola de eventos unificada (client_event_id, sendBeacon) → dismiss outbox + pins + compactación → back-restore sessionStorage + scroll restoration. *Gate: scroll infinito estable, página-2 ≤150ms, back = 0 red.*

**Etapa D — composePage + secciones (commits 14-18):** rules DSL + config caché + composePage (contexto consolidado 1-2 queries) → registry + resolvers candidatos k×2 + dedupe claim + MMR-seed → SlateRenderer home (equivalencia byte a byte con seed) → PDP ISR + cross-sell lazy + landings /c/* → cart add-ons (POST /api/slate/resolve).

**Etapa E — Adaptación viva (commits 19-22):** slate_version + piggyback en track response → secciones overlay rotuladas + ancla "Seguías mirando" → fatiga viewport (seen_at + IO) + churn cap + novelty quota → señal de búsqueda (EVENT_WEIGHTS + track-hook) + pull-to-refresh.

**Etapa F — Medición y negocio (commits 23-26):** atribución de compra + post-purchase exclusion → política de precios en checkout → holdout + guardrails simples + poda → imágenes custom loader + modo ahorro + presupuestos de red + RUM.

Cada commit: typecheck + lint + suites; push por bloques. El spec de diseño completo se commitea a `docs/superpowers/specs/2026-06-10-dynamic-web-pageslate-design.md` al inicio.

## Verificación

- **Unit**: reglas (fail-closed, límites), composePage (claims/dedupe/prioridad, colisiones, TTL, fallback), cursor (posición absoluta, expiración compuesta, regeneración con dedupe), cola de eventos (idempotencia, multi-tab, flush por eventos), stabilizeSlate (churn cap), pins/spares/compactación.
- **Integration** (withTestDb): slate end-to-end (materializar→paginar→invalidar por dismiss/shift), equivalencia home con seed, página-2 route, /api/track batch + carrera de perfiles, fatiga con seen_at, atribución compra→impresión.
- **Lifecycle (1 test Playwright)**: pagehide/pageshow + restauración de scroll con páginas 2+ (el único test E2E nuevo: caza la regresión real).
- **Chaos**: resolver con sleep(60s) → stream/página cierra <3s con fallback; DB pausada → home sirve snapshot, track encola.
- **Latencia**: Server-Timing antes/después por palanca (pool, proxy, slate); gates p99 400ms hit / 1.5s miss / 150ms página-2.
- **Regresión**: tests existentes de feed/search/track intactos; los 2 fallos preexistentes de feed-generate documentados aparte.

## Calibrables durante el piloto (defaults decididos, no bloquean)
page_size=12, sentinel=800px, staleness=300s (cliente y servidor JUNTOS), TTL fatiga 7d/N=3, churn cap 30%, novelty K=3-4, ε=0.1 (reroll 0.3), budgets por sección. Verificar al implementar: plan/región de Vercel vs región Supabase (cambia la aritmética de presupuestos), tamaño real del catálogo (cuota de imágenes).

## Fase 2 (NO ahora — seams listos)
Lado de LECTURA de los agentes (vista de métricas por placement), su runtime (cron + LLM providers existentes), panel de aprobación, shadow-mode (evalúa contra el bundle ya pagado, coste ~0), OPE/curvas con tráfico real. Todo encaja sin migración adicional.

## YAGNI explícito
Push/pub-sub de invalidación; polling; Redis/Edge Config; motor A/B completo; diffs de sección; virtualización de lista (salida de emergencia futura); blurhash; PPR/cacheComponents; mover carrito anónimo a DB; multi-región; UI generativa; re-rank de lo visible (solo append/secciones nuevas); rotación HMAC automatizada (documentar secreto y proceso manual).
