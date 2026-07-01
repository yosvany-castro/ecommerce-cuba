# E-commerce Cuba — Historia, Estado y Arquitectura del Proyecto

> Documento de traspaso integral. Escrito para que alguien sin contexto pueda entender qué es
> el proyecto, qué se intentó, qué se logró, qué falló, cómo funciona el sistema por dentro, y
> en qué punto exacto está el desarrollo. Cada afirmación técnica cita `archivo:línea` para que
> sea verificable, no una promesa. Rama: `feat/thesis-personalization-program`.

---

## 0. Meta — cómo y con qué se generó este documento

- **Modelo / agente:** Claude Opus 4.8 (`claude-opus-4-8`), ventana de contexto **1M tokens**, nivel de esfuerzo **max**.
- **Método:** redacción anclada a archivos reales + dos rondas de verificación adversarial con subagentes (workflow dinámico), eliminando toda afirmación no comprobable contra el repo. Modo **ponytail** activo (sesgo anti-sobre-ingeniería).
- **Estado del repo al generar:** 318 commits, `2026-05-05` → `2026-06-27`, HEAD `ec6836d`. Working tree limpio salvo untracked preexistentes (caché/resultados del simulador de agentes).

---

## 1. Stack actual y por qué

Versiones leídas de `package.json` (las deps de agentes/LLM están declaradas con rango `^`, así que el número es el piso; la resuelta puede ser mayor).

| Capa | Tecnología (versión) | Por qué |
|---|---|---|
| Framework | **Next.js 16.2.5** (App Router, RSC) · **React 19.2.1** · **TypeScript 5.6.3** (strict) | La UI vive en la misma app; los Server Components consumen datos in-proceso (sin hop HTTP interno). Turbopack en dev. |
| Runtime | **Node ≥22** · **pnpm 10.32.1** | — |
| Estilos | **Tailwind CSS 4.2.4** (PostCSS, sin `tailwind.config.js`) | Utilidades inline; sin librería de componentes (no shadcn). |
| Base de datos | **Supabase (Postgres)** SDK `2.105.3` + **`pg` 8.20.0** (driver crudo) + **pgvector** | `pg` crudo con pool por scope para el *request path* (la DB sale del camino crítico de cada página; `feat af748ce`, `9c84d94`). Supabase SDK para el resto. Vector `vector(1024)` + `tsvector` + índices HNSW/GIN (`migration 0004`). |
| Embeddings | **Voyage AI** `voyageai 0.2.1` — `voyage-4`, **1024-dim** L2-normalizado | Cliente en `feat 5055d2a`; dimensión fijada en `migration 0004`. La recomendación de embedding de producción salió del estudio de tesis F1 (E0–E5). |
| LLM (búsqueda/rerank) | **DeepSeek** vía `@langchain/deepseek 1.0.27` (default) + **`@anthropic-ai/sdk 0.95.0`** + `openai 6.36.0` | DeepSeek es el proveedor por defecto para normalizadores/reranker por **frugalidad de tokens y créditos Anthropic agotados** (`feat c947133`, `4cc77d2`; nota de proyecto `fase3c_provider_swap`). El SDK de Anthropic se conserva. |
| Agentes | **LangGraph 1.4.1** + **deepagents 1.10.2** + `langchain 1.4.4` + `@langchain/core 1.1.48` | Runtime del merchandiser (`feat 4c31f5b`). |
| Clustering | **`ml-kmeans 7.0.0`** | Recompute online de "modos" de usuario (PinnerSage; `feat dc590f8`, `1fed555`). |
| Auth | **Auth0** `@auth0/nextjs-auth0 4.20.0` | Sesión + `user_id`; identidad anónima por cookie fusiona al login. |
| Validación | **Zod 4.4.3** | Esquemas en toda frontera de confianza (tracking, search, agente). |
| Tests | **Vitest 4.1.5** · **Playwright 1.59.1** (e2e) · **fast-check 3.23.1** (property) · **ts-morph 28** (checker AST de calidad de tests) | El checker AST prohíbe aserciones débiles (`toBeDefined`, etc.). |

