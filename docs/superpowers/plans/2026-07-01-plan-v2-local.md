# Plan V2 — programa local post-rescate (2026-07-01)

> Ordena la "nueva versión" sobre lo ya construido y auditado, ahora que el proyecto vive
> en hardware local (WSL2) sin los límites del Codespace (procesos >20 min, 8GB/2CPU).
> Fuentes de verdad: `docs/PROJECT-HISTORY.md` (estado integral verificado),
> `docs/handoff-fase2-cierre-y-reanalisis-2026-06-18.md` (agentes),
> `docs/thesis/RESUMEN-EJECUTIVO.md` (números honestos post-auditoría),
> `docs/superpowers/plans/2026-06-20-storefront-contract.md` (contrato listo, no ejecutado).

**Estado al escribir:** rama `feat/thesis-personalization-program` @ `49ca439` íntegra en
GitHub y en local (rescate 2026-07-01); Supabase activa con schema completo (`verify:supabase`
ALL OK); `tsc` 0 errores; 323/323 unit verdes; NDJSON del gate restaurados en
`scripts/agents/results/`.

**Principios heredados (no negociables):** pre-registro antes de medir; baseline realista sin
oráculo; victoria solo con significancia estadística; recuento independiente (verify-ledger);
cada afirmación citable `archivo:línea`. La honestidad es el activo de la tesis.

---

## Fase 0 — Consolidación (½–1 día)

- **0.1 Promover la rama.** PR `feat/thesis-personalization-program` → `main`. `main` quedó
  ~330 commits atrás y contiene reports de fase pre-auditoría sin fe de erratas; el merge trae
  `PROJECT-HISTORY.md` y `RESUMEN-EJECUTIVO.md` que los corrigen. (Decisión del dueño.)
- **0.2 P0 vivo — el vector de sesión jamás se escribe.** `session/state.ts:52` inserta
  `vector_unnormalized` = vector CERO con `weight_sum=0` y el `ON CONFLICT` solo actualiza
  cohort/recipient/signal_window — ningún código puebla el vector ⇒ el α-mixing
  sesión/perfil (F3a) es código muerto también en esta rama. Decidir con datos:
  **FIX** (acumular embeddings de `product_view` con decay en el hook de tracking) o
  **DELETE** (exp-k: la señal de sesión que gana en el mundo honesto son las vistas/categorías
  recientes, no el vector α). Cualquiera de los dos con test de regresión.
- **0.3 Timeout + AbortSignal en el cliente DeepSeek** (`src/lib/llm/deepseek.ts` no configura
  timeout; default SDK ~10 min). Barato; protege normalizadores hoy y el reranker cuando
  `LLM_RERANK_ENABLED=true`.
- **0.4 Scheduling local de crons** (cron de WSL o systemd timers): `popularity-7d` (10–15 min),
  `fatigue` (1–6 h), `npmi-recompute` + `cohort-centroids` + `profile-recompute` +
  `rerank-cache-cleanup` + `prune` (diarios), `agent-merchandiser` (diario; sigue fail-closed
  con `AGENTS_ENABLED` default OFF). Hoy nada está schedulado.
- **0.5 Línea base verde local:** `MOCK_AGGREGATOR_ERROR_RATE=0 pnpm test:integration` una vez
  + smoke E2E. Documentar duración/costo real en local.
- **0.6 Codespace:** conservar 1–2 semanas como respaldo (la retención se renovó hoy);
  borrar solo tras verificar el merge y este plan en marcha.

## Fase 1 — Storefront Contract / DAL (1–2 días) — el puente

Ejecutar el plan TDD existente (`2026-06-20-storefront-contract.md`, 2 tareas, 6 archivos:
`contract.ts`, `map.ts`, `identity.ts`, `pages/{home,cart,product}.ts` + 2 tests). Es la capa
de abstracción del motor en forma **DAL** (la UI vive en la misma app Next ⇒ importar función
tipada, sin hop HTTP interno), decisión ya validada contra la guía de Next.js y pasada por
ponytail (−473 líneas vs el diseño BFF).

- **1b (diferido hasta necesidad real — YAGNI):** fachada HTTP `/v1` (feed/search/events/
  identity) con API keys + CORS + rate limit para frontends EXTERNOS; son wrappers finos sobre
  las mismas funciones del DAL. Activar solo cuando exista un consumidor fuera de la app.

## Fase 2 — Capa visual nueva (3–7 días) — la tienda que se ve

Reconstruir la UI sobre `contract.ts` (home compuesta, PDP + cross-sell, carrito + add-ons,
landings `/c/[category]`), migrar `page.tsx` y `/api/slate/resolve` al contrato, retirar los
3 DTOs inline. Ningún componente visual importa nada fuera de `src/storefront/contract.ts`.

