// src/sectors/b-catalog/weight-estimate.ts — peso estimado por producto.
// Cascada: products.weight_grams (measured|provider|llm) manda; sin dato →
// heurística pura (src/lib/weight.ts) respondida al instante + refinado LLM
// fire-and-forget (patrón ingest-async: singleFlight + withPgDirect) que
// persiste en la columna. NUNCA en el camino crítico del render: el endpoint
// lo llama la PDP después del primer paint (skeleton mientras).
// Retroalimentación: cuando el admin pesa un producto real (weight_source=
// 'measured'), esos pesos entran como contexto de calibración en el prompt de
// los vecinos por embedding — pesar UN producto mejora los estimados de los
// similares.
import type { Client } from "pg";
import { withPgDirect } from "@/lib/db/helpers";
import { defaultProvider } from "@/lib/llm/providers";
import { singleFlight } from "@/sectors/c-search/decide/single-flight";
import { estimateWeightGrams } from "@/lib/weight";

export interface WeightAnswer {
  grams: number;
  source: "measured" | "provider" | "llm" | "heuristic";
  estimated: boolean; // false solo si fue pesado físicamente
}

function llmEnabled(): boolean {
  return process.env.WEIGHT_LLM !== "false" && !!process.env.DEEPSEEK_API_KEY;
}

/** Mejor peso disponible YA (sin esperar LLM) + encola el refinado si falta. */
export async function getOrEstimateWeight(id: string, pg: Client): Promise<WeightAnswer | null> {
  const r = await pg.query<{
    weight_grams: number | null;
    weight_source: string | null;
    title: string;
    description: string;
    category: string | null;
  }>(
    `SELECT weight_grams, weight_source, title, description, metadata->>'category' AS category
     FROM products WHERE id = $1 AND is_active = true`,
    [id],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.weight_grams != null) {
    const source = (row.weight_source ?? "provider") as WeightAnswer["source"];
    return { grams: row.weight_grams, source, estimated: source !== "measured" };
  }
  if (llmEnabled()) {
    const searchPath = (await pg.query(`SHOW search_path`)).rows[0].search_path as string;
    queueWeightRefine(id, searchPath);
  }
  const h = estimateWeightGrams({ title: row.title, category: row.category, description: row.description });
  return { grams: h.grams, source: "heuristic", estimated: true };
}

/** Fire-and-forget con single-flight por producto: N visitas concurrentes a la
 * misma PDP = UNA llamada LLM. Conexión dedicada que hereda el search_path del
 * caller (mismo razonamiento que queueExternalIngest). */
export function queueWeightRefine(id: string, searchPath: string): Promise<number | null> {
  const p = singleFlight(`weight:${id}`, () =>
    withPgDirect(async (pg) => {
      await pg.query(`SET search_path TO ${searchPath}`);
      return refineWeightWithLLM(id, pg);
    }),
  );
  p.catch(() => {}); // jamás unhandled rejection en el path fire-and-forget
  return p as Promise<number | null>;
}

const CLAMP_MIN_G = 10;
const CLAMP_MAX_G = 100_000;

/** Refinado LLM (DeepSeek flash): título+categoría+descripción + vecinos ya
 * PESADOS como calibración → gramos enteros, persistidos con source='llm'.
 * Exportada aparte para poder await-earla en tests. */
export async function refineWeightWithLLM(id: string, pg: Client): Promise<number | null> {
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
    [id],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.weight_grams != null) return row.weight_grams; // llegó por otra vía (provider/measured) — no gastar

  const nb = await pg.query<{ title: string; weight_grams: number }>(
    `SELECT title, weight_grams FROM products
     WHERE weight_source = 'measured' AND weight_grams IS NOT NULL AND id <> $1
       AND embedding IS NOT NULL
       AND (SELECT embedding FROM products WHERE id = $1) IS NOT NULL
     ORDER BY embedding <=> (SELECT embedding FROM products WHERE id = $1)
     LIMIT 5`,
    [id],
  );
  const heur = estimateWeightGrams({ title: row.title, category: row.category, description: row.description });

  const out = await defaultProvider.chat({
    system:
      "Eres un estimador de peso de PAQUETE (producto + empaque de envío) para un ecommerce. " +
      "Te doy un producto y, si existen, productos similares ya pesados en báscula real (calibración: dales prioridad). " +
      'Responde SOLO JSON: {"grams": <entero>}.',
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          producto: {
            titulo: row.title,
            categoria: row.category,
            descripcion: row.description.slice(0, 500),
            tallas: row.sizes,
          },
          heuristica_base_grams: heur.grams,
          similares_pesados_en_bascula: nb.rows.map((n) => ({ titulo: n.title, grams: n.weight_grams })),
        }),
      },
    ],
    maxTokens: 100,
    temperature: 0,
    jsonMode: true,
  });

  let grams: number | null = null;
  try {
    const parsed = JSON.parse(out.text) as { grams?: unknown };
    if (typeof parsed.grams === "number" && Number.isFinite(parsed.grams)) {
      grams = Math.round(Math.min(CLAMP_MAX_G, Math.max(CLAMP_MIN_G, parsed.grams)));
    }
  } catch {
    grams = null; // respuesta no parseable: sin persistir, la heurística sigue cubriendo
  }
  if (grams === null) return null;

  // Solo pisa vacío o un estimado LLM previo — provider/measured mandan.
  await pg.query(
    `UPDATE products SET weight_grams = $1, weight_source = 'llm'
     WHERE id = $2 AND (weight_source IS NULL OR weight_source = 'llm')`,
    [grams, id],
  );
  return grams;
}
