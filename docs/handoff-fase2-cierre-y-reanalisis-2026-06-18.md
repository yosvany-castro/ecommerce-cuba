# Handoff — Cierre de Fase 2 (agentes) + punto de arranque para el RE-ANÁLISIS

**Fecha:** 2026-06-18 · **Branch:** `feat/thesis-personalization-program` (HEAD `93b9cf4`, todo pusheado) · **Schema DB:** public / test / thesis (pooler session-mode 5432)

**Estado en una frase:** la Fase 2 (agente merchandiser LangGraph+DeepAgents) está **construida entera, verificada adversarialmente y MEDIDA**. El gate ≥2× **NO PASA: el agente queda en paridad con el motor (Ĝ=1.005)** por un techo estructural, no por falta de inteligencia. El usuario pidió **re-analizar el enfoque** antes de decidir. Este documento es el punto de arranque de ese re-análisis.

---

## 1. El resultado que dispara el re-análisis

- **Gate ≥2× (run `gate-llm-2026-06-18`): Ĝ=1.005, CI95=[0.981, 1.030].** Ratios por seed: `42=0.978 · 7=0.9995 · 2026=1.009 · 31337=1.009 · 777=1.032`. El agente **no dobla**; está en paridad.
- **Causa = techo estructural, NO el modelo:** el motor (`rrf-sess-pop`, campeón de Fase 1) ocupa el **hero** (20 ítems, único inmueble de alto tráfico). La superficie soberana deja al agente solo los **slots ≥20**, que en el cascade de atención (λ=0.85) arrancan en la posición 21, donde **P(vista)=0.85²⁰≈3.9% de las sesiones**. Optimizar a la perfección un 3.9% de tráfico no puede ×2 el revenue total.
- **El agente funcionó bien:** 142 propuestas, 110 aceptadas, esperó en 13/60 fronteras, **jamás tocó el hero**, 105 low + 5 medium, 0 high auto-aplicado. Soberanía perfecta bajo 60 épocas adversariales.
- **3 seeds marcados `RUN INVÁLIDO`** = falso positivo del detector `frozenCollapse` (predicho en D1-H3): el brazo congelado está vivo (mín 0.99–2.13M¢), no es el exploit de brazo muerto. Irrelevante: 1.005 está lejísimos del 2× con o sin flag.
- **Informe completo y honesto:** `docs/superpowers/reports/2026-06-18-fase2-gate-verdict.md` (veredicto literal + techo + menú A-D).

**Lectura clave para el re-análisis:** el 2× era **inalcanzable por diseño** mientras el hero sea intocable. Esto no es un fracaso de ejecución — es la evidencia de que el motor de Fase 1 ya es dominante donde importa. La pregunta del re-análisis NO es "¿por qué el agente es malo?" sino **"¿cuál es el trabajo correcto para el agente, dado un motor que ya gana?"**

---

## 2. Qué se construyó (mapa de archivos, todo en origin)

### Migración LLM (commits `4cc77d2`, `4c31f5b`, `2e2296c`)
- `src/lib/llm/deepseek.ts` — DeepSeek v4. `flash`=`deepseek-v4-flash` con `thinking:{type:"disabled"}` (v4 default=enabled; sin esto cada extracción JSON quema reasoning). `pro`=`deepseek-v4-pro`. Overrides `DEEPSEEK_MODEL_FLASH/PRO`.
- `src/lib/llm/providers/deepseek-pro.ts` (nuevo, thinking+high) · `deepseek-flash.ts` (thinking disabled).
- Instalado: `@langchain/langgraph` 1.4.1, `deepagents` 1.10.2, `@langchain/deepseek` 1.0.27, `@langchain/core` 1.1.48, `langchain` 1.4.4.

### Fundaciones C0 (commit `0a20c95`)
- `supabase/migrations/0030_agent_surface.sql` — `proposal_key` + `proposal_meta` jsonb en `ui_placements` + índices de lectura + réplicas test_schema.
- `src/sectors/f-slate/select.ts` — `selectPlacements` extraída de compose.ts + `MAX_PLACEMENTS_PER_SURFACE=8` + `PROTECTED_SLOTS` (anti-secuestro del hero). **Un solo compositor compartido por prod y sim.**
- `src/thesis/data/behavior-model.ts` — knob v3 `attractivenessById` (test bit-idéntico `tests/unit/behavior-model-v3.test.ts` protege el generador auditado de la tesis).

