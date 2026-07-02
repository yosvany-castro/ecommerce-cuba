import { describe, test, expect } from "vitest";
import { buildMetricsReport } from "@/sectors/g-agents/metrics/report";
import type {
  CategoryFunnelRow,
  MetricsSource,
  PlacementCatalogRow,
  PlacementFunnelRow,
  PolicyComparisonRow,
  SectionFunnelRow,
} from "@/sectors/g-agents/metrics/types";

/**
 * Toda la lógica de compactación/protección de report.ts — donde un refactor
 * rompería al agente en silencio (un 0.0 que significa "sin datos", un rate
 * sin muestra, una categoría de más).
 */

const NOW = () => new Date("2026-06-11T00:00:00.000Z");

function cat(over: Partial<PlacementCatalogRow>): PlacementCatalogRow {
  return {
    placement_id: "x",
    surface: "home",
    slot: 10,
    section_type: "popular",
    status: "approved",
    risk_tier: "low",
    scope: "global",
    version: 1,
    created_by: "seed",
    updated_at: new Date("2026-06-01T00:00:00.000Z"),
    age_days: 10,
    ...over,
  };
}

function funnel(over: Partial<PlacementFunnelRow>): PlacementFunnelRow {
  return {
    placement_id: "x",
    section_type: "popular",
    surface: "home",
    slot: 10,
    placement_version: 1,
    policy: "default",
    served: 0,
    seen: 0,
    clicks: 0,
    add_to_carts: 0,
    purchases: 0,
    revenue_cents: 0,
    ...over,
  };
}

function src(data: {
  catalog?: PlacementCatalogRow[];
  funnels?: PlacementFunnelRow[];
  since?: PlacementFunnelRow[];
  sections?: SectionFunnelRow[];
  sections7?: SectionFunnelRow[];
  policies?: PolicyComparisonRow[];
  categories?: CategoryFunnelRow[];
}): MetricsSource {
  return {
    placementCatalog: async () => data.catalog ?? [],
    placementFunnels: async (o) => (o.sinceChange ? (data.since ?? []) : (data.funnels ?? [])),
    sectionFunnels: async (o) =>
      o.window.kind === "fixed" && o.window.days === 7 && data.sections7
        ? data.sections7
        : (data.sections ?? []),
    policyComparison: async () => data.policies ?? [],
    categoryFunnels: async () => data.categories ?? [],
  };
}