**Propósito de negocio** (nota de proyecto): e-commerce *reseller* Cuba — revende Amazon/AliExpress **sin stock físico**. Cada llamada a un mock/LLM cuesta dinero real; minimizar fallbacks a mock es prioridad arquitectónica. Por eso el catálogo no tiene variantes/stock reales (concepto que aún no existe en el dominio).

---

## 2. Historia del proyecto (318 commits, cronológico)

El proyecto avanzó en **fases con disciplina spec → plan → TDD → cierre con triple review**. Cada fase tiene su spec y plan en `docs/`.

### 2.1 Fundaciones y comercio base (Fases 0–1)
- **Fase 0:** scaffolding Next 16 + Tailwind v4 + TS strict, runner de migraciones con detección de drift por checksum, mock sembrado de **500 productos**, infra de test (Vitest/Playwright + checker AST), healthchecks, CI.
- **Fase 1:** tracking de eventos (cola unificada, idempotencia por `client_event_id`), enriquecimiento de catálogo (LLM + Voyage + UPSERT), UI base (grid, PDP, carrito anon/logueado, checkout simulado), Auth0 + fusión de identidad al login.

### 2.2 Búsqueda híbrida (Fases 2–2.5)
- **Fase 2:** búsqueda híbrida **BM25 (`ts_rank_cd`) + cosine (pgvector) fusionados por RRF**, normalización de query con LLM (DeepSeek), doble caché (exacto por hash + **semántico θ=0.92**). Migración a DeepSeek como default por frugalidad.
- **Fase 2.5:** filtros estructurados (género/edad/precio) cableados a BM25 y cosine, "smart mock" (el mock usa la query), herramientas de debug (`/api/search?debug`, `/admin`, `pnpm explain`). Cierre: híbrido gana **24/25** queries no-edge.

### 2.3 Personalización (Fases 3a–3c)
- **3a:** vector de usuario único (decay exponencial + shrinkage + α dinámico sesión/perfil), cold-start, multi-destinatario inferido. Eval Recall@10 +77.8pp.
- **3b:** **multi-modo** (k-means), grafo de co-ocurrencia **NPMI** nocturno, fusión **RRF** de 3+ fuentes.
- **3c:** **MMR (λ=0.7)** para diversidad + **reranker LLM contextual** (top-10) con caché. Originalmente diseñado con Anthropic Haiku, migrado a DeepSeek.

### 2.4 Programa de tesis (F0–F6) — elevar el pipeline a grado-tesis
Rama y schema `thesis` aislados. Generador de datos sintéticos con *ground-truth* (taxonomía declarativa, grafo complemento/sustituto, modelo de comportamiento con gusto latente y sesiones de regalo), harness de evaluación sin fugas (split temporal leave-one-out, estimadores off-policy IPS/SNIPS/doubly-robust).
- **F1:** estudio de embeddings E0–E5 (Prod2Vec, two-tower, chunk-MaxSim, voyage-context-3). Hallazgo honesto: los embeddings dan relevancia, **no** complementariedad.
- **F2:** representación **multi-vector** de usuario (PinnerSage, clustering aglomerativo coseno) + detección de **intención de regalo** con vector efímero de destinatario. Bate al vector único en todos los segmentos.
- **F3:** pool multi-fuente de candidatos + 4 rerankers (LTR logístico, cross-encoder MaxSim, LLM listwise). El pool duplica recall; RRF gana relevancia.
- **F4:** ranking **multi-objetivo** (relevancia/margen/conv/novedad/fairness), frontera de Pareto, KPI con guardarraíles. Honestidad: se documentó la infeasibilidad de ciertos guardarraíles.
- **F5:** redacción de tesis (capítulos → PDF) + plan de piloto A/B (diseño, no ejecutado).
- **F6:** campaña de validación holística + **auditoría destructiva** que encontró fugas transductivas, métrica circular y "mundo construido"; remediadas. Resultado post-forense: la personalización ensamblada **bate a la popularidad pura 3/3 seeds** con la config `rrf-sess-pop` (nota de proyecto `f6_validation`).

