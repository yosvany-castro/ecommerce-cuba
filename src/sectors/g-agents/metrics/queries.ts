import type { Client } from "pg";
import { resolveWindow } from "./windows";
import type {
  CategoryFunnelRow,
  MetricsSource,
  PlacementCatalogRow,
  PlacementFunnelRow,
  PolicyComparisonRow,
  ResolvedWindow,
  SectionFunnelRow,
  Surface,
} from "./types";

/**
 * Las 5 funciones SQL de la capa de métricas (A4 §2, columnas verificadas
 * contra DDL 0005/0023-0029). Decisiones no negociables:
 * - click = product_view de la MISMA sesión sobre el MISMO producto con
 *   max(occurred_at) >= served_at, gated por seen_at IS NOT NULL.
 * - add_to_cart SIN condición seen (puede ocurrir desde el PDP post-click).
 * - cast events.session_id (uuid) ::text = feed_impressions.session_id (text).
 * - atribución impresión→placement vía slate_decisions.placements (jsonb):
 *   placement_version jamás se escribe en impresiones hero.
 * - slate_decisions tiene N filas por slate_id (una por pageload) ⇒
 *   DISTINCT ON (slate_id) ... ORDER BY created_at ASC (la composición que lo creó).
 */

/** sum(...)::bigint llega como string desde node-pg. */
function toInt(v: unknown): number {
  return Number(v ?? 0);
}

export async function fetchPlacementCatalog(
  opts: { surface?: Surface; now: Date },
  pg: Client,
): Promise<PlacementCatalogRow[]> {
  const r = await pg.query(
    `SELECT up.id::text AS placement_id,
            up.surface, up.slot, up.section_type, up.status, up.risk_tier,
            up.scope, up.version, up.created_by, up.updated_at,
            GREATEST(0, floor(extract(epoch FROM ($2::timestamptz - up.updated_at)) / 86400))::int AS age_days
     FROM ui_placements up
     WHERE up.status <> 'archived'
       AND ($1::text IS NULL OR up.surface = $1)
     ORDER BY up.surface, up.slot, up.version DESC`,
    [opts.surface ?? null, opts.now],
  );
  // Incluye paused/killed/pending a propósito: el agente debe VER lo muerto
  // para no re-proponerlo.
  return r.rows as PlacementCatalogRow[];
}

const SESSION_ACTIONS_CTE = `
  SELECT e.session_id::text               AS session_id,
         (e.payload->>'product_id')::uuid AS product_id,
         e.event_type,
         max(e.occurred_at)               AS last_at
  FROM events e
  WHERE e.event_type IN ('product_view', 'add_to_cart')
    AND e.occurred_at >= $1::timestamptz
    AND e.occurred_at <  $2::timestamptz + interval '1 day'
    AND e.payload ? 'product_id'
  GROUP BY 1, 2, 3`;

const PURCHASES_CTE = `
  SELECT pa.feed_request_id, pa.position,
         count(*)::int                                  AS purchases,
         sum(pa.unit_price_cents * pa.quantity)::bigint AS revenue_cents
  FROM purchase_attributions pa
  WHERE pa.attributed_at >= $1::timestamptz
    AND pa.attributed_at <  $2::timestamptz + interval '1 day'
    AND pa.feed_request_id IS NOT NULL
  GROUP BY 1, 2`;

export async function fetchSectionFunnels(
  opts: { window: ResolvedWindow; surface?: Surface },
  pg: Client,
): Promise<SectionFunnelRow[]> {
  const r = await pg.query(
    `WITH session_actions AS (${SESSION_ACTIONS_CTE}),
     purchases AS (${PURCHASES_CTE}),
     surfaced AS (
       SELECT DISTINCT ON (sd.slate_id) sd.slate_id, sd.surface
       FROM slate_decisions sd
       WHERE sd.created_at >= $1::timestamptz - interval '2 days'
       ORDER BY sd.slate_id, sd.created_at ASC
     )
     SELECT COALESCE(fi.section_id, 'legacy_feed') AS section_id,
            fi.policy,
            count(*)::int                          AS served,
            count(fi.seen_at)::int                 AS seen,
            count(*) FILTER (
              WHERE fi.seen_at IS NOT NULL AND pv.last_at >= fi.served_at
            )::int                                 AS clicks,
            count(*) FILTER (WHERE atc.last_at >= fi.served_at)::int AS add_to_carts,
            COALESCE(sum(pu.purchases), 0)::int        AS purchases,
            COALESCE(sum(pu.revenue_cents), 0)::bigint AS revenue_cents
     FROM feed_impressions fi
     LEFT JOIN session_actions pv
       ON pv.session_id = fi.session_id AND pv.product_id = fi.product_id
      AND pv.event_type = 'product_view'
     LEFT JOIN session_actions atc
       ON atc.session_id = fi.session_id AND atc.product_id = fi.product_id
      AND atc.event_type = 'add_to_cart'
     LEFT JOIN purchases pu
       ON pu.feed_request_id = fi.feed_request_id AND pu.position = fi.position
     LEFT JOIN surfaced s ON s.slate_id = fi.feed_request_id
     WHERE fi.served_at >= $1::timestamptz AND fi.served_at < $2::timestamptz
       AND ($3::text IS NULL OR s.surface = $3)
     GROUP BY 1, 2
     ORDER BY 1, 2`,
    [opts.window.from, opts.window.to, opts.surface ?? null],
  );
  return (r.rows as SectionFunnelRow[]).map((row) => ({
    ...row,
    revenue_cents: toInt(row.revenue_cents),
  }));
}

