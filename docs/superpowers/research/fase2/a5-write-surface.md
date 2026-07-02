# A5 — Superficie de escritura del agente (`propose_placement`) y garantías de soberanía del motor

**Fecha:** 2026-06-11 · **Fuentes verificadas línea a línea:** `supabase/migrations/0025_ui_slate.sql`, `0026_ui_slate_seed.sql`, `src/sectors/f-slate/{compose.ts,config.ts}`, `src/sectors/f-slate/rules/{schema.ts,types.ts,evaluate.ts}`, `src/sectors/f-slate/sections/registry.ts`, `src/lib/auth/index.ts`, `src/lib/db/helpers.ts`, `scripts/cron-fatigue.ts`, `scripts/cron-prune.ts`, `tests/integration/slate-compose.test.ts`, `tests/helpers/db.ts`, `node_modules/@langchain/core/dist/tools/index.d.ts`, `node_modules/deepagents/dist/index.d.ts`, `node_modules/zod/v4/classic/schemas.d.cts`.
**Alineado con:** A1 (sketch del tool, §a1 líneas 327-345), A3 (§6.1 `buildMerchandiser(backend)`), A4 (capa de métricas read-only).

---

## 0. El mundo tal como ES (verificado, no asumido)

### 0.1 `ui_placements` — DDL exacto (0025:37-59)

