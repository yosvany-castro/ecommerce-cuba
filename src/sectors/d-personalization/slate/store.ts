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

/**
 * Pin a clicked product on the session's live slate (cap enforced; idempotent).
 * Runs from the track-hook on product_view — async to the gesture, never on
 * the serving path. Pins survive re-materialization (injectPins).
 */
export async function pinProductInSlate(
  session_id: string,
  product_id: string,
  pg: Client,
  cap = 4,
): Promise<void> {
  const slate = await loadLiveSlate(session_id, "home", pg);
  if (!slate) return;
  // Only products that actually live on this slate can be pinned (a PDP view
  // arriving from search/category is not a feed click).
  if (!slate.items.some((it) => it.product_id === product_id)) return;
  if (slate.pins.includes(product_id)) return;
  const pins = [...slate.pins, product_id].slice(0, cap);
  await pg.query(`UPDATE feed_slates SET pins = $2::jsonb WHERE slate_id = $1`, [
    slate.slate_id,
    JSON.stringify(pins),
  ]);
}

/**
 * Dismiss compaction: remove the product from the UNSERVED tail of the
 * session's live slate (served positions are history — the client already
 * hid the card optimistically) and backfill ONE spare at the end. Positions
 * are NOT renumbered: outstanding cursors stay valid; pages simply skip the
 * gap. No version bump (that is the shift-invalidation lever, Etapa E).
 */
export async function compactSlateForDismiss(
  session_id: string,
  product_id: string,
  pg: Client,
): Promise<void> {
  const slate = await loadLiveSlate(session_id, "home", pg);
  if (!slate) return;
  const servedMax = await pg.query(
    `SELECT COALESCE(max(position), 0)::int AS p FROM feed_impressions WHERE feed_request_id = $1`,
    [slate.slate_id],
  );
  const servedUpTo = Number(servedMax.rows[0].p);
  const target = slate.items.find(
    (it) => it.product_id === product_id && it.position > servedUpTo,
  );
  if (!target) return; // ya servido (el cliente lo oculta) o no está: nada que compactar
  const maxPos = slate.items.reduce((m, it) => Math.max(m, it.position), 0);
  const inSlate = new Set(slate.items.map((it) => it.product_id));
  const spare = slate.spares.find((id) => !inSlate.has(id) && id !== product_id);
  const newItems = slate.items.filter((it) => it.product_id !== product_id);
  if (spare) {
    newItems.push({ product_id: spare, position: maxPos + 1, source: "exploit", propensity: 1 });
  }
  await pg.query(
    `UPDATE feed_slates SET items = $2::jsonb, spares = $3::jsonb WHERE slate_id = $1`,
    [
      slate.slate_id,
      JSON.stringify(newItems),
      JSON.stringify(slate.spares.filter((id) => id !== spare)),
    ],
  );
}

/**
 * T3: extend a live slate's item list IN PLACE — same slate_id, EXISTING
 * positions untouched, new items appended past the current max position.
 * Used when a slate materialized on a tiny catalog is shorter than
 * PAGE_SIZE_FIRST and the catalog later grew: the fix is additive-only (the
 * owner's usability rule — the shelf never reorders what the user already
 * saw), never a discard-and-rematerialize. No version bump: nothing already
 * shown moves or changes, so outstanding cursors stay valid as-is.
 */
export async function appendToSlate(
  slate_id: string,
  items: SlateItem[],
  pg: Client,
): Promise<void> {
  await pg.query(`UPDATE feed_slates SET items = $2::jsonb WHERE slate_id = $1`, [
    slate_id,
    JSON.stringify(items),
  ]);
}

/**
 * Live invalidation (E1): bump the slate version of the session's live slate.
 * Outstanding cursors carry the OLD version ⇒ their next fetch regenerates
 * transparently (deduped against everything served) — "lo que se muestra
 * vuelve a cambiar" mid-scroll, touching only UNSEEN pages (anti-flicker:
 * nothing visible ever reorders). Triggers: cohort SHIFT (intent changed) and
 * SEARCH (explicit new intent). Returns the new version (null = no live slate).
 */
/**
 * Invalidación por VISTA (fix "el feed no reacciona a lo que miro"): expira el
 * slate vivo de la sesión para que la PRÓXIMA carga de la home re-materialice
 * con la señal fresca (views-categories pesa ×3 la sesión actual). Es hacer
 * event-driven el mismo MISS que ya produce el TTL de 300s — ninguna página
 * visible se reordena en vivo, y los pins del slate expirado sobreviven a la
 * re-materialización (feed.ts los lee "even expired"). bumpSlateVersion no
 * servía para esto: loadLiveSlate no compara version y el HIT re-servía el
 * mismo snapshot hasta expirar.
 */
export async function expireLiveSlate(session_id: string, pg: Client): Promise<void> {
  await pg.query(
    `UPDATE feed_slates SET expires_at = now()
     WHERE session_id = $1 AND surface = 'home' AND expires_at > now()`,
    [session_id],
  );
}

export async function bumpSlateVersion(
  session_id: string,
  pg: Client,
): Promise<number | null> {
  const r = await pg.query(
    `UPDATE feed_slates SET version = version + 1
     WHERE slate_id = (
       SELECT slate_id FROM feed_slates
       WHERE session_id = $1 AND surface = 'home' AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1
     )
     RETURNING version`,
    [session_id],
  );
  return r.rows[0]?.version ?? null;
}
