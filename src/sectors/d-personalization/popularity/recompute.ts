import type { Client } from "pg";

/**
 * Materialized 7-day popularity (0027_product_popularity.sql).
 *
 * `recomputePopularity7d` is the cron body (every 10-15 min): one aggregation
 * over 7 days of events — views + carts weigh 1 each, purchase line-items
 * weigh 1 each in events_7d (raw event count, the popularity the pop-prior
 * and exp-K validated) — joined to products for the category column the
 * views-categories source quotas by. Transactional DELETE+INSERT: readers
 * never observe a half-built table.
 */
export async function recomputePopularity7d(
  pg: Client,
): Promise<{ products: number }> {
  await pg.query("BEGIN");
  try {
    await pg.query(`DELETE FROM product_popularity_7d`);
    const r = await pg.query(
      `WITH product_events AS (
         SELECT (payload->>'product_id')::uuid AS product_id,
                CASE event_type WHEN 'product_view' THEN 'view' ELSE 'cart' END AS kind
         FROM events
         WHERE occurred_at > now() - interval '7 days'
           AND event_type IN ('product_view', 'add_to_cart')
           AND (payload->>'product_id') IS NOT NULL
         UNION ALL
         SELECT (jsonb_array_elements_text(payload->'product_ids'))::uuid, 'purchase'
         FROM events
         WHERE occurred_at > now() - interval '7 days'
           AND event_type = 'purchase'
           AND (payload->'product_ids') IS NOT NULL
       )
       INSERT INTO product_popularity_7d
         (product_id, events_7d, views_7d, carts_7d, purchases_7d, category, computed_at)
       SELECT pe.product_id,
              count(*)::int,
              count(*) FILTER (WHERE pe.kind = 'view')::int,
              count(*) FILTER (WHERE pe.kind = 'cart')::int,
              count(*) FILTER (WHERE pe.kind = 'purchase')::int,
              p.metadata->>'category',
              now()
       FROM product_events pe
       JOIN products p ON p.id = pe.product_id
       GROUP BY pe.product_id, p.metadata->>'category'`,
    );
    await pg.query("COMMIT");
    return { products: r.rowCount ?? 0 };
  } catch (e) {
    await pg.query("ROLLBACK");
    throw e;
  }
}

// Once the cron has populated the table it stays populated (15-min cadence),
// so a positive answer is cached for the process lifetime; a negative answer
// is re-checked on every call (cheap LIMIT 1) until the first cron run lands.
let knownReady = false;

export async function isPopularityTableReady(pg: Client): Promise<boolean> {
  if (knownReady) return true;
  const r = await pg.query(`SELECT 1 FROM product_popularity_7d LIMIT 1`);
  knownReady = r.rows.length > 0;
  return knownReady;
}

/** Test-only: forget the cached readiness (table truncated between tests). */
export function resetPopularityReadinessForTests(): void {
  knownReady = false;
}
