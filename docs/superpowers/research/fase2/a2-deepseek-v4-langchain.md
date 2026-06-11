# A2 — Integración DeepSeek v4 ↔ LangChain para el loop de tools del agente merchandiser

**Fecha:** 2026-06-11 · **Branch:** `feat/thesis-personalization-program`
**Fuentes:** código instalado (`@langchain/deepseek@1.0.27`, `@langchain/openai@1.4.7`, `openai@6.36.0`), docs vigentes DeepSeek vía Context7 (`/websites/api-docs_deepseek`) + página de pricing en vivo, y **8 llamadas empíricas mínimas contra la API real** (coste total < $0.01). Cada afirmación de API está respaldada por `.d.ts` instalado, doc vigente o wire capture empírico — nada de memoria.

---

## 0. Matriz empírica (lo que se probó contra la API real, 2026-06-11)

Probes ejecutados (conservados como sentinelas de regresión):

- `/workspaces/ecommerce-cuba/scripts/_audit/a2-deepseek-langchain-probe.ts` (loop de tools + structured output, con `fetch` interceptado para capturar el body exacto en el wire)
- `/workspaces/ecommerce-cuba/scripts/_audit/a2-toolchoice-thinking.ts`
- `/workspaces/ecommerce-cuba/scripts/_audit/a2-jsonmode-thinking.ts`

| # | Test | v4-flash | v4-pro | Resultado |
|---|------|----------|--------|-----------|
| 1 | `bindTools` + thinking enabled + `reasoning_effort:"high"` → ¿devuelve `tool_calls`? | ✅ | ✅ | `tool_calls` correcto + `additional_kwargs.reasoning_content` poblado (26-28 reasoning tokens) |
| 2 | Round-trip del loop (AIMessage+ToolMessage de vuelta) **sin** `reasoning_content` en el request | ✅ sin 400 | ✅ sin 400 | El assistant message en el wire solo lleva `role,content,tool_calls` y la API lo acepta; respuesta final correcta (`"19.99 USD"`) |
| 3 | `withStructuredOutput(zod, {name})` (method default = functionCalling) con thinking **disabled** | ✅ | ✅ | `{"sku":"XYZ-9","price_usd":42.5}`; wire: `tool_choice:{"type":"function","function":{"name":"extract_price"}}` |
| 4 | `withStructuredOutput` functionCalling con thinking **enabled** | ❌ **400** | (no probado, mismo backend) | Error literal de la API: `400 Thinking mode does not support this tool_choice` |
| 5 | `withStructuredOutput(zod, {method:"jsonMode"})` con thinking **enabled** | ✅ | (no probado) | `{"sku":"XYZ-9","price_usd":42.5}` — `response_format:{type:"json_object"}` sí funciona en thinking mode |
| 6 | `modelKwargs:{thinking:{type:"enabled"},reasoning_effort:"high"}` → ¿llega al wire? | ✅ | ✅ | Body capturado: claves `model,temperature,stream,tools,thinking,reasoning_effort,max_tokens,messages` — ambos en top-level del JSON |

**Conclusión que decide el diseño:** DeepSeek v4 **SÍ soporta function calling en modo thinking** (a diferencia del legacy `deepseek-reasoner`/R1), con UNA restricción dura verificada: en thinking mode **no se puede forzar `tool_choice` a una función nombrada** (400). `tool_choice` omitido (≡ auto) funciona. Para salida estructurada con thinking ON, usar `method: "jsonMode"`.

---

## 1. ChatDeepSeek 1.0.27 — constructor, defaults y cómo llegan los params al wire

### 1.1 Firma del constructor (de `node_modules/@langchain/deepseek/dist/chat_models.d.ts`)

```ts
declare class ChatDeepSeek extends ChatOpenAICompletions<ChatDeepSeekCallOptions> {
  constructor(model: string, fields?: Omit<ChatDeepSeekInput, "model">);
  constructor(fields?: Partial<ChatDeepSeekInput>);
}

interface ChatDeepSeekInput extends ChatOpenAIFields {
  apiKey?: string;        // @default process.env.DEEPSEEK_API_KEY
  model?: string;
  stop?: Array<string>;
  stopSequences?: Array<string>;
  streaming?: boolean;
  temperature?: number;
  maxTokens?: number;
}
```

### 1.2 Defaults verificados en el source instalado (`dist/chat_models.js`)

