import type { Client } from "pg";
import {
  parseCohort,
  AGE_BAND_RANGES,
  type CohortId,
} from "../cohorts/definitions";
import type { RankedItem } from "./rrf";

/**
 * Log-weighted popularity score for products in the given cohort over last 7d.
 *   score = ln(1 + views) + 2·ln(1 + carts) + 3·ln(1 + purchases)
 *
 * Returns top-`limit` products as RankedItem[], excluding any in excludedIds.
 * For unisex_indeterminado cohort, returns empty (no concrete demographic filter).
 */
export async function fetchPopularByCohort(
  cohort_id: CohortId,
  excludedIds: string[],
  limit: number,
  pg: Client,
): Promise<RankedItem[]> {
  const { gender, age_band } = parseCohort(cohort_id);
  if (!gender || !age_band) return [];
  const range = AGE_BAND_RANGES[age_band];

  const r = await pg.query(
    `WITH cohort_products AS (
       SELECT id FROM products
       WHERE is_active = true
         AND metadata->>'gender_target' = $1
         AND (metadata->'age_target'->>'min')::int <= $2
         AND (metadata->'age_target'->>'max')::int >= $3
         AND NOT (id = ANY($4::uuid[]))
     ),
     all_events AS (
       SELECT event_type, (payload->>'product_id')::uuid AS product_id
       FROM events
       WHERE occurred_at > now() - interval '7 days'
         AND event_type IN ('product_view', 'add_to_cart')
         AND (payload->>'product_id') IS NOT NULL
       UNION ALL
       SELECT 'purchase' AS event_type,
              (jsonb_array_elements_text(payload->'product_ids'))::uuid AS product_id
       FROM events
       WHERE occurred_at > now() - interval '7 days'
         AND event_type = 'purchase'
         AND (payload->'product_ids') IS NOT NULL
     ),
     event_counts AS (
       SELECT product_id,
              SUM(CASE WHEN event_type = 'product_view' THEN 1 ELSE 0 END) AS views,
              SUM(CASE WHEN event_type = 'add_to_cart' THEN 1 ELSE 0 END) AS carts,
              SUM(CASE WHEN event_type = 'purchase' THEN 1 ELSE 0 END) AS purchases
       FROM all_events
       GROUP BY product_id
     )
     SELECT cp.id::text AS id,
       (LN(1 + COALESCE(ec.views, 0))
        + 2 * LN(1 + COALESCE(ec.carts, 0))
        + 3 * LN(1 + COALESCE(ec.purchases, 0))) AS score
     FROM cohort_products cp
     LEFT JOIN event_counts ec ON ec.product_id = cp.id
     WHERE (COALESCE(ec.views, 0) + COALESCE(ec.carts, 0) + COALESCE(ec.purchases, 0)) > 0
     ORDER BY score DESC
     LIMIT $5`,
    [gender, range.min, range.max, excludedIds, limit],
  );

  return (r.rows as { id: string }[]).map((row, idx) => ({
    id: row.id,
    rank: idx + 1,
  }));
}
