import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { logSectionImpressions } from "@/sectors/f-slate/sections/impressions";
import { logSlateDecision, type ComposedPage } from "@/sectors/f-slate/compose";
import type { PlacementConfig } from "@/sectors/f-slate/config";
import { sqlMetricsSource } from "@/sectors/g-agents/metrics";

/**
 * Mundo mínimo A4 §8 + C1b: caza deriva de columnas, el cast session_id
 * uuid↔text, el join jsonb de slate_decisions, la dedupe DISTINCT ON, la
 * frontera temporal del click y el logging de carruseles (fila gemela).
 */

beforeEach(async () => {
  await truncateTestTables([
    "purchase_attributions",
    "feed_impressions",
    "slate_decisions",
    "events",
    "ui_placements",
    "products",
  ]);
});

async function seedProduct(pg: Client, category: string, price: number): Promise<string> {
  const r = await pg.query(
    `INSERT INTO products (source, source_product_id, title, description, price_cents, metadata)
     VALUES ('test', $1, 'P', '', $2, $3::jsonb) RETURNING id::text`,
    [randomUUID(), price, JSON.stringify({ category })],
  );
  return r.rows[0].id as string;
}

async function seedPlacement(
  pg: Client,
  p: { slot: number; section_type: string; version: number; updatedAgo: string },
): Promise<string> {
  const r = await pg.query(
    `INSERT INTO ui_placements (surface, slot, section_type, params, scope, status, version, created_by, updated_at)
     VALUES ('home', $1, $2, '{}'::jsonb, 'global', 'approved', $3, 'seed', now() - $4::interval)
     RETURNING id::text`,
    [p.slot, p.section_type, p.version, p.updatedAgo],
  );
  return r.rows[0].id as string;
}

function placementConfig(over: Partial<PlacementConfig>): PlacementConfig {
  return {
    placement_id: "x",
    surface: "home",
    slot: 10,
    section_type: "hero_grid",
    params: {},
    rule: null,
    scope: "global",
    scope_ref: null,
    experiment_id: null,
    version: 1,
    priority: 0,
    min_items: 1,
    budget_ms: 100,
    freshness_policy: "per_request",
    display: "grid",
    title_default: "",
    title_template: null,
    default_params: {},
    ...over,
  };
}

