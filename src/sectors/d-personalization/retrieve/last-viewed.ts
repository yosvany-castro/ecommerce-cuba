import type { Client } from "pg";

export const LAST_VIEWED_WINDOW_MIN = 30;

/**
 * Returns the product_id of the most recent product_view within the given
 * window for the session, or null.
 */
export async function fetchLastViewedProduct(
  session_id: string,
  pg: Client,
  windowMin: number = LAST_VIEWED_WINDOW_MIN,
): Promise<string | null> {
  const r = await pg.query(
    `SELECT (payload->>'product_id') AS product_id
     FROM events
     WHERE session_id = $1
       AND event_type = 'product_view'
       AND occurred_at > now() - ($2 || ' minutes')::interval
       AND (payload->>'product_id') IS NOT NULL
     ORDER BY occurred_at DESC
     LIMIT 1`,
    [session_id, windowMin],
  );
  return r.rows[0]?.product_id ?? null;
}