| columna | tipo | constraint | relevancia para el agente |
|---|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` | devuelto al agente en el ToolMessage |
| `surface` | text | `CHECK IN ('home','pdp','cart','search')` | input del tool |
| `slot` | smallint | sin unique — colisiones SON el mecanismo | gaps de 10 *por diseño* ("so agents can insert between slots", 0025:40) |
| `section_type` | text | FK → `ui_sections` | whitelist del agente ⊂ catálogo |
| `params` | jsonb | default `{}` | validación estricta write-time (§2.3) |
| `rule` | jsonb | nullable (= siempre) | `RuleSchema` Zod (§2.2) |
| `scope` | text | `CHECK IN ('global','segment','user')` | agente: **solo global/segment** (§2.4) |
| `scope_ref` | text | `CHECK (scope='global' OR scope_ref IS NOT NULL)` | |
| `status` | text | `CHECK IN ('pending','approved','paused','archived','killed')` (0025:49-50) | **NO existe `'proposed'`** — corrige el sketch de A1, que decía `status='proposed'`. La propuesta del agente es `'pending'`, que ya existe: **cero migración de status** |
| `risk_tier` | text | `CHECK IN ('low','medium','high')` default `'low'` | el backend lo COMPUTA, no lo confía del LLM (§1.3) |
| `experiment_id` | text | nullable | el backend lo setea = run id en tier medium |
| `ttl_until` | timestamptz | nullable | **mecanismo de rollback ya existente**: el loader filtra `(ttl_until IS NULL OR ttl_until > now())` (config.ts:125) |
| `created_by` | text | NOT NULL default `'seed'` | **la autoría ya existe**: `'agent:merchandiser/v1'` — cero migración |
| `version` | int | default 1 | desempate de colisión: mismo scope ⇒ gana version DESC (compose.ts:101) — computado por el backend, jamás por el LLM |

Trigger `ui_placements_killed_is_final` (0025:71-84): `killed → cualquier-otro` lanza excepción. **Irreversible a nivel de datos**, replicado en `test_schema` (0025:94-97). Esta es la garantía dura nº1: ningún prompt resucita un placement matado.

### 0.2 Lo que el request path LEE (las 4 redes de soberanía ya construidas)

1. **Filtro SQL** (config.ts:117-126): `WHERE status='approved' AND scope IN ('global','segment') AND (ttl_until IS NULL OR ttl_until > now())`. Una fila `pending`/`paused`/`archived`/`killed` es **invisible por construcción** — no por convención.
2. **Filtro de carga** (config.ts:130-133): regla jsonb inválida ⇒ fila descartada con `warn`, jamás un throw en request. Segunda red explícitamente diseñada "for Fase-2 agents" (config.ts:13).
3. **Evaluación fail-closed** (evaluate.ts:16-24): campo desconocido, tipo errado, exceso de profundidad/nodos ⇒ condición `false` ⇒ la sección NO se muestra. `not(basura)` también es `false` (evaluate.ts:44-49).
4. **Caché 60s → stale → `DEFAULT_PLACEMENTS`** (config.ts:141-165) + breaker `dbHealth()` (compose.ts:86-88): DB caída o tabla corrupta ⇒ la página sirve la réplica del seed 0026. La home **no puede quedar en blanco** por nada que se escriba en `ui_placements`.

### 0.3 Endpoints admin que escriben `ui_placements` hoy: **NINGUNO**

`grep -rln "ui_placements" src/` ⇒ solo `f-slate/{config,rules/schema,rules/types,sections/registry}.ts`. El único endpoint con `requireAdmin` es `src/app/api/admin/searches/route.ts` (lectura). Los únicos escritores históricos son la migración seed (`created_by='seed'`) y los tests (`created_by='test'`).

**Consecuencia de diseño:** "el agente pasa por la MISMA validación que el admin" no significa reusar un endpoint (no existe) — significa **crear ahora el módulo compartido de escritura** (`src/sectors/f-slate/write.ts`, §2.1) y que tanto el tool del agente como el futuro endpoint admin (`/api/admin/placements`, Fase D o posterior) lo importen. Una sola máquina de estados, una sola validación, dos llamadores.

### 0.4 APIs instaladas que el tool usará (de los .d.ts, no de memoria)

- `tool(func, fields)` — `@langchain/core/dist/tools/index.d.ts:219` (overload `ZodObjectV4`) y `:225` (overload con `ToolRuntime`): **acepta schemas Zod v4 nativos** (el proyecto usa zod 4.4.3). Retorna `DynamicStructuredTool`. El output del func es string (o se serializa) → el LLM lee el resultado: devolver SIEMPRE un JSON string con `{accepted, reason?...}`, nunca lanzar (un throw rompe el loop del agente; un rechazo legible permite auto-corrección).
- `createDeepAgent(params)` — `deepagents/dist/index.d.ts:3200`; `tools?: StructuredTool[]` (subagentes en `:1973`); `interruptOn` (`:1978`) existe como alternativa HITL para high-tier, pero requiere checkpointer — **no lo usamos**: la pausa de high-tier vive en la fila (`status='pending'`), no en el grafo. Más simple, sobrevive a crashes, auditable en SQL.
- `z.uuid()` — `zod/v4/classic/schemas.d.cts:189` (API top-level de zod 4; no `z.string().uuid()`).
- `withPgDirect(fn, opts)` — `src/lib/db/helpers.ts:51-62`: scope default `'public'` (o `'test'` bajo VITEST), cliente directo **sin** el `statement_timeout` de 2.5s del pool request-path (hallazgo A4 §0.3.5). El cron usa esto: path offline garantizado.

---

## 1. API exacta de `propose_placement`

### 1.1 Nombre canónico y reconciliación A1/A3

A1 lo llama `propose_placement`; A3 §6.1 lo llama `propose_placement_write`. **Canónico: `propose_placement`** (el nombre ya describe el efecto; el sufijo `_write` no añade información y A1 §verificó que no colisiona con los builtin de deepagents). C2 debe ajustar el snippet de A3.

### 1.2 Schema de entrada (Zod v4, código exacto)

```ts
// src/sectors/g-agents/write/schema.ts
import { z } from "zod";
import { RuleSchema } from "@/sectors/f-slate/rules/schema";

/** Secciones que el agente puede colocar. hero_grid EXCLUIDO: no está en
 *  SECTION_REGISTRY (caso especial del runner) y es el feed principal
 *  (priority 0, "never sacrificed" — 0025:26). */
export const AGENT_SECTION_WHITELIST = ["popular", "cross_sell", "cart_addons"] as const;
export const AGENT_SURFACES = ["home", "pdp", "cart"] as const; // search: sin placements aún

/** Slots seed (0026): (home,10) hero, (pdp,10) cross_sell, (cart,10) cart_addons.
 *  El agente NUNCA aplica directo sobre un slot ocupado por una fila no-agente. */
export const PROTECTED_SLOTS: ReadonlySet<string> = new Set(["home:10", "pdp:10", "cart:10"]);

