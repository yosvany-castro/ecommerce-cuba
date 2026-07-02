# A1 — API vigente: deepagents 1.10.2 + @langchain/langgraph 1.4.1 para el agente merchandiser

**Fecha:** 2026-06-11 · **Fuentes:** `.d.ts` y `dist/index.js` instalados (autoritativos), Context7 `/langchain-ai/deepagentsjs` y `/websites/langchain_oss_javascript_langgraph` (verificación cruzada).
**Verificación:** los dos esqueletos de este informe se typecheckearon con `tsc --strict` contra los paquetes instalados (variante A desde el proyecto; variante B desde el virtual store de pnpm simulando `pnpm add langchain`). Smoke runtime: `createDeepAgent({ model: "deepseek:deepseek-v4-pro" })` construye sin API keys ni red.

Versiones instaladas relevantes: `deepagents@1.10.2`, `@langchain/langgraph@1.4.1`, `@langchain/core@1.1.48`, `@langchain/deepseek@1.0.27`, `zod@4.4.3`, `langsmith@0.7.6` (transitivo vía `@langchain/core`), `langchain@1.4.4` (transitivo vía `deepagents`, **no accesible** desde el código del proyecto — ver §2.3).

---

## 1. `createDeepAgent` — firma exacta (1.10.2)

Fuente: `node_modules/deepagents/dist/index.d.ts` líneas 3064-3200 y `dist/index.js` línea 8084.

```ts
declare function createDeepAgent<
  TResponse extends SupportedResponseFormat = SupportedResponseFormat,
  ContextSchema extends InteropZodObject = InteropZodObject,
  const TMiddleware extends readonly AgentMiddleware[] = readonly [],
  const TSubagents extends readonly AnySubAgent[] = readonly [],
  const TTools extends readonly (ClientTool | ServerTool)[] = readonly [],
  const TStreamTransformers extends ReadonlyArray<() => StreamTransformer<any>> = readonly [],
>(params?: CreateDeepAgentParams<...>): DeepAgent<DeepAgentTypeConfig<...>>;
```

**Es síncrona** (devuelve `DeepAgent`, no `Promise`). `DeepAgent<T> extends ReactAgent<T>` (la clase de `createAgent` de langchain 1.x), así que `invoke`/`stream`/`streamEvents` son los de `ReactAgent`.

### `CreateDeepAgentParams` (todas las opciones, d.ts 3064-3167)

| Opción | Tipo | Notas verificadas |
|---|---|---|
| `model` | `BaseLanguageModel \| string` | Default real en runtime: `"anthropic:claude-sonnet-4-6"` (index.js:8085). Acepta instancia (`ChatDeepSeek`) o spec string `"deepseek:deepseek-v4-pro"` — `initChatModel` de langchain mapea `deepseek:` → `ChatDeepSeek` de `@langchain/deepseek` (universal.js:70). |
| `tools` | `TTools \| StructuredTool[]` | Tools custom. Si un nombre colisiona con builtins lanza `ConfigurationError` code `TOOL_NAME_COLLISION`. Nombres reservados (`BUILTIN_TOOL_NAMES`, index.js:8048): `ls, read_file, write_file, edit_file, glob, grep, execute, start_async_task, check_async_task, update_async_task, cancel_async_task, list_async_tasks, task, write_todos`. |
| `systemPrompt` | `string \| SystemMessage` | **No existe `instructions`** (eso era 0.x). Tu prompt se concatena ANTES del `BASE_AGENT_PROMPT` interno como bloques de un solo SystemMessage (index.js:8219-8231). No puedes eliminar el prompt base salvo vía harness profile `baseSystemPrompt` (§3.4). |
| `middleware` | `readonly AgentMiddleware[]` | Se inserta DESPUÉS de los builtin (todo/fs/subagent/summarization/patch) y antes del caching/memory/HITL. |
| `subagents` | `readonly (SubAgent \| CompiledSubAgent \| AsyncSubAgent)[]` | §5. |
| `responseFormat` | `SupportedResponseFormat = ToolStrategy<T> \| ProviderStrategy<T> \| TypedToolStrategy<T>` | **El tipo NO acepta un zod schema crudo** (a diferencia de `createAgent` y de `SubAgent.responseFormat`). Hay que envolver con `toolStrategy(schema)` del paquete `langchain` (§4.2). |
| `contextSchema` | zod object | Contexto inmutable por invocación (se pasa en `invoke(state, { context })`). |
| `checkpointer` | `BaseCheckpointSaver \| boolean` | **Opcional. Para one-shot: omitir** (§4.1). Obligatorio solo si usas `interruptOn` (HITL). |
| `store` | `BaseStore` | Solo para memoria long-term (`StoreBackend`). No necesario. |
| `backend` | `AnyBackendProtocol \| (config) => AnyBackendProtocol` | **Default: `(config) => new StateBackend(config)`** (index.js:8085) — filesystem virtual en el estado del grafo. §3.1. |
| `interruptOn` | `Record<string, boolean \| InterruptOnConfig>` | HITL por tool; requiere checkpointer. Útil futuro: pausar `propose_placement` con `risk_tier=high` para aprobación humana. |
| `name` | `string` | Metadata. |
| `memory` | `string[]` | Rutas AGENTS.md inyectadas al system prompt. No usar. |
| `skills` | `string[]` | Rutas de SKILL.md en el backend. No usar. |
| `permissions` | `FilesystemPermission[]` | Reglas allow/deny por glob para los fs tools builtin. Irrelevante con StateBackend para nosotros. |
| `streamTransformers` | factories | Solo para streaming v3. No usar en cron. |

