// src/sectors/b-catalog/weight-graph.ts — grafo LangGraph de estimación de
// peso de PAQUETE (requisito de negocio: el estimador toma varias decisiones,
// no es una llamada suelta). Topología:
//
//   cargar ──(¿peso explícito en el texto?)──► consolidar ─► persistir
//      │ no
//      ▼
//   estimar_flash ──(¿verosímil vs heurística/vecinos?)──► consolidar ─► persistir
//      │ no (o parse falló)
//      ▼
//   estimar_pro (modelo más inteligente, analiza materiales/dimensiones)
//      ▼
//   consolidar ─► persistir
//
// Decisiones: (1) atajo si el proveedor/texto ya trae peso; (2) validación del
// estimado flash contra la banda de la heurística y los vecinos PESADOS en
// báscula; (3) escalado a deepseek-pro cuando flash no es confiable. Los
// vecinos medidos entran como calibración en ambos prompts — pesar un producto
// real mejora los estimados de los similares.
// Corre SIEMPRE en background (queueWeightRefine, singleFlight) — jamás en el
// camino del render.
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import type { Client } from "pg";
import { defaultProvider, deepseekProProvider, type LLMProvider } from "@/lib/llm/providers";
import { estimateWeightGrams, extractInlineWeightGrams, packagedGrams } from "@/lib/weight";

const CLAMP_MIN_G = 10;
const CLAMP_MAX_G = 100_000;
// Banda de verosimilitud del estimado flash respecto a la heurística: fuera de
// [heur/3, heur×3] se escala al modelo pro. ponytail: knob, ajustar con pruebas.
const PLAUSIBLE_RATIO = 3;

interface Neighbor {
  titulo: string;
  grams: number;
}

const WeightGraphState = Annotation.Root({
  productId: Annotation<string>,
  title: Annotation<string>,
  description: Annotation<string>,
  category: Annotation<string | null>,
  sizes: Annotation<string | null>,
  alreadyWeighted: Annotation<boolean>, // llegó por provider/measured en la carrera
  inlineGrams: Annotation<number | null>, // peso explícito en el texto (ya empaquetado)
  heuristicGrams: Annotation<number>,
  neighbors: Annotation<Neighbor[]>,
  flashGrams: Annotation<number | null>,
  usedPro: Annotation<boolean>,
  finalGrams: Annotation<number | null>,
});
type WState = typeof WeightGraphState.State;

function parseGrams(text: string): number | null {
  try {
    const parsed = JSON.parse(text) as { grams?: unknown };
    if (typeof parsed.grams === "number" && Number.isFinite(parsed.grams)) {
      return Math.round(Math.min(CLAMP_MAX_G, Math.max(CLAMP_MIN_G, parsed.grams)));
    }
  } catch {
    /* respuesta no parseable */
  }
  return null;
}

function estimatePrompt(s: WState, deep: boolean): { system: string; user: string } {
  return {
    system:
      "Eres un estimador de peso de PAQUETE listo para envío (producto + caja/envoltorio/relleno) para un ecommerce de reenvío. " +
      "OJO: las páginas de producto publican peso NETO; tu estimado debe incluir el empaque. " +
      (deep
        ? "Analiza paso a paso materiales, dimensiones y tallas antes de decidir, y da MÁS peso a los productos similares ya pesados en báscula real. "
        : "Si hay productos similares ya pesados en báscula real, dales prioridad. ") +
      'Responde SOLO JSON: {"grams": <entero>}.',
    // OJO: la heurística NO va en el prompt — visto en eval que el modelo la
    // eco-aba en vez de estimar. Estimado independiente; la heurística solo
    // valida en plausible() (estimador y validador separados).
    user: JSON.stringify({
      producto: {
        titulo: s.title,
        categoria: s.category,
        descripcion: s.description.slice(0, 500),
        tallas: s.sizes,
      },
      similares_pesados_en_bascula: s.neighbors,
    }),
  };
}

async function callEstimator(provider: LLMProvider, s: WState, deep: boolean): Promise<number | null> {
  const p = estimatePrompt(s, deep);
  const out = await provider.chat({
    system: p.system,
    messages: [{ role: "user", content: p.user }],
    maxTokens: deep ? 400 : 100,
    temperature: 0,
    jsonMode: true,
  });
  return parseGrams(out.text);
}

/** ¿El estimado flash es verosímil? Banda vs heurística; si hay vecinos
 * medidos, la banda se centra en su mediana (dato real > tabla semilla). */
function plausible(s: WState): boolean {
  if (s.flashGrams === null) return false;
  const anchor = s.neighbors.length >= 2
    ? [...s.neighbors.map((n) => n.grams)].sort((a, b) => a - b)[Math.floor(s.neighbors.length / 2)]
    : s.heuristicGrams;
  return s.flashGrams >= anchor / PLAUSIBLE_RATIO && s.flashGrams <= anchor * PLAUSIBLE_RATIO;
}

