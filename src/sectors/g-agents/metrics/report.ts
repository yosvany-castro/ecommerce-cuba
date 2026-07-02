import {
  MIN_PURCHASES_FOR_HOLDOUT_DELTA,
  MIN_SEEN_FOR_CTR,
  MIN_SERVED_FOR_SEEN_RATE,
  MIN_SESSIONS_PER_ARM,
  wilson95,
} from "./confidence";
import { resolveWindow } from "./windows";
import type {
  MetricsSource,
  PlacementFunnelRow,
  SectionFunnelRow,
  Surface,
  WindowSpec,
} from "./types";

/**
 * buildMetricsReport — el JSON compacto que ve el LLM (A4 §3). Reglas duras:
 * rates a 3 decimales, dinero en cents enteros, ≤12 placements, top-5
 * categorías + other, y celda bajo mínimos ⇒ null + flag — JAMÁS un 0.0 que
 * signifique "sin datos". Compartido literal entre prod (sqlMetricsSource) y
 * sim (simMetricsSource): la compactación es parte del canal de observación.
 */

const MAX_REPORT_PLACEMENTS = 12;
const CATEGORY_FETCH_LIMIT = 8;
const REPORT_CATEGORIES = 5;
const RETENTION_DAYS = 90;

export interface FunnelBlock {
  served: number;
  seen: number;
  seen_rate: number | null;
  clicks: number;
  ctr_seen: number | null;
  ctr_ci95?: [number, number];
  add_to_carts: number;
  atc_per_1k_seen: number | null;
  purchases: number;
  revenue_cents: number;
}

export interface PlacementReport {
  id: string;
  surface: Surface;
  slot: number;
  section: string;
  status: string;
  risk_tier: string;
  version: number;
  days_since_change: number;
  funnel: FunnelBlock | null;
  since_change: {
    days: number;
    served: number;
    seen: number;
    ctr_seen: number | null;
    purchases: number;
    revenue_cents: number;
  } | null;
  flags: string[];
}

export interface HoldoutArm {
  sessions: number;
  seen: number;
  purchases: number;
  revenue_cents: number;
  revenue_per_1k_seen_cents: number | null;
  purchases_per_100_sessions: number;
}

export interface TrendBucket {
  seen: number;
  ctr_seen: number | null;
  purchases: number;
  revenue_cents: number;
}