**Gotcha de config por defecto:** `createDeepAgent` termina en `.withConfig({ recursionLimit: 1e4 })` (index.js:8240-8246) — el default de LangGraph (25) NO aplica; sin override correrías hasta 10 000 supersteps. **Pasar siempre `recursionLimit` explícito en `invoke`.**

---

## 2. Tools custom con zod 4

### 2.1 `tool()` de `@langchain/core/tools` — soporta zod v4 nativo

`node_modules/@langchain/core/dist/tools/index.d.ts:219,225` tiene overloads explícitos para `ZodObjectV4`:

```ts
declare function tool<SchemaT extends ZodObjectV4, NameT extends string, ...>(
  func: (input: SchemaOutputT, runtime: ToolRuntime<TState, TContext>) => ToolOutputT | Promise<ToolOutputT>,
  fields: ToolWrapperParams<SchemaT, NameT>,
): DynamicStructuredTool<...>;
```

**No hace falta `zod/v3` ni compat alguno.** El proyecto tiene `zod@4.4.3`; `deepagents` mismo depende de `zod@^4.3.6`. Ejemplo compilado (tsc --strict OK):

```ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const readMetrics = tool(
  async ({ placementId, windowDays }) => {
    // input ya viene parseado y tipado por el schema
    return JSON.stringify(await fetchMetrics(placementId, windowDays));
  },
  {
    name: "read_metrics",
    description: "Lee métricas agregadas (CTR, CVR, revenue) de un placement.",
    schema: z.object({
      placementId: z.string().describe("UUID del ui_placement"),
      windowDays: z.number().int().min(1).max(90).default(7),
    }),
  },
);
```

El retorno del func puede ser `string`, `ToolMessage` o `Command` (para escribir estado). El segundo parámetro opcional del func es `ToolRuntime<TState, TContext>` (acceso a state/context/config del grafo).

### 2.2 Tools del agente vs. resultado del run

Para el merchandiser, el patrón más robusto es que `propose_placement` sea **el efecto** (INSERT con `status='proposed'`) y acumule en un closure: el resultado del run no depende de parsear texto del LLM (§4.3, variante A).

### 2.3 GOTCHA pnpm: el paquete `langchain` no está accesible

`toolStrategy`, `providerStrategy`, `createMiddleware`, `todoListMiddleware` se exportan del paquete **`langchain`** (no de `@langchain/core`). `langchain@1.4.4` ya está en el store de pnpm (dep de deepagents) pero **no es importable desde `src/`** (pnpm estricto, verificado: `node_modules/langchain` no existe). Para la variante B (responseFormat tipado y/o middleware oculta-tools):

```bash
pnpm add langchain@^1.4.4   # cero bytes nuevos: ya está en el store
```

---

## 3. Garantizar que el agente NO toca filesystem/shell reales

### 3.1 `StateBackend` es el default y es hermético

