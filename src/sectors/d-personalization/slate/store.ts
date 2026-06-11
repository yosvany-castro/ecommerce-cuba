import type { Client } from "pg";
import { SLATE_SOFT_TTL_S } from "./constants";

/**
 * feed_slates access (0024). The slate is the immutable post-exploration
 * snapshot a session pages through: reads are 1 indexed query (the hit path
 * that replaces the ~15-query feed recompute), writes happen once per
 * materialization. Compaction (dismiss) only ever touches UNSERVED positions.
 */

export interface SlateItem {
  product_id: string;
  position: number; // ABSOLUTE (1-based) across all pages
  source: "exploit" | "explore";
  propensity: number;
}

export interface SlateRow {
  slate_id: string;
  session_id: string;
  surface: string;
  version: number;
  items: SlateItem[];
  pins: string[];
  spares: string[];
  policy: string;
}

export async function insertSlate(
  row: {
    slate_id: string;
    user_profile_id: string | null;
    anonymous_id: string | null;
    session_id: string;
    surface: string;
    items: SlateItem[];
    spares: string[];
    policy?: string;
  },
  pg: Client,
): Promise<void> {
  await pg.query(
    `INSERT INTO feed_slates
       (slate_id, user_profile_id, anonymous_id, session_id, surface, items, spares, policy, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, now() + make_interval(secs => $9))`,
    [
      row.slate_id,
      row.user_profile_id,
      row.anonymous_id,
      row.session_id,
      row.surface,
      JSON.stringify(row.items),
      JSON.stringify(row.spares),
      row.policy ?? "default",
      SLATE_SOFT_TTL_S,
    ],
  );
}

/** Latest LIVE slate of a session+surface (lazy expiry: the WHERE is the TTL). */
export async function loadLiveSlate(
  session_id: string,
  surface: string,
  pg: Client,
): Promise<SlateRow | null> {
  const r = await pg.query(
    `SELECT slate_id, session_id, surface, version, items, pins, spares, policy
     FROM feed_slates
     WHERE session_id = $1 AND surface = $2 AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [session_id, surface],
  );
  return (r.rows[0] as SlateRow | undefined) ?? null;
}

/** Slate by id (cursor path) — caller MUST verify session ownership. */
export async function loadSlateById(slate_id: string, pg: Client): Promise<SlateRow | null> {
  const r = await pg.query(
    `SELECT slate_id, session_id, surface, version, items, pins, spares, policy
     FROM feed_slates
     WHERE slate_id = $1 AND expires_at > now()`,
    [slate_id],
  );
  return (r.rows[0] as SlateRow | undefined) ?? null;
}

/**
 * Log the impressions of ONE served page of a slate. feed_request_id =
 * slate_id (the grouping key); the unique(feed_request_id, position) makes
 * reloads and retries idempotent — one exposure row per slate-position, ever.
 */
export async function logSlatePageImpressions(
  slate: SlateRow,
  pageItems: SlateItem[],
  ctx: { user_profile_id: string | null; page_request_id: string },
  pg: Client,
): Promise<void> {
  if (pageItems.length === 0) return;
  try {
    await pg.query(
      `INSERT INTO feed_impressions
         (feed_request_id, user_profile_id, session_id, position, product_id,
          source, propensity, page_request_id, section_id, policy)
       SELECT $1, $2, $3, u.position, u.product_id::uuid, u.source, u.propensity,
              $4, 'hero_grid', $5
       FROM unnest($6::smallint[], $7::text[], $8::text[], $9::float8[])
         AS u(position, product_id, source, propensity)
       ON CONFLICT (feed_request_id, position) DO NOTHING`,
      [
        slate.slate_id,
        ctx.user_profile_id,
        slate.session_id,
        ctx.page_request_id,
        slate.policy,
        pageItems.map((x) => x.position),
        pageItems.map((x) => x.product_id),
        pageItems.map((x) => x.source),
        pageItems.map((x) => x.propensity),
      ],
    );
  } catch (e) {
    // Fire-and-forget contract: logging never fails a page.
    console.warn("[slate] impression logging failed (page unaffected):", e);
  }
}

/** Product ids already served to this session (regeneration dedupe). */
export async function fetchServedProductIds(
  session_id: string,
  pg: Client,
): Promise<string[]> {
  const r = await pg.query(
    `SELECT DISTINCT product_id::text AS id
     FROM feed_impressions
     WHERE session_id = $1 AND served_at > now() - interval '1 day'`,
    [session_id],
  );
  return (r.rows as { id: string }[]).map((x) => x.id);
}