describe("capa de métricas C1 (SQL real, test_schema)", () => {
  test("funnels, atribución por placement, policies, categorías y logging C1b", async () => {
    await withTestDb(async (pg) => {
      const pElec = await seedProduct(pg, "electronica", 2000);
      const pHogar = await seedProduct(pg, "hogar", 3000);
      // hero updated hace 30min: sus impresiones (-1h) quedan FUERA de since_change
      const heroId = await seedPlacement(pg, { slot: 10, section_type: "hero_grid", version: 2, updatedAgo: "30 minutes" });
      const popId = await seedPlacement(pg, { slot: 20, section_type: "popular", version: 1, updatedAgo: "1 day" });

      const slateId = randomUUID();
      const [s1, s2, s3, s4, s5] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];

      // Decisión que creó el slate + fila DUPLICADA posterior con version
      // señuelo 99 (otra pageload) — DISTINCT ON ... ASC debe quedarse con la primera.
      const heroPl = (version: number) =>
        JSON.stringify([{ placement_id: heroId, slot: 10, section_type: "hero_grid", version }]);
      await pg.query(
        `INSERT INTO slate_decisions (slate_id, surface, session_id, config_version, placements, created_at)
         VALUES ($1, 'home', $2, 'cfg-x', $3::jsonb, now() - interval '90 minutes'),
                ($1, 'home', $2, 'cfg-x', $4::jsonb, now() - interval '80 minutes')`,
        [slateId, s1, heroPl(2), heroPl(99)],
      );

      // 4 impresiones hero (3 default — 2 vistas — + 1 holdout) + 1 legacy.
      const imp = (fid: string, sess: string, pos: number, pid: string, policy: string, seen: boolean, section: string | null) =>
        pg.query(
          `INSERT INTO feed_impressions
             (feed_request_id, session_id, position, product_id, source, propensity, section_id, policy, served_at, seen_at)
           VALUES ($1, $2, $3, $4, 'exploit', 0.9, $5, $6, now() - interval '1 hour',
                   CASE WHEN $7 THEN now() - interval '50 minutes' END)`,
          [fid, sess, pos, pid, section, policy, seen],
        );
      await imp(slateId, s1, 1, pElec, "default", true, "hero_grid");
      await imp(slateId, s2, 2, pElec, "default", false, "hero_grid");
      await imp(slateId, s3, 3, pElec, "default", true, "hero_grid");
      await imp(slateId, s4, 4, pElec, "holdout", false, "hero_grid");
      await imp(randomUUID(), s5, 1, pHogar, "default", false, null); // legacy

      // Eventos: view post-served (click), view PRE-served (no cuenta),
      // add_to_cart sobre impresión NO vista (no se condiciona a seen).
      const ev = (sess: string, type: string, ago: string, pid: string) =>
        pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, $3, now() - $4::interval, $5::jsonb)`,
          [randomUUID(), sess, type, ago, JSON.stringify({ product_id: pid })],
        );
      await ev(s1, "product_view", "30 minutes", pElec);
      await ev(s3, "product_view", "2 hours", pElec);
      await ev(s2, "add_to_cart", "30 minutes", pElec);

      // Compras: una atribuida a (slate, pos 1), una orgánica.
      await pg.query(
        `INSERT INTO purchase_attributions
           (order_id, product_id, feed_request_id, position, source, policy, seen, unit_price_cents, quantity)
         VALUES ($1, $2, $3, 1, 'exploit', 'default', true, 2000, 1),
                ($4, $5, NULL, NULL, NULL, NULL, false, 3000, 1)`,
        [randomUUID(), pElec, slateId, randomUUID(), pHogar],
      );

      // ── C1b: impresión de carrusel + fila gemela de decisión. ──
      const compositionId = randomUUID();
      await logSectionImpressions(
        {
          composition_id: compositionId,
          session_id: s1,
          user_profile_id: null,
          page_request_id: null,
          rows: [{ position: 20 * 100 + 1, product_id: pHogar, section_type: "popular", placement_version: 1 }],
        },
        pg,
      );
      const page: ComposedPage = {
        composition_id: compositionId,
        surface: "home",
        placements: [
          placementConfig({ placement_id: heroId, slot: 10, section_type: "hero_grid", version: 2 }),
          placementConfig({ placement_id: popId, slot: 20, section_type: "popular", version: 1 }),
        ],
        rule_ctx: {
          surface: "home", hour_of_day: 12, day_of_week: 3, is_logged_in: false,
          user_segment: null, session_cohort: null, recipient_active: false,
          signal_window_size: 0, gift_confirmed: false, cart_item_count: 0,
          pdp_product_id: null, pdp_category: null,
        },
        config_source: "db",
        config_version: "cfg-x",
      };
      await logSlateDecision(page, { user_profile_id: null, session_id: s1, slate_id: slateId }, pg);

      // Fila gemela: una decisión keyed slate_id Y otra keyed composition_id.
      const twin = await pg.query(
        `SELECT count(*)::int AS n FROM slate_decisions WHERE slate_id = $1`,
        [compositionId],
      );
      expect(twin.rows[0].n).toBe(1);
      // El INSERT de C1b escribe placement_version (el hero jamás lo escribe).
      const carouselRow = await pg.query(
        `SELECT section_id, position, placement_version, policy, source, propensity, seen_at
         FROM feed_impressions WHERE feed_request_id = $1`,
        [compositionId],
      );
      expect(carouselRow.rows).toEqual([
        { section_id: "popular", position: 2001, placement_version: 1, policy: "default",
          source: "exploit", propensity: 1, seen_at: null },
      ]);

      // +5min de margen: las filas C1b llevan served_at = now() del SERVIDOR
      // de DB; sin margen, un skew DB↔test dejaría la fila fuera de [from, to).
      const source = sqlMetricsSource(pg, { now: () => new Date(Date.now() + 5 * 60_000) });
      const window = { kind: "fixed", days: 7 } as const;

      // ── sectionFunnels ──
      const sections = await source.sectionFunnels({ window });
      const heroDefault = sections.find((s) => s.section_id === "hero_grid" && s.policy === "default")!;
      expect(heroDefault).toEqual({
        section_id: "hero_grid", policy: "default",
        served: 3, seen: 2, clicks: 1, add_to_carts: 1, purchases: 1, revenue_cents: 2000,
      });
      expect(sections.some((s) => s.section_id === "legacy_feed")).toBe(true);
      expect(sections.find((s) => s.section_id === "popular")?.served).toBe(1);
      // con filtro de surface, lo legacy (sin decisión) queda fuera y el
      // carrusel entra vía la fila gemela:
      const homeOnly = await source.sectionFunnels({ window, surface: "home" });
      expect(homeOnly.some((s) => s.section_id === "legacy_feed")).toBe(false);
      expect(homeOnly.some((s) => s.section_id === "popular")).toBe(true);

      // ── placementFunnels: join jsonb + dedupe (version 2, no la señuelo 99) ──
      const funnels = await source.placementFunnels({ window });
      const heroRow = funnels.find((f) => f.placement_id === heroId && f.policy === "default")!;
      expect(heroRow).toEqual({
        placement_id: heroId, section_type: "hero_grid", surface: "home", slot: 10,
        placement_version: 2, policy: "default",
        served: 3, seen: 2, clicks: 1, add_to_carts: 1, purchases: 1, revenue_cents: 2000,
      });
      const popRow = funnels.find((f) => f.placement_id === popId)!;
      expect(popRow.placement_version).toBe(1);
      expect(popRow.served).toBe(1);
      expect(popRow.seen).toBe(0);

      // since_change ancla en updated_at: el hero (updated hace 30min) pierde
      // sus impresiones de hace 1h; el carrusel (updated hace 1 día) las conserva.
      const since = await source.placementFunnels({ window, sinceChange: true });
      expect(since.some((f) => f.placement_id === heroId)).toBe(false);
      expect(since.some((f) => f.placement_id === popId)).toBe(true);

      // ── policyComparison: brazos + organic ──
      const policies = await source.policyComparison({ window });
      expect(policies.find((p) => p.policy === "default")).toEqual({
        policy: "default", exposed_sessions: 4, served: 5, seen: 2, purchases: 1, revenue_cents: 2000,
      });
      expect(policies.find((p) => p.policy === "holdout")).toEqual({
        policy: "holdout", exposed_sessions: 1, served: 1, seen: 0, purchases: 0, revenue_cents: 0,
      });
      expect(policies.find((p) => p.policy === "organic")).toEqual({
        policy: "organic", exposed_sessions: 0, served: 0, seen: 0, purchases: 1, revenue_cents: 3000,
      });

      // ── categoryFunnels ──
      const categories = await source.categoryFunnels({ window });
      expect(categories).toEqual([
        { category: "electronica", served: 4, seen: 2, clicks: 1, purchases: 1, revenue_cents: 2000 },
        { category: "hogar", served: 2, seen: 0, clicks: 0, purchases: 0, revenue_cents: 0 },
      ]);

      // ── placementCatalog ──
      const catalog = await source.placementCatalog({});
      expect(catalog.map((c) => c.placement_id)).toEqual([heroId, popId]);
      expect(catalog.every((c) => c.age_days >= 0 && c.status === "approved")).toBe(true);
    });
  });
});