describe("buildMetricsReport (shape compacto para LLM)", () => {
  test("mínimos, flags, top-5+other, cap de 12 y redondeos", async () => {
    const catalog = [
      cat({ placement_id: "p-hero", section_type: "hero_grid", slot: 10, version: 3, age_days: 12 }),
      cat({ placement_id: "p-cross", surface: "pdp", section_type: "cross_sell", slot: 10, age_days: 30 }),
      cat({ placement_id: "p-pop", section_type: "popular", slot: 20, age_days: 2 }),
      ...Array.from({ length: 11 }, (_, i) => cat({ placement_id: `p-dummy-${i}`, slot: 30 + i * 10 })),
    ];
    const report = await buildMetricsReport(
      src({
        catalog,
        funnels: [
          funnel({ placement_id: "p-hero", section_type: "hero_grid", placement_version: 3,
            served: 1000, seen: 150, clicks: 9, add_to_carts: 5, purchases: 2, revenue_cents: 40000 }),
          // fila holdout: NO debe sumarse al funnel default
          funnel({ placement_id: "p-hero", section_type: "hero_grid", policy: "holdout", served: 100, seen: 10 }),
          funnel({ placement_id: "p-pop", slot: 20, served: 400 }),
        ],
        since: [
          funnel({ placement_id: "p-hero", section_type: "hero_grid", placement_version: 3,
            served: 800, seen: 140, clicks: 8, add_to_carts: 4, purchases: 1, revenue_cents: 20000 }),
        ],
        sections: [
          { section_id: "hero_grid", policy: "default", served: 1000, seen: 150, clicks: 9, add_to_carts: 5, purchases: 2, revenue_cents: 40000 },
          { section_id: "hero_grid", policy: "holdout", served: 100, seen: 10, clicks: 0, add_to_carts: 0, purchases: 0, revenue_cents: 0 },
          { section_id: "popular", policy: "default", served: 400, seen: 0, clicks: 0, add_to_carts: 0, purchases: 0, revenue_cents: 0 },
          { section_id: "legacy_feed", policy: "default", served: 50, seen: 5, clicks: 0, add_to_carts: 0, purchases: 0, revenue_cents: 0 },
        ],
        policies: [
          { policy: "default", exposed_sessions: 1620, served: 1400, seen: 8190, purchases: 21, revenue_cents: 391800 },
          { policy: "holdout", exposed_sessions: 183, served: 150, seen: 914, purchases: 2, revenue_cents: 21000 },
          { policy: "organic", exposed_sessions: 0, served: 0, seen: 0, purchases: 8, revenue_cents: 168000 },
        ],
        categories: [
          { category: "electronica", served: 5000, seen: 3120, clicks: 221, purchases: 9, revenue_cents: 189000 },
          { category: "hogar", served: 4000, seen: 2270, clicks: 111, purchases: 6, revenue_cents: 96000 },
          { category: "c3", served: 900, seen: 800, clicks: 40, purchases: 1, revenue_cents: 9000 },
          { category: "c4", served: 800, seen: 700, clicks: 35, purchases: 1, revenue_cents: 8000 },
          { category: "c5", served: 700, seen: 600, clicks: 30, purchases: 0, revenue_cents: 0 },
          { category: "c6", served: 200, seen: 150, clicks: 6, purchases: 0, revenue_cents: 0 },
          { category: "c7", served: 120, seen: 100, clicks: 4, purchases: 1, revenue_cents: 5000 },
        ],
      }),
      { windowDays: 7, now: NOW },
    );

    expect(report.window).toEqual({ label: "7d", from: "2026-06-04", to: "2026-06-11" });

    // store: agregado de TODAS las secciones/policies; organic aparte.
    expect(report.store.served).toBe(1550);
    expect(report.store.seen).toBe(165);
    expect(report.store.seen_rate).toBe(0.106); // round3(165/1550)
    expect(report.store.ctr_seen).toBeNull(); // seen 165 < 200
    expect(report.store.flags).toContain("low_sample");
    expect(report.store.feed_revenue_cents).toBe(40000);
    expect(report.store.organic_revenue_cents).toBe(168000);

    // vs_holdout: con muestra pero holdout flaco ⇒ ratio + flag (no un 0.0).
    expect(report.vs_holdout === null).toBe(false);
    expect(report.vs_holdout!.revenue_ratio).toBe(2.08);
    expect(report.vs_holdout!.flags).toContain("holdout_low_purchases");
    expect(report.vs_holdout!.default.revenue_per_1k_seen_cents).toBe(47839);
    expect(report.vs_holdout!.default.purchases_per_100_sessions).toBe(1.296);

    // placements: cap 12 de 14.
    expect(report.placements).toHaveLength(12);

    const hero = report.placements.find((p) => p.id === "p-hero")!;
    expect(hero.funnel!.served).toBe(1000); // la fila holdout NO se suma
    expect(hero.funnel!.seen_rate).toBe(0.15);
    expect(hero.funnel!.ctr_seen).toBeNull(); // seen 150 < 200
    expect(hero.funnel!.ctr_ci95).toBeUndefined();
    expect(hero.flags).toContain("low_sample");
    expect(hero.since_change).toEqual({
      days: 12, served: 800, seen: 140, ctr_seen: null, purchases: 1, revenue_cents: 20000,
    });

    const cross = report.placements.find((p) => p.id === "p-cross")!;
    expect(cross.funnel).toBeNull();
    expect(cross.flags).toContain("no_impression_logging");

    const pop = report.placements.find((p) => p.id === "p-pop")!;
    expect(pop.flags).toContain("no_seen_tracking"); // served>0 ∧ seen=0, no-hero

    // categorías: top-5 + other(+2) agregado; ctr a 3 decimales.
    expect(report.categories).toHaveLength(6);
    expect(report.categories[0]).toEqual({
      name: "electronica", seen: 3120, ctr_seen: 0.071, purchases: 9, revenue_cents: 189000,
    });
    const other = report.categories[5];
    expect(other.name).toBe("other(+2)");
    expect(other.seen).toBe(250);
    expect(other.purchases).toBe(1);

    expect(report.data_quality.impression_sources).toEqual(["hero_grid", "popular"]);
    expect(report.data_quality.retention_days).toBe(90);
  });

  test("holdout bajo mínimos ⇒ vs_holdout null + nota (jamás un ratio ruidoso)", async () => {
    const report = await buildMetricsReport(
      src({
        policies: [
          { policy: "default", exposed_sessions: 200, served: 100, seen: 80, purchases: 12, revenue_cents: 50000 },
          { policy: "holdout", exposed_sessions: 10, served: 10, seen: 8, purchases: 1, revenue_cents: 2000 },
        ],
      }),
      { windowDays: 7, now: NOW },
    );
    expect(report.vs_holdout).toBeNull();
    expect(report.data_quality.notes.join(" ")).toContain("insufficient_holdout_data");
  });

  test("windowDays=14 ⇒ trend de dos buckets 7d (previous = 14d − current)", async () => {
    const report = await buildMetricsReport(
      src({
        sections: [
          { section_id: "hero_grid", policy: "default", served: 3000, seen: 600, clicks: 30, add_to_carts: 0, purchases: 10, revenue_cents: 100000 },
        ],
        sections7: [
          { section_id: "hero_grid", policy: "default", served: 2000, seen: 400, clicks: 20, add_to_carts: 0, purchases: 7, revenue_cents: 60000 },
        ],
      }),
      { windowDays: 14, now: NOW },
    );
    expect(report.window.label).toBe("14d");
    expect(report.store.trend!.current_7d).toEqual({
      seen: 400, ctr_seen: 0.05, purchases: 7, revenue_cents: 60000,
    });
    expect(report.store.trend!.previous_7d).toEqual({
      seen: 200, ctr_seen: 0.05, purchases: 3, revenue_cents: 40000,
    });
  });
});
