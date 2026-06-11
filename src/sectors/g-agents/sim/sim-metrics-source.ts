import { resolveWindow, SINCE_CLAMP_DAYS } from "@/sectors/g-agents/metrics/windows";
import type {
  CategoryFunnelRow,
  MetricsSource,
  PlacementCatalogRow,
  PlacementFunnelRow,
  PolicyComparisonRow,
  ResolvedWindow,
  SectionFunnelRow,
  Surface,
} from "@/sectors/g-agents/metrics/types";
import type { ArmLog, SimImpression } from "./ledger";
import type { SimPlacementRow } from "./store";

/**
 * MetricsSource in-memory sobre el log del brazo (blueprint §5.10) con LAS
 * MISMAS definiciones que queries.ts (A4 §2), línea a línea:
 * - click  = product_view de la MISMA sesión+producto con max(occurred_at) >=
 *   served_at, gated por seen_at IS NOT NULL;
 * - add_to_cart SIN condición seen;
 * - acciones/compras con ventana [from, to + 1 día); exposición [from, to);
 * - compras agrupadas por (feed_request_id, position), feed_request_id NOT NULL;
 * - policyComparison: compras en [from, to) SIN el +1 día (espejo exacto);
 * - placementFunnels solo filas cuyo placement_id existe en el store (espejo
 *   del JOIN ui_placements) y since_change ancla en GREATEST(updated_at, -28d).
 * La equivalencia con sqlMetricsSource la clava sim-metrics-parity.test.ts
 * (decisión 2.B.6). El gate JAMÁS lee de aquí (A4 §6.4): esto es solo el canal
 * de observación del agente.
 */

const DAY_MS = 86_400_000;

export interface SimMetricsArgs {
  log: ArmLog;
  placements: () => SimPlacementRow[];
  categoryOf: (productId: string) => string | null;
  now: () => Date;
}

interface FunnelAcc {
  served: number;
  seen: number;
  clicks: number;
  add_to_carts: number;
  purchases: number;
  revenue_cents: number;
}

const newAcc = (): FunnelAcc => ({
  served: 0,
  seen: 0,
  clicks: 0,
  add_to_carts: 0,
  purchases: 0,
  revenue_cents: 0,
});

/** max(occurred_at) por sesión×producto×tipo en [from, to+1d) — ≡ session_actions CTE. */
function buildActionIndex(args: SimMetricsArgs, w: ResolvedWindow): Map<string, number> {
  const hi = w.to.getTime() + DAY_MS;
  const lo = w.from.getTime();
  const idx = new Map<string, number>();
  for (const e of args.log.events) {
    if (e.event_type !== "product_view" && e.event_type !== "add_to_cart") continue;
    const ts = e.occurred_at.getTime();
    if (ts < lo || ts >= hi) continue;
    const key = `${e.session_id}|${e.product_id}|${e.event_type}`;
    const cur = idx.get(key);
    if (cur === undefined || ts > cur) idx.set(key, ts);
  }
  return idx;
}

/** Σ compras/revenue por (feed_request_id, position) en [from, to+1d) — ≡ purchases CTE. */
function buildPurchaseIndex(
  args: SimMetricsArgs,
  w: ResolvedWindow,
): Map<string, { purchases: number; revenue_cents: number }> {
  const hi = w.to.getTime() + DAY_MS;
  const lo = w.from.getTime();
  const idx = new Map<string, { purchases: number; revenue_cents: number }>();
  for (const p of args.log.purchases) {
    if (p.feed_request_id === null) continue;
    const ts = p.attributed_at.getTime();
    if (ts < lo || ts >= hi) continue;
    const key = `${p.feed_request_id}|${p.position}`;
    const cur = idx.get(key) ?? { purchases: 0, revenue_cents: 0 };
    cur.purchases += 1;
    cur.revenue_cents += p.unit_price_cents * p.quantity;
    idx.set(key, cur);
  }
  return idx;
}