const createAction = z.strictObject({
  action: z.literal("create"),
  surface: z.enum(AGENT_SURFACES),
  slot: z.number().int().min(20).max(90).multipleOf(10), // entre los gaps; slot 10 = seed, fuera
  section_type: z.enum(AGENT_SECTION_WHITELIST),
  params: z.record(z.string(), z.unknown()).default({}),  // validación fina en §2.3
  rule: RuleSchema.nullable().default(null),
  scope: z.enum(["global", "segment"]),                   // 'user' PROHIBIDO (§2.4)
  scope_ref: z.string().min(1).max(64).nullable().default(null),
  ttl_hours: z.number().int().min(1).max(168).default(72), // rollback obligatorio ≤7d
  rationale: z.string().min(40).max(2000),                 // evidencia citando read_metrics
});

const supersedeAction = createAction.omit({ action: true, slot: true }).extend({
  action: z.literal("supersede"),
  // puede apuntar a CUALQUIER slot (incl. protegidos) — pero el tier computado
  // sobre slot ocupado por fila no-agente fuerza 'pending' (§1.3)
  slot: z.number().int().min(10).max(90).multipleOf(10),
});

const pauseOwnAction = z.strictObject({
  action: z.literal("pause_own"),
  placement_id: z.uuid(),          // z.uuid(): zod/v4/classic/schemas.d.cts:189
  rationale: z.string().min(40).max(2000),
});

const requestPauseAction = z.strictObject({
  action: z.literal("request_pause"), // pausar fila humana/seed: SIEMPRE pending
  target_placement_id: z.uuid(),
  rationale: z.string().min(40).max(2000),
});

export const PlacementProposalSchema = z.discriminatedUnion("action", [
  createAction, supersedeAction, pauseOwnAction, requestPauseAction,
]);
export type PlacementProposal = z.infer<typeof PlacementProposalSchema>;
```

Notas:
- **El LLM no declara `risk_tier`**: lo computa el backend (§1.3). Un agente desalineado no puede auto-rebajarse el tier. (A1 lo pedía como input — corregido.)
- `ttl_hours` obligatorio con default: **toda escritura directa del agente expira sola**. El rollback no depende de que el agente "se acuerde" — es el loader quien deja de servirla (config.ts:125).
- `rationale` mínimo 40 chars: va a `proposal_meta` (auditoría), nunca a columnas que composePage lea.

### 1.3 Tier computado y mapping tier → acción de DB

```ts
// src/sectors/g-agents/write/tier.ts — función PURA (test unit barato)
export type EffectiveTier = "low" | "medium" | "high";

export function deriveEffectiveTier(p: PlacementProposal, ctx: {
  /** filas approved/pending en (surface,slot) con created_by NOT LIKE 'agent:%' */
  slotHasNonAgentRow: boolean;
  isProtectedSlot: boolean;
}): EffectiveTier {
  if (p.action === "request_pause") return "high";          // tocar lo humano = humano decide
  if (p.action === "pause_own") return "low";               // retirar lo propio = siempre seguro
  if (ctx.isProtectedSlot || ctx.slotHasNonAgentRow) return "high"; // ocupar/superseder seed o humano
  if (p.action === "supersede") return "medium";            // reemplaza una fila agente viva
  if (p.scope === "segment") return "medium";               // segmentado = blast radius menor pero menos observado
  return "low";                                             // create en slot libre, global, con TTL
}
```

| tier | acción en DB | vive en request path | rollback |
|---|---|---|---|
| **low** | `INSERT ... status='approved', ttl_until=now()+ttl_hours` | sí, ≤60s después (TTL caché config.ts:47) | automático al expirar TTL; o `pause_own` |
| **medium** | si `AGENT_MEDIUM_AUTOAPPLY==='true'`: como low pero además `experiment_id=run_id` (medible en `slate_decisions.experiment_id`, compose.ts:141). Default (env ausente): `status='pending'` | solo con env explícito | TTL + experiment para comparar |
| **high** | **SIEMPRE `status='pending'`. Sin excepción, sin env que lo salte.** Humano aprueba vía futuro endpoint admin (mismo módulo write.ts) flipping a `'approved'` | **jamás directo** | n/a (nunca sirvió) |

El humano que aprueba un high `supersede` sobre `(home,10)` activa el mecanismo de colisión existente: scope global, `version` = MAX(version del slot)+1 ⇒ gana por version DESC (compose.ts:98-104). **Así evoluciona la home: propuesta del agente + click humano, cero deploy.**

### 1.4 Columnas que el agente escribe (INSERT) — y las que jamás

INSERT (`create`/`supersede`): `surface, slot, section_type, params, rule, scope, scope_ref, status, risk_tier (=effectiveTier), experiment_id, ttl_until, created_by, version (computado: COALESCE(MAX(version) FILTER (mismo surface+slot+scope),0)+1), proposal_key, proposal_meta`.

UPDATE (`pause_own`): solo `status='paused', updated_at=now()` con guardia dura en el WHERE:

```sql
UPDATE ui_placements SET status='paused', updated_at=now()
WHERE id=$1 AND created_by LIKE 'agent:%' AND status IN ('approved','pending')
-- 0 filas afectadas ⇒ rechazo legible al LLM, no error
```

**Jamás:** `ui_sections` (budgets/min_items/priority/params_schema son contrato humano del runner de claims), `status='killed'` (verbo humano/guardrail), `status='archived'→'approved'` (no hay resurrección: nueva propuesta con lineage en `proposal_meta.supersedes`), DELETE de nada, filas con `created_by NOT LIKE 'agent:%'`.

### 1.5 Migración mínima (0030) — solo auditoría + idempotencia

`created_by` ya existe (autoría: cero ALTER). Falta dónde guardar rationale/run/evidencia y una llave de idempotencia:

```sql
-- 0030_agent_write_surface.sql
-- proposal_meta: SOLO auditoría (rationale, run_id, metrics snapshot hash,
-- supersedes). composePage NUNCA lo lee — cumple la regla column-vs-jsonb de 0025.
ALTER TABLE public.ui_placements
  ADD COLUMN IF NOT EXISTS proposal_key  TEXT,
  ADD COLUMN IF NOT EXISTS proposal_meta JSONB;

