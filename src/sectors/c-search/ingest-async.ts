// src/sectors/c-search/ingest-async.ts — F4 T3: ingesta externa ASÍNCRONA.
// La búsqueda devuelve lo local YA; el fetch al proveedor + enriquecimiento
// (LLM+embedding por producto, el tramo de decenas de segundos con APIs
// reales) corre de fondo con su PROPIA conexión (la del request muere con el
// request). Al terminar invalida la caché exacta de esa query: la siguiente
// búsqueda idéntica es miss y re-recupera incluyendo lo ingestado — sin esa
// invalidación, la caché congelaría el resultado local-only 24h.
import type { Client } from "pg";
import { withPgDirect } from "@/lib/db/helpers";
import { activeProvider } from "@/sectors/b-catalog/provider";
import { processProduct } from "@/sectors/b-catalog/enrichment/pipeline";
import type { MockCategory } from "@/sectors/b-catalog/mock/types";
import { singleFlight } from "./decide/single-flight";

/** Lectura por-llamada (testeable en ambos modos). Default: asíncrona. */
export function asyncIngestEnabled(): boolean {
  return process.env.SEARCH_ASYNC_INGEST !== "false";
}

export interface IngestOutcome {
  fetched: number;
  processed: number;
  failed: number;
  was_error: boolean;
}

async function runIngest(
  input: { hash: string; query?: string; category?: MockCategory; limit?: number },
  pg: Client,
): Promise<IngestOutcome> {
  const t0 = Date.now();
  try {
    const res = await activeProvider.fetch({
      category: input.category,
      query: input.query,
      limit: input.limit,
    });
    await pg.query(
      `INSERT INTO mock_calls (params, response_size, simulated_cost_cents, latency_ms, was_error)
       VALUES ($1::jsonb, $2, $3, $4, false)`,
      [
        JSON.stringify({ source: "async_ingest", provider: activeProvider.name, query: input.query }),
        res.products.length,
        res.cost_cents,
        Math.round(Date.now() - t0),
      ],
    );
    let processed = 0;
    let failed = 0;
    const seen = new Set<string>();
    for (const raw of res.products) {
      const key = `${raw.source}:${raw.source_product_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        await processProduct(raw, pg);
        processed++;
      } catch {
        failed++;
      }
    }
    await pg.query(`DELETE FROM product_query_cache WHERE query_hash = $1`, [input.hash]);
    return { fetched: res.products.length, processed, failed, was_error: false };
  } catch {
    try {
      await pg.query(
        `INSERT INTO mock_calls (params, response_size, simulated_cost_cents, latency_ms, was_error)
         VALUES ($1::jsonb, 0, 4, 0, true)`,
        [JSON.stringify({ source: "async_ingest", provider: activeProvider.name, query: input.query })],
      );
    } catch {
      // el logging jamás tumba el job
    }
    return { fetched: 0, processed: 0, failed: 0, was_error: true };
  }
}

/**
 * Encola la ingesta (fire-and-forget para producción; los tests/evals pueden
 * await-ear la promesa devuelta). Single-flight por hash: N búsquedas
 * idénticas concurrentes = UNA llamada pagada y UN job.
 */
export function queueExternalIngest(input: {
  hash: string;
  query?: string;
  category?: MockCategory;
  limit?: number;
  /**
   * search_path del cliente del request (SHOW search_path) — el job corre en
   * conexión DEDICADA (withPgDirect, no el pool: mutar el path de un cliente
   * pooleado envenenaría a otros usuarios) y hereda el schema del caller, de
   * modo que bajo tests escribe en test_schema y no contamina public.
   */
  searchPath: string;
}): Promise<IngestOutcome> {
  const p = singleFlight(`ingest:${input.hash}`, () =>
    withPgDirect(async (pg) => {
      await pg.query(`SET search_path TO ${input.searchPath}`);
      return runIngest(input, pg);
    }),
  );
  p.catch(() => {}); // jamás unhandled rejection en el path fire-and-forget
  return p;
}
