import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import {
  recomputePopularity7d,
  isPopularityTableReady,
  resetPopularityReadinessForTests,
} from "@/sectors/d-personalization/popularity/recompute";
import { fetchEventCounts7d } from "@/sectors/d-personalization/retrieve/event-popularity";

/**
 * Etapa B — slate data backbone (migrations 0024-0027).
 * Invariants that protect the IRREVERSIBLE attribution contract.
 */

beforeEach(async () => {
  await truncateTestTables(["feed_impressions", "feed_slates", "events", "products", "product_popularity_7d"]);
  resetPopularityReadinessForTests();
});

describe("feed_impressions consolidated attribution (0024)", () => {
  test("retry-safe: duplicate (feed_request_id, position) is a no-op, not a duplicate impression", async () => {
    await withTestDb(async (pg) => {
      const reqId = randomUUID();
      const productId = randomUUID();
      const insert = () =>
        pg.query(
          `INSERT INTO feed_impressions
             (feed_request_id, position, product_id, source, propensity, section_id, policy, experiment_id)
           VALUES ($1, 1, $2, 'exploit', 0.9, 'hero_grid', 'default', 'exp-test')
           ON CONFLICT (feed_request_id, position) DO NOTHING`,
          [reqId, productId],
        );
      await insert();
      await insert(); // network retry
      const r = await pg.query(
        `SELECT count(*)::int AS c, max(section_id) AS section, max(policy) AS policy
         FROM feed_impressions WHERE feed_request_id = $1`,
        [reqId],
      );
      expect(r.rows[0].c).toBe(1);
      expect(r.rows[0].section).toBe("hero_grid");
      expect(r.rows[0].policy).toBe("default");
    });
  });

  test("feed_slates roundtrips the materialized snapshot (items/pins/spares jsonb)", async () => {
    await withTestDb(async (pg) => {
      const slateId = randomUUID();
      const items = [
        { product_id: randomUUID(), position: 1, source: "exploit", propensity: 0.9 },
        { product_id: randomUUID(), position: 2, source: "explore", propensity: 0.05 },
      ];
      await pg.query(
        `INSERT INTO feed_slates (slate_id, session_id, surface, items, expires_at)
         VALUES ($1, $2, 'home', $3::jsonb, now() + interval '300 seconds')`,
        [slateId, randomUUID(), JSON.stringify(items)],
      );
      const r = await pg.query(
        `SELECT items, version, pins FROM feed_slates WHERE slate_id = $1 AND expires_at > now()`,
        [slateId],
      );
      expect(r.rows[0].items).toEqual(items);
      expect(r.rows[0].version).toBe(1);
      expect(r.rows[0].pins).toEqual([]);
    });
  });
});

describe("ui_placements lifecycle guards (0025/0026)", () => {
  test("the public seed replicates today's pages (hero_grid home, cross_sell pdp, cart_addons cart)", async () => {
    await withTestDb(async (pg) => {
      const sections = await pg.query(
        `SELECT section_type, priority, min_items FROM public.ui_sections ORDER BY section_type`,
      );
      const types = sections.rows.map((r) => r.section_type);
      expect(types).toEqual(expect.arrayContaining(["hero_grid", "cross_sell", "popular", "cart_addons"]));
      const hero = sections.rows.find((r) => r.section_type === "hero_grid");
      expect(hero.priority).toBe(0); // el feed principal jamás se sacrifica

      const placements = await pg.query(
        `SELECT surface, section_type, status FROM public.ui_placements
         WHERE created_by = 'seed' ORDER BY surface`,
      );
      expect(placements.rows).toEqual([
        { surface: "cart", section_type: "cart_addons", status: "approved" },
        { surface: "home", section_type: "hero_grid", status: "approved" },
        { surface: "pdp", section_type: "cross_sell", status: "approved" },
      ]);
    });
  });

  test("status='killed' is irreversible at the DATA layer (trigger), not by convention", async () => {
    await withTestDb(async (pg) => {
      await pg.query(
        `INSERT INTO ui_sections (section_type, title_default, display)
         VALUES ('test_section', 'Test', 'grid')
         ON CONFLICT (section_type) DO NOTHING`,
      );
      const ins = await pg.query(
        `INSERT INTO ui_placements (surface, slot, section_type, status, created_by)
         VALUES ('home', 99, 'test_section', 'killed', 'test')
         RETURNING id`,
      );
      const id = ins.rows[0].id;
      await expect(
        pg.query(`UPDATE ui_placements SET status = 'approved' WHERE id = $1`, [id]),
      ).rejects.toThrow(/irreversible/);
      // killed → killed (touch other columns) sigue permitido:
      await pg.query(`UPDATE ui_placements SET version = version + 1 WHERE id = $1`, [id]);
    });
  });
});

describe("product_popularity_7d materialization (0027)", () => {
  test("recompute aggregates 7d events with category; consumers read the table; empty table falls back live", async () => {
    await withTestDb(async (pg) => {
      const productId = randomUUID();
      await pg.query(
        `INSERT INTO products (id, source, source_product_id, title, description, price_cents, metadata)
         VALUES ($1, 'test', $2, 'Audífonos X', '', 1000, '{"category": "audio"}'::jsonb)`,
        [productId, randomUUID()],
      );
      const anon = randomUUID();
      const sess = randomUUID();
      for (let i = 0; i < 3; i++) {
        await pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, 'product_view', now() - interval '1 hour', $3::jsonb)`,
          [anon, sess, JSON.stringify({ product_id: productId })],
        );
      }
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'purchase', now() - interval '1 hour', $3::jsonb)`,
        [anon, sess, JSON.stringify({ order_id: randomUUID(), product_ids: [productId], total_cents: 1000 })],
      );

      const { products } = await recomputePopularity7d(pg);
      expect(products).toBe(1);
      const row = (
        await pg.query(`SELECT events_7d, views_7d, purchases_7d, category FROM product_popularity_7d`)
      ).rows[0];
      expect(row.events_7d).toBe(4);
      expect(row.views_7d).toBe(3);
      expect(row.purchases_7d).toBe(1);
      expect(row.category).toBe("audio");

      // Fast path: the consumer reads the materialized number.
      resetPopularityReadinessForTests();
      expect(await isPopularityTableReady(pg)).toBe(true);
      const counts = await fetchEventCounts7d([productId], pg);
      expect(counts.get(productId)).toBe(4);

      // Fallback: empty table ⇒ live aggregation still answers (cron never ran).
      await pg.query(`DELETE FROM product_popularity_7d`);
      resetPopularityReadinessForTests();
      const live = await fetchEventCounts7d([productId], pg);
      expect(live.get(productId)).toBe(4);
    });
  });
});
