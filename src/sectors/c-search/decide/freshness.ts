import type { Client } from "pg";

/**
 * Returns the most recent `last_refreshed_at` timestamp across active products
 * in the given category, or null if no matching products exist or the category
 * is null. Used by hybridSearch to avoid paying a mock-API call when we already
 * refreshed this category recently (master doc Sec 9 Paso 5).
 */
export async function getCategoryFreshness(
  category: string | null,
  pg: Client,
): Promise<Date | null> {
  if (!category) return null;
  const r = await pg.query(
    `SELECT MAX(last_refreshed_at) AS last_refresh
     FROM products
     WHERE metadata->>'category' = $1 AND is_active = true`,
    [category],
  );
  const t = r.rows[0]?.last_refresh;
  return t ? new Date(t) : null;
}
