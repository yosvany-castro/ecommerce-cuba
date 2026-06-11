import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { sqlMetricsSource } from "@/sectors/g-agents/metrics";
import { simMetricsSource } from "@/sectors/g-agents/sim/sim-metrics-source";
import { SimPlacementStore } from "@/sectors/g-agents/sim/store";
import type { ArmLog } from "@/sectors/g-agents/sim/ledger";

/**
 * Paridad del canal de observación (decisión 2.B.6): el fixture A4 §8 — view
 * pre-served, seen gating, holdout, orgánica, legacy, dedupe de decisiones,
 * since_change — cargado en test_schema Y en el log del sim ⇒ sqlMetricsSource
 * y simMetricsSource deben devolver filas DEEP-EQUAL en las 5 funciones. Si
 * divergen, el agente del gate observa un mundo distinto al de producción
 * (anti-H7) y el gate queda invalidado.
 */

const NOW = new Date("2026-03-01T12:00:00.000Z");
const ago = (mins: number) => new Date(NOW.getTime() - mins * 60_000);
const DAY_MIN = 24 * 60;

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

describe("paridad sqlMetricsSource ≡ simMetricsSource (fixture A4 §8)", () => {
  test("las 5 funciones devuelven filas deep-equal sobre el mismo mundo", async () => {
    await withTestDb(async (pg) => {
      const pElec = await seedProduct(pg, "electronica", 2000);
      const pHogar = await seedProduct(pg, "hogar", 3000);

      // ── Placements: hero v2 (updated hace 30min) + popular v1 (hace 1 día). ──
      const heroUpdated = ago(30);
      const popUpdated = ago(DAY_MIN);
      const seedPlacement = async (slot: number, section: string, version: number, updated: Date) => {
        const r = await pg.query(
          `INSERT INTO ui_placements (surface, slot, section_type, params, scope, status, version, created_by, created_at, updated_at)
           VALUES ('home', $1, $2, '{}'::jsonb, 'global', 'approved', $3, 'seed', $4, $4)
           RETURNING id::text`,
          [slot, section, version, updated],
        );
        return r.rows[0].id as string;
      };
      const heroId = await seedPlacement(10, "hero_grid", 2, heroUpdated);
      const popId = await seedPlacement(20, "popular", 1, popUpdated);

      const slateId = randomUUID();
      const compositionId = randomUUID();
      const [s1, s2, s3, s4, s5] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];

      // Decisión + fila señuelo version 99 (DISTINCT ON ASC se queda la primera);
      // fila gemela para el carrusel (keyed composition_id, C1b).
      const heroPl = (version: number) =>
        JSON.stringify([{ placement_id: heroId, slot: 10, section_type: "hero_grid", version }]);
      const popPl = JSON.stringify([
        { placement_id: heroId, slot: 10, section_type: "hero_grid", version: 2 },
        { placement_id: popId, slot: 20, section_type: "popular", version: 1 },
      ]);
      await pg.query(
        `INSERT INTO slate_decisions (slate_id, surface, session_id, config_version, placements, created_at)
         VALUES ($1, 'home', $4, 'cfg-x', $5::jsonb, $7),
                ($1, 'home', $4, 'cfg-x', $6::jsonb, $8),
                ($2, 'home', $4, 'cfg-x', $3::jsonb, $8)`,
        [slateId, compositionId, popPl, s1, heroPl(2), heroPl(99), ago(90), ago(80)],
      );

      // ── Impresiones: 3 hero default (2 vistas) + 1 holdout + 1 legacy + 1 carrusel. ──
      const servedAt = ago(60);
      const seenAt = ago(50);
      const imp = (
        fid: string, sess: string, pos: number, pid: string, policy: string,
        seen: boolean, section: string | null, version: number | null,
      ) =>
        pg.query(
          `INSERT INTO feed_impressions
             (feed_request_id, session_id, position, product_id, source, propensity,
              section_id, placement_version, policy, served_at, seen_at)
           VALUES ($1, $2, $3, $4, 'exploit', 1.0, $5, $6, $7, $8, $9)`,
          [fid, sess, pos, pid, section, version, policy, servedAt, seen ? seenAt : null],
        );
      await imp(slateId, s1, 1, pElec, "default", true, "hero_grid", null);
      await imp(slateId, s2, 2, pElec, "default", false, "hero_grid", null);
      await imp(slateId, s3, 3, pElec, "default", true, "hero_grid", null);
      await imp(slateId, s4, 4, pElec, "holdout", false, "hero_grid", null);
      await imp(randomUUID(), s5, 1, pHogar, "default", false, null, null); // legacy
      await imp(compositionId, s1, 2001, pHogar, "default", false, "popular", 1); // carrusel

      // ── Eventos: click post-served, view PRE-served (no cuenta), atc sin seen. ──
      const ev = (sess: string, type: string, when: Date, pid: string) =>
        pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [randomUUID(), sess, type, when, JSON.stringify({ product_id: pid })],
        );
      await ev(s1, "product_view", ago(30), pElec);
      await ev(s3, "product_view", ago(120), pElec);
      await ev(s2, "add_to_cart", ago(30), pElec);

      // ── Compras: atribuida a (slateId, pos 1) + orgánica. ──
      await pg.query(
        `INSERT INTO purchase_attributions
           (order_id, product_id, feed_request_id, position, source, policy, seen, unit_price_cents, quantity, attributed_at)
         VALUES ($1, $2, $3, 1, 'exploit', 'default', true, 2000, 1, $6),
                ($4, $5, NULL, NULL, NULL, NULL, false, 3000, 1, $6)`,
        [randomUUID(), pElec, slateId, randomUUID(), pHogar, ago(30)],
      );

      // ── El MISMO mundo en el sim (ids idénticos, timestamps idénticos). ──
      const store = new SimPlacementStore(1);
      const seedSim = (id: string, slot: number, section: string, version: number, updated: Date) =>
        store.seed({
          id, surface: "home", slot, section_type: section, params: {}, rule: null,
          scope: "global", scope_ref: null, status: "approved", risk_tier: "low",
          experiment_id: null, ttl_until: null, created_by: "seed", version,
          created_at: updated, updated_at: updated, proposal_key: null, proposal_meta: null,
        });
      seedSim(heroId, 10, "hero_grid", 2, heroUpdated);
      seedSim(popId, 20, "popular", 1, popUpdated);

      const simImp = (
        fid: string, sess: string, pos: number, pid: string, policy: string,
        seen: boolean, section: string | null, placementId: string | null, version: number | null,
        surface: string | null,
      ) => ({
        epoch: 0, feed_request_id: fid, session_id: sess, user_id: "u", position: pos,
        product_id: pid, section_id: section, placement_id: placementId,
        placement_version: version, policy, surface, source: "exploit" as const,
        propensity: 1, served_at: servedAt, seen_at: seen ? seenAt : null,
      });
      const legacyFid = randomUUID();
      const log: ArmLog = {
        impressions: [
          simImp(slateId, s1, 1, pElec, "default", true, "hero_grid", heroId, 2, "home"),
          simImp(slateId, s2, 2, pElec, "default", false, "hero_grid", heroId, 2, "home"),
          simImp(slateId, s3, 3, pElec, "default", true, "hero_grid", heroId, 2, "home"),
          simImp(slateId, s4, 4, pElec, "holdout", false, "hero_grid", heroId, 2, "home"),
          simImp(legacyFid, s5, 1, pHogar, "default", false, null, null, null, null),
          simImp(compositionId, s1, 2001, pHogar, "default", false, "popular", popId, 1, "home"),
        ],
        events: [
          { epoch: 0, session_id: s1, user_id: "u", event_type: "product_view", product_id: pElec, occurred_at: ago(30) },
          { epoch: 0, session_id: s3, user_id: "u", event_type: "product_view", product_id: pElec, occurred_at: ago(120) },
          { epoch: 0, session_id: s2, user_id: "u", event_type: "add_to_cart", product_id: pElec, occurred_at: ago(30) },
        ],
        purchases: [
          { epoch: 0, session_id: s1, product_id: pElec, feed_request_id: slateId, position: 1,
            policy: "default", seen: true, unit_price_cents: 2000, quantity: 1,
            attributed_at: ago(30), attributed_placement_id: heroId, margin_pct: 0.6 },
          { epoch: 0, session_id: s5, product_id: pHogar, feed_request_id: null, position: null,
            policy: null, seen: false, unit_price_cents: 3000, quantity: 1,
            attributed_at: ago(30), attributed_placement_id: null, margin_pct: 0.6 },
        ],
      };
      const categoryOf = (id: string) =>
        id === pElec ? "electronica" : id === pHogar ? "hogar" : null;

      const now = () => NOW;
      const sql = sqlMetricsSource(pg, { now });
      const sim = simMetricsSource({ log, placements: () => store.allRows(), categoryOf, now });
      const window = { kind: "fixed", days: 7 } as const;

      // ── Las 5 funciones, deep-equal (incluye variantes surface y sinceChange). ──
      expect(await sim.placementCatalog({})).toEqual(await sql.placementCatalog({}));
      expect(await sim.sectionFunnels({ window })).toEqual(await sql.sectionFunnels({ window }));
      expect(await sim.sectionFunnels({ window, surface: "home" })).toEqual(
        await sql.sectionFunnels({ window, surface: "home" }),
      );
      expect(await sim.placementFunnels({ window })).toEqual(await sql.placementFunnels({ window }));
      expect(await sim.placementFunnels({ window, sinceChange: true })).toEqual(
        await sql.placementFunnels({ window, sinceChange: true }),
      );
      expect(await sim.policyComparison({ window })).toEqual(await sql.policyComparison({ window }));
      expect(await sim.categoryFunnels({ window })).toEqual(await sql.categoryFunnels({ window }));

      // sanity de NO-vacuidad: la paridad no puede pasar por listas vacías
      const sections = await sim.sectionFunnels({ window });
      expect(sections.length).toBeGreaterThanOrEqual(3);
      const hero = sections.find((s) => s.section_id === "hero_grid" && s.policy === "default")!;
      expect(hero).toMatchObject({ served: 3, seen: 2, clicks: 1, add_to_carts: 1, purchases: 1, revenue_cents: 2000 });
      const since = await sim.placementFunnels({ window, sinceChange: true });
      expect(since.some((f) => f.placement_id === heroId)).toBe(false); // updated_at posterior a served
      expect(since.some((f) => f.placement_id === popId)).toBe(true);
    });
  });
});