export async function fetchPlacementFunnels(
  opts: { window: ResolvedWindow; surface?: Surface; sinceChange?: boolean; now: Date },
  pg: Client,
): Promise<PlacementFunnelRow[]> {
  // pl.placement_id se declara TEXT (no uuid): las decisiones logueadas con
  // DEFAULT_PLACEMENTS llevan ids tipo 'default-home-hero' — un cast uuid
  // reventaría toda la query; con text simplemente no joinean ui_placements.
  const r = await pg.query(
    `WITH decisions AS (
       SELECT DISTINCT ON (sd.slate_id) sd.slate_id, sd.surface, sd.placements
       FROM slate_decisions sd
       WHERE sd.created_at >= $1::timestamptz - interval '2 days'
       ORDER BY sd.slate_id, sd.created_at ASC
     ),
     imp AS (
       SELECT fi.feed_request_id, fi.session_id, fi.position, fi.product_id,
              fi.policy, fi.seen_at, fi.served_at,
              d.surface, pl.placement_id, pl.version AS placement_version
       FROM feed_impressions fi
       JOIN decisions d ON d.slate_id = fi.feed_request_id
       CROSS JOIN LATERAL jsonb_to_recordset(d.placements)
            AS pl(placement_id text, slot smallint, section_type text, version int)
       WHERE pl.section_type = fi.section_id
         AND fi.served_at >= $1::timestamptz AND fi.served_at < $2::timestamptz
         AND ($3::text IS NULL OR d.surface = $3)
     ),
     session_actions AS (${SESSION_ACTIONS_CTE}),
     purchases AS (${PURCHASES_CTE})
     SELECT imp.placement_id, up.section_type, imp.surface, up.slot,
            imp.placement_version, imp.policy,
            count(*)::int                  AS served,
            count(imp.seen_at)::int        AS seen,
            count(*) FILTER (
              WHERE imp.seen_at IS NOT NULL AND pv.last_at >= imp.served_at
            )::int                         AS clicks,
            count(*) FILTER (WHERE atc.last_at >= imp.served_at)::int AS add_to_carts,
            COALESCE(sum(pu.purchases), 0)::int        AS purchases,
            COALESCE(sum(pu.revenue_cents), 0)::bigint AS revenue_cents
     FROM imp
     JOIN ui_placements up ON up.id::text = imp.placement_id
     LEFT JOIN session_actions pv
       ON pv.session_id = imp.session_id AND pv.product_id = imp.product_id
      AND pv.event_type = 'product_view'
     LEFT JOIN session_actions atc
       ON atc.session_id = imp.session_id AND atc.product_id = imp.product_id
      AND atc.event_type = 'add_to_cart'
     LEFT JOIN purchases pu
       ON pu.feed_request_id = imp.feed_request_id AND pu.position = imp.position
     WHERE ($4::boolean IS DISTINCT FROM true
            OR imp.served_at >= GREATEST(up.updated_at, $5::timestamptz - interval '28 days'))
     GROUP BY 1, 2, 3, 4, 5, 6
     ORDER BY imp.surface, up.slot, imp.policy`,
    [opts.window.from, opts.window.to, opts.surface ?? null, opts.sinceChange ?? false, opts.now],
  );
  return (r.rows as PlacementFunnelRow[]).map((row) => ({
    ...row,
    revenue_cents: toInt(row.revenue_cents),
  }));
}