- Default verificado: `backend = (config) => new StateBackend(config)` (index.js:8085).
- `StateBackend` (d.ts:884) implementa `BackendProtocolV2` sobre el **record `files` del estado de LangGraph** — `write_file`/`read_file`/`edit_file`/`ls`/`glob`/`grep` operan SOLO sobre ese mapa en memoria/checkpoint. Cero I/O de disco.
- El tool **`execute` (shell) solo existe si el backend es sandbox**: en `createFilesystemMiddleware`, `if (!supportsExecution) tools = tools.filter((t) => t.name !== "execute")` (index.js:1856-1861), donde `supportsExecution = isSandboxBackend(backend)`. `StateBackend` NO lo es.
- Acceso real a disco/shell requeriría pasar explícitamente `FilesystemBackend`, `LocalShellBackend` o un sandbox. **Regla: nunca pasar `backend` en el merchandiser.**

### 3.2 Lo que NO se puede quitar y lo que sí

El stack builtin se ensambla incondicionalmente (index.js:8149-8181): `todoListMiddleware` (tool `write_todos`), `FilesystemMiddleware` (tools fs virtuales), `SubAgentMiddleware` (tool `task`), `SummarizationMiddleware`, `PatchToolCallsMiddleware`. No hay parámetro `builtinTools` (eso es de deepagents Python/0.x).

- `excludedMiddleware` (vía harness profile) puede quitar middleware por nombre, **excepto** `REQUIRED_MIDDLEWARE_NAMES = {"FilesystemMiddleware", "SubAgentMiddleware"}` (index.js:7341) — lanzaría al construir el profile.
- `excludedTools` (vía harness profile) oculta cualquier tool al modelo, incluidos builtins (se aplica con un middleware filtrador al final, index.js:8194-8205).

### 3.3 Mecanismo A — middleware propio que oculta tools (funciona con instancia `ChatDeepSeek`)

Compilado y verificado (requiere `pnpm add langchain` por `createMiddleware`):

```ts
import { createMiddleware } from "langchain";

const HIDDEN = new Set(["write_todos", "task", "ls", "read_file", "write_file", "edit_file", "glob", "grep"]);
const hideBuiltinTools = createMiddleware({
  name: "HideBuiltinToolsMiddleware",
  wrapModelCall: async (request, handler) =>
    handler({ ...request, tools: request.tools.filter((t) => !HIDDEN.has(String(t.name))) }),
});
// createDeepAgent({ ..., middleware: [hideBuiltinTools] })
```

Quitar `task` de la vista del modelo desactiva de facto los subagentes (incluido el general-purpose). Mantener `write_todos` si quieres "lo mínimo de planificación"; ocultar el resto.

### 3.4 Mecanismo B — harness profile (solo con model **string**)

```ts
import { registerHarnessProfile } from "deepagents";
registerHarnessProfile("deepseek", {
  excludedTools: ["write_todos", "task"],          // lo que sobre
  generalPurposeSubagent: { enabled: false },        // único modo de quitar el GP subagent
  // systemPromptSuffix / baseSystemPrompt / toolDescriptionOverrides / excludedMiddleware también disponibles
});
const agent = createDeepAgent({ model: "deepseek:deepseek-v4-pro", ... });
```

**GOTCHA crítico verificado (index.js:7991-7998, 8088-8091):** la resolución de profile para **instancias** usa `getModelProvider(model)`, que solo conoce `ChatAnthropic`, `ChatOpenAI`, `ChatGoogleGenerativeAI` y `ConfigurableModel`. Para una instancia `ChatDeepSeek` devuelve `undefined` → profile vacío → **`registerHarnessProfile` NO surte efecto con instancias DeepSeek**. Solo aplica si pasas el modelo como string `"deepseek:..."` (que internamente crea un `ConfigurableModel` vía `initChatModel`; `deepseek` está soportado y `ChatDeepSeek` lee `DEEPSEEK_API_KEY` del env). Trade-off: con string pierdes control fino del constructor (`temperature`, `maxTokens`, `modelKwargs.thinking`).

### 3.5 El subagente general-purpose se auto-añade

Con profile vacío (instancia DeepSeek), un subagente `general-purpose` con TODOS tus tools se registra siempre (index.js:8133-8144). Tres formas de neutralizarlo:
1. Ocultar `task` con el middleware de §3.3 (inalcanzable).
2. Profile con `generalPurposeSubagent: { enabled: false }` (solo model string).
3. **Shadowing**: si pasas un subagente propio con `name: "general-purpose"`, el default no se añade (check por nombre en index.js:8133).

### 3.6 Resumen de la postura segura del merchandiser