export function buildWeightGraph(pg: Client) {
  const cargar = async (s: WState): Promise<Partial<WState>> => {
    const r = await pg.query<{
      title: string;
      description: string;
      category: string | null;
      sizes: string | null;
      weight_grams: number | null;
    }>(
      `SELECT title, description, metadata->>'category' AS category,
              metadata->'attrs'->>'sizes' AS sizes, weight_grams
       FROM products WHERE id = $1`,
      [s.productId],
    );
    const row = r.rows[0];
    if (!row) return { alreadyWeighted: true, finalGrams: null };
    if (row.weight_grams != null) return { alreadyWeighted: true, finalGrams: row.weight_grams };

    const nb = await pg.query<{ titulo: string; grams: number }>(
      `SELECT title AS titulo, weight_grams AS grams FROM products
       WHERE weight_source = 'measured' AND weight_grams IS NOT NULL AND id <> $1
         AND embedding IS NOT NULL
         AND (SELECT embedding FROM products WHERE id = $1) IS NOT NULL
       ORDER BY embedding <=> (SELECT embedding FROM products WHERE id = $1)
       LIMIT 5`,
      [s.productId],
    );
    const inlineNet = extractInlineWeightGrams(`${row.title} ${row.description}`);
    return {
      title: row.title,
      description: row.description,
      category: row.category,
      sizes: row.sizes,
      alreadyWeighted: false,
      inlineGrams: inlineNet !== null ? packagedGrams(inlineNet, row.category) : null,
      heuristicGrams: estimateWeightGrams({ title: row.title, category: row.category, description: row.description }).grams,
      neighbors: nb.rows,
    };
  };

  const estimarFlash = async (s: WState): Promise<Partial<WState>> => {
    const grams = await callEstimator(defaultProvider, s, false).catch(() => null);
    return { flashGrams: grams };
  };

  const estimarPro = async (s: WState): Promise<Partial<WState>> => {
    const grams = await callEstimator(deepseekProProvider, s, true).catch(() => null);
    // pro tampoco pudo → flash si existió; último recurso: nada (la heurística
    // pura sigue cubriendo la UI sin persistir, honesto).
    return { usedPro: true, finalGrams: grams ?? s.flashGrams ?? null };
  };

  const consolidar = async (s: WState): Promise<Partial<WState>> => {
    if (s.inlineGrams !== null) return { finalGrams: s.inlineGrams };
    return { finalGrams: s.flashGrams };
  };

  const persistir = async (s: WState): Promise<Partial<WState>> => {
    if (s.alreadyWeighted || s.finalGrams === null) return {};
    await pg.query(
      `UPDATE products SET weight_grams = $1, weight_source = 'llm'
       WHERE id = $2 AND (weight_source IS NULL OR weight_source = 'llm')`,
      [s.finalGrams, s.productId],
    );
    return {};
  };

  return new StateGraph(WeightGraphState)
    .addNode("cargar", cargar)
    .addNode("estimar_flash", estimarFlash)
    .addNode("estimar_pro", estimarPro)
    .addNode("consolidar", consolidar)
    .addNode("persistir", persistir)
    .addEdge(START, "cargar")
    // Decisión 1: ya pesado (carrera) → fin; peso explícito → sin LLM.
    .addConditionalEdges("cargar", (s) =>
      s.alreadyWeighted ? END : s.inlineGrams !== null ? "consolidar" : "estimar_flash",
    )
    // Decisión 2: ¿flash verosímil contra heurística/vecinos? Si no → pro.
    .addConditionalEdges("estimar_flash", (s) => (plausible(s) ? "consolidar" : "estimar_pro"))
    .addEdge("estimar_pro", "persistir")
    .addEdge("consolidar", "persistir")
    .addEdge("persistir", END)
    .compile();
}

export interface WeightGraphResult {
  grams: number | null;
  usedPro: boolean;
  heuristicGrams: number | null;
  neighborsUsed: number;
}

/** Corre el grafo para un producto. Devuelve el resultado (para el eval y los
 * tests); la persistencia ya ocurrió dentro del grafo. */
export async function runWeightGraph(productId: string, pg: Client): Promise<WeightGraphResult> {
  const graph = buildWeightGraph(pg);
  const out = await graph.invoke(
    {
      productId,
      title: "",
      description: "",
      category: null,
      sizes: null,
      alreadyWeighted: false,
      inlineGrams: null,
      heuristicGrams: 0,
      neighbors: [],
      flashGrams: null,
      usedPro: false,
      finalGrams: null,
    },
    { recursionLimit: 10 },
  );
  return {
    grams: out.finalGrams,
    usedPro: out.usedPro,
    heuristicGrams: out.heuristicGrams || null,
    neighborsUsed: out.neighbors.length,
  };
}
