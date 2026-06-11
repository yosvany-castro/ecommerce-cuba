# Handoff — Fase 2: Agentes (LangGraph + DeepAgents) sobre el motor PageSlate

**Fecha:** 2026-06-11 · **Branch:** `feat/thesis-personalization-program` (HEAD `1c22d5b`, todo pusheado)
**Estado:** Fase 1 (motor) COMPLETA. Fase 2 (agentes) DISEÑADA, sin empezar — este documento es el punto de arranque.

---

## 1. Dónde estamos (lo construido, verificado y pusheado)

### El ranking que funciona (programa de tesis, post-auditoría)
- La auditoría destructiva (`docs/auditoria-destructiva-f6-2026-06-09.md`) invalidó los titulares originales (fugas transductivas, métrica circular, mundo amañado). Docs reescritos con honestidad.
- **Fix real cableado a producción**: campaña exp-K (`scripts/_audit/exp-k-pop-sweep.ts`) — el ensemble `rrf-sess-pop` (categorías por vistas sesión×3+historial × popularidad + popular-global, RRF, cola por popularidad) **bate a popular-global 3/3 seeds, CI95>0** (+6.8/+10.1/+11.8% nDCG@10; +157~324% vs tienda ingenua). La forma desplegada (`feed-pop`) quedó en paridad con el mejor Recall@10 del reporte oficial (`docs/superpowers/reports/...popfix-final.*`).
- Todo offline es SIMULADOR (cero usuarios reales aún); el techo navegación (pc-oracle ~0.26) no es rival del home.

### Fase 1 PageSlate (22 commits, etapas A-F) — el MOTOR soberano
- **A Fundaciones**: `pg.Pool` por scope (¡HALLAZGO: puerto 6543 transaction-mode filtra `SET` entre sockets — runtime en session-mode 5432!), proxy cookie-only (identidad nace en el primer `/api/track`), `requireAdmin` fail-closed, breaker `dbHealth` + `error.tsx`, `RequestTiming`. **Home ~1200ms → ~300ms TTFB medido.**
- **B Columna vertebral** (migraciones 0024-0029): `feed_impressions` consolidada (seen_at/page_request_id/section_id/policy/experiment_id + unique retry-safe), `feed_slates`, `slate_decisions` (holdout flag), `ui_sections`/`ui_placements` (rules jsonb, scope, status, **risk_tier**, `killed` IRREVERSIBLE por trigger) + seed ≡ página actual, `product_popularity_7d` + cron, `purchase_attributions`, `excluded_products.reason`.
- **C Slate vivo**: snapshot inmutable post-exploración (cabeza RRF+MMR + cola por popularidad), cursor de **posición absoluta** `{slate_id,pos,v}`, scroll infinito (sentinel 800px, saveData→"Ver más"), hit-path ~2-3 queries, cola de eventos cliente (client_event_id, sendBeacon, multi-tab, bfcache) + `/api/track` batch, dismiss outbox + compactación sin renumerar, pins, back PDP→home a 0 red.
- **D Página componible**: `composePage` (DSL de reglas fail-closed real + Zod write/load-time, caché 60s → stale → DEFAULTS hardcodeados, colisiones user>segment>global), runner con claims por prioridad/budgets/min_items/hidratación única, `SlateRenderer` (equivalencia hero ≡ serveFeedPage PROBADA), **cross-sell en PDP + add-ons en carrito** (`POST /api/slate/resolve`), landings `/c/*` SEO. **Activar secciones = filas, no deploys.**
- **E Adaptación viva**: shift/búsqueda → `bumpSlateVersion` (la próxima página del cursor regenera; lo visible jamás se reordena) + señal piggy-backed en track; rótulos "Seguías mirando"/"Para descubrir"; `seen_at` por viewport (servido≠visto) + cron fatiga (≥3 vistos sin click → 7d descanso); **momento añadir-al-carro** (sugerencias in situ en PDP); popular modo `pdp_category`; churn cap 30%.
- **F Negocio**: `purchase_attributions` (compra ↔ última impresión 7d, posición/source/policy/SEEN; orgánicas NULL contadas), exclusión `purchased` 30d, **holdout 10%** determinista (sha256 salteado, policy='holdout', baseline popular puro), proxy de imágenes wsrv.nl (300w/800w webp; NUNCA optimizer Vercel) + **modo ahorro default-ON** (Save-Data piso), poda 90d.
- **Suites**: 254/254 unit; typecheck 0; lint 19 preexistentes; integración con 1 solo preexistente estable (cohorte feed-generate 50%<60%).

### Deuda consciente de Fase 1 (menor, anotada)
Aviso de delta de precios en UI (el COBRO ya usa precio vigente), RUM cliente, toggle UI de modo ahorro, test Playwright de lifecycle, margen 0.6 hardcodeado en checkout.

---

## 2. Fase 2 — REQUISITOS DEL USUARIO (2026-06-11, vinculantes)

