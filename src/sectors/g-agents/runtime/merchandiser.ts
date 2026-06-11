import { createDeepAgent, type SubAgent } from "deepagents";
import { createMiddleware } from "langchain";
import { tool } from "@langchain/core/tools";
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

const hideBuiltinTools = createMiddleware({
  name: "HideBuiltinToolsMiddleware",
  wrapModelCall: async (request, handler) =>
    handler({ ...request, tools: request.tools.filter((t) => !HIDDEN.has(String(t.name))) }),
});

export const MERCHANDISER_PROMPT = `Eres el merchandiser de una tienda e-commerce para Cuba. Tu único poder es proponer
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
re-proponerlo con la evidencia de since_change.`;

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
    if (e instanceof GraphRecursionError || isAbortLike(e)) {
      truncated = true; // las propuestas ya escritas por tools sobreviven
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
