import type { Client } from "pg";
import { isValidRule } from "./rules/schema";
import type { Rule } from "./rules/types";

/**
 * ui_placements/ui_sections config loader (D2).
 *
 * In-process cache, TTL 60s: serverless instances tolerate ≤60s of config
 * skew (merchandising, not inventory). DB down ⇒ serve the stale copy
 * indefinitely; nothing cached ⇒ hardcoded DEFAULT_PLACEMENTS (≡ the 0026
 * seed): the home can NEVER go blank because of the config table.
 * Rows with invalid rules are dropped at LOAD time with a warn — a net of
 * RULE validity only. Placement safety (hero/protected slots, cap eviction)
 * is enforced by the agent write path (tier ⇒ pending) PLUS the agent guards
 * in select.ts — never by this loader.
 */

export type Surface = "home" | "pdp" | "cart" | "search";

export interface PlacementConfig {
  placement_id: string;
  surface: Surface;
  slot: number;
  section_type: string;
  params: Record<string, unknown>;
  rule: Rule | null;
  scope: "global" | "segment" | "user";
  scope_ref: string | null;
  experiment_id: string | null;
  version: number;
  /** Procedencia: las salvaguardas de select.ts distinguen filas 'agent:%'. */
  created_by: string;
  // ui_sections (catálogo):
  priority: number;
  min_items: number;
  budget_ms: number;
  freshness_policy: string;
  display: string;
  title_default: string;
  title_template: string | null;
  default_params: Record<string, unknown>;
}

export interface SurfaceConfig {
  placements: PlacementConfig[];
  source: "db" | "stale" | "fallback";
  /** Composition attribution (logged per decision; bumps on every refresh). */
  config_version: string;
}

const TTL_MS = 60_000;

interface CacheState {
  bySurface: Map<Surface, PlacementConfig[]>;
  loadedAt: number;
  configVersion: string;
}
let cache: CacheState | null = null;

const SECTION_DEFAULTS = {
  hero_grid: { priority: 0, min_items: 10, budget_ms: 1500, freshness_policy: "per_session_snapshot", display: "grid", title_default: "Catálogo", title_template: null },
  cross_sell: { priority: 1, min_items: 3, budget_ms: 250, freshness_policy: "per_request", display: "carousel", title_default: "Combina con esto", title_template: null },
  cart_addons: { priority: 1, min_items: 2, budget_ms: 300, freshness_policy: "per_request", display: "carousel", title_default: "Completa tu compra", title_template: null },
} as const;

/** ≡ seed 0026 — the page can never be config-table-dependent to exist. */
export const DEFAULT_PLACEMENTS: Record<Surface, PlacementConfig[]> = {
  home: [
    {
      placement_id: "default-home-hero",
      surface: "home",
      slot: 10,
      section_type: "hero_grid",
      params: { limit: 20 },
      rule: null,
      scope: "global",
      scope_ref: null,
      experiment_id: null,
      version: 0,
      created_by: "seed",
      default_params: { limit: 20 },
      ...SECTION_DEFAULTS.hero_grid,
    },
  ],
  pdp: [
    {
      placement_id: "default-pdp-cross-sell",
      surface: "pdp",
      slot: 10,
      section_type: "cross_sell",
      params: { limit: 8 },
      rule: null,
      scope: "global",
      scope_ref: null,
      experiment_id: null,
      version: 0,
      created_by: "seed",
      default_params: { limit: 8 },
      ...SECTION_DEFAULTS.cross_sell,
    },
  ],
  cart: [
    {
      placement_id: "default-cart-addons",
      surface: "cart",
      slot: 10,
      section_type: "cart_addons",
      params: { limit: 6 },
      rule: { field: "cart_item_count", op: "gte", value: 1 },
      scope: "global",
      scope_ref: null,
      experiment_id: null,
      version: 0,
      created_by: "seed",
      default_params: { limit: 6 },
      ...SECTION_DEFAULTS.cart_addons,
    },
  ],
  search: [],
};

async function loadFromDb(pg: Client): Promise<Map<Surface, PlacementConfig[]>> {
  const r = await pg.query(
    `SELECT p.id::text AS placement_id, p.surface, p.slot, p.section_type, p.params,
            p.rule, p.scope, p.scope_ref, p.experiment_id, p.version, p.created_by,
            s.priority, s.min_items, s.budget_ms, s.freshness_policy, s.display,
            s.title_default, s.title_template, s.default_params
     FROM ui_placements p
     JOIN ui_sections s USING (section_type)
     WHERE p.status = 'approved'
       AND p.scope IN ('global', 'segment')
       AND (p.ttl_until IS NULL OR p.ttl_until > now())
     ORDER BY p.surface, p.slot ASC, p.version DESC`,
  );
  const bySurface = new Map<Surface, PlacementConfig[]>();
  for (const row of r.rows as (PlacementConfig & { rule: unknown })[]) {
    if (!isValidRule(row.rule)) {
      console.warn(`[slate-config] placement ${row.placement_id}: invalid rule — skipped`);
      continue;
    }
    const list = bySurface.get(row.surface) ?? [];
    list.push(row as PlacementConfig);
    bySurface.set(row.surface, list);
  }
  return bySurface;
}

export async function getSurfaceConfig(surface: Surface, pg: Client): Promise<SurfaceConfig> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < TTL_MS) {
    return {
      placements: cache.bySurface.get(surface) ?? [],
      source: "db",
      config_version: cache.configVersion,
    };
  }
  try {
    const bySurface = await loadFromDb(pg);
    cache = { bySurface, loadedAt: now, configVersion: `cfg-${now}` };
    return { placements: bySurface.get(surface) ?? [], source: "db", config_version: cache.configVersion };
  } catch (e) {
    console.warn("[slate-config] DB load failed:", e);
    if (cache) {
      return {
        placements: cache.bySurface.get(surface) ?? [],
        source: "stale",
        config_version: cache.configVersion,
      };
    }
    return { placements: DEFAULT_PLACEMENTS[surface], source: "fallback", config_version: "cfg-fallback" };
  }
}

/** Tests + futuro endpoint admin de invalidación. */
export function invalidateSlateConfigCache(): void {
  cache = null;
}