`createDeepAgent({ model, tools: [readMetrics, readCatalog, proposePlacement], subagents: [critic] })` sin `backend`, sin `checkpointer`, sin `interruptOn` ⇒ superficie real = tus 3 tools (que solo leen métricas/catálogo y escriben filas `proposed`). Los fs tools existen pero son virtuales; `execute` no existe. Si además quieres que el modelo ni los vea (ahorro de tokens + foco), añade el middleware §3.3.

---

## 4. Invocación one-shot para cron (sin servidor)

### 4.1 `invoke` — sin checkpointer, sin thread_id

`ReactAgent.invoke` (langchain/dist/agents/ReactAgent.d.ts:134):

```ts
invoke(state: InvokeStateParameter<Types>, config?: InvokeConfiguration<...>): Promise<MergedAgentState<Types>>
```

- **Checkpointer NO es necesario** para un run one-shot: sin él no hay persistencia ni `thread_id` requerido (docs LangGraph: `thread_id` solo es obligatorio *cuando hay* checkpointer). Para un cron que corre y muere, omitirlo es lo correcto — menos I/O, cero estado huérfano.
- Config soportada (runtime.d.ts `CreateAgentPregelOptions`): `configurable, durability, store, cache, signal, recursionLimit, maxConcurrency, timeout, callbacks, subgraphs` (+ `context`).
- `recursionLimit`: pásalo SIEMPRE (deepagents default = 10 000, §1). Al excederse lanza `GraphRecursionError` (`@langchain/langgraph`, errors.d.ts:15) — capturable; las propuestas ya insertadas por tools sobreviven.
- `signal: AbortSignal.timeout(ms)` como cinturón para la máquina de 2 cores.

```ts
import { GraphRecursionError } from "@langchain/langgraph";

const result = await agent.invoke(
  { messages: [{ role: "user", content: "Revisa placements de 7d y propone ajustes." }] },
  { recursionLimit: 60, signal: AbortSignal.timeout(5 * 60_000) },
);
```

`result` es el estado final: `result.messages: BaseMessage[]`, `result.structuredResponse` (solo si `responseFormat`), `result.todos`, `result.files` (estados de middleware).

### 4.2 Resultado estructurado — tres opciones, en orden de preferencia

**(a) Side-effects de tool + closure (variante A — sin dependencias extra).** `propose_placement` es la salida real; el texto final del LLM es solo log. Extraer último mensaje: `result.messages.at(-1)` y `typeof last.content === "string" ? last.content : last.text` (getter `.text` de BaseMessage en core 1.x). Es la opción más alineada con "el agente solo ESCRIBE propuestas en ui_placements".

**(b) `responseFormat: toolStrategy(zodSchema)` (variante B — requiere `pnpm add langchain`).** Devuelve `result.structuredResponse` tipado (`InferStructuredResponse<TypedToolStrategy<T>> = T`). `toolStrategy` funciona vía tool-calling — compatible con DeepSeek. Verificado compilando: el retorno tipa exactamente como `z.infer<typeof schema>`. (`providerStrategy` exige JSON-schema nativo del provider; para DeepSeek usar `toolStrategy`.)

**(c) Parsear el último mensaje** — frágil, solo como fallback de (a).

Recomendación merchandiser: **(a) como contrato, (b) opcional para el resumen del run** (útil para la fila de auditoría del cron: `{ proposals_count, summary }`).

### 4.3 Errores a manejar en el cron

- `GraphRecursionError` → run truncado; conservar propuestas ya hechas, loguear.
- `AbortError` (del signal) → ídem.
- `ConfigurationError` (deepagents) → bug de construcción (colisión de nombres); fail fast.

---

## 5. Subagentes (crítico/verificador)

Interfaz `SubAgent` (d.ts:1965-2048) — declarativo, el padre lo invoca con el tool builtin `task({ description, subagent_type })`:

```ts
interface SubAgent {
  name: string;            // selector en task(subagent_type=...)
  description: string;     // lo que ve el modelo padre para decidir delegar
  systemPrompt: string;
  tools?: StructuredTool[];          // default: SIN tus tools (solo builtins fs/todos)
  model?: LanguageModelLike | string; // default: el del padre
  middleware?: readonly AgentMiddleware[];
  interruptOn?: ...;                  // requiere checkpointer
  skills?: string[];
  responseFormat?: CreateAgentParams["responseFormat"]; // ¡aquí SÍ acepta zod crudo!
  permissions?: FilesystemPermission[];
}
```

