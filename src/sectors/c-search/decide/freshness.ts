import type { Client } from "pg";

/**
 * F4 T4: freshness POR QUERY. Devuelve cuándo se llamó por última vez al
 * agregador externo para ESTE query_hash, o null si nunca. hybridSearch lo usa
 * para no re-pagar la misma búsqueda dentro de la ventana
 * (FRESHNESS_THRESHOLD_HOURS) y como NEGATIVE CACHE: una query que el agregador
 * respondió con 0 resultados igual quedó registrada, así que no se re-consulta.
 *
 * Reemplaza a la antigua freshness por categoría (MAX(last_refreshed_at) de la
 * categoría), que suprimía llamadas para queries legítimamente distintas de la
 * misma categoría (auditoría 2026-07-01).
 */
export async function getQueryFreshness(queryHash: string, pg: Client): Promise<Date | null> {
  const r = await pg.query(
    `SELECT last_called_at FROM query_aggregator_log WHERE query_hash = $1`,
    [queryHash],
  );
  const t = r.rows[0]?.last_called_at;
  return t ? new Date(t) : null;
}

/**
 * Registra una llamada al agregador para este query_hash (upsert). Se invoca
 * SOLO tras un fetch EXITOSO — incluido 0 resultados (negative cache legítimo).
 * Un fallo NO registra, para permitir reintento en la siguiente búsqueda.
 */
export async function recordQueryAggregatorCall(
  queryHash: string,
  resultCount: number,
  pg: Client,
): Promise<void> {
  await pg.query(
    `INSERT INTO query_aggregator_log (query_hash, last_called_at, result_count)
     VALUES ($1, now(), $2)
     ON CONFLICT (query_hash) DO UPDATE SET
       last_called_at = now(),
       result_count = EXCLUDED.result_count`,
    [queryHash, resultCount],
  );
}
