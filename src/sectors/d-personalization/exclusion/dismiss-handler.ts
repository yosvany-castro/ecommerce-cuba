import type { Client } from "pg";

export const DISMISS_TTL_DAYS = 14;

export async function handleDismissAutoExclude(
  opts: { anonymous_id: string; user_id: string | null; product_id: string },
  pg: Client,
): Promise<void> {
  // When user_id is present, store the exclusion against user_id (durable across
  // devices and after cookie clear). Otherwise store against anonymous_id.
  await pg.query(
    `INSERT INTO excluded_products (anonymous_id, user_id, product_id, ttl_until)
     VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)
     ON CONFLICT DO NOTHING`,
    [
      opts.user_id ? null : opts.anonymous_id,
      opts.user_id,
      opts.product_id,
      DISMISS_TTL_DAYS,
    ],
  );
}