### 2.5 Web dinámica — "PageSlate" (Etapas B–E + F1–F5)
El feed dejó de ser estático: se convirtió en una **composición per-usuario**.
- Columna vertebral de datos, slate materializado servible + **cursor de scroll infinito**, back instantáneo desde PDP (0 red, scroll restaurado).
- **`composePage`** (la página componible per-usuario), la home como composición con equivalencia probada, **cross-sell en PDP** + **add-ons en carrito** (primeras superficies de venta nuevas), landings `/c/[category]` (superficie indexable), adaptación viva (invalidación por versión, rótulos, fatiga por viewport).
- **Atribución de compra + holdout 10%** — "el reward del sistema, medible" (`feat 95bf480`).
- Resiliencia: circuit breaker `dbHealth` + error boundary (la web no cae con la DB), proxy cookie-only.

### 2.6 Fase 2 — Agentes que venden (el frente actual del motor)
Ver §4 y §5. Cierre en `docs/handoff-fase2-cierre-y-reanalisis-2026-06-18.md`.

### 2.7 Storefront contract (esta sesión) — ver §6.

---

## 3. Cómo funciona el sistema (API, pipeline, muestreo)

### 3.1 Composición de una página (el "qué se muestra")
Capa `src/sectors/f-slate/`, tres funciones con frontera limpia:
1. **`composePage`** (`compose.ts:48`, "D2"): dado `surface` + identidad, decide **qué placements** aplican ahora (reglas fail-closed evaluadas contra contexto vivo: cohorte de sesión, carrito, ancla PDP, hora). Devuelve `ComposedPage` con `composition_id`, `placements[]`, `config_source`.
2. **`selectPlacements`** (`select.ts`, "C0"): resuelve colisiones de slot (scope user>segment>global), capa a **8 placements/superficie**, contiene al agente (nunca ocupa `PROTECTED_SLOTS` = home/pdp/cart slot 10).
3. **`resolveSections`** (`sections/resolve.ts`, "D3"): materializa productos por sección e hidrata en **un** batch. Devuelve `ResolvedSection[]` con `SectionCardDTO` (`sections/types.ts:7,42`).

### 3.2 Rutas / API
- **Home:** SSR (`src/app/(shop)/page.tsx`). La sección `hero_grid` **es** el feed personalizado (`serveFeedPage`), con su cursor de scroll infinito.
- **PDP / carrito:** `POST /api/slate/resolve` — client-fetch, lazy bajo el fold; el carrito lee `localStorage` (verdad anónima) y manda los ids en el body.
- **Paginación del feed:** `GET /api/feed/page?cursor=` — scroll infinito.
- **Confirmación de vista:** `POST /api/feed/seen` — beacon de viewport.
- **Búsqueda:** `/search` → `hybridSearch` (`c-search/search.ts:69`).
- **Otras:** `/api/track` (eventos), `/api/cart`, `/api/checkout`, `/api/identity/merge`, landings `/c/[category]`, y superficies admin (`/admin/users/[id]`, `/admin/search/explain`, `/admin/co-occurrence/top`).

### 3.3 Pipeline de personalización (el feed hero, `serveFeedPage`)
`src/sectors/d-personalization/feed.ts`. Para el `hero_grid`:
1. **Vector efectivo:** `α·vector_sesión + (1−α)·vector_perfil`, α crece con eventos de sesión.
2. **Retrieval multi-fuente:** `retrieveTopKByVector` (pgvector `<=>`) + `fetchPopularByCohort` + `fetchPopularGlobal` + `fetchViewsCategoriesList` (categorías vistas; envuelve `rankByViewedCategoriesQuota`).
3. **Fusión RRF** (`retrieve/rrf.ts`, `k0=60`, score-free).
4. **MMR** (`retrieve/mmr.ts`, `λ=0.7`, diversidad).
5. **Reranker LLM** (DeepSeek, top-10) — **OFF por default** (`LLM_RERANK_ENABLED`, `feed.ts:574`): en el head-to-head F6 no batió a RRF+MMR en relevancia, su latencia (~8–10 s) viola el gate p99<1.5 s de Fase 3c y cuesta ~$0.48/1000 feeds. El path por default es **RRF+MMR sin LLM**; el reranker se reserva para experimentos gateados (regalo explícito, búsqueda conversacional).
6. **Exploración ε-greedy** (ver §3.5).
7. **Persistencia:** `insertSlate` + `logSlatePageImpressions`.

