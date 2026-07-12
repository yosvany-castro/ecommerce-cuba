// src/sectors/b-catalog/weight-estimate.ts — peso estimado por producto.
// Cascada: products.weight_grams (measured|provider|llm) manda; sin dato →
// heurística pura (src/lib/weight.ts) respondida al instante + GRAFO LangGraph
// (weight-graph.ts: decisiones, validación y escalado flash→pro) fire-and-
// forget (patrón ingest-async: singleFlight + withPgDirect) que persiste en la
// columna. NUNCA en el camino crítico del render: el endpoint lo llama la PDP
// después del primer paint (skeleton mientras).
// Retroalimentación: cuando el admin pesa un producto real (weight_source=
// 'measured'), esos pesos entran como calibración en los prompts del grafo vía
// vecinos por embedding — pesar UN producto mejora los estimados de los
// similares.
import type { Client } from "pg";
import { withPgDirect } from "@/lib/db/helpers";
import { singleFlight } from "@/sectors/c-search/decide/single-flight";
import { estimateWeightGrams } from "@/lib/weight";
import { runWeightGraph } from "./weight-graph";

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
 * misma PDP = UN run del grafo. Conexión dedicada que hereda el search_path
 * del caller (mismo razonamiento que queueExternalIngest). El grafo persiste
 * él mismo (nodo persistir). */
export function queueWeightRefine(id: string, searchPath: string): Promise<number | null> {
  const p = singleFlight(`weight:${id}`, () =>
    withPgDirect(async (pg) => {
      await pg.query(`SET search_path TO ${searchPath}`);
      const result = await runWeightGraph(id, pg);
      return result.grams;
    }),
  );
  p.catch(() => {}); // jamás unhandled rejection en el path fire-and-forget
  return p as Promise<number | null>;
}