export async function fetchPolicyComparison(
  opts: { window: ResolvedWindow },
  pg: Client,
): Promise<PolicyComparisonRow[]> {
  const exposure = await pg.query(
    `SELECT fi.policy,
            count(DISTINCT fi.session_id)::int AS exposed_sessions,
            count(*)::int                      AS served,
            count(fi.seen_at)::int             AS seen
     FROM feed_impressions fi
     WHERE fi.served_at >= $1::timestamptz AND fi.served_at < $2::timestamptz
     GROUP BY 1`,
    [opts.window.from, opts.window.to],
  );
  // 'organic' = compras sin crédito del feed; el agente no debe atribuirse la tienda entera.
  const reward = await pg.query(
    `SELECT COALESCE(pa.policy, 'organic')                 AS policy,
            count(*)::int                                  AS purchases,
            sum(pa.unit_price_cents * pa.quantity)::bigint AS revenue_cents
     FROM purchase_attributions pa
     WHERE pa.attributed_at >= $1::timestamptz AND pa.attributed_at < $2::timestamptz
     GROUP BY 1`,
    [opts.window.from, opts.window.to],
  );
  const byPolicy = new Map<string, PolicyComparisonRow>();
  const get = (policy: string): PolicyComparisonRow => {
    let row = byPolicy.get(policy);
    if (!row) {
      row = { policy, exposed_sessions: 0, served: 0, seen: 0, purchases: 0, revenue_cents: 0 };
      byPolicy.set(policy, row);
    }
    return row;
  };
  for (const e of exposure.rows as PolicyComparisonRow[]) {
    Object.assign(get(e.policy), {
      exposed_sessions: e.exposed_sessions,
      served: e.served,
      seen: e.seen,
    });
  }
  for (const w of reward.rows as { policy: string; purchases: number; revenue_cents: unknown }[]) {
    Object.assign(get(w.policy), { purchases: w.purchases, revenue_cents: toInt(w.revenue_cents) });
  }
  return [...byPolicy.values()].sort((a, b) => a.policy.localeCompare(b.policy));
}

export async function fetchCategoryFunnels(
  opts: { window: ResolvedWindow; limit?: number },
  pg: Client,
): Promise<CategoryFunnelRow[]> {
  const r = await pg.query(
    `WITH session_actions AS (
       SELECT e.session_id::text               AS session_id,
              (e.payload->>'product_id')::uuid AS product_id,
              max(e.occurred_at)               AS last_at
       FROM events e
       WHERE e.event_type = 'product_view'
         AND e.occurred_at >= $1::timestamptz
         AND e.occurred_at <  $2::timestamptz + interval '1 day'
         AND e.payload ? 'product_id'
       GROUP BY 1, 2
     ),
     purchases AS (${PURCHASES_CTE})
     SELECT COALESCE(p.metadata->>'category', 'uncategorized') AS category,
            count(*)::int          AS served,
            count(fi.seen_at)::int AS seen,
            count(*) FILTER (
              WHERE fi.seen_at IS NOT NULL AND pv.last_at >= fi.served_at
            )::int                 AS clicks,
            COALESCE(sum(pu.purchases), 0)::int        AS purchases,
            COALESCE(sum(pu.revenue_cents), 0)::bigint AS revenue_cents
     FROM feed_impressions fi
     JOIN products p ON p.id = fi.product_id
     LEFT JOIN session_actions pv
       ON pv.session_id = fi.session_id AND pv.product_id = fi.product_id
     LEFT JOIN purchases pu
       ON pu.feed_request_id = fi.feed_request_id AND pu.position = fi.position
     WHERE fi.served_at >= $1::timestamptz AND fi.served_at < $2::timestamptz
     GROUP BY 1
     ORDER BY seen DESC
     LIMIT $3`,
    [opts.window.from, opts.window.to, opts.limit ?? 8],
  );
  return (r.rows as CategoryFunnelRow[]).map((row) => ({
    ...row,
    revenue_cents: toInt(row.revenue_cents),
  }));
}

/** Contexto barato de catálogo (tabla pre-materializada por cron, sin tocar events). */
export async function fetchCatalogContext(
  opts: { limit?: number },
  pg: Client,
): Promise<{ category: string; events_7d: number; purchases_7d: number; products: number }[]> {
  const r = await pg.query(
    `SELECT COALESCE(pp.category, 'uncategorized') AS category,
            sum(pp.events_7d)::int    AS events_7d,
            sum(pp.purchases_7d)::int AS purchases_7d,
            count(*)::int             AS products
     FROM product_popularity_7d pp
     GROUP BY 1
     ORDER BY 2 DESC
     LIMIT $1`,
    [opts.limit ?? 8],
  );
  return r.rows as { category: string; events_7d: number; purchases_7d: number; products: number }[];
}

/** La única impl SQL de MetricsSource. `now` inyectable = el único ajuste del sim. */
export function sqlMetricsSource(pg: Client, opts?: { now?: () => Date }): MetricsSource {
  const now = opts?.now ?? (() => new Date());
  return {
    placementCatalog: (o) => fetchPlacementCatalog({ surface: o.surface, now: now() }, pg),
    placementFunnels: (o) =>
      fetchPlacementFunnels(
        {
          window: resolveWindow(o.window, now),
          surface: o.surface,
          sinceChange: o.sinceChange,
          now: now(),
        },
        pg,
      ),
    sectionFunnels: (o) =>
      fetchSectionFunnels({ window: resolveWindow(o.window, now), surface: o.surface }, pg),
    policyComparison: (o) => fetchPolicyComparison({ window: resolveWindow(o.window, now) }, pg),
    categoryFunnels: (o) =>
      fetchCategoryFunnels({ window: resolveWindow(o.window, now), limit: o.limit }, pg),
  };
}
