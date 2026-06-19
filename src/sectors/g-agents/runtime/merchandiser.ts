import { createDeepAgent, type SubAgent } from "deepagents";
import { createMiddleware } from "langchain";
import { tool } from "@langchain/core/tools";
import { ToolMessage } from "@langchain/core/messages";
import { GraphRecursionError } from "@langchain/langgraph";
import { z } from "zod";
import { merchandiserLoopModel, criticModel } from "@/sectors/g-agents/llm";
import { PlacementProposalSchema, type PlacementProposal } from "@/sectors/g-agents/write/schema";
import type { MerchandiserBackend, ProposalResult } from "./backend";

/**
 * El agente merchandiser (blueprint §4.9). Contrato del run = side-effects de
 * propose_placement; el texto final es solo log. Hermético por construcción:
 * SIN backend deepagents (StateBackend = fs 100% virtual, sin tool execute),
 * SIN checkpointer (one-shot), SIN responseFormat (tool_choice forzado da 400
 * con thinking ON). Los prompts son constantes BYTE-ESTABLES: el caché de
 * contexto de DeepSeek (hit 50× más barato) es el factor #1 de coste del gate.
 */

const HIDDEN = new Set(["ls", "read_file", "write_file", "edit_file", "glob", "grep", "write_todos"]); // task VISIBLE (critic)

export const hideBuiltinTools = createMiddleware({
  name: "HideBuiltinToolsMiddleware",
  wrapModelCall: async (request, handler) =>
    handler({ ...request, tools: request.tools.filter((t) => !HIDDEN.has(String(t.name))) }),
  // Filtrar el request NO basta: el system prompt de deepagents menciona los
  // builtins, el modelo puede alucinar uno por nombre y el ToolNode lo ejecuta
  // igual (sigue registrado en el grafo) — un input mal tipado ahí escala a
  // MiddlewareError fatal y mata el run entero (visto en el gate: el critic
  // llamó write_todos con {text} en vez de {content}). Short-circuit recuperable.
  wrapToolCall: async (request, handler) => {
    const name = String(request.toolCall.name);
    if (HIDDEN.has(name)) {
      return new ToolMessage({
        tool_call_id: request.toolCall.id ?? "",
        name,
        content: `La tool ${name} no está disponible en este agente. Continúa sin ella.`,
        status: "error",
      });
    }
    // Una tool REAL (propose_placement) llamada con args que violan su Zod
    // (p.ej. slot<20) lanza en la capa de tool de langchain y escala a un
    // MiddlewareError FATAL que mata el run entero — igual que el builtin
    // alucinado de arriba. Convertir cualquier throw en un ToolMessage de error
    // recuperable: el agente lee el motivo y corrige, en vez de perder la época.
    try {
      return await handler(request);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new ToolMessage({
        tool_call_id: request.toolCall.id ?? "",
        name,
        content: `La llamada a ${name} falló: ${msg}. Corrige los argumentos y reintenta (recuerda: en create el slot va de 20 a 90, nunca 10).`,
        status: "error",
      });
    }
  },
});

export const MERCHANDISER_PROMPT = `Eres el merchandiser de una tienda e-commerce para Cuba. Tu único poder es proponer
cambios de placements (secciones de página) vía propose_placement; jamás aplicas nada
directamente: el sistema decide el tier y el status.

ESTRUCTURA DE LA TIENDA (dónde vive el valor — léela antes de proponer):
- El HOME tiene el hero (slot 10, del motor, INTOCABLE) y debajo los carruseles que TÚ añades
  en slots 20..90. La atención del usuario DECAE con el slot: slot 20 (justo bajo el hero) es
  el de MAYOR atención, slot 30 el siguiente, y así. Los carruseles del home son ADITIVOS
  PUROS: sin ti el home solo muestra el hero, así que cada carrusel tuyo es margen nuevo. Son
  tu MAYOR palanca. Prioriza LLENAR los slots bajos del home (20, luego 30, 40) con secciones
  fuertes y bien justificadas por métricas.
- La PDP muestra cross_sell (anclado al producto mirado) y la página de CARRITO muestra
  cart_addons. Esas superficies ya sirven un default razonable; tu placement ahí solo aporta
  si supera al default. Útiles, pero SECUNDARIAS frente a los carruseles aditivos del home.
- Estrategia: primero asegura los carruseles de alto valor del home (slots bajos); LUEGO, si
  tienes evidencia, mejora PDP/cart. No dispersa en superficies de bajo tráfico antes de
  haber cubierto el inmueble aditivo del home.

SECCIONES Y PARAMS VÁLIDOS (cualquier OTRA clave = RECHAZO automático; no inventes claves):
- popular     → { "limit": 1..30, "mode": "global" | "cohort" | "pdp_category" }.
  Para "lo más popular de una categoría" usa mode="pdp_category" (NO existe clave "category").
  mode="cohort" = popular dentro del segmento del usuario.
- cross_sell  → { "limit": 1..20 }.
- cart_addons → { "limit": 1..20 }.

Protocolo obligatorio:
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
ajenas (solo pause_own de las tuyas; para pausar algo humano usa request_pause); en
create el slot va de 20 a 90 en TODAS las superficies (home, pdp, cart) — el slot 10 es
del seed/sistema y NUNCA se usa en create; todo lo que apliques expira por TTL — si
funciona, deberás re-proponerlo con la evidencia de since_change.`;