-- Idempotencia: re-run del cron el mismo día no duplica la misma acción.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ui_placements_proposal_key
  ON public.ui_placements (proposal_key) WHERE proposal_key IS NOT NULL;

ALTER TABLE test_schema.ui_placements
  ADD COLUMN IF NOT EXISTS proposal_key  TEXT,
  ADD COLUMN IF NOT EXISTS proposal_meta JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ui_placements_proposal_key_ts
  ON test_schema.ui_placements (proposal_key) WHERE proposal_key IS NOT NULL;
```

`proposal_key = sha256("${surface}|${slot}|${action}|${section_type ?? target_placement_id}|${YYYY-MM-DD}")` + `ON CONFLICT (proposal_key) DO NOTHING` (índice parcial: las filas seed/test/humanas con key NULL no participan). Crash a mitad de run + re-run ⇒ exactamente-una-vez por acción/día.

### 1.6 El tool cableado (firma verificada)

```ts
// src/sectors/g-agents/write/tool.ts
import { tool } from "@langchain/core/tools";        // overload ZodObjectV4: index.d.ts:219
import { PlacementProposalSchema } from "./schema";
import type { MerchandiserBackend } from "../runtime/backend"; // A3 §6.1: pg | sim

export function makeProposePlacement(backend: MerchandiserBackend) {
  return tool(
    async (input) => {
      // backend.proposeWrite: valida (§2), computa tier (§1.3), aplica caps (§3),
      // escribe en transacción corta. NUNCA lanza: rechazo => JSON legible.
      const r = await backend.proposeWrite(input);
      return JSON.stringify(r); // {accepted, placement_id?, effective_tier?, status?, reason?}
    },
    {
      name: "propose_placement",
      description:
        "Registra UNA propuesta de cambio de placement. low se aplica con TTL; " +
        "high queda pending para un humano. El tier lo decide el sistema, no tú. " +
        "Cita números de read_metrics en rationale o será rechazada.",
      schema: PlacementProposalSchema,
    },
  );
}
```

---

## 2. Validación write-time

### 2.1 Módulo compartido (la "MISMA validación" del enunciado)

```
src/sectors/f-slate/write.ts          ← validatePlacementWrite + applyPlacementWrite
        ▲                       ▲