```js
const apiKey = fields.apiKey || getEnvironmentVariable("DEEPSEEK_API_KEY");
if (!apiKey) throw new Error(`Deepseek API key not found. ...`);
super({
  ...fields,
  apiKey,
  configuration: {
    baseURL: "https://api.deepseek.com",   // default; fields.configuration lo puede pisar
    ...fields.configuration
  }
});
```

- **Env var:** `DEEPSEEK_API_KEY` (exactamente la que ya está en `/workspaces/ecommerce-cuba/.env.local`). Lanza error en el constructor si falta — el agente debe instanciarse lazy, nunca a nivel de módulo importado por el request path.
- **baseURL default:** `https://api.deepseek.com`. Se sobreescribe con `configuration: { baseURL: "https://api.deepseek.com/beta" }` (necesario solo para `strict: true` en tools, feature Beta).
- **`configuration` acepta cualquier opción del cliente `openai`** (incluido `fetch` custom — así se capturó el wire en los probes).

### 1.3 Cómo pasar el body extra de v4 (`thinking`, `reasoning_effort`): `modelKwargs`

Mecánica verificada en `@langchain/openai/dist/chat_models/completions.js` (`invocationParams`):

```js
const params = {
  model: this.model,
  temperature: this.temperature,
  // ...
  tools: options?.tools?.length ? ... : void 0,
  tool_choice: formatToOpenAIToolChoice(options?.tool_choice),
  response_format: this._getResponseFormat(options?.response_format),
  parallel_tool_calls: options?.parallel_tool_calls,
  ...this.modelKwargs,                    // ← spread directo en el body del request
  // ...
};
const reasoning = this._getReasoningParams(options);
if (reasoning !== void 0 && reasoning.effort !== void 0) params.reasoning_effort = reasoning.effort;
if (isReasoningModel(params.model)) params.max_completion_tokens = ...;
else params.max_tokens = this.maxTokens === -1 ? void 0 : this.maxTokens;   // ← rama DeepSeek
```

Hechos verificados:

1. **`modelKwargs` se spreadea tal cual en el body** del `chat.completions.create`. Empíricamente: `modelKwargs: { thinking: { type: "enabled" }, reasoning_effort: "high" }` produjo en el wire `"thinking":{"type":"enabled"}` y `"reasoning_effort":"high"` en top-level. Es el equivalente exacto del `extra_body` de la doc oficial de DeepSeek (que documenta `thinking: {type:"enabled"|"disabled"}` y `reasoning_effort` top-level).
2. **`max_tokens` (no `max_completion_tokens`)**: `isReasoningModel()` solo matchea `/^o\d/` y `gpt-5*`, así que para `deepseek-*` siempre va `max_tokens` — confirmado en el wire (`max_tokens: 500`). Coincide con lo que DeepSeek espera.
3. **Ruta alternativa para effort (NO recomendada):** el campo `reasoning?: OpenAI.Reasoning` del constructor también termina como `params.reasoning_effort`, y **pisa** lo que pongas en `modelKwargs` (se asigna después del spread). Pero el tipo de `openai@6.36.0` es `ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null` — **no incluye `"max"`** (el valor DeepSeek), así que requeriría cast. Usar `modelKwargs` como mecanismo único: sin fricción de tipos y verificado en el wire.
4. **`frequency_penalty` / `presence_penalty`:** DeepSeek los declara deprecados ("no longer supported and will not take effect", doc `api/create-chat-completion`). LangChain los manda solo si se setean — dejarlos sin tocar.
5. **`reasoning_content` en el round-trip:** el converter `convertMessagesToCompletionsMessageParams` (`dist/converters/completions.js`) serializa AIMessages de vuelta SOLO con `role`, `content`, `tool_calls` (+ `name`/`function_call`/`audio` si aplican). El `additional_kwargs.reasoning_content` **nunca se envía de vuelta** al wire. Ver §2.2 para por qué esto importa y por qué hoy no rompe.
6. **Streaming:** el wrapper DeepSeek post-procesa deltas — `reasoning_content` de deltas va a `additional_kwargs.reasoning_content` por chunk, y además parsea tags `<think>...</think>` embebidos en `content` (defensa para modos donde el razonamiento llega inline). No afecta al modo no-streaming del agente.
7. **Usage / cache accounting (clave para el harness):** la respuesta no-streaming mapea `usage.prompt_tokens_details.cached_tokens → usage_metadata.input_token_details.cache_read` y `completion_tokens_details.reasoning_tokens → output_token_details.reasoning`. Verificado empíricamente: `{"output_tokens":72,"input_tokens":337,"input_token_details":{"cache_read":0},"output_token_details":{"reasoning":26}}`. El harness puede medir coste real por época sin instrumentación extra.