Secciones estáticas (`popular`, `cross_sell`, `cart_addons`) se resuelven por popularidad 7d / NPMI (`sections/registry.ts`), sin LLM.

### 3.4 Búsqueda híbrida
`hybridSearch`: hash + caché exacto → caché semántico (HNSW, **θ=0.92**, `cache/semantic.ts:4`; *decretado, no calibrado* — el audit F6 lo marcó, `calibrate-semantic-cache.ts` existe) → normalización LLM → BM25 + cosine → **RRF** → persistencia. Fallback a mock solo si hace falta (cada mock = $).

### 3.5 Muestreo (la parte que hace medible el sistema)
Esto es lo que convierte al feed en un experimento con reward real:
- **Holdout 10%** (`holdout.ts:24`): grupo de control que **nunca** recibe personalización, asignado determinísticamente por `sha256("pageslate-holdout-v1:" + key)` mód 100 (`< HOLDOUT_PERCENT`, default 10, env `HOLDOUT_PERCENT`). Sin control no hay lift medible.
- **ε-greedy** (`explore/epsilon.ts`, ε=0.1): ~10% de slots son un draw uniforme del pool no elegido. Se registra la **propensity** de cada ítem — explore `ε/|pool|` (`epsilon.ts:78`), exploit `1−ε` (`epsilon.ts:81`) — que alimenta los estimadores off-policy (IPS/SNIPS/DR) de la tesis para evaluar políticas sin desplegarlas.
- **Impresiones** (`sections/impressions.ts`): `feed_impressions` con `position = slot*100 + (idx+1)` (único dentro del `composition_id`), `served_at` al componer, **`seen_at` NULL** hasta que el beacon cliente confirma ≥50% viewport ≥1s. Fatiga y guardarraíles leen `seen_at`, nunca `served_at`.
- **Atribución de compra** (`a-tracking/attribution.ts:36`, `migration 0029`): una compra se atribuye a una impresión cuyo `served_at > now() − interval '7 days'`. Ítems comprados entran a exclusión con TTL 30d.
- **Sampling de logging:** el 20% de los requests de home **emiten** su `RequestTiming` a stdout (`page.tsx:17` `console.log`, `TIMING_SAMPLE_RATE=0.2`) — observabilidad sin coste por request.

### 3.6 Persistencia
**28 migraciones** (ficheros numerados `0001..0030`; faltan `0012` y `0014`). Hitos: `0004` productos con `vector(1024)`+`tsvector`+HNSW/GIN; `0006` personalización (modos/sesiones/cohortes/exclusiones); `0007` co-ocurrencia; `0025` slate (`ui_placements`, `ui_sections`); `0029` atribución de compra; `0030` superficie del agente.

---

## 4. Agentes que venden — el "merchandiser"

**Qué es:** un agente LLM (LangGraph + deepagents, ChatDeepSeek) que actúa como un merchandiser humano — mira métricas y propone **colocaciones de carruseles** en las superficies de la tienda para aumentar revenue. Es la Fase 2 del programa de agentes.

**Qué puede hacer** (`src/sectors/g-agents/`):
- **Acciones** (`write/schema.ts`): `create` / `supersede` / `pause_own` / `request_pause` un placement. Campos: `surface` ∈ {home, pdp, cart}, `slot` ∈ 20–90 (gaps de 10; el hero en slot 10 es intocable), `section_type` ∈ {`popular`, `cross_sell`, `cart_addons`}, `params`, `rule`, `scope` ∈ {global, segment}, `ttl_hours`, `rationale`. **No puede** elegir productos individuales ni tocar el `hero_grid`.
- **Herramientas:** `read_metrics`, `read_catalog`, `propose_placement`. Un **subagente crítico** audita las propuestas (verifica los números citados, rechaza celdas con `low_sample` / sin logging).
- **Gobernanza por tiers** (`write/tier.ts`): `low` → auto-apply + TTL; `medium` → auto-apply solo si `AGENT_MEDIUM_AUTOAPPLY=true`; `high` → siempre `pending` (revisión humana). El tier lo **computa** el sistema desde hechos SQL, no lo envía el LLM.
- **Límites** (`write/caps.ts`): 5/run, 10/24h, 3 vivos/superficie, 12 vivos total, cooldown 48h, idempotencia por `proposal_key` (SHA256).