## Fase 3 — Veredicto canónico de agentes (paralelo; corre de noche en esta máquina)

El gate de 5 seeds sobre `sim-world-v2` nunca corrió: el Codespace mataba procesos a ~20 min.
Esta máquina es el desbloqueador. Orden pre-registrado ANTES de correr:

- **3.0 Pre-registro de cambios al harness:**
  (a) recalibrar `frozenCollapse` — distinguir colapso sostenido (brazo muerto) de dip de una
  época con recuperación (falso positivo conocido D1-H3 que invalidó 3/5 seeds del gate v1);
  (b) cerrar la desviación 2.C.5 (el sim filtra `margin_pct` por producto; producción usa 0.6
  plano — igualar);
  (c) publicar SIEMPRE el brazo **scripted-tonto** junto al LLM (forense 2026-06-27: un script
  de 2 filas fijas llegó a 1.94× — la pregunta "¿el LLM paga vs un script?" va en el acta).
- **3.1 Varianza smoke:** ≥3 seeds smoke en v2 (~$0.10 total con caché write-once).
- **3.2 Gate canónico:** `NODE_OPTIONS="--max-old-space-size=8192" pnpm exec tsx
  scripts/agents/gate-seeds.ts` (resumible por seed, determinista por CRN). Al terminar:
  `verify-ledger.ts` (recuento independiente al centavo).
- **3.3 Decisión por el menú del veredicto 2026-06-18:** PASS ⇒ shadow-mode con tráfico real
  (pending + holdout 10% ya existen). FAIL ⇒ opción B (asistente de cola larga medido en
  `since_change`) u opción C (ceder hero bajo A/B + rollback — decisión de producto del dueño).
- **3.4 Siguiente palanca (post-3.3):** acción de **curaduría de catálogo** para el agente —
  minar `searches` (queries con <12 hits locales y confidence alta = demanda insatisfecha) y
  proponer qué ingestar/pre-cargar del agregador, como nuevo verbo del write-surface con el
  mismo patrón tier/caps/idempotencia. Es la palanca única del modelo dropshipping: crear
  oferta donde hay demanda, algo que el motor de ranking no puede hacer.

## Fase 4 — Catálogo dinámico real (1–2 semanas; paralelizable con F2/F3)

Sustituir el mock por proveedores reales, en este orden (gaps mapeados en el audit 2026-07-01):

- **4.1** Interfaz `Provider` (romper el import directo del mock en `c-search/search.ts`) +
  **ingesta asíncrona** (hoy: hasta 25×(LLM+embed) SECUENCIALES dentro del request — devolver
  lo local ya y encolar) + single-flight de llamadas en vuelo + **presupuesto diario/circuit
  breaker** + rate limit por proveedor.
- **4.2** Refresh de precios/stock (hoy el precio solo se actualiza si el producto reaparece;
  no existe stock — crítico en dropshipping) + moneda/markup de reseller + rehost de imágenes.
- **4.3** Dedup multi-proveedor: producto canónico por embedding+título (hoy el mismo producto
  físico en 2 fuentes = 2 filas sin relación).
- **4.4** Freshness por query, no por categoría (hoy 1 producto de "ropa" congela toda la ropa
  24 h) + negative cache.
- **4.5 (Negocio, bloqueante para producción real, no para el piloto)** proveedores y pagos
  viables para Cuba (OFAC/embargo). Sin respuesta aquí no hay tienda real; con mock/semi-real
  sí hay tesis y piloto.

## Fase 5 — Piloto A/B real (el veredicto final de la tesis)

El diseño ya existe (F5, `2026-06-07-thesis-f5-writeup-pilot-design.md`) y el instrumental
está construido (holdout 10% determinista, propensity ε-greedy, atribución 7d, exclusiones).
Con UI nueva (F2) + catálogo al menos semi-real (F4): 50/50 sistema vs tienda normal, decidir
con ventas reales. Regla pre-comprometida: solo se declara victoria contra el rival honesto
con significancia.

---

**Riesgos:** (1) el gate v2 podría ser inalcanzable por construcción si `frozenCollapse` no se
recalibra — por eso 3.0a va primero y pre-registrado; (2) costo LLM del gate ante cache-miss
masivo (mundo v2 nuevo ⇒ pocas fronteras cacheadas; presupuestar ~$1–3 y monitorear);
(3) F4 real depende de 4.5 (legal/pagos).

**Decisiones del dueño:** merge a main (0.1) · fix vs delete del vector de sesión (0.2) ·
ceder hero o no (3.3) · cuándo activar `AGENTS_ENABLED` real (post-3.3) · alcance del piloto (F5).