export interface MetricsReport {
  window: { label: string; from: string; to: string };
  store: {
    served: number;
    seen: number;
    seen_rate: number | null;
    clicks: number;
    ctr_seen: number | null;
    add_to_carts: number;
    purchases: number;
    feed_revenue_cents: number;
    organic_revenue_cents: number;
    flags: string[];
    trend?: { current_7d: TrendBucket; previous_7d: TrendBucket };
  };
  vs_holdout: {
    default: HoldoutArm;
    holdout: HoldoutArm;
    revenue_ratio: number | null;
    flags: string[];
  } | null;
  placements: PlacementReport[];
  categories: {
    name: string;
    seen: number;
    ctr_seen: number | null;
    purchases: number;
    revenue_cents: number;
  }[];
  data_quality: { impression_sources: string[]; retention_days: number; notes: string[] };
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const round2 = (x: number) => Math.round(x * 100) / 100;
const round1 = (x: number) => Math.round(x * 10) / 10;

interface FunnelTotals {
  served: number;
  seen: number;
  clicks: number;
  add_to_carts: number;
  purchases: number;
  revenue_cents: number;
}

const ZERO: FunnelTotals = {
  served: 0,
  seen: 0,
  clicks: 0,
  add_to_carts: 0,
  purchases: 0,
  revenue_cents: 0,
};

function add(a: FunnelTotals, b: FunnelTotals): FunnelTotals {
  return {
    served: a.served + b.served,
    seen: a.seen + b.seen,
    clicks: a.clicks + b.clicks,
    add_to_carts: a.add_to_carts + b.add_to_carts,
    purchases: a.purchases + b.purchases,
    revenue_cents: a.revenue_cents + b.revenue_cents,
  };
}

function sumSections(rows: SectionFunnelRow[]): FunnelTotals {
  return rows.reduce<FunnelTotals>((acc, r) => add(acc, r), ZERO);
}

/** Agrega filas por placement (solo policy='default'; el holdout vive en vs_holdout). */
function sumByPlacement(rows: PlacementFunnelRow[]): Map<string, FunnelTotals> {
  const out = new Map<string, FunnelTotals>();
  for (const r of rows) {
    if (r.policy !== "default") continue;
    out.set(r.placement_id, add(out.get(r.placement_id) ?? ZERO, r));
  }
  return out;
}

/** rate bajo mínimo ⇒ null + flag low_sample (una sola vez por bloque). */
function gatedRate(num: number, den: number, minDen: number, flags: string[]): number | null {
  if (den >= minDen) return round3(num / den);
  if (!flags.includes("low_sample")) flags.push("low_sample");
  return null;
}

function funnelBlock(t: FunnelTotals, flags: string[]): FunnelBlock {
  const seen_rate = gatedRate(t.seen, t.served, MIN_SERVED_FOR_SEEN_RATE, flags);
  const ctr_seen = gatedRate(t.clicks, t.seen, MIN_SEEN_FOR_CTR, flags);
  const block: FunnelBlock = {
    served: t.served,
    seen: t.seen,
    seen_rate,
    clicks: t.clicks,
    ctr_seen,
    add_to_carts: t.add_to_carts,
    atc_per_1k_seen: t.seen >= MIN_SEEN_FOR_CTR ? round1((t.add_to_carts / t.seen) * 1000) : null,
    purchases: t.purchases,
    revenue_cents: t.revenue_cents,
  };
  if (ctr_seen !== null) {
    const ci = wilson95(t.clicks, t.seen);
    if (ci) block.ctr_ci95 = [round3(ci[0]), round3(ci[1])];
  }
  return block;
}

function trendBucket(t: FunnelTotals): TrendBucket {
  return {
    seen: t.seen,
    ctr_seen: t.seen >= MIN_SEEN_FOR_CTR ? round3(t.clicks / t.seen) : null,
    purchases: t.purchases,
    revenue_cents: t.revenue_cents,
  };
}

export async function buildMetricsReport(
  source: MetricsSource,
  opts: { surface?: Surface; windowDays: 7 | 14 | 28; now: () => Date },
): Promise<MetricsReport> {
  const window: WindowSpec = { kind: "fixed", days: opts.windowDays };
  const resolved = resolveWindow(window, opts.now);

  const [catalog, sectionRows, placementRows, sinceRows, policyRows, categoryRows] =
    await Promise.all([
      source.placementCatalog({ surface: opts.surface }),
      source.sectionFunnels({ window, surface: opts.surface }),
      source.placementFunnels({ window, surface: opts.surface }),
      source.placementFunnels({ window, surface: opts.surface, sinceChange: true }),
      source.policyComparison({ window }),
      source.categoryFunnels({ window, limit: CATEGORY_FETCH_LIMIT }),
    ]);

  const notes: string[] = [
    "clicks = product_view misma sesión post-exposición (proxy; no hay evento click)",
  ];

  // ── store ──
  const totals = sumSections(sectionRows);
  const organicRow = policyRows.find((p) => p.policy === "organic");
  const storeFlags: string[] = [];
  const store: MetricsReport["store"] = {
    served: totals.served,
    seen: totals.seen,
    seen_rate: gatedRate(totals.seen, totals.served, MIN_SERVED_FOR_SEEN_RATE, storeFlags),
    clicks: totals.clicks,
    ctr_seen: gatedRate(totals.clicks, totals.seen, MIN_SEEN_FOR_CTR, storeFlags),
    add_to_carts: totals.add_to_carts,
    purchases: totals.purchases,
    feed_revenue_cents: totals.revenue_cents,
    organic_revenue_cents: organicRow?.revenue_cents ?? 0,
    flags: storeFlags,
  };

  // 14d trend: dos buckets de 7d comparados en TS (los conteos son aditivos
  // sobre ventanas disjuntas; previous = 14d − current).
  if (opts.windowDays === 14) {
    const current = sumSections(
      await source.sectionFunnels({ window: { kind: "fixed", days: 7 }, surface: opts.surface }),
    );
    const previous: FunnelTotals = {
      served: totals.served - current.served,
      seen: totals.seen - current.seen,
      clicks: totals.clicks - current.clicks,
      add_to_carts: totals.add_to_carts - current.add_to_carts,
      purchases: totals.purchases - current.purchases,
      revenue_cents: totals.revenue_cents - current.revenue_cents,
    };
    store.trend = { current_7d: trendBucket(current), previous_7d: trendBucket(previous) };
  }

  // ── vs_holdout (la métrica reina; null + nota bajo mínimos) ──
  const def = policyRows.find((p) => p.policy === "default");
  const hold = policyRows.find((p) => p.policy === "holdout");
  let vs_holdout: MetricsReport["vs_holdout"] = null;
  if (
    def &&
    hold &&
    def.exposed_sessions >= MIN_SESSIONS_PER_ARM &&
    hold.exposed_sessions >= MIN_SESSIONS_PER_ARM &&
    def.purchases + hold.purchases >= MIN_PURCHASES_FOR_HOLDOUT_DELTA
  ) {
    const arm = (p: typeof def): HoldoutArm => ({
      sessions: p.exposed_sessions,
      seen: p.seen,
      purchases: p.purchases,
      revenue_cents: p.revenue_cents,
      revenue_per_1k_seen_cents: p.seen > 0 ? Math.round((p.revenue_cents / p.seen) * 1000) : null,
      purchases_per_100_sessions: round3((p.purchases / p.exposed_sessions) * 100),
    });
    const flags: string[] = [];
    if (hold.purchases < MIN_PURCHASES_FOR_HOLDOUT_DELTA) flags.push("holdout_low_purchases");
    const defRate = def.seen > 0 ? def.revenue_cents / def.seen : null;
    const holdRate = hold.seen > 0 ? hold.revenue_cents / hold.seen : null;
    vs_holdout = {
      default: arm(def),
      holdout: arm(hold),
      revenue_ratio: defRate !== null && holdRate ? round2(defRate / holdRate) : null,
      flags,
    };
  } else {
    notes.push("vs_holdout omitido: insufficient_holdout_data");
  }

  // ── placements (≤12; funnel:null + flag para lo no instrumentado) ──
  const byPlacement = sumByPlacement(placementRows);
  const sinceByPlacement = sumByPlacement(sinceRows);
  const anyRows = new Set(placementRows.map((r) => r.placement_id));
  const placements: PlacementReport[] = catalog
    .slice(0, MAX_REPORT_PLACEMENTS)
    .map((c) => {
      const flags: string[] = [];
      const t = byPlacement.get(c.placement_id);
      let funnel: FunnelBlock | null = null;
      let since_change: PlacementReport["since_change"] = null;
      if (!t && !anyRows.has(c.placement_id)) {
        flags.push("no_impression_logging");
      } else if (t) {
        funnel = funnelBlock(t, flags);
        if (c.section_type !== "hero_grid" && t.served > 0 && t.seen === 0) {
          flags.push("no_seen_tracking");
        }
        const s = sinceByPlacement.get(c.placement_id);
        if (s) {
          const sinceFlags: string[] = [];
          since_change = {
            days: Math.min(c.age_days, 28),
            served: s.served,
            seen: s.seen,
            ctr_seen: gatedRate(s.clicks, s.seen, MIN_SEEN_FOR_CTR, sinceFlags),
            purchases: s.purchases,
            revenue_cents: s.revenue_cents,
          };
        }
      }
      return {
        id: c.placement_id,
        surface: c.surface,
        slot: c.slot,
        section: c.section_type,
        status: c.status,
        risk_tier: c.risk_tier,
        version: c.version,
        days_since_change: c.age_days,
        funnel,
        since_change,
        flags,
      };
    });

  // ── categories: top-5 + other(+N) ──
  const categories: MetricsReport["categories"] = categoryRows
    .slice(0, REPORT_CATEGORIES)
    .map((c) => ({
      name: c.category,
      seen: c.seen,
      ctr_seen: c.seen >= MIN_SEEN_FOR_CTR ? round3(c.clicks / c.seen) : null,
      purchases: c.purchases,
      revenue_cents: c.revenue_cents,
    }));
  const rest = categoryRows.slice(REPORT_CATEGORIES);
  if (rest.length > 0) {
    const other = rest.reduce<FunnelTotals>((acc, r) => add(acc, { ...r, add_to_carts: 0 }), ZERO);
    categories.push({
      name: `other(+${rest.length})`,
      seen: other.seen,
      ctr_seen: other.seen >= MIN_SEEN_FOR_CTR ? round3(other.clicks / other.seen) : null,
      purchases: other.purchases,
      revenue_cents: other.revenue_cents,
    });
  }

  return {
    window: {
      label: resolved.label,
      from: resolved.from.toISOString().slice(0, 10),
      to: resolved.to.toISOString().slice(0, 10),
    },
    store,
    vs_holdout,
    placements,
    categories,
    data_quality: {
      impression_sources: [
        ...new Set(sectionRows.map((r) => r.section_id).filter((s) => s !== "legacy_feed")),
      ].sort(),
      retention_days: RETENTION_DAYS,
      notes,
    },
  };
}