function accumulate(
  acc: FunnelAcc,
  imp: SimImpression,
  actions: Map<string, number>,
  purchases: Map<string, { purchases: number; revenue_cents: number }>,
): void {
  const served = imp.served_at.getTime();
  acc.served += 1;
  if (imp.seen_at !== null) acc.seen += 1;
  const pv = actions.get(`${imp.session_id}|${imp.product_id}|product_view`);
  if (imp.seen_at !== null && pv !== undefined && pv >= served) acc.clicks += 1;
  const atc = actions.get(`${imp.session_id}|${imp.product_id}|add_to_cart`);
  if (atc !== undefined && atc >= served) acc.add_to_carts += 1;
  const pu = purchases.get(`${imp.feed_request_id}|${imp.position}`);
  if (pu) {
    acc.purchases += pu.purchases;
    acc.revenue_cents += pu.revenue_cents;
  }
}

const inWindow = (imp: SimImpression, w: ResolvedWindow): boolean => {
  const ts = imp.served_at.getTime();
  return ts >= w.from.getTime() && ts < w.to.getTime();
};

export function simMetricsSource(args: SimMetricsArgs): MetricsSource {
  return {
    async placementCatalog(opts) {
      const now = args.now();
      const rows: PlacementCatalogRow[] = args
        .placements()
        .filter((r) => r.status !== "archived" && (!opts.surface || r.surface === opts.surface))
        .map((r) => ({
          placement_id: r.id,
          surface: r.surface,
          slot: r.slot,
          section_type: r.section_type,
          status: r.status,
          risk_tier: r.risk_tier,
          scope: r.scope,
          version: r.version,
          created_by: r.created_by,
          updated_at: r.updated_at,
          age_days: Math.max(
            0,
            Math.floor((now.getTime() - r.updated_at.getTime()) / DAY_MS),
          ),
        }));
      return rows.sort(
        (a, b) =>
          a.surface.localeCompare(b.surface) || a.slot - b.slot || b.version - a.version,
      );
    },

    async sectionFunnels(opts) {
      const w = resolveWindow(opts.window, args.now);
      const actions = buildActionIndex(args, w);
      const purchases = buildPurchaseIndex(args, w);
      const groups = new Map<string, SectionFunnelRow>();
      for (const imp of args.log.impressions) {
        if (!inWindow(imp, w)) continue;
        if (opts.surface && imp.surface !== opts.surface) continue;
        const sectionId = imp.section_id ?? "legacy_feed";
        const key = `${sectionId}|${imp.policy}`;
        let g = groups.get(key);
        if (!g) {
          g = { section_id: sectionId, policy: imp.policy, ...newAcc() };
          groups.set(key, g);
        }
        accumulate(g, imp, actions, purchases);
      }
      return [...groups.values()].sort(
        (a, b) => a.section_id.localeCompare(b.section_id) || a.policy.localeCompare(b.policy),
      );
    },

    async placementFunnels(opts) {
      const now = args.now();
      const w = resolveWindow(opts.window, args.now);
      const actions = buildActionIndex(args, w);
      const purchases = buildPurchaseIndex(args, w);
      const rowById = new Map(args.placements().map((r) => [r.id, r]));
      const groups = new Map<string, PlacementFunnelRow>();
      for (const imp of args.log.impressions) {
        if (imp.placement_id === null) continue;
        const up = rowById.get(imp.placement_id);
        if (!up) continue; // ≡ JOIN ui_placements: ids default-* no joinean
        if (!inWindow(imp, w)) continue;
        if (opts.surface && imp.surface !== opts.surface) continue;
        if (opts.sinceChange === true) {
          const floor = Math.max(up.updated_at.getTime(), now.getTime() - SINCE_CLAMP_DAYS * DAY_MS);
          if (imp.served_at.getTime() < floor) continue;
        }
        const key = `${imp.placement_id}|${imp.placement_version}|${imp.policy}`;
        let g = groups.get(key);
        if (!g) {
          g = {
            placement_id: imp.placement_id,
            section_type: up.section_type,
            surface: (imp.surface ?? up.surface) as Surface,
            slot: up.slot,
            placement_version: imp.placement_version ?? up.version,
            policy: imp.policy,
            ...newAcc(),
          };
          groups.set(key, g);
        }
        accumulate(g, imp, actions, purchases);
      }
      return [...groups.values()].sort(
        (a, b) =>
          a.surface.localeCompare(b.surface) ||
          a.slot - b.slot ||
          a.policy.localeCompare(b.policy),
      );
    },

    async policyComparison(opts) {
      const w = resolveWindow(opts.window, args.now);
      const byPolicy = new Map<string, PolicyComparisonRow>();
      const get = (policy: string): PolicyComparisonRow => {
        let row = byPolicy.get(policy);
        if (!row) {
          row = { policy, exposed_sessions: 0, served: 0, seen: 0, purchases: 0, revenue_cents: 0 };
          byPolicy.set(policy, row);
        }
        return row;
      };
      const sessionsByPolicy = new Map<string, Set<string>>();
      for (const imp of args.log.impressions) {
        if (!inWindow(imp, w)) continue;
        const row = get(imp.policy);
        row.served += 1;
        if (imp.seen_at !== null) row.seen += 1;
        let s = sessionsByPolicy.get(imp.policy);
        if (!s) {
          s = new Set();
          sessionsByPolicy.set(imp.policy, s);
        }
        s.add(imp.session_id);
      }
      for (const [policy, sessions] of sessionsByPolicy) {
        get(policy).exposed_sessions = sessions.size;
      }
      // reward en [from, to) SIN +1 día — espejo exacto de fetchPolicyComparison
      for (const p of args.log.purchases) {
        const ts = p.attributed_at.getTime();
        if (ts < w.from.getTime() || ts >= w.to.getTime()) continue;
        const row = get(p.policy ?? "organic");
        row.purchases += 1;
        row.revenue_cents += p.unit_price_cents * p.quantity;
      }
      return [...byPolicy.values()].sort((a, b) => a.policy.localeCompare(b.policy));
    },

    async categoryFunnels(opts) {
      const w = resolveWindow(opts.window, args.now);
      const purchases = buildPurchaseIndex(args, w);
      // session_actions de categorías: SOLO product_view (≡ A4 §2.5)
      const hi = w.to.getTime() + DAY_MS;
      const pvIdx = new Map<string, number>();
      for (const e of args.log.events) {
        if (e.event_type !== "product_view") continue;
        const ts = e.occurred_at.getTime();
        if (ts < w.from.getTime() || ts >= hi) continue;
        const key = `${e.session_id}|${e.product_id}`;
        const cur = pvIdx.get(key);
        if (cur === undefined || ts > cur) pvIdx.set(key, ts);
      }
      const groups = new Map<string, CategoryFunnelRow>();
      for (const imp of args.log.impressions) {
        if (!inWindow(imp, w)) continue;
        const category = args.categoryOf(imp.product_id);
        if (category === null) continue; // ≡ JOIN products (inner)
        let g = groups.get(category);
        if (!g) {
          g = { category, served: 0, seen: 0, clicks: 0, purchases: 0, revenue_cents: 0 };
          groups.set(category, g);
        }
        g.served += 1;
        if (imp.seen_at !== null) g.seen += 1;
        const pv = pvIdx.get(`${imp.session_id}|${imp.product_id}`);
        if (imp.seen_at !== null && pv !== undefined && pv >= imp.served_at.getTime()) {
          g.clicks += 1;
        }
        const pu = purchases.get(`${imp.feed_request_id}|${imp.position}`);
        if (pu) {
          g.purchases += pu.purchases;
          g.revenue_cents += pu.revenue_cents;
        }
      }
      return [...groups.values()]
        .sort((a, b) => b.seen - a.seen || a.category.localeCompare(b.category))
        .slice(0, opts.limit ?? 8);
    },
  };
}