### Capa de métricas C1 (commit `4a0e959`) — `src/sectors/g-agents/metrics/`
- `types.ts` (seam `MetricsSource`), `windows.ts` (ventanas puras, clamp 28d), `confidence.ts` (Wilson CI95 + mínimos de muestra), `queries.ts` (5 funciones SQL + `sqlMetricsSource`), `report.ts` (`buildMetricsReport`: JSON compacto para el LLM, flags en vez de ceros), `index.ts`.
- `src/sectors/f-slate/sections/impressions.ts` — logging de impresiones de carruseles (cierra el gap solo-hero).

### Write-surface + runtime C2 (commit `08c2cab`)
- `src/sectors/f-slate/write.ts` — módulo compartido agente/futuro-admin (`validatePlacementWrite` + `applyPlacementWrite` idempotente).
- `src/sectors/g-agents/write/` — `schema.ts` (Zod estricta 4 verbos, RuleSchema embebido, scope user ni parsea), `tier.ts` (`deriveEffectiveTier` COMPUTADO de hechos SQL, jamás input del LLM), `params.ts` (STRICT_PARAMS), `caps.ts` (5/run, 10/día, 3 vivas/surface, 12 total, cooldown 48h).
- `src/sectors/g-agents/llm.ts` — factories `merchandiserLoopModel` (v4-flash thinking+high) y `criticModel` (v4-pro thinking+max). **Nunca tool_choice forzado con thinking ON (400 verificado).**
- `src/sectors/g-agents/runtime/` — `backend.ts` (seam `MerchandiserBackend`), `backend-pg.ts` (impl SQL prod), `merchandiser.ts` (deepagents hermético: sin backend=StateBackend, sin checkpointer, recursionLimit 40, `hideBuiltinTools` middleware con **wrapToolCall short-circuit** —fix del crash del gate—, subagente critic, gpStub shadowing).
- `scripts/cron-agent-merchandiser.ts` — `AGENTS_ENABLED` default-OFF fail-closed, `--dry-run`, `--kill-all`. Script `cron:agent-merchandiser`.

### Simulador + harness C3 (commit `6fd0e41`) — `src/sectors/g-agents/sim/`
- `constants.ts` (GATE_SEEDS={42,7,2026,31337,777}, DEV_SEED=123, λ=0.85, SLATE_K=20), `shifts.ts` (calendario no estacionario pre-registrado), `world.ts` (universo 3000 inmutable + hash), `store.ts` (ui_placements in-memory con trigger killed replicado), `sections.ts` (resolvers espejo 1:1, hero=rrf-sess-pop), `crons.ts` (popularidad+NPMI solo-pasado), `policy.ts` (DEFAULT jamás `[]`), `ledger.ts` (ground-truth), `sim-metrics-source.ts`, `stats.ts` (gate: media geométrica, CI95 t log-espacio, `frozenCollapsed`), `engine.ts` (pipeline por seed).
- `src/sectors/g-agents/runtime/backend-sim.ts` — el agente REAL corre dentro del harness con sus mismas tools.
- `scripts/agents/eval-harness.ts` — CLI `--gate`/`--smoke`/`--aa`/`--agent`. Caché write-once de transcripts (`scripts/agents/cache/`, 60 commiteados). **Seeds SECUENCIALES** (fix OOM). `NODE_OPTIONS=--max-old-space-size=4096`.

### Verificación adversarial Fase D (commit `9ab1f03`)
- 3 ataques `holds`: `scripts/agents/adversarial.ts` (80/80 trampas bloqueadas), `scripts/agents/verify-ledger.ts` (recuento independiente al céntimo), `tests/integration/agent-sovereignty-adversarial.test.ts`, `tests/integration/harness-aa.test.ts` (A/A=1.0000 exacto), `tests/unit/agent-import-guard-transitive.test.ts`. 5 agujeros reales remediados (detalle en el commit).

### Investigación y specs
- `docs/superpowers/research/fase2/a1..a5-*.md` (5 informes verificados contra .d.ts + Context7 + smokes reales).
- `docs/superpowers/specs/2026-06-11-fase2-agents-blueprint.md` (blueprint archivo-por-archivo).
- `docs/superpowers/reports/2026-06-18-fase2-gate-verdict.md` (veredicto).

**Tests:** 312 unit verde + integración de Fase 2 (sovereignty, adversarial, metrics-layer, sim-metrics-parity, harness-aa) verde. `npx tsc --noEmit` limpio.

---

## 3. Decisiones cerradas y gotchas técnicos (no re-descubrir)

