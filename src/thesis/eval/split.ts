/**
 * Leave-one-out temporal split for purchase logs.
 *
 * Policy:
 *   - For each user with ≥ 2 purchases, the single LATEST purchase (by time)
 *     becomes the **test** row; all earlier purchases become **train** rows.
 *   - Users with only 1 purchase contribute that purchase to **train** only
 *     (no held-out row — there is nothing to evaluate against).
 *   - "Latest" is a total (deterministic) order:
 *       primary key  : Date.parse(occurred_at)  — larger is later
 *       tie-break key: product_id.localeCompare — larger string wins
 *     Tie-breaking is essential because synthetic events often share a
 *     wall-clock timestamp; without a total order the held-out item would
 *     vary across runs depending on insertion order, making evals non-reproducible.
 *
 * This utility is pure: no I/O, no Date.now(), no Math.random().
 * It is used by the public-dataset eval path and for re-splitting
 * arbitrary purchase logs independently of the synthetic generator.
 */

export interface PurchaseRow {
  user_id: string;
  product_id: string;
  occurred_at: string;
}

export interface SplitRow extends PurchaseRow {
  split: "train" | "test";
}

/**
 * Returns `{ train, test }` split arrays.
 * Input order is preserved within each group; the function is referentially
 * transparent — same input always produces the same output.
 */
export function temporalSplit(
  purchases: PurchaseRow[]
): { train: SplitRow[]; test: SplitRow[] } {
  // Group rows by user_id, preserving insertion order.
  const byUser = new Map<string, PurchaseRow[]>();
  for (const row of purchases) {
    const bucket = byUser.get(row.user_id);
    if (bucket) {
      bucket.push(row);
    } else {
      byUser.set(row.user_id, [row]);
    }
  }

  const train: SplitRow[] = [];
  const test: SplitRow[] = [];

  for (const [, rows] of byUser) {
    if (rows.length === 1) {
      // Single-purchase users: train only, no held-out row.
      train.push({ ...rows[0], split: "train" });
      continue;
    }

    // Find the single latest row using a total order:
    // compare by (Date.parse(occurred_at) DESC, product_id DESC).
    // "pb" > "pa" in localeCompare, so larger product_id wins on tie.
    let latestIdx = 0;
    for (let i = 1; i < rows.length; i++) {
      const iTime = Date.parse(rows[i].occurred_at);
      const latestTime = Date.parse(rows[latestIdx].occurred_at);
      if (
        iTime > latestTime ||
        (iTime === latestTime &&
          rows[i].product_id.localeCompare(rows[latestIdx].product_id) > 0)
      ) {
        latestIdx = i;
      }
    }

    for (let i = 0; i < rows.length; i++) {
      if (i === latestIdx) {
        test.push({ ...rows[i], split: "test" });
      } else {
        train.push({ ...rows[i], split: "train" });
      }
    }
  }

  return { train, test };
}
