import type { Client } from "pg";

/**
 * Data retention (F4): raw attribution/serving logs are kept 90 days (the
 * experiment-reading window); expired slates die after a day of grace (their
 * impressions/attributions OUTLIVE them — the slate row is just the snapshot,
 * the history lives in feed_impressions/purchase_attributions, que no se
 * podan hasta los 90d). Free-tier discipline: unbounded logs are an outage
 * with delay.
 */
export async function pruneOldData(pg: Client): Promise<{
  impressions: number;
  decisions: number;
  slates: number;
}> {
  const impressions = await pg.query(
    `DELETE FROM feed_impressions WHERE served_at < now() - interval '90 days'`,
  );
  const decisions = await pg.query(
    `DELETE FROM slate_decisions WHERE created_at < now() - interval '90 days'`,
  );
  const slates = await pg.query(
    `DELETE FROM feed_slates WHERE expires_at < now() - interval '1 day'`,
  );
  return {
    impressions: impressions.rowCount ?? 0,
    decisions: decisions.rowCount ?? 0,
    slates: slates.rowCount ?? 0,
  };
}