1. **LangGraph + DeepAgents**: los agentes se construyen con `@langchain/langgraph` + `deepagents` (JS) — son sistemas complejos con planificación/subagentes/herramientas. Instalarlos; verificar API VIGENTE con Context7 (no de memoria).
2. **La tienda funciona SIN agentes**: el motor es soberano. Agentes NUNCA en request path; solo LEEN métricas y ESCRIBEN `ui_placements` (status según risk_tier). Si mueren, la tienda sirve idéntica (caché→defaults ya lo garantiza).
3. **LA BARRA: mejorar el motor CON CRECES (>2x) o no tienen sentido**. Gate medido, no asumido: harness de evaluación de agentes con N seeds + CI95. Si no superan, se documenta y NO se despliegan.
4. **Modelos DeepSeek actualizados**: `deepseek-v4-flash`, `deepseek-v4-pro`; `deepseek-chat` y `deepseek-reasoner` DEPRECAN 2026-07-24. El repo usa `deepseek-chat` → MIGRAR YA (micro-tarea en vuelo, interrumpida: `src/lib/llm/deepseek.ts` DEEPSEEK_MODELS + provider + smoke real).
5. **Primero que funcione; luego analizar con sumo detalle y testear hasta el cansancio** (backend-first, como toda la Fase 2).
6. **Usar dynamic Workflow** para esta tarea grande (mandato explícito del usuario).

---

## 3. Plan de ejecución de la Fase 2 (pensado, listo para arrancar)

### Micro-tarea inmediata (directa, antes del workflow)
**P2-0**: migrar modelos — `DEEPSEEK_MODELS.flash = env ?? "deepseek-v4-flash"`, añadir `pro = "deepseek-v4-pro"` (razonamiento para agentes), actualizar provider name, smoke con llamada real barata. Archivos: `src/lib/llm/deepseek.ts`, `src/lib/llm/providers/deepseek-flash.ts` (+ nuevo provider pro).

### Workflow dinámico (4 fases)
- **Fase A — Investigación paralela (read-only)**: (1) API actual de LangGraph JS + deepagents JS vía Context7/web (versiones 2026, breaking changes, patrón de tools/subagentes/checkpointing); (2) docs DeepSeek v4 (params, pricing, JSON mode, compat OpenAI para @langchain/openai con baseURL); (3) diseño del harness >2x: simulador DINÁMICO con shifts (demanda/catálogo/precios) donde la config estática decae — ahí el >2x es honesto; basarse en `src/thesis/data/behavior-model.ts` (v2: Zipf, elasticidad, exposurePolicy del loop cerrado); (4) diseño de la capa de métricas por placement (SQL sobre slate_decisions + feed_impressions(seen) + purchase_attributions).
- **Fase B — Blueprint**: síntesis con specs a nivel de archivo.
- **Fase C — Implementación por áreas DISJUNTAS** (máquina de 2 cores; evitar conflictos): (1) `src/sectors/g-agents/metrics/` lectura de métricas + tests; (2) `src/sectors/g-agents/runtime/` agente merchandiser deepagents/langgraph con tools acotadas (read_metrics, read_catalog, propose_placement con Zod+RuleSchema+risk_tier; jamás aplica high directamente) + cron; (3) `scripts/agents/eval-harness.ts` simulador dinámico + gate >2x.
- **Fase D — Verificación adversarial**: suites completas + revisor que intente romper el gate (¿el harness mide de verdad?, ¿el agente puede hacer trampa?, ¿la tienda sigue idéntica sin agentes?).

### El gate >2x (cómo se mide honestamente)
El motor estático ya está cerca de su techo en mundo ESTACIONARIO — exigir 2x ahí sería deshonesto. La barra justa y dura: **mundo NO estacionario** (lanzamientos, agotamientos, cambios de demanda/precio por época) donde la config congelada pierde revenue realizado época a época; el agente (que LEE métricas y AJUSTA placements/params/reglas entre épocas) debe sostener **≥2x el revenue realizado acumulado del motor congelado**, N seeds, CI95>0, sin tocar el request path. Si el agente no dobla: no se despliega (se documenta el resultado y qué haría falta).

### Tareas ya creadas en el task list
#20 migración DeepSeek v4 · #21 instalar LangGraph+DeepAgents · #22 capa de métricas · #23 agente merchandiser · #24 harness >2x.

---

## 4. Referencia rápida
- **Comandos**: `pnpm test:unit` · `npx vitest run tests/integration/...` · `pnpm migrate` · crons: `cron:popularity-7d`, `cron:fatigue`, `cron:prune`, `cron:npmi-recompute` · typecheck `npx tsc --noEmit`.
- **Decisiones cerradas**: holdout 10% · modo ahorro ON · adaptación per-usuario · agentes backend-first · staleness única 300s · ε=0.1 (holdout ε=0).
- **Spec maestra**: `docs/superpowers/specs/2026-06-10-dynamic-web-pageslate-design.md`. Memoria viva: `~/.claude/projects/-workspaces-ecommerce-cuba/memory/project_dynamic_web_plan.md`.
- **DB**: pooler session-mode (5432); scopes public/test/thesis; statement_timeout 2.5s SOLO public; el 6543 filtra GUCs (no volver sin SQL SET-free).