export const CRITIC_PROMPT = `Eres un auditor escéptico de propuestas de merchandising. Recibes un borrador de
propuestas de placements y los números que supuestamente las justifican. Tu trabajo:
1. Verifica con read_metrics que cada número citado EXISTE en el reporte (ids,
   ctr_seen, revenue_cents, ventana). Un número que no aparece = objeción.
2. Rechaza toda propuesta apoyada en celdas flaggeadas (low_sample,
   insufficient_holdout_data, no_impression_logging, no_seen_tracking) o en null.
3. Rechaza propuestas sin hipótesis medible (¿qué esperas ver en since_change?).
Responde SOLO un objeto JSON con este shape exacto, sin texto adicional:
{"approve": false, "objections": ["la propuesta 2 cita ctr_seen=0.041 pero el reporte da null con flag low_sample"]}
Si todo sobrevive: {"approve": true, "objections": []}`;

export const TASK_MESSAGE =
  "Revisa las métricas de la tienda y propone hasta 5 ajustes de placements según tu protocolo.";

export function buildMerchandiser(backend: MerchandiserBackend) {
  const readMetrics = tool(
    async (i: { surface?: "home" | "pdp" | "cart" | "search"; window_days: 7 | 14 | 28 }) =>
      backend.readMetrics(i),
    {
      name: "read_metrics",
      description:
        "Lee el reporte de métricas de la tienda (funnels por placement, vs_holdout, categorías). JSON.",
      schema: z.object({
        surface: z.enum(["home", "pdp", "cart", "search"]).optional(),
        window_days: z.union([z.literal(7), z.literal(14), z.literal(28)]).default(7),
      }),
    },
  );
  const readCatalog = tool(
    async (i: { category?: string; limit: number }) => backend.readCatalog(i),
    {
      name: "read_catalog",
      description: "Lista productos activos (precio, categoría, popularidad 7d, edad). JSON.",
      schema: z.object({
        category: z.string().min(1).max(64).optional(),
        limit: z.number().int().min(1).max(30).default(15),
      }),
    },
  );
  // El union discriminado va envuelto en {proposal}: la API DeepSeek exige
  // type:"object" en la raíz del schema del tool (400 verificado con el anyOf
  // desnudo). El parse estricto del union se conserva intacto.
  const proposePlacement = tool(
    async (i: { proposal: PlacementProposal }) =>
      JSON.stringify(await backend.proposeWrite(i.proposal)),
    {
      name: "propose_placement",
      description:
        "Registra UNA propuesta de placement (objeto en el campo proposal). low se aplica con TTL; " +
        "high queda pending para un humano. El tier lo decide el sistema, no tú. " +
        "Cita números de read_metrics en rationale o será rechazada.",
      schema: z.object({ proposal: PlacementProposalSchema }),
    },
  );

  const critic: SubAgent = {
    name: "critic",
    description: "Auditor escéptico. Pásale tu borrador de propuestas ANTES de ejecutar propose_placement.",
    systemPrompt: CRITIC_PROMPT,
    tools: [readMetrics],
    model: criticModel(),
    middleware: [hideBuiltinTools],
  };
  // shadowing del general-purpose default (A1 §3.5): con instancia ChatDeepSeek
  // el harness profile no resuelve y el GP se auto-añadiría con TODOS los tools.
  const gpStub: SubAgent = {
    name: "general-purpose",
    description: "Deshabilitado. No usar.",
    systemPrompt: "Responde únicamente: deshabilitado.",
    tools: [],
    middleware: [hideBuiltinTools],
  };

  return createDeepAgent({
    model: merchandiserLoopModel(),
    tools: [readMetrics, readCatalog, proposePlacement],
    systemPrompt: MERCHANDISER_PROMPT,
    subagents: [critic, gpStub],
    middleware: [hideBuiltinTools],
  });
  // SIN backend (StateBackend hermético), SIN checkpointer, SIN responseFormat.
}

export interface MerchandiserRunResult {
  runId: string;
  proposals: ProposalResult[];
  finalText: string;
  truncated: boolean;
  applied: number;
  pending: number;
  rejected: number;
}

function isAbortLike(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

export async function runMerchandiserOnce(opts: {
  backend: MerchandiserBackend;
  timeoutMs?: number;
}): Promise<MerchandiserRunResult> {
  // closure POR RUN: las propuestas son el resultado del run, registradas
  // envolviendo el backend (los caps viven dentro del backend mismo).
  const proposals: ProposalResult[] = [];
  const recording: MerchandiserBackend = {
    ...opts.backend,
    proposeWrite: async (i) => {
      const r = await opts.backend.proposeWrite(i);
      proposals.push(r);
      return r;
    },
  };
  const agent = buildMerchandiser(recording);

  let finalText = "";
  let truncated = false;
  try {
    const result = await agent.invoke(
      { messages: [{ role: "user", content: TASK_MESSAGE }] },
      // deepagents fija recursionLimit 10000 vía withConfig — override SIEMPRE
      { recursionLimit: 40, signal: AbortSignal.timeout(opts.timeoutMs ?? 600_000) },
    );
    const last = result.messages.at(-1);
    finalText = typeof last?.content === "string" ? last.content : (last?.text ?? "");
  } catch (e) {
    // GraphRecursion / abort / timeout → run truncado, las propuestas ya escritas
    // por tools sobreviven. MiddlewareError (un error de tool que A1 no convirtió
    // en ToolMessage recuperable) NO debe invalidar el seed entero: backstop final.
    if (
      e instanceof GraphRecursionError ||
      isAbortLike(e) ||
      (e instanceof Error && e.name === "MiddlewareError")
    ) {
      truncated = true;
    } else {
      throw e;
    }
  }

  const applied = proposals.filter(
    (p) => p.accepted && (p.status === "approved" || p.status === "paused"),
  ).length;
  const pending = proposals.filter((p) => p.accepted && p.status === "pending").length;
  const rejected = proposals.filter((p) => !p.accepted).length;
  return { runId: opts.backend.runId, proposals, finalText, truncated, applied, pending, rejected };
}
