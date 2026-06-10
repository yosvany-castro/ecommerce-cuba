import type { Client } from "pg";
import type { RankedItem } from "./rrf";
import {
  topSubcategoriesFromCounts,
  rankByViewedCategoriesQuota,
} from "../ranking/views-categories";

/**
 * "Views-categories" feed source: predict the user's top categories from their
 * recent product views (current-session views weighted ×3 — today's intent
 * dominates), then rank the POPULAR products inside those categories with
 * proportional quotas (shared module: ranking/views-categories.ts).
 *
 * This is the strongest realistic cold-home signal found by exp-I/exp-K on the
 * honest v2 world (pc-views-multi / pc-sess family): category-level
 * personalization × popularity, where pure cosine collapses.
 *
 * Popularity = raw event count over the last 7 days (views+carts+purchases),
 * matching the train-only event-count popularity the harness validated.
 * Returns [] when the user has no categorized views (RRF drops empty lists).
 */
export async function fetchViewsCategoriesList(
  opts: {
    user_id: string | null;
    anonymous_id: string | null;
    session_id: string | null;
    excludedIds: string[];
    limit?: number;
    maxCategories?: number;
    sessionWeight?: number;
  },
  pg: Client,
): Promise<RankedItem[]> {
  const limit = opts.limit ?? 20;
  if (!opts.user_id && !opts.anonymous_id) return [];

  // 1. Weighted view counts per category for this user (30-day window).
  const catRows = await pg.query(
    `SELECT p.metadata->>'category' AS cat,
            SUM(CASE WHEN $3::uuid IS NOT NULL AND e.session_id = $3::uuid
                     THEN $4::int ELSE 1 END)::int AS w
     FROM events e
     JOIN products p ON p.id = (e.payload->>'product_id')::uuid
     WHERE e.event_type = 'product_view'
       AND e.payload->>'product_id' IS NOT NULL
       AND e.occurred_at > now() - interval '30 days'
       AND ((e.user_id IS NOT NULL AND e.user_id = $1::uuid)
         OR (e.anonymous_id = $2::uuid))
       AND p.metadata->>'category' IS NOT NULL
     GROUP BY 1`,
    [opts.user_id, opts.anonymous_id, opts.session_id, opts.sessionWeight ?? 3],
  );
  const counts = new Map<string, number>(
    (catRows.rows as { cat: string; w: number }[]).map((r) => [r.cat, Number(r.w)]),
  );
  const topCats = topSubcategoriesFromCounts(counts, opts.maxCategories ?? 4);
  if (topCats.length === 0) return [];

  // 2. Popular products inside those categories (7-day raw event count).
  const candRows = await pg.query(
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
     ),
     pop AS (
       SELECT product_id, count(*)::int AS c FROM product_events GROUP BY 1
     )
     SELECT p.id::text AS id, p.metadata->>'category' AS cat, COALESCE(pop.c, 0)::int AS c
     FROM products p
     LEFT JOIN pop ON pop.product_id = p.id
     WHERE p.is_active = true
       AND p.metadata->>'category' = ANY($1::text[])
       AND NOT (p.id = ANY($2::uuid[]))
     ORDER BY COALESCE(pop.c, 0) DESC, p.id ASC
     LIMIT $3`,
    [topCats.map((t) => t.subcategory), opts.excludedIds, Math.max(60, limit * 3)],
  );
  const rows = candRows.rows as { id: string; cat: string; c: number }[];
  if (rows.length === 0) return [];
  const catOf = new Map(rows.map((r) => [r.id, r.cat]));
  const popOf = new Map(rows.map((r) => [r.id, Number(r.c)]));

  // Quota head of 10 + popularity-ordered tail up to `limit` — exp-K champion
  // list shape (pcSess(blend(3), 4) head): the first 10 slots are category-
  // personalized, the next 10 are the popularity rescue.
  const ranked = rankByViewedCategoriesQuota({
    topSubcategories: topCats,
    candidates: rows.map((r) => r.id),
    subcategoryOf: (id) => catOf.get(id) ?? null,
    popOf: (id) => popOf.get(id) ?? 0,
    headSize: Math.min(10, limit),
  });
  return ranked.slice(0, limit).map((id, i) => ({ id, rank: i + 1 }));
}