---

## 2. LA pregunta de diseño: function calling en thinking mode

### 2.1 Respuesta: SÍ — verificado en docs y empíricamente en ambos modelos

- **Docs vigentes** (`api-docs.deepseek.com/guides/thinking_mode`, sección "Tool Calls"): "The DeepSeek model's thinking mode supports tool calls, allowing it to perform multiple turns of reasoning and tool execution before providing a final answer". El ejemplo oficial usa `deepseek-v4-pro` + `tools` + `reasoning_effort="high"` + `extra_body={"thinking":{"type":"enabled"}}` en un loop multi-turn.
- **Empírico (test 1-2):** v4-flash Y v4-pro con thinking enabled devuelven `tool_calls` poblados en `AIMessage.tool_calls` (formato LangChain estándar: `{name, args, type:"tool_call", id}`) junto con `reasoning_content`, y el loop completo (tool result → respuesta final) funciona vía `ChatDeepSeek` sin tocar nada.
- **Contexto histórico:** el legacy `deepseek-reasoner` (R1) NO soportaba function calling. Desde el changelog oficial: `deepseek-chat` ≡ v4-flash non-thinking y `deepseek-reasoner` ≡ v4-flash thinking, **ambos alias se apagan el 2026-07-24**. El proyecto ya migró (P2-0) — usar siempre `deepseek-v4-flash` / `deepseek-v4-pro` explícitos.

### 2.2 La restricción y la discrepancia docs↔realidad (vigilar)

**Restricción dura (verificada, test 4):** en thinking mode la API rechaza `tool_choice` con función nombrada: `400 Thinking mode does not support this tool_choice`. Configs de integración publicadas en los docs de DeepSeek (oh_my_pi) declaran `supportsToolChoice: false` para v4 — consistente. `tool_choice` omitido (auto) funciona (tests 1-2). `tool_choice: "required"` NO se probó — tratarlo como no soportado en thinking mode.

**Discrepancia (riesgo latente):** la guía de thinking mode dice que en loops de tools hay que devolver `reasoning_content` en los requests siguientes o la API responde 400 (y dos configs de integración del propio sitio declaran `requiresReasoningContentForToolCalls: true`). **Empíricamente hoy (2026-06-11) NO es así:** el wire capturado muestra que LangChain no devuelve `reasoning_content` y ambos modelos completaron el loop sin 400. Interpretación: la API actual tolera la ausencia (probablemente regenera o descarta el estado de razonamiento). **Riesgo:** si DeepSeek empieza a enforcear el 400 documentado, `ChatDeepSeek` rompería el loop en thinking mode sin cambio de código nuestro, porque su converter no puede enviar `reasoning_content` de vuelta. **Mitigación barata:** mantener `scripts/_audit/a2-deepseek-langchain-probe.ts` como smoke pre-deploy del agente (1 run = ~$0.001); si algún día da 400 en CALL 2, el fallback es thinking disabled para el loop (§6) — cero cambio de arquitectura.

---

## 3. `withStructuredOutput` con v4

Del source instalado (`@langchain/deepseek/dist/chat_models.js`):

```js
withStructuredOutput(outputSchema, config) {
  const ensuredConfig = { ...config };
  if (ensuredConfig?.method === void 0) ensuredConfig.method = "functionCalling";  // ← default DeepSeek
  return super.withStructuredOutput(outputSchema, ensuredConfig);
}
```

| Method | Mecánica en el wire | thinking disabled | thinking enabled |
|--------|--------------------|-------------------|------------------|
| `functionCalling` (**default**) | tool con el schema + `tool_choice` forzado a esa función | ✅ verificado (test 3) | ❌ **400** (test 4) |
| `jsonMode` | `response_format: {type:"json_object"}` + parser | ✅ (doc oficial json_mode) | ✅ verificado (test 5) |
| `jsonSchema` | `response_format: {type:"json_schema",...}` | ⚠️ NO usar: DeepSeek no documenta `json_schema`; el gate del wrapper (`_getStructuredOutputMethod`) solo bloquea modelos `gpt-3/gpt-4`, así que lo dejaría pasar y fallaría/ignoraría en la API | ⚠️ NO usar |

Notas operativas:

- Acepta schemas zod 4 directamente (`InteropZodType`; zod 4.4.3 instalado funciona — verificado en los 3 probes).
- Con `jsonMode` el prompt DEBE contener la palabra "JSON" y conviene un ejemplo del shape (requisito documentado de DeepSeek; el probe lo cumple y parsea perfecto).
- `{ includeRaw: true }` disponible si se quiere el AIMessage crudo + parsed (útil para loggear `reasoning_content` de la decisión del agente en `slate_decisions`-style auditoría).
- El perfil instalado (`@langchain/deepseek/dist/profiles.js`) declara `structuredOutput: true` para `deepseek-v4-pro` y `deepseek-v4-flash` (y `toolCalling: true` para los cuatro modelos conocidos).

---

## 4. Pricing y context window vigentes (para presupuestar agente + harness)

Fuente canónica: página de pricing en vivo `api-docs.deepseek.com/quick_start/pricing` (fetch 2026-06-11), corroborada por el summary de Context7 de la misma página. USD por 1M tokens:

| Modelo | Input cache HIT | Input cache MISS | Output | Context | Max output |
|--------|----------------|------------------|--------|---------|-----------|
| `deepseek-v4-flash` | **$0.0028** | **$0.14** | **$0.28** | 1M tokens | 384K tokens |
| `deepseek-v4-pro` | **$0.003625** | **$0.435** | **$0.87** | 1M tokens | 384K tokens |

Notas críticas:

1. **Discrepancia entre páginas del propio sitio:** la config `pi_mono/models.json` en los docs de DeepSeek lista pro a $1.74 in / $3.48 out (exactamente 4×) y flash cacheRead $0.028 (10×). La página de pricing es la fuente canónica y dos lecturas independientes coinciden; los configs de integración parecen stale. Presupuestar con la tabla de arriba pero **mantener margen 4× en el peor caso para v4-pro**.
2. **El comment de pricing en `/workspaces/ecommerce-cuba/src/lib/llm/deepseek.ts` (línea 9) está stale:** dice "cache hit $0.028/M" para flash; hoy la página dice $0.0028/M. Actualizarlo de pasada.
3. **Thinking vs non-thinking: mismo precio por token** (la tabla no diferencia). Lo que cambia el coste es que thinking emite reasoning tokens facturados como output. En los probes, una pregunta trivial con `reasoning_effort:"high"` gastó solo 26-28 reasoning tokens — el overhead escala con la dificultad.
4. **El caché de contexto es automático** (server-side, sin acción del cliente; `cacheWrite: 0`). Cache hit en flash es **50× más barato** que miss. Implicación de diseño para el harness: **prefijo de prompt estable** (system prompt del merchandiser + definiciones de tools idénticas byte a byte entre llamadas) → la mayor parte del input de cada época cae a $0.0028/M. LangChain manda las tools en el mismo orden que `bindTools`, así que basta con construir el modelo una vez por proceso.

### Presupuesto estimado

Supuestos por run del merchandiser: ~6 llamadas de loop, ~8K input/llamada (≥80% cache hit con prefijo estable), ~1.2K output/llamada (incl. reasoning):

- **v4-flash:** input ≈ (6×1.6K×$0.14 + 6×6.4K×$0.0028)/1M ≈ $0.0015; output ≈ 7.2K×$0.28/1M ≈ $0.0020 → **~$0.0035/run** (~$0.005 redondeando con margen).
- **v4-pro:** misma cuenta a 3.1× output y 3.1× miss → **~$0.011/run** (peor caso 4× pricing: ~$0.045/run).

Harness (gate ≥2x revenue): p.ej. 60 épocas × 5 seeds = 300 runs del agente real → **flash ≈ $1-1.5 total; pro ≈ $3.5 (peor caso ~$13)**. Conclusión: el harness completo con flash cuesta menos que un café; incluso con pro en cada época es viable. El caché automático es el factor #1 — no regenerar el system prompt dinámicamente por época.

---

## 5. Parallel tool calls y límites de `max_tokens`

