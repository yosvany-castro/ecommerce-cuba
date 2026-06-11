import type { Client } from "pg";

/**
 * Post-checkout attribution (F1). Best-effort AFTER the order commits — a
 * failure here never fails a sale. Two effects per purchased product:
 *
 * 1. purchase_attributions: join to the LATEST impression (7d) of this
 *    session/profile — feed_request_id, position, exploit/explore, policy,
 *    seen (viewport). Organic purchases get NULL feed columns and are
 *    recorded anyway (no survivor bias in the feed's credit).
 * 2. excluded_products reason='purchased' (TTL 30d): what you just bought
 *    stops chasing you — and becomes the natural cross-sell anchor instead.
 */
export async function attributePurchaseAndExclude(
  pg: Client,
  input: {
    order_id: string;
    user_id: string;
    anonymous_id: string;
    session_id: string;
    items: { product_id: string; unit_price_cents: number; quantity: number }[];
  },
): Promise<void> {
  const productIds = input.items.map((i) => i.product_id);

  await pg.query(
    `INSERT INTO purchase_attributions
       (order_id, product_id, feed_request_id, position, source, policy, seen, unit_price_cents, quantity)
     SELECT $1, b.pid, fi.feed_request_id, fi.position, fi.source, fi.policy,
            COALESCE(fi.seen_at IS NOT NULL, false), b.price, b.qty
     FROM unnest($2::uuid[], $3::int[], $4::int[]) AS b(pid, price, qty)
     LEFT JOIN LATERAL (
       SELECT i.feed_request_id, i.position, i.source, i.policy, i.seen_at
       FROM feed_impressions i
       WHERE i.product_id = b.pid
         AND i.served_at > now() - interval '7 days'
         AND (i.session_id = $5
           OR i.user_profile_id = (SELECT id FROM user_profiles WHERE user_id = $6)
           OR i.user_profile_id = (SELECT id FROM user_profiles WHERE anonymous_id = $7))
       ORDER BY i.served_at DESC
       LIMIT 1
     ) fi ON true`,
    [
      input.order_id,
      productIds,
      input.items.map((i) => i.unit_price_cents),
      input.items.map((i) => i.quantity),
      input.session_id,
      input.user_id,
      input.anonymous_id,
    ],
  );

  await pg.query(
    `INSERT INTO excluded_products (user_id, product_id, ttl_until, reason)
     SELECT $1, pid, now() + interval '30 days', 'purchased'
     FROM unnest($2::uuid[]) AS p(pid)
     WHERE NOT EXISTS (
       SELECT 1 FROM excluded_products ep
       WHERE ep.user_id = $1 AND ep.product_id = p.pid AND ep.ttl_until > now()
     )`,
    [input.user_id, productIds],
  );
}