Notas verificadas:
- Cada subagente recibe su propio stack builtin (todos/fs/summarization/patch + tu middleware) — index.js:8106-8128. Comparten el mismo `backend` (files) del padre.
- `SubAgent.responseFormat` acepta **zod schema directo** (tipo `CreateAgentParams["responseFormat"]`); la respuesta estructurada se JSON-serializa como contenido del `ToolMessage` que recibe el padre — ideal para un veredicto del crítico parseable: `{ approved: boolean, objections: string[] }`.
- También existe `CompiledSubAgent` (`{ name, description, runnable }`) para envolver un agente ya construido, y `AsyncSubAgent` (LangGraph Platform; irrelevante aquí).

**¿Cuándo compensa el crítico?** Compensa si: (i) quieres revisar propuestas `risk_tier=high` con un contexto limpio (el crítico no hereda el sesgo de la conversación del padre — solo ve el `description` que el padre escribe en `task`), y (ii) aceptas el costo de una sub-conversación extra (en DeepSeek v4 es barato). NO compensa para validaciones determinísticas (rangos, slugs existentes): eso va en el schema zod del tool o en SQL. Diseño sugerido: crítico con SOLO `read_metrics`, `responseFormat` zod de veredicto, y prompt de auditor escéptico; el padre lo llama una vez antes de cerrar.

Costo de tener subagentes declarados: el tool `task` + descripciones en el prompt (~1 llamada extra si el padre delega). Si no se declara ninguno y se oculta `task` (§3.3), el agente queda single-loop puro.

---

## 6. langsmith: peer, runtime y tracing

- `deepagents/package.json` declara `peerDependencies: { "langsmith": ">=0.6.0 <1.0.0" }` y `dist/index.js` lo importa **a nivel de módulo** (líneas 18-19: `import { Client } from "langsmith"` + `langsmith/experimental/sandbox`). O sea: debe ser *resoluble* en runtime.
- **Ya lo es, sin instalarlo tú**: `langsmith@0.7.6` es dependencia directa de `@langchain/core@1.1.48`, y pnpm satisfizo el peer (visible en la key del virtual store: `deepagents@1.10.2_langsmith@0.7.6_...`). Verificado con smoke runtime: `createDeepAgent(...)` construye sin variables LangSmith y sin red.
- **Tracing OFF por defecto**: `@langchain/core/dist/utils/callbacks.js` — solo se activa si alguna de `LANGSMITH_TRACING_V2 | LANGCHAIN_TRACING_V2 | LANGSMITH_TRACING | LANGCHAIN_TRACING` === `"true"`. Sin esas vars no hay llamadas a LangSmith ni se necesita API key.
- Warning benigno de `npm ls`: `langchain@1.4.4 invalid: "^0.3.29" from langsmith` — langsmith 0.7.6 tiene un peer (opcional) viejo sobre `langchain`; no afecta runtime.
- Si algún día se añade `langsmith` al package.json: respetar `<1.0.0`.

---

## 7. Gotchas / breaking changes 2026 (1.x vs 0.x)

1. **`instructions` → `systemPrompt`** y **no existe `builtinTools`** en JS 1.10.2 (los posts/blogs de deepagents 0.x muestran ambos). El control de builtins es: backend (qué hacen) + harness profile o middleware (si se ven).
2. **`responseFormat` del agente principal exige strategy** (`toolStrategy`/`providerStrategy`), no zod crudo — pero `SubAgent.responseFormat` sí acepta zod crudo. Asimetría fácil de tropezar.
3. **deepagents fija `recursionLimit: 10000`** vía `withConfig` — un loop de tool-calling pagando DeepSeek podría correr larguísimo. Override SIEMPRE en `invoke`.
4. **Default model `"anthropic:claude-sonnet-4-6"`**: si olvidas `model`, intentará Anthropic (créditos depletados) — pásalo siempre.
5. **Harness profiles no resuelven para instancias `ChatDeepSeek`** (§3.4). Builtin profiles solo registran sufijos de prompt para `anthropic:*` y modelos Codex — nada para deepseek, registro limpio.
6. **pnpm estricto**: `langchain` (paquete) no importable sin añadirlo; `tool()` viene de `@langchain/core/tools` (sí accesible).
7. **LangGraph 1.x**: `invoke(input, { recursionLimit })` y `GraphRecursionError` igual que 0.x; default 25 *en grafos crudos* (aquí lo pisa deepagents). `checkpointer: true` en params es para herencia en subgrafos — no usarlo en el agente raíz.
8. **zod 4 nativo en toda la cadena** (core tools con overloads `ZodObjectV4`; deepagents depende de zod ^4.3.6). No usar `zod/v3`.
9. `streamEvents(..., { version: "v3" })` (proyecciones tipadas) es experimental — innecesario para cron; `invoke` es la ruta estable.
10. Tools custom no pueden llamarse como los builtin (`ConfigurationError: TOOL_NAME_COLLISION`); nuestros `read_metrics`/`read_catalog`/`propose_placement` están libres.

