import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { serveFeedPage } from "@/sectors/d-personalization/feed";
import { composePage } from "@/sectors/f-slate/compose";
import { resolveSections } from "@/sectors/f-slate/sections/resolve";
import { invalidateSlateConfigCache } from "@/sectors/f-slate/config";

beforeEach(async () => {
  invalidateSlateConfigCache();
  await truncateTestTables([
    "ui_placements",
    "ui_sections",
    "feed_slates",
    "feed_impressions",
    "events",
    "products",
    "product_popularity_7d",
    "user_profiles",
    "slate_decisions",
  ]);
});

/**
 * D4 — garantía de CERO regresión: con el seed (home = solo hero_grid), la
 * composición sirve EXACTAMENTE los mismos items, en el mismo orden, que el
 * camino directo serveFeedPage (mismo slate de la sesión). Una sola siembra
 * (12 embeds Voyage — frugal).
 */
describe("home equivalence (D4)", () => {
  test("composePage+resolveSections(hero) ≡ serveFeedPage para la misma sesión", async () => {
    await withTestDb(async (pg) => {
      // seed catálogo + señal de popularidad de otro visitante
      const ids: string[] = [];
      for (let i = 0; i < 12; i++) {
        const { id } = await seedProductWithEmbedding(pg, { title: `Eq ${i}`, metadata: { category: "audio" } });
        ids.push(id);
      }
      const otherAnon = randomUUID();
      const otherSess = randomUUID();
      for (const pid of ids) {
        await pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, 'product_view', now() - interval '1 hour', $3::jsonb)`,
          [otherAnon, otherSess, JSON.stringify({ product_id: pid })],
        );
      }
      // seed de composición ≡ 0026 (réplica test_schema)
      await pg.query(
        `INSERT INTO ui_sections (section_type, title_default, display, priority, min_items, budget_ms, freshness_policy, default_params)
         VALUES ('hero_grid', 'Catálogo', 'grid', 0, 1, 5000, 'per_session_snapshot', '{"limit":20}'::jsonb)`,
      );
      await pg.query(
        `INSERT INTO ui_placements (surface, slot, section_type, params, scope, status, created_by)
         VALUES ('home', 10, 'hero_grid', '{"limit":20}'::jsonb, 'global', 'approved', 'seed')`,
      );

      const identity = { user_id: null, anonymous_id: randomUUID(), session_id: randomUUID() };

      // Camino directo (materializa el slate de la sesión):
      const direct = await serveFeedPage(identity, pg);
      expect(direct.items.length).toBeGreaterThan(0);

      // Camino compuesto (DEBE hitear el MISMO slate y no tocar nada):
      const page = await composePage({ surface: "home", identity }, pg);
      expect(page.placements).toHaveLength(1);
      const sections = await resolveSections(page, identity, undefined, pg);
      const hero = sections.find((s) => s.section_type === "hero_grid")!;

      expect(hero.outcome).toBe("served");
      expect(hero.slate_id).toBe(direct.slate_id);
      expect(hero.items.map((x) => x.id)).toEqual(direct.items.map((x) => x.product.id));
      // El cursor sobrevive a la composición (scroll infinito intacto):
      expect(typeof hero.next_cursor === "string" || hero.next_cursor === null).toBe(true);
    });
  }, 240_000);
});