**La cadena propuesta → vivo → renderizado** (cerrada para producción, con excepciones declaradas):
`agente propone` → `backend valida (schema→params→caps→tier)` → `tabla ui_placements` → `composePage la lee (caché 60s)` → `SlateRenderer la pinta`. Backends intercambiables `backend-pg` (prod) / `backend-sim` (sim) tras la interfaz común `MerchandiserBackend` — **el mismo agente LLM corre contra ambos mundos**.

**Activación:** `AGENTS_ENABLED` (default **OFF**, fail-closed). Cron diario `cron:agent-merchandiser`. **Falta** (seams declarados): UI de aprobación de `pending`, scheduler automático, dashboard de placements vivos.

---

## 5. Los fallos del 2× (la compuerta que no pasa)

**La compuerta (gate):** para desplegar al agente debe demostrar **≥2× margen** vs un baseline "frozen" (tienda congelada en época 0, sin agente). Criterio de PASS exacto (`sim/stats.ts:65`): **n≥5 seeds** Y **media geométrica ≥ 2.0** Y **CI95-low > 1.0** (t-Student en log-space) Y **unánime** (los 5 ratios > 1). Seeds pre-registrados `[42,7,2026,31337,777]` (`constants.ts:36`).

**Lo que realmente se midió:**
1. **El único gate canónico que completó FALLÓ.** 5 seeds × 1000 usuarios × 12 épocas, sim-world-v1: ratios `[0.978, 0.999, 1.009, 1.009, 1.032]`, **geomMean 1.005**, `pass=false`, `invalid=true`. Veredicto commiteado: **"Fase 2 NO PASA (paridad)"** (`commit 93b9cf4`).
2. **Diagnóstico:** el sim viejo colapsaba las 4 secciones en un home de 20 slots que el hero monopolizaba → atención alcanzable del agente ≈ λ²⁰ ≈ 3.9% → ~0%. Se declaró **artefacto de fidelidad**, no del merchandising (producción **sí** es multi-superficie).
3. **Reescritura del sim** (`commit d0af18d`, `SIM_WORLD_VERSION = "sim-world-v2"`): atención de dos niveles (λ=0.85 vertical + horizontal), journey endógeno home→PDP→carrito. Control **A/A = 1.0000** exacto (el mundo no está amañado por brazo).
4. **Tras la reescritura, solo runs *smoke* (1 seed, 300 usuarios):** LLM **3.40×** (3 épocas medidas), scripted 1.94× (¡pero en sim-world-**v1**!), un gemelo LLM misma config **1.59×**, y el único run de 12 épocas en v2 da **1.87× (sub-2×) y sale `invalid`** por `frozenCollapse`.
5. **Ningún gate canónico de 5 seeds ha corrido sobre v2.** El log del último intento (`scripts/agents/results/gate-run.log`) muere en la seed 42, época 3 (`e3 simulada t=235s`); el único gate que sí completó (v1) tardó ~21.7 min (`wallSeconds 1302`), y el codespace mata procesos largos.

**Veredicto de la auditoría forense (esta sesión, 10 agentes, verificado contra los JSON y el código):**
> El 2× **NO está validado ni es confiable** con la evidencia actual. (a) Es smoke de **una sola seed / 3 épocas**, sin CI, sin protocolo canónico. (b) El "lift" está dominado por el **baseline frozen colapsando** (−87.6% e0→e4; −42.7% dentro de la ventana medida e2→e4, con el agente casi plano), no por el agente subiendo. (c) Un **script tonto de 2 filas fijas ya llega a 1.94×** → la "inteligencia" del agente es en gran parte decorativa; el lift es mecánica de superficie aditiva + auto-apply + baseline decayente. (d) La desviación **2.C.5** (el sim filtra `margin_pct` por-producto al agente; producción usa 0.6 plano) es real pero **juega en contra** del win medido (margin/GMV del agente 0.281 < frozen 0.328), así que **no** es la palanca. (e) La reescritura del sim **es fidelidad legítima** (producción es multi-superficie de verdad, y ya lo era antes del rediseño), **pero** el 2× que se invoca para justificarla sigue **sin demostrarse** bajo el protocolo canónico.
>
> **Riesgo estructural:** a horizonte de 12 épocas el baseline frozen colapsa de forma natural (dispara `frozenCollapse`), así que un gate válido de 5 seeds en v2 podría ser **inalcanzable por construcción** sin recalibrar esa regla — lo cual sería mover el poste otra vez.

