import type { Client } from "pg";
import type { RankedItem } from "./rrf";
import { isPopularityTableReady } from "../popularity/recompute";

/**
 * Global popularity source (7-day raw event count: views + carts + purchase
 * line-items), demographic-free. Two jobs (exp-K, rrf-sess-pop champion):
 *   1. the "popularity rescue" half of the winning ensemble — when category
 *      prediction misses, best-sellers still fill the slate;
 *   2. plugs the cold-start hole: popular-by-cohort returns [] for the
 *      unisex_indeterminado cohort, leaving the feed with NO popularity
 *      signal exactly when we know least about the user.
 */
export async function fetchPopularGlobal(
  excludedIds: string[],
  limit: number,
  pg: Client,
): Promise<RankedItem[]> {
  // Fast path (0027): cron-materialized popularity, read by index.
  if (await isPopularityTableReady(pg)) {
    const r = await pg.query(
      `SELECT p.id::text AS id
       FROM product_popularity_7d pop
       JOIN products p ON p.id = pop.product_id
       WHERE p.is_active = true
         AND NOT (p.id = ANY($1::uuid[]))
       ORDER BY pop.events_7d DESC, p.id ASC
       LIMIT $2`,
      [excludedIds, limit],
    );
    return (r.rows as { id: string }[]).map((row, idx) => ({ id: row.id, rank: idx + 1 }));
  }
  const r = await pg.query(
    `WITH product_events AS (
       SELECT (payload->>'product_id')::uuid AS product_id
       FROM events
       WHERE occurred_at > now() - interval '7 days'
         AND event_type IN ('product_view', 'add_to_cart')
         AND (payload->>'product_id') IS NOT NULL
       UNION ALL
       SELECT (jsonb_array_elements_text(payload->'product_ids'))::uuid
       FROM events
       WHERE occurred_at > now() - interval '7 days'
         AND event_type = 'purchase'
         AND (payload->'product_ids') IS NOT NULL
     )
     SELECT p.id::text AS id
     FROM products p
     JOIN (SELECT product_id, count(*)::int AS c FROM product_events GROUP BY 1) pop
       ON pop.product_id = p.id
     WHERE p.is_active = true
       AND NOT (p.id = ANY($1::uuid[]))
     ORDER BY pop.c DESC, p.id ASC
     LIMIT $2`,
    [excludedIds, limit],
  );
  return (r.rows as { id: string }[]).map((row, idx) => ({ id: row.id, rank: idx + 1 }));
}
