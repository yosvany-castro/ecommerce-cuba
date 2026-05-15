import type { Client } from "pg";

export const COOCCURRENCE_WEIGHTS: Record<string, number> = {
  purchase: 5,
  add_to_cart: 3,
  product_view: 1,
};

export const DEFAULT_WINDOW_MIN = 30;

export interface CaptureOpts {
  session_id: string;
  current_product_id: string;
  current_event_type: "product_view" | "add_to_cart" | "purchase";
  window_minutes?: number;
}

/**
 * For each other product viewed/carted/purchased in the same session within
 * the time window, insert or accumulate a co_occurrence pair (a<b).
 * The pair weight is MAX of the two event weights (purchase=5 dominates view=1).
 *
 * Returns the number of pairs touched.
 */
export async function captureCoOccurrence(
  opts: CaptureOpts,
  pg: Client,
): Promise<number> {
  const window = opts.window_minutes ?? DEFAULT_WINDOW_MIN;
  const r = await pg.query(
    `SELECT DISTINCT ON ((payload->>'product_id'))
            (payload->>'product_id') AS product_id,
            event_type
     FROM events
     WHERE session_id = $1
       AND event_type IN ('product_view', 'add_to_cart', 'purchase')
       AND occurred_at > now() - ($2 || ' minutes')::interval
       AND (payload->>'product_id') IS NOT NULL
       AND (payload->>'product_id') != $3
     ORDER BY (payload->>'product_id'), occurred_at DESC`,
    [opts.session_id, window, opts.current_product_id],
  );

  const currentWeight = COOCCURRENCE_WEIGHTS[opts.current_event_type] ?? 1;
  let inserted = 0;
  for (const row of r.rows as Array<{ product_id: string; event_type: string }>) {
    const otherWeight = COOCCURRENCE_WEIGHTS[row.event_type] ?? 1;
    const weight = Math.max(currentWeight, otherWeight);
    const [a, b] =
      row.product_id < opts.current_product_id
        ? [row.product_id, opts.current_product_id]
        : [opts.current_product_id, row.product_id];
    await pg.query(
      `INSERT INTO co_occurrence (product_a_id, product_b_id, count, last_seen_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (product_a_id, product_b_id) DO UPDATE
       SET count = co_occurrence.count + EXCLUDED.count,
           last_seen_at = now()`,
      [a, b, weight],
    );
    inserted += 1;
  }
  return inserted;
}