**Qué haría falta para un 2× defendible:** correr `gate-seeds.ts` sobre sim-world-v2, 5 seeds × 1000u × 12 épocas, con Ĝ≥2, CI-low>1, unánime y **5/5 seeds válidos** (sin `frozenCollapse`) — pendiente de hardware. Antes conviene: resolver `frozenCollapse` de forma pre-registrada, cerrar el leak 2.C.5 (margen plano en el sim), y cuantificar la varianza con ≥3 seeds en smoke.

---

## 6. Estado actual — el Storefront Contract (capa para la UI)

**Objetivo:** una capa fina `src/storefront/` que exponga el motor (slate + personalización + agente) como **un contrato tipado estable** para que otro equipo (de agentes) construya la **capa visual** (ProductCard, destacados, relacionados, carrito) importando **solo `contract.ts`**, sin tocar el motor.

**Decisión arquitectónica** (validada por investigación de arquitectura esta sesión — headless commerce, SDUI/blocks, patrón BFF y sus anti-patrones, guía oficial de Next.js): es un **Data Access Layer (DAL), no un BFF+REST**. La capa visual vive en la misma app Next → "pedir al API" = **importar una función tipada** (`getHomePage()`), sin hop HTTP (guía oficial de Next.js). REST solo para lo que el cliente ya pide (cart + cross-sell), que ya tiene ruta (`/api/slate/resolve`). El contrato **es un *trim* de los DTOs que el motor ya emite** (`ResolvedSection`/`SectionCardDTO` menos internals), no una capa de view-models nueva — pasada ponytail que recortó el diseño −473 líneas.

**Qué busca el plan:** matar el *wiring* hoy duplicado (`composePage + resolveSections + logSlateDecision + identity`, copiado en `page.tsx` y `/api/slate/resolve`) detrás de 3 funciones tipadas: `getHomePage()`, `getCartPage(ids)`, `getProductSections(id, cat)`.

**Dónde está:**
- **Spec:** `docs/superpowers/specs/2026-06-20-storefront-contract-design.md`
- **Plan:** `docs/superpowers/plans/2026-06-20-storefront-contract.md` — **2 tareas TDD, 6 archivos fuente** (`contract.ts`, `map.ts`, `identity.ts`, y `pages/home.ts` + `pages/cart.ts` + `pages/product.ts`) + 2 de test.
- **Estado:** **NO ejecutado** — `src/storefront/` aún no existe. Listo para implementar.

---

## 7. Panorama: dónde va el desarrollo

- **Motor de personalización:** construido y cableado a datos reales (Fases 3 + tesis F0–F6). Sólido y auditado.
- **PageSlate (web dinámica):** construido — composición per-usuario, cross-sell, atribución, holdout.
- **Agentes que venden:** cadena técnica cerrada, pero **la compuerta ≥2× no pasa** el protocolo canónico (pendiente de hardware + resolver `frozenCollapse` y el leak 2.C.5 de forma honesta).
- **Capa visual:** siguiente frente. El **Storefront Contract** (spec+plan listos, sin ejecutar) es el puente entre el motor (listo) y la UI (por construir).

**Pendientes priorizados:**
1. Ejecutar el plan del Storefront Contract (2 tareas TDD).
2. Con hardware potente: correr el gate canónico de 5 seeds sobre sim-world-v2 y decidir honestamente el destino del ≥2× (resolver `frozenCollapse` pre-registrado, cerrar 2.C.5).
3. Construir la capa visual sobre el contrato.

---

*Fin del documento. Toda afirmación técnica es verificable en el `archivo:línea` citado; los números del 2× provienen de los JSON en `scripts/agents/results/` y del código en `src/sectors/g-agents/sim/`.*