agent tool (g-agents/write)   futuro /api/admin/placements (requireAdmin, lib/auth/index.ts:57)
```

El módulo vive en **f-slate** (dueño del contrato), no en g-agents: el agente es un llamador más. El endpoint admin, cuando exista, añade `requireAdmin` y NO los caps del agente (un humano puede tocar slots protegidos); el agente añade whitelists+caps encima.

### 2.2 Regla: reusar el schema EXACTO

```ts
import { RuleSchema, isValidRule } from "@/sectors/f-slate/rules/schema";
```

`RuleSchema` (rules/schema.ts:52) ya acota: campos = los 12 de `SlateRuleContext`, ops fijos, `MAX_RULE_DEPTH=5`, ramas `all/any` ≤8, `MAX_IN_LIST=50`, `.strict()` en cada nodo. Está embebido en `PlacementProposalSchema` (§1.2), así que el rechazo ocurre en el parse del tool — el LLM recibe el ZodError y puede reformular. **Gotcha conocido:** `MAX_RULE_NODES=32` solo se aplica en evaluación (evaluate.ts:33), no en el schema — una regla de 5 niveles×8 ramas pasa el write pero evalúa `false` fail-closed. Aceptable (fila inerte, no peligrosa); opcional para C2: contador de nodos en `validatePlacementWrite`.

### 2.3 Params: el registry NO sirve como validador estricto — gotcha real

Los `paramsSchema` del registry usan `.catch(def)` (registry.ts:15-16, 62-65): son **resilientes**, no estrictos — `{limit: 99999}` no falla, *se convierte* en el default. Correcto en runtime (una config rota no tumba la página), inútil en write-time (aceptaría cualquier basura silenciosamente). Validación estricta del agente:

```ts
// src/sectors/g-agents/write/params.ts — espejo ESTRICTO de los bounds del registry
const STRICT_PARAMS: Record<(typeof AGENT_SECTION_WHITELIST)[number], z.ZodType> = {
  cross_sell:  z.strictObject({ limit: z.number().int().min(1).max(20) }).partial(),
  cart_addons: z.strictObject({ limit: z.number().int().min(1).max(20) }).partial(),
  popular:     z.strictObject({
    limit: z.number().int().min(1).max(30),
    mode: z.enum(["global", "cohort", "pdp_category"]),
  }).partial(),
};
```

Test unit de paridad (frugal, caza la regresión real): para cada sección de la whitelist, todo objeto que pase `STRICT_PARAMS` debe sobrevivir `SECTION_REGISTRY[s].paramsSchema.parse` **sin que el catch lo altere** (`deepEqual(parse(x), {...defaults, ...x})`). Si C-alguien sube el max del registry y olvida el espejo, el test truena.

(`ui_sections.params_schema` jsonb existe como copia JSON-Schema para admin UIs (0025:20-22), pero validarlo requeriría `ajv` — dependencia nueva para duplicar lo que Zod ya hace. No.)

### 2.4 Scope: `user` PROHIBIDO al agente

Tres razones estructurales: (1) el hot path solo carga `global+segment` (config.ts:124) — filas user son lookups per-request por diseño (0025:61-66): un agente podría crear cardinalidad por-usuario ilimitada fuera del cap de churn; (2) targeting individual escrito por un LLM = inauditable (¿por qué ESTE usuario?); (3) el thesis gate mide políticas de página, no de persona. Enforcement: `z.enum(["global","segment"])` en el schema (§1.2) — el valor `'user'` ni parsea.

`scope='segment'` exige `scope_ref` ∈ whitelist de cohortes conocidas (`CohortId` de `@/sectors/d-personalization/cohorts/definitions` — único vocabulario de segmento vivo hoy; `user_segment` del rule context es seam null, compose.ts:74). `scope_ref` fuera de la lista ⇒ rechazo legible.

---

## 3. Límites de seguridad

| límite | valor | enforcement |
|---|---|---|
| Propuestas por run | `AGENT_MAX_PROPOSALS_PER_RUN` (default **5**) | contador en el closure del backend; el tool devuelve `{accepted:false, reason:"run cap reached"}` |
| Escrituras por día | 10 | `SELECT count(*) FROM ui_placements WHERE created_by LIKE 'agent:%' AND created_at > now()-interval '24 hours'` pre-run; ≥cap ⇒ el run arranca en modo solo-lectura |
| Filas agente VIVAS por surface | 3 (`approved` no expiradas) | check pre-insert en `proposeWrite` — anti page-stuffing |
| Filas agente vivas totales | 12 | ídem — anti acumulación lenta |
| Cooldown por (surface,slot) | 48h | `max(updated_at)` de filas agente del slot; dentro de ventana ⇒ rechazo — mata la oscilación write/pause/write |
| Idempotencia | `proposal_key` único parcial (§1.5) | `ON CONFLICT DO NOTHING` ⇒ `{accepted:false, reason:"duplicate today"}` |
| TTL máximo | 168h en el schema | toda fila auto-aplicada muere sola |

**Kill switches (3 capas):**
1. `AGENTS_ENABLED !== "true"` ⇒ el cron sale con código 0 y log `disabled` — **default OFF, fail-closed** (mismo patrón fail-closed que la allowlist de admins, auth/index.ts:52).
2. `killed` irreversible por trigger (0025:71-84): el guardrail humano mata una fila y ningún run futuro la revive.
3. Pánico: `npm run cron:agent-merchandiser -- --kill-all` ⇒ `UPDATE ui_placements SET status='killed' WHERE created_by LIKE 'agent:%' AND status <> 'killed'` + `invalidateSlateConfigCache()` es irrelevante (serverless): a los ≤60s ninguna instancia las sirve.

**Qué filas puede MODIFICAR — política:** solo las suyas (`created_by LIKE 'agent:%'`), solo `approved|pending → paused`. Pausar una fila humana/seed **nunca directo**: verbo `request_pause` ⇒ fila `pending` con `proposal_meta = {action:'pause_target', target_placement_id, rationale}`; el endpoint humano de aprobación ejecuta la pausa. Honestidad sobre el límite: la guardia `created_by LIKE 'agent:%'` es **app-level** — a nivel de DB ambos actores son la misma conexión Postgres, un trigger no puede distinguirlos. La defensa de DB real es la combinación status-machine + trigger killed + el filtro `status='approved'` del loader.

**Defensa en profundidad recomendada para C2 (1 línea en compose):** cap de placements por página tras resolver colisiones — `placements.slice(0, MAX_PLACEMENTS_PER_SURFACE /* 8 */)` en compose.ts:106. Protege contra CUALQUIER escritor futuro, no solo el agente.

---

## 4. Cron entrypoint — `scripts/cron-agent-merchandiser.ts`

Plantilla = cron-fatigue.ts/cron-prune.ts (dotenv `.env.local` ANTES de imports de app, `withPgDirect`, log con prefijo, `process.exit(1)` en fallo):

```ts
#!/usr/bin/env tsx
/**
 * Cron: merchandiser agent (Fase 2) — lee métricas (A4), propone placements
 * (A5). OFFLINE por construcción: withPgDirect, jamás el pool del request
 * path. Si este proceso muere, la tienda sirve idéntica (caché→defaults).
 *
 * Flags: --dry-run  valida y loggea propuestas SIN escribir
 *        --kill-all mata toda fila agente (pánico) y sale
 * Env:   AGENTS_ENABLED=true            (default: OFF — el cron no corre)
 *        AGENT_MEDIUM_AUTOAPPLY=true    (default: medium ⇒ pending)
 *        AGENT_MAX_PROPOSALS_PER_RUN=5
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { withPgDirect } from "@/lib/db/helpers";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (process.argv.includes("--kill-all")) {
    const n = await withPgDirect((pg) =>
      pg.query(`UPDATE ui_placements SET status='killed', updated_at=now()
                WHERE created_by LIKE 'agent:%' AND status <> 'killed'`),
    );
    console.log(`[cron-agent] KILLED ${n.rowCount} agent rows`);
    return;
  }

  if (process.env.AGENTS_ENABLED !== "true") {
    console.log("[cron-agent] AGENTS_ENABLED!=true — disabled, exiting 0");
    return; // fail-closed: sin opt-in explícito no hay agente
  }

  // imports diferidos: no pagar el grafo LangChain cuando está disabled
  const { runMerchandiserOnce } = await import("@/sectors/g-agents/runtime/merchandiser");

  const out = await withPgDirect(async (pg) => runMerchandiserOnce({ pg, dryRun }));
  for (const p of out.proposals) {
    console.log(`[cron-agent] ${dryRun ? "DRY " : ""}${p.accepted ? "ok " : "REJ"} ` +
      `${p.action} ${p.surface ?? ""}:${p.slot ?? ""} tier=${p.effective_tier ?? "-"} ` +
      `status=${p.status ?? "-"} ${p.reason ?? ""}`);
  }
  console.log(`[cron-agent] run=${out.runId} proposals=${out.proposals.length} ` +
    `applied=${out.applied} pending=${out.pending} rejected=${out.rejected} dry=${dryRun}`);
}

main().catch((e) => {
  console.error("[cron-agent] failed:", e);
  process.exit(1); // la tienda no se entera: nada del request path depende de este proceso
});
```

`package.json`: `"cron:agent-merchandiser": "tsx scripts/cron-agent-merchandiser.ts"` (junto a las líneas 12-19 existentes). `--dry-run` se implementa en el **backend pg** (`proposeWrite` corre TODA la validación+tier+caps y se detiene antes del INSERT, devolviendo lo que habría escrito) — así el dry-run ejercita el código real, no una rama paralela. Frecuencia sugerida: diaria (las ventanas de métricas de A4 son 7-28d; más frecuente = churn sin señal nueva). Coste LLM por run: centavos (A3 §6.2).

---

## 5. Prueba de soberanía (Fase D) — diseño

**Integración, no unit-con-mocks.** La garantía cruza tres capas que un mock taparía: el `WHERE status='approved'` del SQL real (config.ts:123), el trigger `killed` de Postgres, y el caché module-global. Un unit que mockee `getSurfaceConfig` demostraría que el mock filtra — tautología. El repo ya tiene el patrón exacto: `tests/integration/slate-compose.test.ts` (withTestDb + truncate + `invalidateSlateConfigCache()` en `beforeEach` — **gotcha crítico: el caché es estado de módulo (config.ts:54); sin invalidar entre fases, las fases se contaminan**).

```
tests/integration/agent-sovereignty.test.ts
```

Canonicalización para comparar byte-a-byte: `const canon = (page: ComposedPage) => JSON.stringify(page.placements.map(({placement_id, slot, section_type, params, version}) => ({placement_id, slot, section_type, params, version})))` — se excluye `composition_id` (randomUUID por request, compose.ts:109) y `config_version` (bumps por refresh de caché, config.ts:152).

| escenario | setup | aserción |
|---|---|---|
| **(a) cero filas agente** | seed mínimo (secciones + placements `created_by='test'` ≡ 0026) | `canon(baseline)` capturado; es la referencia de (b)/(c) |
| **(b) agente muerto a mitad de escritura** | simular el crash en sus DOS modos: (b1) batch parcial — escribir vía `applyPlacementWrite` 1 de 3 propuestas (transacción corta POR propuesta ⇒ no existe fila rota, solo run incompleto) con la escrita en `pending`; (b2) basura post-validación — `INSERT` directo SQL de una fila `approved` con `rule` jsonb inválido (`{"field":"hacked","op":"eq"}`), saltándose la validación a propósito | (b1): `canon(after) === canon(baseline)`. (b2): la red 2 actúa — fila descartada al load con warn (config.ts:130-133), `canon === baseline`, y `composePage` **no lanza** |
| **(c) propuestas pending sin aprobar** | 3 propuestas high reales por `proposeWrite` (terminan `pending`) + 1 `request_pause` del hero | `canon === baseline`; verificación negativa: `SELECT count(*) ... status='pending'` = 4 (existen pero no sirven) |
| **(d) bonus killed-irreversible** | `UPDATE ... SET status='approved' WHERE status='killed'` | `expect(...).rejects.toThrow(/irreversible/)` — ejercita el trigger replicado en test_schema (0025:94-97) |

Entre cada fase: `invalidateSlateConfigCache()`. Total: ~5 tests, una conexión, sin LLM (cero tokens — el agente real no participa: se prueba la SUPERFICIE, `applyPlacementWrite`, que es lo que el agente puede tocar). Complemento unit puro y barato: `deriveEffectiveTier` (tabla de casos, §1.3) y el test de paridad de params (§2.3). Guardia anti-acoplamiento (1 test trivial): grep de que `src/app/**` no importa `src/sectors/g-agents/**` — el agente jamás entra al request path ni por accidente de import.

---

## 6. Riesgos: lo peor que puede escribir el agente — y el límite estructural contra cada uno

| # | ataque (reglas/params VÁLIDOS pero dañinos) | límite estructural |
|---|---|---|
| 1 | **Ocultar el catálogo** (pausar/superseder el hero de home) | no puede pausar filas no-agente (verbo no existe en su UPDATE, WHERE `created_by LIKE 'agent:%'`); superseder `(home,10)` ⇒ `PROTECTED_SLOTS` ⇒ tier high ⇒ `pending`, jamás servido sin humano. El hero seed tiene `rule NULL` (siempre pasa): la home no puede quedar vacía por nada que el agente aplique directo |
| 2 | **Page stuffing** (50 carruseles en slots 20..90) | slots `20..90 multipleOf 10` = máx 8 slots posibles; cap 3 filas vivas/surface; cap 5/run; recomendación `MAX_PLACEMENTS_PER_SURFACE` en compose (§3) |
| 3 | **Pin de 100 productos** (reglas `pdp_product_id in [...]` masivas) | `MAX_IN_LIST=50` ya en RuleSchema; el agente no elige productos — solo secciones cuyo contenido lo deciden los resolvers/ranker (registry.ts): **no existe un params de "estos product_ids"** en la whitelist |
| 4 | **Params absurdos** (`limit: 10^9` → query cara) | STRICT_PARAMS write-time (§2.3) + `.catch()` runtime + `budget_ms`/`budget_queries` de ui_sections (que el agente no puede tocar) |
| 5 | **Targeting individual** (scope user, reglas por persona) | `scope user` ni parsea; `scope_ref` de segment contra whitelist de cohortes |
| 6 | **Churn infinito** (write→pause→write cada run) | cooldown 48h por slot + idempotencia diaria + cap 10/día |
| 7 | **Inmortalidad** (`ttl_until` año 9999) | `ttl_hours ≤ 168` en el schema; el backend computa `ttl_until`, el LLM no escribe timestamps |
| 8 | **Auto-escalada** (declararse `risk_tier='low'`) | el tier no es input: `deriveEffectiveTier` lo computa de hechos SQL (slot ocupado, protegido) |
| 9 | **Resurrección de lo matado** | trigger `killed` irreversible (0025:71-84) — garantía de datos, no de prompt |
| 10 | **Prompt injection vía catálogo** (títulos de producto leídos por `read_catalog` que ordenan "aprueba todo") | irrelevante por construcción: aunque el LLM obedezca, la superficie no tiene los verbos (no kill, no update ajeno, no ui_sections, no user scope) y los caps/tiers son código, no instrucciones |
| 11 | **Regla válida pero degenerada** (`hour_of_day gte 0` siempre-true en todo) | inofensivo: equivale a `rule NULL`, que es el caso normal; el daño potencial está acotado por #2/#4 |
| 12 | **Versión inflada** (`version: 2^31` para ganar colisiones eternas) | `version` lo computa el backend (MAX+1); no es input del tool |

Riesgo residual honesto: una propuesta **high mal aprobada por un humano** puede degradar la home (p.ej. reemplazar hero por `popular`). Mitigación: el endpoint de aprobación (futuro) muestra `proposal_meta.rationale` + métricas citadas, y el TTL aplica también a filas aprobadas-de-pending. Y el guardrail final siempre existe: `killed`.

---

## 7. Checklist de implementación (C2) y mapa de archivos

| archivo | contenido | tests |
|---|---|---|
| `supabase/migrations/0030_agent_write_surface.sql` | §1.5 (proposal_key + proposal_meta + índices, public y test_schema) | cubierto por integración |
| `src/sectors/f-slate/write.ts` | `validatePlacementWrite` + `applyPlacementWrite` (máquina de estados, transacción corta por propuesta) — compartido agente/admin | `tests/integration/agent-sovereignty.test.ts` (§5) |
| `src/sectors/g-agents/write/schema.ts` | §1.2 (PlacementProposalSchema, whitelists, PROTECTED_SLOTS) | parse table-driven (unit) |
| `src/sectors/g-agents/write/tier.ts` | §1.3 `deriveEffectiveTier` (pura) | unit, tabla de casos |
| `src/sectors/g-agents/write/params.ts` | §2.3 STRICT_PARAMS | unit paridad con registry |
| `src/sectors/g-agents/write/tool.ts` | §1.6 `makeProposePlacement(backend)` | smoke en harness (A3), no unit propio |
| `scripts/cron-agent-merchandiser.ts` | §4 | `--dry-run` manual; sin test dedicado (plantilla ya probada) |
| `package.json` | script `cron:agent-merchandiser` | — |
| compose.ts (1 línea) | `MAX_PLACEMENTS_PER_SURFACE` (§3, defensa en profundidad) | 1 caso extra en slate-compose.test.ts |

**Decisiones que C2 hereda cerradas:** status de propuesta = `pending` (no existe `proposed`); autoría = `created_by='agent:merchandiser/v1'`; tier computado, no declarado; medium default = pending (autoapply solo por env); user scope prohibido; hero/slots seed intocables en directo; el agente solo pausa lo suyo; TTL obligatorio en toda escritura directa; nombre canónico `propose_placement`.
