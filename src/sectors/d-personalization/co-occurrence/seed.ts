import type { Client } from "pg";

export const SEED_WEIGHT = 0.1;
export const SEED_PRICE_TOLERANCE = 0.5;

/**
 * Seeds co_occurrence with weak pairs for products in same category and
 * similar price range (±50%). Skips pairs that already exist (real activity).
 *
 * Returns the number of pairs seeded.
 */
export async function seedCoOccurrenceForProduct(
  product_id: string,
  pg: Client,
): Promise<number> {
  const r = await pg.query(
    `WITH new_product AS (
       SELECT id, metadata->>'category' AS cat, price_cents
       FROM products WHERE id = $1
     )
     INSERT INTO co_occurrence (product_a_id, product_b_id, count, last_seen_at)
     SELECT LEAST(p.id, np.id), GREATEST(p.id, np.id), $2, now()
     FROM products p, new_product np
     WHERE p.is_active = true
       AND p.id != np.id
       AND p.metadata->>'category' = np.cat
       AND np.cat IS NOT NULL
       AND ABS(p.price_cents - np.price_cents) <= (np.price_cents * $3::numeric + 1)
     ON CONFLICT (product_a_id, product_b_id) DO NOTHING
     RETURNING 1`,
    [product_id, SEED_WEIGHT, SEED_PRICE_TOLERANCE],
  );
  return r.rows.length;
}
