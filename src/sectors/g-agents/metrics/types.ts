/**
 * Capa de métricas del agente merchandiser (Fase 2 C1) — READ-ONLY.
 * Ejecutada SOLO desde el path offline (withPgDirect / scope test): las
 * agregaciones 7-28d sobre feed_impressions+events no caben en el
 * statement_timeout de 2.5s del pool request-path — y esa prohibición ES la
 * garantía de "el agente nunca toca el request path".
 */

export interface ResolvedWindow {
  from: Date;
  to: Date;
  label: string; // "7d" | "14d" | "28d" | "since_change"
}

export type WindowSpec =
  | { kind: "fixed"; days: 7 | 14 | 28 }
  | { kind: "since"; from: Date }; // clamp a 28d en windows.ts

export type Surface = "home" | "pdp" | "cart" | "search";

export interface SectionFunnelRow {
  section_id: string; // 'hero_grid' | 'legacy_feed' | section_type de carrusel
  policy: string; // 'default' | 'holdout' | ...
  served: number;
  seen: number;
  clicks: number; // proxy: product_view post-exposición, misma sesión+producto
  add_to_carts: number;
  purchases: number;
  revenue_cents: number;
}

export interface PlacementFunnelRow extends Omit<SectionFunnelRow, "section_id"> {
  placement_id: string;
  section_type: string;
  surface: Surface;
  slot: number;
  placement_version: number; // del jsonb de slate_decisions (versión servida)
}

export interface PlacementCatalogRow {
  placement_id: string;
  surface: Surface;
  slot: number;
  section_type: string;
  status: string;
  risk_tier: string;
  scope: string;
  version: number;
  created_by: string;
  updated_at: Date; // ancla de since_change
  age_days: number;
}

export interface PolicyComparisonRow {
  policy: string; // 'default' | 'holdout' | 'organic' (solo compras)
  exposed_sessions: number;
  served: number;
  seen: number;
  purchases: number;
  revenue_cents: number;
}

export interface CategoryFunnelRow {
  category: string;
  served: number;
  seen: number;
  clicks: number;
  purchases: number;
  revenue_cents: number;
}

/** Seam delgado: 1 impl SQL (prod) + 1 impl in-memory (sim) con test de paridad. */
export interface MetricsSource {
  placementCatalog(opts: { surface?: Surface }): Promise<PlacementCatalogRow[]>;
  placementFunnels(opts: {
    window: WindowSpec;
    surface?: Surface;
    sinceChange?: boolean;
  }): Promise<PlacementFunnelRow[]>;
  sectionFunnels(opts: { window: WindowSpec; surface?: Surface }): Promise<SectionFunnelRow[]>;
  policyComparison(opts: { window: WindowSpec }): Promise<PolicyComparisonRow[]>;
  categoryFunnels(opts: { window: WindowSpec; limit?: number }): Promise<CategoryFunnelRow[]>;
}