---

## 8. Esqueleto completo del merchandiser (typecheck-verificado)

### Variante A — recomendada: sin deps nuevas, resultado = side-effects de tool

Compilada con `tsc --noEmit --strict` contra los paquetes instalados. Destino sugerido: `src/sectors/g-agents/runtime/merchandiser.ts` + `scripts/cron-merchandiser.ts`.

```ts
import { createDeepAgent, type SubAgent } from "deepagents";
import { ChatDeepSeek } from "@langchain/deepseek";
import { tool } from "@langchain/core/tools";
import { GraphRecursionError } from "@langchain/langgraph";
import { z } from "zod";

// --- modelo: instancia => control total de params DeepSeek v4 -----------------
const model = new ChatDeepSeek({
  model: "deepseek-v4-pro",              // razonamiento; usar DEEPSEEK_MODELS.pro del lib
  apiKey: process.env.DEEPSEEK_API_KEY,
  temperature: 0,
  maxTokens: 4096,
  modelKwargs: { thinking: { type: "enabled" } }, // extensión v4, fuera del tipo OpenAI
});

// --- tools custom (zod 4 nativo) ----------------------------------------------
const riskTierSchema = z.enum(["low", "medium", "high"]);

interface PlacementProposal {
  section_slug: string;
  position: number;
  variant: string;
  risk_tier: z.infer<typeof riskTierSchema>;
  rationale: string;
}
const collected: PlacementProposal[] = []; // las propuestas SON el resultado del run

const readMetrics = tool(
  async ({ placementId, windowDays }) => {
    // real: SELECT thesis.feed_impressions / thesis.purchase_attributions
    return JSON.stringify({ placementId, windowDays, ctr: 0.031, cvr: 0.004, revenue_usd: 123.45 });
  },
  {
    name: "read_metrics",
    description: "Lee métricas agregadas (CTR, CVR, revenue atribuido) de un placement en una ventana de días.",
    schema: z.object({
      placementId: z.string().describe("UUID del ui_placement"),
      windowDays: z.number().int().min(1).max(90).default(7),
    }),
  },
);

const readCatalog = tool(
  async ({ category, limit }) => {
    // real: SELECT public.products JOIN thesis.product_popularity_7d
    return JSON.stringify({ category, items: [], limit });
  },
  {
    name: "read_catalog",
    description: "Lista productos activos de una categoría con su popularidad 7d.",
    schema: z.object({
      category: z.string(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
  },
);

const proposePlacement = tool(
  async (input) => {
    // real: INSERT INTO thesis.ui_placements (status='proposed', risk_tier=...)
    collected.push(input);
    return `Propuesta registrada (${collected.length}): ${input.section_slug}@${input.position} [${input.risk_tier}]`;
  },
  {
    name: "propose_placement",
    description:
      "Registra UNA propuesta de cambio de placement. Nunca aplica cambios: solo propone. " +
      "risk_tier=high requiere rationale con evidencia numérica de read_metrics.",
    schema: z.object({
      section_slug: z.string(),
      position: z.number().int().min(0),
      variant: z.string(),
      risk_tier: riskTierSchema,
      rationale: z.string().min(20),
    }),
  },
);

// --- subagente crítico opcional ------------------------------------------------
const critic: SubAgent = {
  name: "critic",
  description:
    "Verifica una lista de propuestas de placement contra las métricas citadas. " +
    "Úsalo antes de finalizar si hay propuestas risk_tier=high.",
  systemPrompt:
    "Eres un auditor escéptico. Recibes propuestas de merchandising y las métricas que las justifican. " +
    "Rechaza toda propuesta cuya evidencia numérica no cuadre.",
  tools: [readMetrics],
  model,
  // opcional: responseFormat zod crudo => veredicto JSON en el ToolMessage del padre
};

// --- agente: hermético por construcción -----------------------------------------
// sin backend  => StateBackend (fs virtual en estado; sin tool execute)
// sin checkpointer => one-shot sin thread_id
const agent = createDeepAgent({
  model,
  tools: [readMetrics, readCatalog, proposePlacement],
  systemPrompt:
    "Eres el merchandiser de la tienda. Lee métricas, detecta placements decaídos y " +
    "PROPONES cambios vía propose_placement. Jamás asumes que un cambio se aplica.",
  subagents: [critic],
});

// --- invocación one-shot (cron) --------------------------------------------------
export async function runMerchandiserOnce(): Promise<{
  proposals: PlacementProposal[];
  finalText: string;
  hitRecursionLimit: boolean;
}> {
  collected.length = 0;
  try {
    const result = await agent.invoke(
      {
        messages: [
          { role: "user", content: "Revisa los placements de la home de los últimos 7 días y propone hasta 3 ajustes." },
        ],
      },
      { recursionLimit: 60, signal: AbortSignal.timeout(5 * 60_000) },
    );
    const last = result.messages.at(-1);
    const finalText = typeof last?.content === "string" ? last.content : (last?.text ?? "");
    return { proposals: [...collected], finalText, hitRecursionLimit: false };
  } catch (err) {
    if (err instanceof GraphRecursionError) {
      return { proposals: [...collected], finalText: "", hitRecursionLimit: true };
    }
    throw err;
  }
}
```

