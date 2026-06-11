# Blueprint Fase 2 — Agente merchandiser (LangGraph + DeepAgents) sobre el motor PageSlate

**Fecha:** 2026-06-11 · **Branch:** `feat/thesis-personalization-program` · **Autor:** síntesis B (arquitecto) sobre A1–A5
**Fuentes:** `docs/superpowers/research/fase2/a1..a5-*.md` + `docs/handoff-fase2-agentes-2026-06-11.md` (requisitos vinculantes §2). Toda API citada está verificada en los informes contra `.d.ts` instalados o empíricamente contra la API real — nada viene de memoria.
**Regla de lectura:** este documento es ejecutable sin acceso a los informes. Donde un informe contradecía a otro, la subsección 2.B dice quién gana y por qué. No hay TBD.

---

## 1. Arquitectura

```
                 OFFLINE (cron diario, tsx, withPgDirect)            REQUEST PATH (intocable)
┌─────────────────────────────────────────────────────────┐   ┌──────────────────────────────────┐
│ scripts/cron-agent-merchandiser.ts                      │   │ composePage (f-slate/compose.ts) │
│   AGENTS_ENABLED!=true ⇒ exit 0 (fail-closed)           │   │   └─ getSurfaceConfig:           │
│   --dry-run | --kill-all                                │   │      WHERE status='approved'     │
│        │                                                │   │        AND ttl_until > now()     │
│        ▼                                                │   │      caché 60s → stale →         │
│ buildMerchandiser(backend)        [deepagents 1.10.2]   │   │      DEFAULT_PLACEMENTS          │
│  ┌────────────────────────────────────────────┐         │   │   └─ evaluateRule fail-closed    │
│  │ loop: ChatDeepSeek v4-flash thinking+high  │         │   │   └─ resolveSections + registry  │
│  │ subagent critic: v4-pro thinking+max       │         │   └──────────────▲───────────────────┘
│  │ tools (única superficie de efectos):       │         │                  │ solo LEE filas
│  │   read_metrics   ──► g-agents/metrics (SQL │         │                  │ approved
│  │                      read-only, A4)        │         │                  │
│  │   read_catalog   ──► products+popularity_7d│         │   ┌──────────────┴───────────────────┐
│  │   propose_placement ─► f-slate/write.ts ───┼─────────┼──►│ ui_placements                    │
│  │     (valida RuleSchema+STRICT_PARAMS,      │         │   │  low    → approved + TTL ≤168h   │
│  │      tier COMPUTADO, caps, idempotencia)   │         │   │  medium → approved+experiment_id │
│  └────────────────────────────────────────────┘         │   │           (solo env autoapply)   │
│                                                         │   │  high   → pending (humano)       │
│ scripts/agents/eval-harness.ts  (gate ≥2x)              │   │  killed → irreversible (trigger) │
│   mismo buildMerchandiser, backend-sim in-memory        │   └──────────────────────────────────┘
│   brazo frozen vs brazo agente, N seeds, CI95           │
└─────────────────────────────────────────────────────────┘
```

El agente vive EXCLUSIVAMENTE en un proceso cron offline: lee métricas agregadas (capa C1, SQL read-only por `withPgDirect`, jamás el pool del request path) y escribe propuestas en `ui_placements` a través del módulo compartido `src/sectors/f-slate/write.ts`, con el `risk_tier` computado por código (no declarado por el LLM) y mapeado a `status`: low se aplica con TTL obligatorio, medium se aplica solo con env explícito, high queda `pending` siempre. El motor es soberano por construcción: el loader del request path solo ve filas `approved` no expiradas, descarta reglas inválidas con warn, evalúa fail-closed y cae a `DEFAULT_PLACEMENTS` ante cualquier fallo — si el agente muere, escribe basura o no existe (`AGENTS_ENABLED` default OFF), la tienda sirve idéntica. El harness del gate corre el MISMO módulo de agente con backend de simulación contra un mundo no estacionario y exige ≥2x el margen realizado acumulado del motor congelado (N=5 seeds, media geométrica, CI95-low>1, unanimidad) — si no, no se despliega.

---

## 2. Decisiones cerradas

### 2.A Decisiones (cada una con su fuente)