- **Múltiples tool calls por respuesta: SÍ.** Doc oficial (news0725, vigente para la API actual): function calling "supports parallel function calls and enables up to 128 functions in a single request". El propio docstring del wrapper muestra 4 `tool_calls` en una respuesta de deepseek-chat. El executor del agente debe iterar `AIMessage.tool_calls` completo — `ToolNode` de LangGraph y el loop de deepagents ya lo hacen nativamente.
- **El param `parallel_tool_calls` (estilo OpenAI) NO está en la lista documentada de params de DeepSeek** (`api/create-chat-completion`). LangChain solo lo manda si se pasa como call option — **no confiar en él para limitar a 1 tool call**; si el agente necesita serialización estricta, hacerlo en el executor (procesar solo el primer tool_call y devolver error a los demás) o vía prompt.
- **`tool_choice` soportado (non-thinking):** `"none" | "auto" | "required"` o función nombrada (doc `api/create-chat-completion`). En thinking mode: solo omitido/auto (§2.2).
- **`strict: true` por tool (Beta):** valida server-side contra el JSON Schema; disponible en thinking y non-thinking; requiere `configuration: { baseURL: "https://api.deepseek.com/beta" }`. El wrapper lo soporta vía la call option `strict` (pasa `strict` a cada function def). No necesario para Fase 2; anotado por si el simulador detecta args malformados.
- **`max_tokens`:** máximo **384K** de output en ambos modelos (pricing page + profiles.js instalado). Default si se omite: no documentado para v4 — **setear `maxTokens` siempre explícito**. El wrapper lo manda como `max_tokens` (verificado); `maxTokens: -1` lo omite del body. Para el loop del merchandiser 4-8K es de sobra; recordar que los reasoning tokens cuentan contra `max_tokens`, así que con thinking enabled no escatimar (mínimo ~2K para evitar truncar el razonamiento + respuesta).
- **Context window: 1M tokens** ambos modelos (pricing page; `profile.maxInputTokens` instalado = 1e6). El estado del merchandiser (métricas agregadas por placement) nunca se acercará.

---

## 6. RECOMENDACIÓN FINAL — config exacta por rol (compilable)

Decisiones derivadas de la matriz empírica:

- **(a) Loop de tools del merchandiser → `deepseek-v4-flash` + thinking enabled + effort `high`.** Tools verificadas en thinking mode, 3× más barato que pro, y `reasoning_content` queda en `additional_kwargs` de cada AIMessage → se persiste como audit trail de cada propuesta. NO usar `tool_choice` forzado en este modelo (400). El harness (cientos de runs) usa exactamente este config.
- **(b) Subagente crítico (decisión final / cambios `risk_tier` alto) → `deepseek-v4-pro` + thinking enabled + effort `max`, salida estructurada vía `jsonMode`** (única vía de structured output verificada con thinking ON). Si el coste del harness con pro duele, degradar a flash+`high` solo dentro del simulador y mantener pro en producción.
- **(c) Extracción barata → `deepseek-v4-flash` + thinking DISABLED + `withStructuredOutput` (functionCalling default).** Verificado; es el reemplazo 1:1 del patrón `deepseek-chat` actual de `src/lib/llm/deepseek.ts`. `temperature: 0`.

```ts
// src/sectors/g-agents/llm.ts (propuesto)
import { ChatDeepSeek } from "@langchain/deepseek";

/** V4: thinking viene ENABLED por defecto en la API — siempre explícito. */
type Thinking = "enabled" | "disabled";
type Effort = "high" | "max";

function deepseekV4(opts: {
  model: "deepseek-v4-flash" | "deepseek-v4-pro";
  thinking: Thinking;
  reasoningEffort?: Effort;     // solo aplica con thinking enabled
  maxTokens: number;            // explícito SIEMPRE (default de la API no documentado)
  temperature?: number;
}) {
  return new ChatDeepSeek({
    model: opts.model,
    temperature: opts.temperature ?? 0,
    maxTokens: opts.maxTokens,
    // Equivalente verificado del extra_body de la doc DeepSeek:
    // se spreadea tal cual en el body del request (wire-verified).
    modelKwargs: {
      thinking: { type: opts.thinking },
      ...(opts.thinking === "enabled" && opts.reasoningEffort
        ? { reasoning_effort: opts.reasoningEffort }
        : {}),
    },
    // apiKey: lee process.env.DEEPSEEK_API_KEY (lanza si falta — instanciar lazy)
    // baseURL: default https://api.deepseek.com
  });
}

/** (a) Loop de tools del merchandiser — tools en thinking mode, tool_choice auto SOLO. */
export const merchandiserLoopModel = () =>
  deepseekV4({ model: "deepseek-v4-flash", thinking: "enabled", reasoningEffort: "high", maxTokens: 8192 });

/** (b) Subagente crítico — razonamiento máximo; structured output SOLO vía jsonMode. */
export const criticModel = () =>
  deepseekV4({ model: "deepseek-v4-pro", thinking: "enabled", reasoningEffort: "max", maxTokens: 16384 });

/** (c) Extracción barata — functionCalling permitido porque thinking está OFF. */
export const extractionModel = () =>
  deepseekV4({ model: "deepseek-v4-flash", thinking: "disabled", maxTokens: 2048 });
```