Nota de producción: el closure `collected` debe vivir por-run (factory `buildMerchandiserAgent()` que cree tools+agente por invocación) si el proceso del cron pudiera reutilizarse; en `tsx scripts/cron-merchandiser.ts` de un solo uso es seguro tal cual.

### Variante B — `responseFormat` tipado + ocultar builtins (requiere `pnpm add langchain@^1.4.4`)

Compilada con `tsc --strict` (desde el virtual store, equivalente a tener `langchain` como dep directa):

```ts
import { createDeepAgent, registerHarnessProfile } from "deepagents";
import { toolStrategy, createMiddleware } from "langchain";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const proposalsSchema = z.object({
  proposals: z.array(z.object({
    section_slug: z.string(),
    position: z.number().int(),
    variant: z.string(),
    risk_tier: z.enum(["low", "medium", "high"]),
    rationale: z.string(),
  })),
  summary: z.string(),
});

// Mecanismo 1 (funciona con CUALQUIER modelo, incl. instancia ChatDeepSeek):
const HIDDEN = new Set(["write_todos", "task", "ls", "read_file", "write_file", "edit_file", "glob", "grep"]);
const hideBuiltinTools = createMiddleware({
  name: "HideBuiltinToolsMiddleware",
  wrapModelCall: async (request, handler) =>
    handler({ ...request, tools: request.tools.filter((t) => !HIDDEN.has(String(t.name))) }),
});

// Mecanismo 2 (solo surte efecto con model STRING "deepseek:..."):
registerHarnessProfile("deepseek", {
  excludedTools: ["write_todos", "task"],
  generalPurposeSubagent: { enabled: false },
});

const agent = createDeepAgent({
  model: "deepseek:deepseek-v4-pro",   // string => harness profile aplica; lee DEEPSEEK_API_KEY
  tools: [/* readMetrics, readCatalog, proposePlacement */],
  middleware: [hideBuiltinTools],
  responseFormat: toolStrategy(proposalsSchema),
});

const result = await agent.invoke(
  { messages: [{ role: "user", content: "propón ajustes" }] },
  { recursionLimit: 60 },
);
const out: z.infer<typeof proposalsSchema> = result.structuredResponse; // tipado exacto
```

### Decisión recomendada para P2-C2

Variante A como base (instancia `ChatDeepSeek` con `temperature: 0` y control de `thinking`; resultado por side-effects). Añadir de la variante B solo `hideBuiltinTools` (un `pnpm add langchain`) si los tokens del prompt builtin (write_todos/fs/task descriptions) pesan en el presupuesto — medirlo primero: con DeepSeek v4 flash/pro el overhead de ~8 tool schemas es marginal y el cache de contexto de DeepSeek lo absorbe en runs repetidos.