- **DeepSeek v4 thinking mode** SÍ soporta function calling, pero RECHAZA `tool_choice` forzado a función nombrada (400). `withStructuredOutput` default rompe ⇒ usar `jsonMode`. `thinking`/`reasoning_effort` van por `modelKwargs`. `deepseek-chat`/`reasoner` deprecan **2026-07-24**.
- **deepagents:** `createDeepAgent` síncrona; pasar `model` SIEMPRE (default es anthropic). Sin `backend` = StateBackend hermético (fs virtual). `recursionLimit` default 10000 — override obligatorio. Ocultar builtins del modelo NO basta: el ToolNode los ejecuta igual si el modelo los alucina ⇒ **`wrapToolCall` debe short-circuitar** (fix `045de40`).
- **OOM del gate:** `Promise.all` sobre 5 mundos revienta 2GB. Seeds secuenciales + heap 4GB (fix `9115034`).
- **Gate honesto:** brazo frozen = filas reales del seed 0026 (home: solo hero). Crons corren en AMBOS brazos sobre su log propio. A/A=1.0000 exacto valida que el harness no fabrica diferencias. Caché write-once = re-runs $0, run congelado y auditable.
- **frozenCollapse detector:** demasiado conservador para 12 épocas volátiles (D1-H3); marca `INVÁLIDO` por dips legítimos de una época. No cambia el veredicto pero ensucia el acta. Recalibración pre-flagged (distinguir margen<piso de caída-con-recuperación).

---

## 4. Los ejes del RE-ANÁLISIS (lo que hay que decidir en la nueva conversación)

El gate respondió "no dobla" con honestidad brutal. El re-análisis debe atacar las **premisas**, no el código:

1. **¿Es el 2× la vara correcta?** Se eligió como barra dura, pero un motor soberano + hero intocable hace el 2× geométricamente imposible (techo 3.9%). Opciones: (a) bajar la vara a un lift honesto de merchandising (5–30% sobre el tráfico que el agente SÍ controla); (b) mantener 2× pero solo si se cede inmueble (eje 3).

2. **¿Cuál es el trabajo REAL del agente?** El motor ya gana en el hero. ¿El agente debería (a) gestionar la cola larga / superficies que el motor no toca (cross-sell PDP, add-ons carrito, landings, búsqueda); (b) ajustar PARÁMETROS del motor en vez de competir por slots; (c) operar como detector de shifts/agotamientos que avisa, no como colocador de placements?

3. **¿Se cede el hero?** Único camino al 2× real. Requiere: A/B con holdout SOBRE el hero, rollback agresivo, tier high obligatoriamente humano. Negocia contra la soberanía que el usuario impuso. **Decisión de producto, no de ingeniería.**

4. **¿El mundo simulado es la prueba correcta?** El sim es honesto pero es un sim (cero usuarios reales). Quizá el agente deba probarse en **shadow-mode con tráfico real** (la infra ya lo soporta: propuestas pending + holdout 10%) y medir lift en `since_change`, en vez de pelear un gate sintético.

5. **¿El agente compite o coopera con el motor?** Hoy compite por slots. ¿Y si el agente ALIMENTA al motor (señales, candidatos, re-ranking de la cola) en vez de colocar placements paralelos?

**Recomendación para abrir el re-análisis:** usar el skill `brainstorming` partiendo de la pregunta "dado un motor que ya gana en el hero, ¿cuál es la propuesta de valor del agente y cómo se mide honestamente?" — NO re-construir nada; toda la infra (soberana, segura, medible) ya existe y se reutiliza sea cual sea la respuesta.

---

## 5. Referencia rápida

- **Re-correr el gate** (todo cacheado, ~20 min, $0 LLM): `NODE_OPTIONS="--max-old-space-size=4096" pnpm exec tsx scripts/agents/eval-harness.ts --gate`
- **Smoke** (~$0.03): `... eval-harness.ts --smoke` · **A/A** (cero LLM): `... --aa --seeds 123`
- **Tests:** `pnpm test:unit` (312) · `npx vitest run tests/integration/<archivo>` · `npx tsc --noEmit`
- **Adversarial:** `pnpm exec tsx scripts/agents/adversarial.ts` (80/80) · `verify-ledger.ts` (recuento independiente)
- **Cron del agente:** `AGENTS_ENABLED=true pnpm cron:agent-merchandiser --dry-run`
- **Decisiones cerradas heredadas:** holdout 10% · modo ahorro ON · DB session-mode 5432 (6543 filtra GUCs) · seeds del gate {42,7,2026,31337,777} (jamás tocar en dev; usar 123)
- **Memoria viva:** `~/.claude/projects/-workspaces-ecommerce-cuba/memory/project_dynamic_web_plan.md` (actualizada con el veredicto).
- **Suspensión del codespace:** mata procesos largos y borra `/tmp`; el caché write-once del harness sobrevive (en disco), por eso re-correr el gate es barato.
