import type { Client } from "pg";

/**
 * Raw event count per product over the last 7 days (views + carts + purchase
 * line-items) for a given id set — the popularity input of the multiplicative
 * prior (ranking/pop-prior.ts) applied to the cosine retrieval lists.
 * Products with no events are simply absent (caller treats missing as 0).
 */
export async function fetchEventCounts7d(
  ids: readonly string[],
  pg: Client,
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
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
     SELECT product_id::text AS id, count(*)::int AS c
     FROM product_events
     WHERE product_id = ANY($1::uuid[])
     GROUP BY 1`,
    [ids],
  );
  return new Map((r.rows as { id: string; c: number }[]).map((x) => [x.id, Number(x.c)]));
}
