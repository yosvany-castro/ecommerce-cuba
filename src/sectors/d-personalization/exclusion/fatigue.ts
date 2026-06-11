import type { Client } from "pg";

/**
 * Fatigue exclusion (E3): a product the user actually SAW (viewport-confirmed
 * seen_at — never served_at) ≥3 times in 7 days without a single click gets
 * rested for 7 days (half the dismiss TTL: inferred weak signal earns half
 * the penalty of explicit rejection). Runs from cron, NEVER on the serving
 * path; the feed picks exclusions up through fetchExcludedIds unchanged.
 */

export const FATIGUE_SEEN_THRESHOLD = 3;
export const FATIGUE_TTL_DAYS = 7;

export async function applyFatigueExclusions(pg: Client): Promise<{ excluded: number }> {
  const r = await pg.query(
    `WITH seen AS (
       SELECT fi.user_profile_id, fi.product_id, count(*) AS times_seen
       FROM feed_impressions fi
       WHERE fi.seen_at IS NOT NULL
         AND fi.served_at > now() - interval '7 days'
         AND fi.user_profile_id IS NOT NULL
       GROUP BY 1, 2
       HAVING count(*) >= $1
     ),
     fatigued AS (
       SELECT s.user_profile_id, s.product_id, up.anonymous_id, up.user_id
       FROM seen s
       JOIN user_profiles up ON up.id = s.user_profile_id
       WHERE NOT EXISTS (
         -- un click del MISMO usuario lo absuelve (vio y le interesó)
         SELECT 1 FROM events e
         WHERE e.event_type = 'product_view'
           AND e.payload->>'product_id' = s.product_id::text
           AND ((up.user_id IS NOT NULL AND e.user_id = up.user_id)
             OR (up.user_id IS NULL AND e.anonymous_id = up.anonymous_id))
           AND e.occurred_at > now() - interval '7 days'
       )
     )
     INSERT INTO excluded_products (anonymous_id, user_id, product_id, ttl_until, reason)
     SELECT f.anonymous_id, f.user_id, f.product_id,
            now() + make_interval(days => $2), 'fatigue'
     FROM fatigued f
     WHERE NOT EXISTS (
       SELECT 1 FROM excluded_products ep
       WHERE ep.product_id = f.product_id
         AND ep.ttl_until > now()
         AND ((f.user_id IS NOT NULL AND ep.user_id = f.user_id)
           OR (f.user_id IS NULL AND ep.anonymous_id = f.anonymous_id))
     )`,
    [FATIGUE_SEEN_THRESHOLD, FATIGUE_TTL_DAYS],
  );
  return { excluded: r.rowCount ?? 0 };
}