1. **API de construcción del agente:** `createDeepAgent({ model, tools, systemPrompt, subagents, middleware })` de `deepagents@1.10.2` — síncrona; NO existe `instructions` ni `builtinTools`; el prompt va en `systemPrompt` (A1 §1).
2. **Modelo SIEMPRE explícito como instancia `ChatDeepSeek`:** el default real de deepagents es `"anthropic:claude-sonnet-4-6"` (créditos depletados) — pasar instancia da control de `modelKwargs` (A1 §7.4, A2 §1).
3. **Modelo por rol:** loop merchandiser = `deepseek-v4-flash` + `thinking:{type:"enabled"}` + `reasoning_effort:"high"` + `temperature:0` + `maxTokens:8192`; subagente critic = `deepseek-v4-pro` + thinking `max` + `maxTokens:16384`; extracción barata (ya existente en `src/lib/llm/`) = flash thinking disabled (A2 §6 — matriz empírica; tools en thinking mode verificados en ambos modelos).
4. **PROHIBIDO `tool_choice` forzado (named o `required`) con thinking ON:** la API devuelve 400 verificado; structured output con thinking ON solo vía `method:"jsonMode"` (A2 tests 4-5).
5. **`modelKwargs` es el canal del body extra v4** (`thinking`, `reasoning_effort`) — wire-verificado que llega top-level; nunca usar el campo `reasoning` del constructor (pisa modelKwargs y su tipo no admite `"max"`) (A2 §1.3).
6. **Resultado del run = side-effects del tool `propose_placement`** (contrato), texto final solo log; SIN `responseFormat` en el agente principal (A1 §4.2a; refuerzo: A2 advierte que las strategies podrían inyectar `tool_choice` forzado — decisión 4).
7. **Hermetismo:** no pasar `backend` (StateBackend default = fs 100% virtual, tool `execute` no existe), no pasar `checkpointer` (one-shot sin thread_id), `recursionLimit: 40` explícito en cada `invoke` (deepagents fija 10000), `signal: AbortSignal.timeout()` (A1 §3.1, §4.1).
8. **Ocultar builtins al modelo** con middleware `wrapModelCall` (`createMiddleware` de `langchain` — requiere `pnpm add langchain@^1.4.4`, cero bytes nuevos): HIDDEN = fs tools + `write_todos`; **`task` se mantiene visible** (lo usa el critic). El subagente `general-purpose` se neutraliza por shadowing con un stub inerte (A1 §3.3, §3.5).
9. **Subagente critic declarativo** (`SubAgent` con `tools:[read_metrics]`, modelo pro): veredicto como **JSON en texto plano** exigido por su systemPrompt (palabra "JSON" + ejemplo de shape, requisito DeepSeek json_object) — NO `SubAgent.responseFormat` (riesgo de tool_choice forzado, decisión 4). El veredicto es ADVISORY: la seguridad nunca depende de él (A1 §5, A2 §3).
10. **Tool name canónico: `propose_placement`** con 4 verbos `create|supersede|pause_own|request_pause` (A5 §1.1).
11. **`risk_tier` NO es input del LLM:** lo computa `deriveEffectiveTier` de hechos SQL (slot protegido u ocupado por fila no-agente ⇒ high; supersede propio o scope segment ⇒ medium; create en slot libre global ⇒ low; `request_pause` ⇒ high; `pause_own` ⇒ low) (A5 §1.3).
12. **Mapping tier→DB:** low ⇒ `INSERT status='approved', ttl_until=now()+ttl_hours` (TTL 1..168h, default 72, obligatorio); medium ⇒ approved+`experiment_id=run_id` SOLO con `AGENT_MEDIUM_AUTOAPPLY==='true'`, si no `pending`; high ⇒ `pending` SIEMPRE, sin env que lo salte (A5 §1.3).
13. **Status de propuesta = `'pending'`:** el CHECK de 0025 no tiene `'proposed'`; `created_by='agent:merchandiser/v1'` (columna ya existe) (A5 §0.1).
14. **Única migración: `0030_agent_surface.sql`** = `proposal_key` (unique parcial, idempotencia diaria) + `proposal_meta` jsonb (auditoría que composePage jamás lee) + 2 índices de lectura (`feed_impressions(served_at)`, `purchase_attributions(attributed_at)`) + réplicas `test_schema` (A5 §1.5 + A4 §7 fusionados).
15. **Whitelists del agente:** secciones `popular|cross_sell|cart_addons` (hero_grid EXCLUIDO — priority 0, "never sacrificed"); superficies `home|pdp|cart`; scope `global|segment` (`user` ni parsea); `scope_ref` de segment contra `CohortId` de `@/sectors/d-personalization/cohorts/definitions`; slots create 20..90 múltiplos de 10; `PROTECTED_SLOTS={home:10,pdp:10,cart:10}` (A5 §1.2, §2.4).
16. **Validación write-time:** `RuleSchema` exacto de `@/sectors/f-slate/rules/schema` embebido en el Zod del tool + `STRICT_PARAMS` espejo estricto del registry (los `paramsSchema` del registry usan `.catch()` — resilientes, inservibles para write-time) (A5 §2.2-2.3).
17. **Caps:** 5 propuestas/run, 10 escrituras/día, 3 filas agente vivas/surface, 12 totales, cooldown 48h por (surface,slot), TTL ≤168h, idempotencia `proposal_key` por día (A5 §3).
18. **Kill switches:** `AGENTS_ENABLED` default OFF fail-closed; trigger `killed` irreversible; `--kill-all` de pánico (A5 §3).
19. **Defensa en profundidad en compose:** `MAX_PLACEMENTS_PER_SURFACE=8` aplicado tras resolver colisiones (A5 §3).
20. **Capa de métricas C1:** 5 funciones SQL parametrizadas sin `now()` en ventanas, `MetricsSource` como seam delgado, `buildMetricsReport` compacto (≤12 placements, top-5 categorías + other, cents enteros, rates 3 decimales, flags en vez de ceros, Wilson CI95) (A4 §2-3).
21. **Ventanas:** 7d default (alineada con popularidad/atribución/fatiga 7d) + 14d trend (dos buckets de 7d) + since-change anclada a `ui_placements.updated_at` clamp 28d; NUNCA ventana libre para el LLM (A4 §4).
22. **Mínimos de muestra estructurales** (en `report.ts`, no solo en prompt): `seen_rate` con served≥50; `ctr_seen` con seen≥200; `revenue_per_1k_seen` con purchases≥10; `vs_holdout` con ≥30 sesiones/brazo y ≥10 compras — bajo mínimo ⇒ `null` + flag, jamás 0.0 (A4 §5).
23. **Proxy de click = `product_view`** misma sesión+producto con `max(occurred_at) >= served_at`, condicionado a `seen_at IS NOT NULL`; `add_to_cart` sin condición seen; cast `events.session_id::text = feed_impressions.session_id` (A4 §2.2).
24. **Atribución impresión→placement vía `slate_decisions.placements`** (jsonb_to_recordset + `DISTINCT ON (slate_id)`) porque `placement_version` jamás se escribe en impresiones hero (A4 §0.3).
25. **C1 incluye el logging de impresiones de carruseles** (hoy solo hero loguea): `feed_request_id = composition_id`, `section_id = section_type`, `position = slot*100 + idx+1`, `placement_version` escrito; `logSlateDecision` inserta fila adicional keyed por `composition_id` cuando difiere del `slate_id` del hero (cierra el gap A4 §0.3.1 y da paridad sim↔prod del canal de observación). `seen_at` de carruseles queda NULL hasta el beacon cliente (deuda declarada, flag `no_seen_tracking`).
26. **Mundo del harness:** behavior-model v2 + UN solo knob aditivo `attractivenessById` (test de regresión bit-idéntica obligatorio); catálogo-universo inmutable 3000 (2400 activos e0 + 600 reservados); no estacionariedad por época: demanda (eventos ×2-3, walk ±10%), lanzamientos ~40/época, agotamientos exógenos 2.5%/época sesgados a bestsellers, repricing 7%/época ±10-25% con priceBand ±1 en 30%; calendario muestreado de `worldSeed` (A3 §1).
27. **Qué se congela:** SOLO las filas `ui_placements` del brazo frozen (= filas reales del seed 0026 para `home`: hero_grid slot 10 únicamente — ver 2.B.9); crons de popularidad (ventana 1 época) y NPMI (ventana 6 épocas) corren en AMBOS brazos sobre el log propio; ranker hero rrf-sess-pop, ε=0.1, λ=0.85, panel y calendario idénticos (A3 §2).
28. **Calendario del gate:** e0 warmup orgánico + e1 congelada compartida + e2..e13 medidas (12 decisiones del agente, fronteras de época), `EPOCH_DAYS=14` (A3 §1.3).
29. **Métrica del gate: margen realizado** (`Σ price_cents(t)·margin_pct` del funnel simulado, todo el brazo incluyendo orgánicas); GMV secundaria. GMV sería gameable (margin anti-correlado con priceBand) (A3 §4 — resuelve P1 de A3).
30. **Gate matemático:** por seed `ratio_s = M_agent/M_frozen` (épocas 2..13); `Ĝ = exp(mean(ln ratio_s))`; CI95 t-Student en log-espacio; **PASA ⇔ Ĝ≥2.0 ∧ CI-low>1.0 ∧ ratio>1 en todos los seeds**; 1.9x = FAIL. Escalada única pre-registrada a N=10 si Ĝ≥2 con CI-low≤1. Seeds gate `{42,7,2026,31337,777}`, extensión `{1001..1005}`, desarrollo SOLO `123` (A3 §5).
31. **Holdout 10% dentro del brazo agente** (composición congelada, compras cuentan en el total del brazo), reutilizando `isHoldout` de `src/sectors/d-personalization/holdout.ts` con salt fijado por el harness (A3 §4; paridad con prod F-stage).
32. **El agente del gate = el agente que se despliega:** mismo `buildMerchandiser`, mismo prompt byte-estable, mismos schemas, backend intercambiado (anti-H7); configuración gateada = flash loop + critic pro + `AGENT_MEDIUM_AUTOAPPLY=true` (ver 2.B.5) — fijada AQUÍ, antes del primer run del gate (resuelve P2 de A3).
33. **Coste y caché:** prompt + tools byte-estables (cache hit DeepSeek 50× más barato); caché write-once de decisiones por hash (transcripts commiteados); gate ≈ **$0.5** (worst case pricing 4×: ~$2); `--smoke` ≈ $0.03 (A2 §4, A3 §6.2).
34. **Cadencia prod: diaria** (`cron:agent-merchandiser`); las ventanas son 7-28d, más frecuencia = churn sin señal (A5 §4).
35. **Anti-fuga al prompt:** el input del agente jamás contiene `latent_state`, `attractivenessById`, calendario de shifts ni datos > frontera; test de whitelist de claves del JSON del report (A3 §8 #2).
36. **Slate vacío ⇒ `DEFAULT_PLACEMENTS`, jamás `[]`** — `[]` activa el régimen orgánico-oráculo del generador (exploit bloqueado + test dedicado) (A3 §8 #7).
37. **El gate NO se mide con la capa de métricas:** ground truth = ledger interno del simulador; la capa C1 es solo el canal de observación del agente (un bug de métricas ciega al agente, no infla el gate) (A4 §6.4).

### 2.B Contradicciones entre informes — resolución explícita

1. **Nombre del tool** (`propose_placement` A1 vs `propose_placement_write` A3): **gana A5** (`propose_placement`) — A5 es el informe propietario de la superficie de escritura y verificó no-colisión con builtins.
2. **`risk_tier` como input del LLM** (A1 sketch) vs computado (A5): **gana A5** — un agente desalineado no puede auto-rebajarse el tier; es hecho SQL, no declaración.
3. **`status='proposed'`** (A1 sketch) vs `'pending'` (A5): **gana A5** — el CHECK de 0025:49-50 no contiene `proposed`; es un hecho del DDL, no una opinión.
4. **Modelo del loop** (A3 §6.1 usaba v4-pro) vs flash (A2 §6a): **gana A2** — es el informe empírico de DeepSeek; tools+thinking verificados en flash, 3.1× más barato, y el harness corre 60+ runs. El pro queda para el critic. El sketch de A3 §6.1 se corrige.
5. **Tier medium** (A3: approved+TTL≤2 épocas; A5: env-gated default pending): **gana A5 en mecanismo** (env `AGENT_MEDIUM_AUTOAPPLY`), y se cierra la política de despliegue: **la config que se gatea y se despliega corre con `AGENT_MEDIUM_AUTOAPPLY=true`** — sin autoapply el agente solo tendría "create en slot libre" y el gate mediría una política capada que nadie desplegaría. High sigue pending SIEMPRE en ambos entornos (su valor queda honestamente fuera del gate).
6. **Fuente de métricas del sim** (A4 §6: insertar el mundo en `test_schema` y usar el único SQL; A3: todo in-memory, cero DB): **resolución híbrida — gana A3 en runtime, gana A4 en semántica.** El gate genera ~30-50K eventos/época/brazo × 2 brazos × 12 épocas × 5 seeds ≈ millones de filas: insertarlas en el pooler remoto desde 2 cores rompe el presupuesto de 15-20 min. Por tanto: `SimMetricsSource` in-memory que implementa la MISMA interfaz `MetricsSource` de A4, `buildMetricsReport` (la compactación) es código compartido literal, y la equivalencia semántica se clava con un **test de paridad obligatorio**: el fixture de integración de A4 §8 (que cubre todos los edge cases: view pre-served, seen gating, holdout, orgánica, legacy, dedupe) se carga en `test_schema` Y en el ledger del sim ⇒ `sqlMetricsSource` y `simMetricsSource` deben devolver filas deep-equal. La recomendación literal de A4 ("no escribir SimMetricsSource") queda **anulada con esta mitigación**.
7. **Shape de observación del agente en el sim** (A3 §3.2 `MerchandiserInput` con épocas vs A4 §3 report con ventanas): **gana A4** — anti-H7 exige gatear el canal de observación que se despliega; el agente ve ventanas 7/14/28d (en el sim son días simulados, mapeo natural), nunca "épocas" (concepto interno del harness). El `MerchandiserInput` de A3 queda descartado; el test de whitelist de A3 §8 #2 se aplica a las claves del report.
8. **`params.limit` del hero como palanca del agente** (A3 §2 paréntesis) vs hero fuera de whitelist (A5): **gana A5** — el hero no es tocables en NINGÚN verbo (la whitelist de secciones no lo contiene); la palanca no existe.
9. **Config congelada** (A3 decía "seed 0026: hero slot 10 + popular global"): **gana el DDL** — 0026 siembra en `home` SOLO `('home',10,'hero_grid')`; `popular` existe como sección pero sin placement en home. El brazo frozen = exactamente las filas 0026 aplicables al sim (home: hero). Es la config que la tienda real shippea; baseline competente (ranker campeón + crons vivos), sin inflar.
10. **TTL ≤168h vs épocas de 14 días** (conflicto latente A5↔A3 detectado en esta síntesis): el cap de 168h asume cadencia diaria del cron (re-afirmación antes de expirar); en el sim el agente corre cada 14 días ⇒ TTL literal expiraría a mitad de época y caparía al agente por artefacto de cadencia, no por política. **Cierre pre-registrado:** el invariante real es "TTL ≤ ~2× la cadencia de revisión". El backend sim convierte `simTtlEpochs(ttl_hours) = clamp(round(ttl_hours/72), 1, 2)` (72h→1 época, 168h→2 épocas), consistente con la pre-registración de A3 ("medium con ttl ≤ 2 épocas"). Schema y prompt idénticos; la conversión es del backend y se documenta como desviación sim↔prod nº4.
11. **Colisión de numeración 0030** (A4 `0030_metrics_read_indexes` vs A5 `0030_agent_write_surface`): se fusionan en **una** migración `0030_agent_surface.sql` (decisión 14).
12. **`responseFormat`/`toolStrategy`** (A1 variante B) vs riesgo 400 thinking (A2): **gana A2** — ni `responseFormat` en el padre ni `SubAgent.responseFormat` en el critic; side-effects + JSON-en-texto (decisiones 6 y 9).

### 2.C Desviaciones sim↔prod declaradas (capítulo de validez)

1. `cross_sell` ancla en last-viewed del log (prod: PDP actual) — conservador contra el agente (A3 §3.4).
2. `cart_addons` no existe en el sim; superficies pdp/cart no se componen en el sim — propuestas del agente para ellas son aceptadas-pero-inertes (capadas por el run cap; conservador contra el agente).
3. `recipient_active`/`gift_confirmed` fijos false (el detector real tiene precision ~13% — dárselo sería oráculo).
4. TTL escalado a cadencia (2.B.10).
5. `margin_pct` per-product visible en el sim (catalog-model); en prod el margen efectivo es 0.6 hardcodeado (deuda F1) — el campo existe en ambos shapes, prod lo llena con la constante vigente.
6. `seen` de carruseles: el sim lo tiene (examinación cascade); prod lo tendrá cuando exista el beacon cliente (riesgo abierto R6).

---

## 3. Spec C1 — `src/sectors/g-agents/metrics/` (+ logging de carruseles)

Convención del repo: funciones `(args, pg: Client)`, identificadores SQL en inglés, sin estado, sin escrituras (la excepción C1b es telemetría del motor, no del agente).

### 3.1 `src/sectors/g-agents/metrics/types.ts`

```ts
import type { Client } from "pg";

export interface ResolvedWindow { from: Date; to: Date; label: string } // "7d"|"14d"|"since_change"
export type WindowSpec = { kind: "fixed"; days: 7 | 14 | 28 } | { kind: "since"; from: Date };
export type Surface = "home" | "pdp" | "cart" | "search";

export interface SectionFunnelRow {
  section_id: string;    // 'hero_grid' | 'legacy_feed' | section_type de carrusel
  policy: string;        // 'default' | 'holdout' | ...
  served: number; seen: number; clicks: number; add_to_carts: number;
  purchases: number; revenue_cents: number;
}
export interface PlacementFunnelRow extends Omit<SectionFunnelRow, "section_id"> {
  placement_id: string; section_type: string; surface: Surface; slot: number;
  placement_version: number;
}
export interface PlacementCatalogRow {
  placement_id: string; surface: Surface; slot: number; section_type: string;
  status: string; risk_tier: string; scope: string; version: number;
  created_by: string; updated_at: Date; age_days: number;
}
export interface PolicyComparisonRow {
  policy: string;        // 'default' | 'holdout' | 'organic' (solo compras)
  exposed_sessions: number; served: number; seen: number;
  purchases: number; revenue_cents: number;
}
export interface CategoryFunnelRow {
  category: string; served: number; seen: number; clicks: number;
  purchases: number; revenue_cents: number;
}

/** Seam delgado: 1 impl SQL (prod) + 1 impl in-memory (sim) con test de paridad. */
export interface MetricsSource {
  placementCatalog(opts: { surface?: Surface }): Promise<PlacementCatalogRow[]>;
  placementFunnels(opts: { window: WindowSpec; surface?: Surface; sinceChange?: boolean }): Promise<PlacementFunnelRow[]>;
  sectionFunnels(opts: { window: WindowSpec; surface?: Surface }): Promise<SectionFunnelRow[]>;
  policyComparison(opts: { window: WindowSpec }): Promise<PolicyComparisonRow[]>;
  categoryFunnels(opts: { window: WindowSpec; limit?: number }): Promise<CategoryFunnelRow[]>;
}
```

### 3.2 `src/sectors/g-agents/metrics/windows.ts`

`export function resolveWindow(spec: WindowSpec, now: () => Date): ResolvedWindow` — puro. `fixed` ⇒ `[now-days, now)`; `since` ⇒ `[max(from, now-28d), now)` con label `since_change`. Ningún SQL usa `now()` para ventanas: siempre `$N::timestamptz` desde aquí (requisito de reloj inyectable del sim).

### 3.3 `src/sectors/g-agents/metrics/confidence.ts`

`export function wilson95(successes: number, n: number): [number, number] | null` (implementación exacta de A4 §5, z=1.959963984540054, clamping [0,1], null si n≤0 o successes fuera de rango) + constantes exportadas: `MIN_SERVED_FOR_SEEN_RATE=50`, `MIN_SEEN_FOR_CTR=200`, `MIN_PURCHASES_FOR_REVENUE_RATE=10`, `MIN_SESSIONS_PER_ARM=30`, `MIN_PURCHASES_FOR_HOLDOUT_DELTA=10`.

### 3.4 `src/sectors/g-agents/metrics/queries.ts`

`export function sqlMetricsSource(pg: Client, opts?: { now?: () => Date }): MetricsSource`

Los 5 SQL son los de A4 §2 **literalmente** (columnas verificadas contra DDL 0005/0023-0029); resumen de cada uno con sus decisiones no negociables:

- **`placementCatalog`**: `SELECT up.id::text AS placement_id, up.surface, up.slot, up.section_type, up.status, up.risk_tier, up.scope, up.version, up.created_by, up.updated_at, GREATEST(0, floor(extract(epoch FROM ($2::timestamptz - up.updated_at))/86400))::int AS age_days FROM ui_placements up WHERE up.status <> 'archived' AND ($1::text IS NULL OR up.surface=$1) ORDER BY up.surface, up.slot, up.version DESC`. Incluye `paused/killed/pending` (el agente debe VER lo muerto para no re-proponerlo).
- **`sectionFunnels`** (A4 §2.2 completo): CTE `session_actions` (una fila por sesión×producto×tipo con `max(occurred_at)`, eventos `product_view|add_to_cart` con `payload ? 'product_id'`, cast `e.session_id::text`), CTE `purchases` (GROUP BY `(feed_request_id, position)` de `purchase_attributions`, `sum(unit_price_cents*quantity)`), CTE `surfaced` (`DISTINCT ON (sd.slate_id)` de `slate_decisions`, lookback `- interval '2 days'`); agregación `COALESCE(fi.section_id,'legacy_feed')`×`fi.policy` con clicks = `seen_at IS NOT NULL AND pv.last_at >= fi.served_at`, add_to_carts sin condición seen.
- **`placementFunnels`** (A4 §2.3 completo): CTE `decisions` (`DISTINCT ON (slate_id)` ASC) + `CROSS JOIN LATERAL jsonb_to_recordset(d.placements) AS pl(placement_id uuid, slot smallint, section_type text, version int)` con `pl.section_type = fi.section_id`; `sinceChange=true` ⇒ `imp.served_at >= GREATEST(up.updated_at, $now - interval '28 days')`.
- **`policyComparison`** (A4 §2.4): dos agregados (exposición por policy desde `feed_impressions`; reward por `COALESCE(pa.policy,'organic')` desde `purchase_attributions`) combinados en TS.
- **`categoryFunnels`** (A4 §2.5): join `products` con `COALESCE(p.metadata->>'category','uncategorized')`, ORDER BY seen DESC LIMIT `$3`.

Además: `export async function fetchCatalogContext(opts: { limit?: number }, pg: Client)` — agregado por categoría de `product_popularity_7d` (`category, sum(events_7d), sum(purchases_7d), count(*)`), top 8: contexto barato para el report.

### 3.5 `src/sectors/g-agents/metrics/report.ts`

`export async function buildMetricsReport(source: MetricsSource, opts: { surface?: Surface; windowDays: 7 | 14 | 28; now: () => Date }): Promise<MetricsReport>` — produce el JSON shape de A4 §3 EXACTO:

- bloque `store` (agregado), `vs_holdout` (con ambos `n` crudos, `revenue_ratio`, flags; `null` + `insufficient_holdout_data` bajo mínimos), `placements[]` (≤12, uuid completo, `funnel` + `since_change` por placement, `funnel:null`+flag `no_impression_logging` para placements sin filas; flag `no_seen_tracking` cuando `served>0 ∧ seen=0` en sección no-hero), `categories[]` (top-5 + `other(+N)`), `data_quality` (impression_sources, retention_days 90, notes).
- Reglas duras: rates `Math.round(x*1000)/1000`; dinero en cents enteros; celda bajo mínimo ⇒ métrica `null`/omitida + flag (`low_sample` etc.) — **jamás un 0.0 que signifique "sin datos"**; `ctr_ci95` Wilson solo con muestra; `since_change` se computa SIEMPRE (no es parámetro del tool).
- 14d trend: dos ventanas 7d comparadas en TS cuando `windowDays=14`.

### 3.6 `src/sectors/g-agents/metrics/index.ts` — re-exports.

### 3.7 C1b — logging de impresiones de carruseles (paridad del canal de observación)

**`src/sectors/f-slate/sections/impressions.ts`** (nuevo):

```ts
export interface SectionImpressionRow {
  position: number;          // slot*100 + (idx+1)  — único dentro del composition_id
  product_id: string;
  section_type: string;
  placement_version: number;
}
export async function logSectionImpressions(
  args: { composition_id: string; session_id: string | null; user_profile_id: string | null;
          page_request_id: string | null; rows: SectionImpressionRow[] },
  pg: Client,
): Promise<void>;
```

Un solo INSERT batched con `unnest` (patrón exacto de `logSlatePageImpressions`, `src/sectors/d-personalization/slate/store.ts:93-123`), `ON CONFLICT (feed_request_id, position) DO NOTHING`, `source='exploit'`, `propensity=1.0`, `policy='default'`, `seen_at` NULL, **`placement_version` escrito**. Try/catch fire-and-forget: el logging jamás tumba la página.

**Cableado:** dentro de `resolveSections` (`src/sectors/f-slate/sections/resolve.ts`) — tras resolver todas las secciones no-hero, acumular filas y llamar `logSectionImpressions` UNA vez con `page.composition_id` (la firma ya recibe `page: ComposedPage` y `pg`; `identity` da session/profile). Cubre ambos callers (home `src/app/(shop)/page.tsx:43` y `POST /api/slate/resolve` route:63) sin tocarlos.

**`logSlateDecision`** (`src/sectors/f-slate/compose.ts:119`): cuando `ctx.slate_id` existe y difiere de `page.composition_id`, insertar UNA fila adicional con `slate_id = page.composition_id` (mismos placements jsonb) — así las impresiones de carrusel (keyed composition_id) joinean `slate_decisions` igual que las del hero (keyed slate_id). Backwards-compatible; `DISTINCT ON` ya absorbe la multiplicidad.

### 3.8 Migración (parte C1 de `0030_agent_surface.sql`)

```sql
CREATE INDEX IF NOT EXISTS idx_feed_impressions_served_at ON public.feed_impressions (served_at);
CREATE INDEX IF NOT EXISTS idx_purchase_attr_attributed_at ON public.purchase_attributions (attributed_at);
CREATE INDEX IF NOT EXISTS idx_feed_impressions_served_at_ts ON test_schema.feed_impressions (served_at);
CREATE INDEX IF NOT EXISTS idx_purchase_attr_attributed_at_ts ON test_schema.purchase_attributions (attributed_at);
```

### 3.9 Tests C1 (nombres exactos; detalle en §6)

`tests/unit/metrics-confidence.test.ts`, `tests/unit/metrics-windows.test.ts`, `tests/unit/metrics-report-shape.test.ts`, `tests/integration/metrics-layer.test.ts`.

---

## 4. Spec C2 — write surface + `src/sectors/g-agents/runtime/` + cron

### 4.1 `src/sectors/g-agents/llm.ts` — factories de modelo (A2 §6, compilable)

```ts
import { ChatDeepSeek } from "@langchain/deepseek";
import { DEEPSEEK_MODELS } from "@/lib/llm/deepseek";

function deepseekV4(opts: { model: string; thinking: "enabled" | "disabled";
  reasoningEffort?: "high" | "max"; maxTokens: number; temperature?: number }) {
  return new ChatDeepSeek({
    model: opts.model, temperature: opts.temperature ?? 0, maxTokens: opts.maxTokens,
    modelKwargs: { thinking: { type: opts.thinking },
      ...(opts.thinking === "enabled" && opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}) },
  }); // apiKey: lee DEEPSEEK_API_KEY y LANZA si falta ⇒ instanciar LAZY, jamás a nivel de módulo
}
export const merchandiserLoopModel = () =>
  deepseekV4({ model: DEEPSEEK_MODELS.flash, thinking: "enabled", reasoningEffort: "high", maxTokens: 8192 });
export const criticModel = () =>
  deepseekV4({ model: DEEPSEEK_MODELS.pro, thinking: "enabled", reasoningEffort: "max", maxTokens: 16384 });
```

Checks vinculantes A2 heredados: jamás `tool_choice` forzado con thinking ON; `maxTokens` explícito siempre; prompt+tools byte-estables; actualizar el comment de pricing stale en `src/lib/llm/deepseek.ts:9` ($0.0028/M cache hit, no $0.028); mantener `scripts/_audit/a2-deepseek-langchain-probe.ts` como smoke pre-deploy (~$0.001).

### 4.2 `src/sectors/f-slate/select.ts` — extracción compartida (C0)

```ts
export const MAX_PLACEMENTS_PER_SURFACE = 8;
export function selectPlacements(placements: PlacementConfig[], ctx: SlateRuleContext): PlacementConfig[];
```

Cuerpo = el bloque exacto de `compose.ts:93-106` (filtro `evaluateRule`, `SCOPE_RANK user>segment>global`, desempate `version DESC`, sort por slot) + `.slice(0, MAX_PLACEMENTS_PER_SURFACE)` al final (decisión 19). `compose.ts` pasa a llamarla (refactor sin cambio de semántica salvo el cap; la equivalencia la cubre `tests/integration/slate-compose.test.ts` + 1 caso nuevo). El sim (C3) importa esta MISMA función — un solo compositor (anti-H7).

### 4.3 `src/sectors/f-slate/write.ts` — módulo compartido de escritura (agente + futuro admin)

```ts
export interface PlacementWrite {
  surface: Surface; slot: number; section_type: string;
  params: Record<string, unknown>; rule: unknown | null;
  scope: "global" | "segment"; scope_ref: string | null;
  status: "approved" | "pending"; risk_tier: "low" | "medium" | "high";
  experiment_id: string | null; ttl_until: Date | null;
  created_by: string; proposal_key: string | null; proposal_meta: unknown | null;
}
export interface WriteResult { ok: boolean; placement_id?: string; reason?: string }

export function validatePlacementWrite(w: PlacementWrite): { ok: true } | { ok: false; reason: string };
export async function applyPlacementWrite(w: PlacementWrite, pg: Client): Promise<WriteResult>;
export async function pauseOwnPlacement(args: { placement_id: string; created_by_like: string }, pg: Client): Promise<WriteResult>;
```

- `validatePlacementWrite`: `section_type ∈ SECTION_REGISTRY ∪ {hero_grid}` (`sections/registry.ts`), `rule` por `isValidRule`/`RuleSchema` (`rules/schema.ts`), CHECKs de scope/status espejados.
- `applyPlacementWrite`: transacción corta POR escritura; `version = COALESCE(MAX(version) FILTER (mismo surface+slot+scope), 0) + 1` computado en SQL; `INSERT ... ON CONFLICT (proposal_key) DO NOTHING` ⇒ 0 filas = `{ok:false, reason:"duplicate"}`.
- `pauseOwnPlacement`: `UPDATE ui_placements SET status='paused', updated_at=now() WHERE id=$1 AND created_by LIKE $2 AND status IN ('approved','pending')` — 0 filas ⇒ rechazo legible.
- El módulo vive en f-slate (dueño del contrato); el agente añade whitelists+caps ENCIMA (4.4); el futuro `/api/admin/placements` añadirá `requireAdmin` sin caps.

### 4.4 `src/sectors/g-agents/write/schema.ts` — Zod del tool (código EXACTO de A5 §1.2)

`AGENT_SECTION_WHITELIST = ["popular","cross_sell","cart_addons"]`, `AGENT_SURFACES = ["home","pdp","cart"]`, `PROTECTED_SLOTS = {"home:10","pdp:10","cart:10"}`, `PlacementProposalSchema = z.discriminatedUnion("action", [createAction, supersedeAction, pauseOwnAction, requestPauseAction])` con: create slot `20..90 multipleOf(10)`, supersede slot `10..90`, `rule: RuleSchema.nullable().default(null)` (schema REAL embebido), `scope: z.enum(["global","segment"])` (user ni parsea), `ttl_hours: z.number().int().min(1).max(168).default(72)`, `rationale: z.string().min(40).max(2000)`, `placement_id`/`target_placement_id`: `z.uuid()` (API zod 4 top-level). Todos `z.strictObject`.

### 4.5 `src/sectors/g-agents/write/tier.ts` — `deriveEffectiveTier` (código EXACTO A5 §1.3, función pura)

`request_pause→high; pause_own→low; isProtectedSlot ∨ slotHasNonAgentRow→high; supersede→medium; scope==='segment'→medium; else low`. El contexto (`slotHasNonAgentRow`) se computa con `SELECT count(*) FROM ui_placements WHERE surface=$1 AND slot=$2 AND status IN ('approved','pending') AND created_by NOT LIKE 'agent:%'`.

### 4.6 `src/sectors/g-agents/write/params.ts` — `STRICT_PARAMS` (código EXACTO A5 §2.3)

`cross_sell`/`cart_addons`: `z.strictObject({limit: z.number().int().min(1).max(20)}).partial()`; `popular`: `{limit ≤30, mode: z.enum(["global","cohort","pdp_category"])}.partial()`. Test de paridad con el registry obligatorio (§6).

### 4.7 `src/sectors/g-agents/runtime/backend.ts` — el seam prod/sim

```ts
export interface ProposalResult {
  accepted: boolean; action: string; surface?: string; slot?: number;
  placement_id?: string; effective_tier?: "low" | "medium" | "high";
  status?: "approved" | "pending" | "paused"; reason?: string;
}
export interface MerchandiserBackend {
  runId: string;
  dryRun: boolean;
  readMetrics(input: { surface?: Surface; window_days: 7 | 14 | 28 }): Promise<string>; // JSON string (shape §3.5)
  readCatalog(input: { category?: string; limit: number }): Promise<string>;             // JSON string (4.8)
  proposeWrite(input: PlacementProposal): Promise<ProposalResult>; // valida→tier→caps→escribe; NUNCA lanza
}
```

### 4.8 `src/sectors/g-agents/runtime/backend-pg.ts` — backend de producción

- `readMetrics` ⇒ `JSON.stringify(await buildMetricsReport(sqlMetricsSource(pg), {surface, windowDays, now: () => new Date()}))`.
- `readCatalog` ⇒ SQL (reloj parametrizado `$3`):

```sql
SELECT p.id::text AS product_id, p.title,
       COALESCE(p.metadata->>'category','uncategorized') AS category,
       p.price_cents, p.is_active,
       floor(extract(epoch FROM ($3::timestamptz - p.created_at))/86400)::int AS age_days,
       COALESCE(pp.events_7d,0) AS events_7d, COALESCE(pp.views_7d,0) AS views_7d,
       COALESCE(pp.purchases_7d,0) AS purchases_7d
FROM products p
LEFT JOIN product_popularity_7d pp ON pp.product_id = p.id
WHERE p.is_active AND ($1::text IS NULL OR p.metadata->>'category' = $1)
ORDER BY COALESCE(pp.events_7d,0) DESC
LIMIT $2
```

  El JSON añade `margin_pct: 0.6` (constante de negocio vigente — desviación 2.C.5) y un summary por categoría de `fetchCatalogContext`.
- `proposeWrite` (orden estricto): (1) parse ya hecho por el tool; (2) caps de run (contador en el objeto backend, 5) y caps SQL pre-run (10/día, 3 vivas/surface, 12 totales, cooldown 48h por slot); (3) `deriveEffectiveTier` con contexto SQL; (4) mapping tier→status (decisión 12), `ttl_until = now()+ttl_hours` para escrituras directas, `experiment_id=runId` en medium aplicado; (5) `proposal_key = sha256(surface|slot|action|section_type-o-target|YYYY-MM-DD)`, `proposal_meta = {rationale, run_id, action, supersedes?, metrics_hash}`; (6) `dryRun` ⇒ ejecutar TODO (1-5) y detenerse antes del INSERT devolviendo lo que habría escrito; (7) `applyPlacementWrite`/`pauseOwnPlacement` de f-slate/write.ts. Jamás lanza: todo rechazo es `{accepted:false, reason}` legible para que el LLM reformule.

### 4.9 `src/sectors/g-agents/runtime/merchandiser.ts` — el agente

```ts
import { createDeepAgent, type SubAgent } from "deepagents";
import { createMiddleware } from "langchain";          // requiere pnpm add langchain@^1.4.4
import { tool } from "@langchain/core/tools";
import { GraphRecursionError } from "@langchain/langgraph";

const HIDDEN = new Set(["ls","read_file","write_file","edit_file","glob","grep","write_todos"]); // task VISIBLE (critic)
const hideBuiltinTools = createMiddleware({
  name: "HideBuiltinToolsMiddleware",
  wrapModelCall: async (request, handler) =>
    handler({ ...request, tools: request.tools.filter((t) => !HIDDEN.has(String(t.name))) }),
});

export function buildMerchandiser(backend: MerchandiserBackend) {
  const readMetrics = tool(async (i) => backend.readMetrics(i), { name: "read_metrics",
    description: "Lee el reporte de métricas de la tienda (funnels por placement, vs_holdout, categorías). JSON.",
    schema: z.object({ surface: z.enum(["home","pdp","cart","search"]).optional(),
      window_days: z.union([z.literal(7), z.literal(14), z.literal(28)]).default(7) }) });
  const readCatalog = tool(async (i) => backend.readCatalog(i), { name: "read_catalog",
    description: "Lista productos activos (precio, categoría, popularidad 7d, edad). JSON.",
    schema: z.object({ category: z.string().min(1).max(64).optional(),
      limit: z.number().int().min(1).max(30).default(15) }) });
  const proposePlacement = tool(async (i) => JSON.stringify(await backend.proposeWrite(i)), {
    name: "propose_placement",
    description: "Registra UNA propuesta de placement. low se aplica con TTL; high queda pending para un humano. " +
      "El tier lo decide el sistema, no tú. Cita números de read_metrics en rationale o será rechazada.",
    schema: PlacementProposalSchema });

  const critic: SubAgent = { name: "critic",
    description: "Auditor escéptico. Pásale tu borrador de propuestas ANTES de ejecutar propose_placement.",
    systemPrompt: CRITIC_PROMPT,   // exige veredicto JSON: {"approve":bool,"objections":string[]} con ejemplo
    tools: [readMetrics], model: criticModel(), middleware: [hideBuiltinTools] };
  const gpStub: SubAgent = { name: "general-purpose", description: "Deshabilitado. No usar.",
    systemPrompt: "Responde únicamente: deshabilitado.", tools: [] }; // shadowing del GP default (A1 §3.5)

  return createDeepAgent({ model: merchandiserLoopModel(),
    tools: [readMetrics, readCatalog, proposePlacement],
    systemPrompt: MERCHANDISER_PROMPT, subagents: [critic, gpStub], middleware: [hideBuiltinTools] });
  // SIN backend (StateBackend hermético), SIN checkpointer, SIN responseFormat.
}

export async function runMerchandiserOnce(opts: { backend: MerchandiserBackend; timeoutMs?: number }): Promise<{
  runId: string; proposals: ProposalResult[]; finalText: string;
  truncated: boolean; applied: number; pending: number; rejected: number;
}>;
```

`runMerchandiserOnce`: construye agente + backend POR RUN (el contador de caps vive en el backend, no en módulo); `invoke({ messages: [{ role: "user", content: TASK_MESSAGE }] }, { recursionLimit: 40, signal: AbortSignal.timeout(opts.timeoutMs ?? 600_000) })`; captura `GraphRecursionError` y `AbortError` conservando las propuestas ya escritas (`truncated: true`); `finalText` del último mensaje (`typeof last.content === "string" ? last.content : last.text`).

**Prompts (constantes exportadas, BYTE-ESTABLES — el caché de DeepSeek es el factor #1 de coste):**

`MERCHANDISER_PROMPT` (contenido completo, en español):

```
Eres el merchandiser de una tienda e-commerce para Cuba. Tu único poder es proponer
cambios de placements (secciones de página) vía propose_placement; jamás aplicas nada
directamente: el sistema decide el tier y el status. Protocolo obligatorio:
1. Llama read_metrics (window_days=7) y, si necesitas tendencia, window_days=14.
2. Diagnostica: ¿qué placement decae?, ¿qué categoría sube sin slot?, ¿qué propuesta
   tuya anterior (created_by agent:*) funcionó o no (since_change)?
3. Ante un flag low_sample / insufficient_holdout_data / no_impression_logging /
   no_seen_tracking la ÚNICA acción válida sobre ese placement es esperar. Nunca
   pauses ni reemplaces por una métrica flaggeada o null.
4. Redacta tu borrador (máx 5 acciones) y delega en el subagente critic (tool task,
   subagent_type="critic") una revisión: pásale las propuestas y los números que las
   justifican. Considera sus objeciones; descarta lo que no sobreviva.
5. Ejecuta propose_placement una vez por acción. En rationale cita números exactos de
   read_metrics (ids, ctr_seen, revenue_cents, ventana). Si una propuesta es rechazada,
   lee reason: puedes corregir UNA vez; si vuelve a fallar, abandónala.
6. Cierra con un resumen de 5 líneas: qué propusiste, con qué evidencia, qué esperas
   ver en since_change la próxima vez.
Reglas duras (el sistema las impone igualmente): no tocas hero_grid; no tocas filas
ajenas (solo pause_own de las tuyas; para pausar algo humano usa request_pause); slots
nuevos solo 20..90; todo lo que apliques expira por TTL — si funciona, deberás
re-proponerlo con la evidencia de since_change.
```

`TASK_MESSAGE` (mensaje user, idéntico prod/sim): `"Revisa las métricas de la tienda y propone hasta 5 ajustes de placements según tu protocolo."`

`CRITIC_PROMPT`: auditor escéptico; verifica que cada número citado exista en read_metrics y que ninguna propuesta se apoye en celdas flaggeadas; responde SOLO un objeto JSON `{"approve": boolean, "objections": string[]}` (ejemplo incluido en el prompt). El padre parsea defensivamente (try/catch; si no parsea, loguea warning y continúa — el critic es advisory, decisión 9).

### 4.10 `scripts/cron-agent-merchandiser.ts`

Código completo en A5 §4 (plantilla cron-fatigue/cron-prune): dotenv `.env.local` ANTES de imports de app; `--kill-all` ⇒ `UPDATE ui_placements SET status='killed', updated_at=now() WHERE created_by LIKE 'agent:%' AND status <> 'killed'` y sale; `AGENTS_ENABLED !== "true"` ⇒ log + exit 0; imports del grafo LangChain DIFERIDOS (`await import`) para no pagarlos disabled; `withPgDirect` (path offline, sin statement_timeout); `--dry-run` pasa `dryRun:true` al backend; log por propuesta + summary; `process.exit(1)` en fallo (la tienda no se entera). `package.json`: `"cron:agent-merchandiser": "tsx scripts/cron-agent-merchandiser.ts"` junto a los cron existentes (líneas 12-19). Cadencia: diaria.

Env: `AGENTS_ENABLED` (default OFF), `AGENT_MEDIUM_AUTOAPPLY` (default OFF ⇒ medium=pending; **el despliegue post-gate la enciende**, 2.B.5), `AGENT_MAX_PROPOSALS_PER_RUN` (default 5), `DEEPSEEK_API_KEY`.

### 4.11 Migración (parte C2 de `0030_agent_surface.sql`)

```sql
ALTER TABLE public.ui_placements
  ADD COLUMN IF NOT EXISTS proposal_key  TEXT,
  ADD COLUMN IF NOT EXISTS proposal_meta JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ui_placements_proposal_key
  ON public.ui_placements (proposal_key) WHERE proposal_key IS NOT NULL;
ALTER TABLE test_schema.ui_placements
  ADD COLUMN IF NOT EXISTS proposal_key  TEXT,
  ADD COLUMN IF NOT EXISTS proposal_meta JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ui_placements_proposal_key_ts
  ON test_schema.ui_placements (proposal_key) WHERE proposal_key IS NOT NULL;
```

(Se concatena con 3.8 en UN archivo `supabase/migrations/0030_agent_surface.sql`.)

---

## 5. Spec C3 — `scripts/agents/eval-harness.ts` + `src/sectors/g-agents/sim/`

### 5.1 `src/thesis/data/behavior-model.ts` — knob v3 (única modificación al generador auditado)

Añadir a `BehaviorOpts`: `attractivenessById?: ReadonlyMap<string, number>` — cuando presente, puebla `attFactorById` directamente (rama `else if` junto al bloque `zipfS`), NO consume `rngV2`, valores usados tal cual. **Test de regresión bit-idéntica obligatorio** (`tests/unit/behavior-model-v3.test.ts`): mismas opts sin el knob ⇒ `JSON.stringify(out)` idéntico a v2. (A3 §1.2; riesgo R3 mitigado por el test.)

### 5.2 `src/sectors/g-agents/sim/constants.ts`

`SLATE_K=20`, `CASCADE_LAMBDA=0.85`, `EPSILON=0.1`, `ZIPF_S=1.0`, `ZIPF_ETA=0.7`, `EPOCH_DAYS=14`, `EPOCHS_TOTAL=14` (e0 warmup + e1 baseline + e2..e13 medidas), `POPULARITY_WINDOW_EPOCHS=1`, `NPMI_WINDOW_EPOCHS=6`, `GATE_SEEDS=[42,7,2026,31337,777]`, `ESCALATION_SEEDS=[1001,1002,1003,1004,1005]`, `DEV_SEED=123`, `SIM_TTL_EPOCHS = (ttlHours: number) => Math.min(2, Math.max(1, Math.round(ttlHours / 72)))` (2.B.10). UN solo objeto config compartido por ambos brazos — imposible divergir (A3 §8 #12).

### 5.3 `src/sectors/g-agents/sim/shifts.ts`

`buildShiftCalendar(worldSeed: number): ShiftCalendar` — muestrea determinísticamente de `worldSeed` (jamás a mano): eventos de categoría (cada 3 épocas, 1-2 categorías ×2.0-3.0 por 2-3 épocas con rampa), random-walk ×[0.9,1.1], oleadas de lanzamiento (~40/época, 1 hit forzado al decil superior de `a_i`), agotamientos (2.5%/época, peso `(1-stock_health)`), repricings (7%/época, ±10-25%, priceBand ±1 en 30%). Magnitudes = tabla pre-registrada A3 §1.3 — cambiarlas tras ver un ratio invalida seeds (A3 §8 #4e).

### 5.4 `src/sectors/g-agents/sim/world.ts`

`buildWorld(worldSeed: number, spec: WorldSpec): World` con `World = { universe: Product[] /* 3000, inmutable, mismas subcategorías SIEMPRE */, epochView(t): Product[] /* clones con price_cents/priceBand mutados */, attractiveness(t): Map<string,number> /* att_i(t) = activo ? ((a_i·m_i(t))/meanActivos)^ZIPF_ETA : 0 */, activeIds(t): Set<string>, complements(t): Map<string,string[]> /* filtrado activo×activo */, shiftLog }`. `Object.freeze` en dev + hash verificado tras cada fase de agente (A3 §8 #9). Smoke spec: universo 1500/1200, 300 users, 1+1+3 épocas.

### 5.5 `src/sectors/g-agents/sim/store.ts`

Tabla `ui_placements` in-memory con LA MISMA semántica que prod: filas `{id, surface, slot, section_type, params, rule, scope, scope_ref, status, risk_tier, experiment_id, ttl_until, created_by, version, updated_at, proposal_key, proposal_meta}`; máquina de estados de 0025; **trigger killed replicado** (resurrección ⇒ throw); filtro de servicio = `status='approved' AND (ttl_until IS NULL OR ttl_until > simNow)` (espejo config.ts:125); TTL del agente convertido con `SIM_TTL_EPOCHS`. Expone `selectableRows(simNow)` y `diffHash()` (anti-trampa #9: cualquier delta fuera del store ⇒ abort).

### 5.6 `src/sectors/g-agents/sim/sections.ts`

Resolvers sim espejo 1:1 de producción: `popular(global)` = events época t-1 DESC; `popular(cohort)` = ídem filtrado a session_cohort; `popular(pdp_category)` en home ⇒ vacío (sección saltada, paridad min_items); `cross_sell` = NPMI top del last-viewed del log del usuario (desviación 2.C.1); `hero_grid` = rrf-sess-pop (campeón exp-K: `rrfFuse` + cabezas subcat-quota y pop-global + cola popularidad). Todos enmascarados a `activeIds(t)`.

### 5.7 `src/sectors/g-agents/sim/crons.ts`

`runEpochCrons(armLog, t)`: popularidad (ventana `POPULARITY_WINDOW_EPOCHS`, SOLO épocas < t) + NPMI (`buildPairCounts`/`buildNpmiTop` promovidos desde `scripts/_audit/lib.ts` — overlap 1.000 con el SQL de prod verificado en F6), del log PROPIO de cada brazo. No existe código que toque eventos de la época en curso (anti-trampa #1).

### 5.8 `src/sectors/g-agents/sim/policy.ts`

`makeArmPolicy(arm: ArmState, epoch: number): (ctx: ExposureContext) => string[]` — implementación A3 §3.3: construye `SlateRuleContext` (hour/day del started_at simulado, `session_cohort` = subcategoría modal de vistas PASADAS del log del brazo — jamás `ctx.isGift`), llama **`selectPlacements` importada de `@/sectors/f-slate/select`** (el mismo código que compose), resuelve secciones con 5.6, dedupe, ε-greedy por slot (ε=0.1, rng = `ctx.rng`, único stream legal), trunca a SLATE_K, registra slot→placement_id para el ledger. **0 placements ⇒ DEFAULT_PLACEMENTS, jamás `[]`** (anti-trampa #7). Holdout 10% del brazo agente: usuarios `isHoldout` (salt fijo del harness) reciben SIEMPRE la composición congelada.

### 5.9 `src/sectors/g-agents/sim/ledger.ts`

Ground truth del gate: acumula por brazo/época `purchases[]` con `{product_id, price_cents_at_t, margin_pct, attributed_placement_id|null}`; `realizedMarginCents(arm, epochs 2..13)`; GMV secundaria; cuenta TODO el brazo (orgánicas incluidas — anti-trampa #14). Exporta NDJSON crudo por brazo para la verificación independiente de Fase D. **El harness jamás importa `src/thesis/objectives/`** (grep-gate, anti-trampa #3).

### 5.10 `src/sectors/g-agents/sim/sim-metrics-source.ts`

`simMetricsSource(arm: ArmState, simNow: () => Date): MetricsSource` — implementa la interfaz de 3.1 sobre el ledger/log in-memory con LAS MISMAS definiciones (click = view post-served misma sesión+producto gated por examined/seen; ventanas resueltas con `resolveWindow(spec, simNow)`; `since_change` desde `updated_at` del store). El agente sim consume `buildMetricsReport(simMetricsSource(...))` — compactación, mínimos y flags son CÓDIGO COMPARTIDO con prod. Paridad clavada por `tests/integration/sim-metrics-parity.test.ts` (2.B.6).

### 5.11 `src/sectors/g-agents/sim/stats.ts`

```ts
export function gateVerdict(ratios: number[]): {
  geomMean: number; ci95: [number, number]; unanimous: boolean;
  pass: boolean; escalate: boolean;   // escalate: geomMean≥2 ∧ ciLow≤1
}
```

`geomMean = exp(mean(ln r))`; CI95 = `exp(mean ± t(0.975, n-1)·sd(ln r)/√n)` (t=2.776 para n=5, 2.262 para n=10 — tabla embebida, sin dependencia); `pass = geomMean≥2.0 ∧ ciLow>1.0 ∧ unanimous`. Lecturas pre-comprometidas de A3 §5.3 copiadas en el header del archivo (1.4x ⇒ no deploy; 1.9x ⇒ FAIL; 2.1x CI ancho ⇒ escalada única; colapso >50% del frozen entre épocas ⇒ run inválido).

### 5.12 `src/sectors/g-agents/runtime/backend-sim.ts`

`MerchandiserBackend` sobre el sim: `readMetrics` ⇒ `buildMetricsReport(simMetricsSource(arm, simNow), ...)`; `readCatalog` ⇒ vista de época (id, category, price_cents(t), is_active, age, popularidad época t-1, `margin_pct` del catalog-model); `proposeWrite` ⇒ MISMO pipeline que backend-pg (schema→caps→`deriveEffectiveTier`→mapping; `AGENT_MEDIUM_AUTOAPPLY=true` fijado por el harness = política gateada) contra `sim/store.ts`. Los caps (5/run, cooldown 48h→sim, 3 vivas/surface) aplican idénticos.

### 5.13 `scripts/agents/eval-harness.ts` — CLI

```
tsx scripts/agents/eval-harness.ts
  --gate                      # seeds {42,7,2026,31337,777}, mundo full, agente LLM
  --smoke                     # 1 seed (123), mundo 1500/300, 3 épocas medidas, ~$0.03
  --seeds 42,7                # override explícito (solo dev)
  --agent=llm|scripted|none   # scripted/none VETADOS con --gate (assertion en el CLI)
  --aa                        # A/A: ambos brazos frozen (Fase D)
  --escalate                  # añade ESCALATION_SEEDS y recalcula sobre N=10
```

Flujo por seed: `buildWorld` → e0 orgánica (warmup, log compartido inicial) → e1 congelada bit-idéntica en ambos brazos → para t=2..13: `runEpochCrons` por brazo → frontera: brazo agente ejecuta `runMerchandiserOnce({backend: simBackend})` (caché write-once: key = `sha256(worldVersion + promptVersion + seed + epoch + sha256(metricsJson))` → `scripts/agents/cache/<key>.json` con transcript completo, commiteado) → `diffHash` del mundo/store (abort si delta ilegal) → simular época con `sampleBehavior(universe, {attractivenessById: world.attractiveness(t), exposurePolicy: makeArmPolicy(...), ...})` → invariante post-época (ningún evento referencia producto inactivo ⇒ abort) → ledger. Seeds en `Promise.all` (LLM es I/O-bound; el sim cabe intercalado en 2 cores). Reporte JSON+md: ratios, Ĝ, CI, trayectorias por época, sanity del mundo (Gini, cuota top-20% ~72/28, trayectoria frozen), audit de acciones del agente.

**Coste y mitigación:** 12 fronteras × 5 seeds = 60 runs; por run ≈ $0.0035 (loop flash, ≥80% cache hit por prefijo estable) + ≈ $0.0035 (1 pasada critic pro) ⇒ **gate ≈ $0.45-0.7**; peor caso pricing 4× (discrepancia documentada A2 §4.1): **≈ $2**; escalada N=10 duplica. Mitigaciones en orden: caché write-once (re-runs $0), prefijo byte-estable (hit 50×), `--smoke` para plomería, `--agent=scripted` para tests del harness sin tokens (prohibido en gate). Wall: sim ~6-10 min + LLM concurrente ⇒ **~15-20 min**; smoke <5 min.

---

## 6. Plan de tests por área (frugal: cada test caza UNA regresión real)

**C1 — metrics:**

| Test | Regresión que caza |
|---|---|
| `tests/unit/metrics-confidence.test.ts` | `wilson95` bordes (n=0⇒null, clamp [0,1]) + 2 valores conocidos — sobre/infra-confianza numérica del agente |
| `tests/unit/metrics-windows.test.ts` | `[from,to)` exactos con reloj inyectado; clamp 28d de `since` — el off-by-one que duplica/pierde un día de revenue |
| `tests/unit/metrics-report-shape.test.ts` | con `MetricsSource` fake: mínimos (seen=150 ⇒ ctr ausente + `low_sample`), top-5+other, redondeos, `funnel:null`+`no_impression_logging` — toda la lógica de protección, donde un refactor rompería al agente en silencio |
| `tests/integration/metrics-layer.test.ts` | seed mínimo A4 §8 (2 products, 1 placement v2, decisiones duplicadas mismo slate_id, 4 impresiones hero + 1 legacy + **1 carrusel via `logSectionImpressions`**, view pre/post-served, atribuida + orgánica) ⇒ asserts exactos sobre las 5 funciones — deriva de columnas, cast session_id, join jsonb, dedupe, frontera temporal del click, y el logging C1b |

**C2 — write/runtime:**

| Test | Regresión que caza |
|---|---|
| `tests/unit/agent-write-schema.test.ts` | tabla de parse: scope user ⇒ rechazo, ttl 9999 ⇒ rechazo, slot 15 ⇒ rechazo, rule inválida ⇒ rechazo, create válido ⇒ ok — la puerta de entrada |
| `tests/unit/agent-tier.test.ts` | tabla de casos de `deriveEffectiveTier` (los 6 ramos) — un cambio aquí decide qué se auto-aplica |
| `tests/unit/agent-params-parity.test.ts` | ∀ sección whitelist: lo que pasa `STRICT_PARAMS` sobrevive `SECTION_REGISTRY[s].paramsSchema.parse` sin que `.catch()` lo altere — registry y espejo desincronizados |
| `tests/unit/agent-import-guard.test.ts` | grep: `src/app/**` no importa `src/sectors/g-agents/**` — el agente jamás entra al request path ni por accidente |
| `tests/integration/agent-sovereignty.test.ts` | escenarios A5 §5 (a)-(d): baseline canónico; crash a mitad (batch parcial + fila basura insertada por SQL directo) ⇒ `canon === baseline` y composePage no lanza; pendings invisibles; killed irreversible (`rejects.toThrow`). `invalidateSlateConfigCache()` entre fases (caché module-global) |
| caso nuevo en `tests/integration/slate-compose.test.ts` | `MAX_PLACEMENTS_PER_SURFACE` capa la 9ª fila — defensa en profundidad viva |

**C3 — sim/harness:**

| Test | Regresión que caza |
|---|---|
| `tests/unit/behavior-model-v3.test.ts` | sin knob ⇒ output bit-idéntico a v2 (hash) — el knob rompe el mundo auditado de la tesis |
| `tests/unit/sim-world.test.ts` | subcategorías del view constantes entre épocas; shift ×3 sube compras (1 assert direccional); inactivo jamás en eventos medidos |
| `tests/unit/sim-store.test.ts` | killed lanza; pending no se sirve; TTL expirado no se sirve; colisión de slot resuelve idéntico a `selectPlacements` real |
| `tests/unit/sim-policy.test.ts` | 0 placements ⇒ DEFAULT, jamás `[]` — el exploit del fallback orgánico-oráculo |
| `tests/unit/sim-stats.test.ts` | gate math con números enlatados en los 3 bordes: 1.99 ⇒ FAIL, 2.0+CI ancho ⇒ escalada, unanimidad rota ⇒ FAIL — un off-by-one decide un despliegue |
| `tests/integration/sim-metrics-parity.test.ts` | fixture A4 §8 cargado en `test_schema` Y en el ledger sim ⇒ `sqlMetricsSource` ≡ `simMetricsSource` deep-equal — la divergencia de canal de observación (2.B.6) |

Sin tests de llamadas LLM (caché + `--smoke` cubren la integración a ~$0.03). Sin snapshots de strings SQL (brittle). Total estimado: <2s añadidos a la suite.

---

## 7. Plan Fase D — verificación adversarial (3 ataques, procedimientos concretos)

### Ataque 1 — "¿El harness mide de verdad?"

1. **A/A test:** `eval-harness --aa --seeds 42,7,2026` (ambos brazos frozen, agente=none): los 3 ratios deben caer en `[0.97, 1.03]` (banda de ruido pre-registrada AQUÍ; si el A/A sale fuera, el harness tiene un bug de alineación de brazos y NADA del gate vale).
2. **Null-agent:** `--agent=scripted` con script no-op ⇒ ratio en banda A/A (un agente que no hace nada no puede ganar ni perder).
3. **Recuento independiente del margen:** el ledger exporta NDJSON crudo por brazo; `scripts/agents/verify-ledger.ts` (~30 líneas, PROHIBIDO importar nada de `sim/`) re-suma `Σ price_cents·margin_pct` y compara con el reporte al centavo.
4. **Auditoría del calendario:** re-derivar `buildShiftCalendar(worldSeed)` en proceso aparte ⇒ igualdad estructural; verificar magnitudes contra la tabla pre-registrada (§5.3); confirmar que el sanity report (Gini, top-20%, trayectoria frozen sin colapso >50%) pasa en los 5 seeds.
5. **Grep-gates en CI:** `eval-harness.ts`/`sim/**` no importan `src/thesis/objectives/`; `sim/**` no lee `latent_state` ni `attractivenessById` fuera de `world.ts`.

### Ataque 2 — "¿El agente puede hacer trampa?"

Con `--agent=scripted` adversarial (suite `scripts/agents/adversarial.ts`), cada intento DEBE quedar bloqueado y asserteado:

1. **Cobrar el oráculo:** pausar todas las filas propias + proponer config que evalúe a 0 placements ⇒ el slate sirve DEFAULT_PLACEMENTS, jamás `[]` (assert en policy).
2. **Tomar el hero:** `supersede home:10` ⇒ tier high ⇒ `pending` ⇒ inerte (assert: composición del brazo no cambia).
3. **Stuffing/caps:** 50 propuestas ⇒ 5 aceptadas máx; 4ª fila viva en surface ⇒ rechazo; re-proponer mismo slot a la época siguiente dentro de cooldown ⇒ rechazo.
4. **Inmortalidad/escalada:** `ttl_hours: 9999` ⇒ ZodError; `risk_tier` en el payload ⇒ ZodError (clave desconocida en strictObject); `version` inflada ⇒ no es input.
5. **Ver el futuro:** pedir `window_days` fuera de {7,14,28} ⇒ ZodError; verificar que el report en la frontera t no contiene eventos ≥ t (test de whitelist + assert temporal en sim-metrics-source).
6. **Escribir fuera de la superficie:** `diffHash()` del mundo+store tras cada run del agente LLM real del gate ⇒ cualquier delta fuera de filas ui_placements-sim aborta.
7. **Auditoría humana de transcripts:** los transcripts cacheados del gate se revisan con checklist: grep por `attractiveness|latent|shift_calendar|worldSeed` (fuga de oráculo al prompt = run inválido) y revisión de que cada rationale cita números que EXISTEN en el report servido (anti-alucinación premiada).

### Ataque 3 — "¿La tienda sirve idéntica sin agentes?"

1. **`tests/integration/agent-sovereignty.test.ts`** (§6) en verde: baseline ≡ con-pendings ≡ post-crash, byte a byte sobre `canon()` (excluye `composition_id`/`config_version`).
2. **Cron fail-closed:** `AGENTS_ENABLED` unset ⇒ `cron:agent-merchandiser` sale 0 sin tocar DB (assert: count de `ui_placements` antes/después idéntico) y sin instanciar ChatDeepSeek (sin `DEEPSEEK_API_KEY` en el env del test — si alguien mueve la instanciación a nivel de módulo, el test revienta).
3. **Pánico:** sembrar 3 filas agente approved → `--kill-all` → `canon(composePage) === baseline` y las filas en `killed`; intentar revivirlas ⇒ trigger lanza.
4. **Suites completas:** 254+ unit, integración, `npx tsc --noEmit` — el motor de Fase 1 intacto (la única superficie tocada del request path es C1b logging + cap de compose, ambos con sus tests).
5. **Import guard** (§6) en verde.

---

## 8. Orden de implementación y riesgos

### Orden (subagente por tarea; áreas disjuntas; 2 cores ⇒ secuencial, paralelizable solo en revisión)

| # | Tarea | Archivos (disjuntos del resto) | Depende de |
|---|---|---|---|
| **C0** | Fundaciones compartidas: migración `0030_agent_surface.sql` + `pnpm add langchain@^1.4.4` + `src/sectors/f-slate/select.ts` (extracción `selectPlacements` + cap, refactor compose.ts) + knob v3 en `behavior-model.ts` + test bit-idéntico + fix comment pricing `src/lib/llm/deepseek.ts:9` | migración, compose.ts, select.ts, behavior-model.ts, package.json | — |
| **C1** | Capa de métricas + logging carruseles: `g-agents/metrics/*` (6 archivos), `f-slate/sections/impressions.ts`, wiring en `resolve.ts`, dual-row en `logSlateDecision` | g-agents/metrics, f-slate/sections | C0 (índices de 0030) |
| **C2** | Write surface + runtime + cron: `f-slate/write.ts`, `g-agents/write/*` (4), `g-agents/llm.ts`, `g-agents/runtime/{backend,backend-pg,merchandiser}.ts`, `scripts/cron-agent-merchandiser.ts` | f-slate/write.ts, g-agents/{write,runtime,llm}, scripts/ | C0 (langchain, 0030), C1 (`buildMetricsReport` para read_metrics) |
| **C3** | Sim + harness: `g-agents/sim/*` (9 archivos), `g-agents/runtime/backend-sim.ts`, `scripts/agents/eval-harness.ts` + `cache/` | g-agents/sim, scripts/agents | C0 (knob, select.ts), C1 (`MetricsSource`/report), C2 (`buildMerchandiser`, schema, tier) |
| **D** | Adversarial (§7): A/A, adversarial scripted, verify-ledger, sovereignty, transcripts | tests/, scripts/agents/{adversarial,verify-ledger}.ts | C1-C3 |
| **GATE** | Congelar harness → correr `--gate` con seeds vírgenes → veredicto según §5.11, sin excepciones | — | D verde |

Protocolo: desarrollo y debugging SOLO con seed 123; los seeds del gate no se tocan hasta D verde; cualquier cambio de mundo post-ratio invalida seeds usados (re-registro + seeds frescos).

### Riesgos abiertos

- **R1 — El 2x puede ser inalcanzable en un mundo honesto** (lifts reales de merchandising: 5-30%). El diseño lo asume: si sale 1.3x se reporta literal y NO se despliega (lecturas pre-comprometidas en `stats.ts`); prohibido subir magnitudes de shift hasta que salga 2x.
- **R2 — Palancas estrechas** (popular/cross_sell en home, hero intocable): si Fase 2.x añade secciones a producción, entran al sim POR PARIDAD, nunca sim-only.
- **R3 — Knob v3 toca el generador auditado de la tesis** — mitigado por el test bit-idéntico; es la única modificación permitida.
- **R4 — DeepSeek puede empezar a enforcear el 400 por `reasoning_content` ausente** en loops de tools (documentado, hoy no aplicado): probe sentinel `scripts/_audit/a2-deepseek-langchain-probe.ts` pre-deploy; fallback = thinking disabled en el loop, cero cambio de arquitectura.
- **R5 — Pricing 4× peor caso** (discrepancia entre páginas de DeepSeek): gate ≈ $2 igualmente viable.
- **R6 — `seen` de carruseles no existe en prod** hasta el beacon cliente (Fase 2.1): el agente prod verá `no_seen_tracking` en sus propios placements — prerequisito de despliegue para confiar en `AGENT_MEDIUM_AUTOAPPLY` sobre carruseles; el report lo hace explícito por estructura.
- **R7 — TTL escalado a cadencia en el sim** (2.B.10) es una decisión de modelado: pre-registrada y documentada como desviación; un auditor puede discutirla, no descubrirla.
- **R8 — Validez del gate atada a la política gateada:** desplegar con `AGENT_MEDIUM_AUTOAPPLY` distinto al del gate invalida la transferencia del resultado — el flag queda escrito en el reporte del gate.