Uso por rol:

```ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// (a) loop de tools: bindTools SIN tool_choice (auto). PROHIBIDO forzar función en thinking mode.
const loopLlm = merchandiserLoopModel().bindTools([readMetricsTool, proposePlacementTool]);

// (b) subagente crítico: jsonMode es el ÚNICO método de structured output válido con thinking ON.
const Verdict = z.object({
  approve: z.boolean(),
  risk_tier: z.enum(["low", "medium", "high"]),
  reason: z.string(),
});
const critic = criticModel().withStructuredOutput(Verdict, {
  name: "verdict",
  method: "jsonMode", // ← functionCalling daría 400 "Thinking mode does not support this tool_choice"
});
// El prompt del crítico DEBE contener la palabra "JSON" + ejemplo del shape (requisito DeepSeek json_object).

// (c) extracción: default functionCalling, thinking OFF.
const extract = extractionModel().withStructuredOutput(MySchema, { name: "extract" });
```

### Fallbacks (en orden)

1. **Si la API empieza a enforcear el 400 por `reasoning_content` ausente en loops de tools** (documentado pero hoy no aplicado — §2.2): cambiar el loop (a) a `thinking: "disabled"` (≡ semántica legacy `deepseek-chat`, function calling clásico verificado). Pérdida: audit trail de razonamiento; el diseño del agente no cambia. Detectable con el probe sentinel en <30s.
2. **Si el harness con pro excede presupuesto** (improbable: ~$3.5/campaña a pricing canónico): crítico → flash + `reasoning_effort:"high"`.
3. **Si Anthropic se restaura** (memoria fase 3c): los gates de calidad se re-miden, pero esta integración no se toca — el merchandiser nunca está en el request path y su coste/latencia no compite con el reranker.

### Checks vinculantes para la implementación (P2-C2)

- [ ] Nunca `tool_choice` forzado (named o `"required"`) en un modelo con thinking enabled.
- [ ] `withStructuredOutput(..., { method: "jsonMode" })` siempre que el modelo tenga thinking ON, con "JSON" + ejemplo en el prompt.
- [ ] `maxTokens` explícito en todo constructor (≥2K si thinking ON).
- [ ] System prompt + tools byte-estables entre llamadas (cache hit 50× más barato — domina el coste del harness).
- [ ] Verificar que deepagents/LangGraph no inyecte `tool_choice` forzado en su estrategia de structured output cuando se le pase el modelo (a)/(b) — si lo hace, pasarle el modelo ya envuelto con jsonMode o usar el modelo (c) para ese paso.
- [ ] Actualizar el comment de pricing stale en `src/lib/llm/deepseek.ts:9` (cache hit flash es $0.0028/M, no $0.028/M).
- [ ] Smoke pre-deploy: `npx tsx scripts/_audit/a2-deepseek-langchain-probe.ts` (~$0.001) — caza el día en que DeepSeek cambie el contrato de thinking+tools.

---

## Apéndice: detalles del wrapper útiles durante la implementación

- `ChatDeepSeek extends ChatOpenAICompletions` (Chat Completions API; nunca la Responses API).
- `lc_secrets` mapea `apiKey → DEEPSEEK_API_KEY` (serialización LangSmith no filtra la key).
- `profile` (de `profiles.js` instalado): los 4 modelos (`deepseek-chat`, `deepseek-reasoner`, `deepseek-v4-pro`, `deepseek-v4-flash`) con `maxInputTokens: 1e6`, `maxOutputTokens: 384e3`, `toolCalling: true`; `structuredOutput: true` solo en los v4.
- Call options runtime (`ChatDeepSeekCallOptions extends ChatOpenAICallOptions`): `tools`, `tool_choice`, `parallel_tool_calls`, `strict`, `headers`, `signal`, etc. — pasables como 2º arg de `bindTools` o vía `withConfig`.
- El converter de salida preserva `message.reasoning_content → additional_kwargs.reasoning_content` (no-streaming y streaming); el converter de entrada lo descarta (no va al wire).
- Aliases legacy `deepseek-chat`/`deepseek-reasoner` mueren **2026-07-24**; ya migrado (P2-0), no introducirlos en código nuevo.
