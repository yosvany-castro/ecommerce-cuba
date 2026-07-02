import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import {
  fetchCategoryPage,
  CATEGORY_PAGE_SIZE,
} from "@/sectors/b-catalog/repository/category-page";
import { resetPopularityReadinessForTests } from "@/sectors/d-personalization/popularity/recompute";

beforeEach(async () => {
  resetPopularityReadinessForTests();
  await truncateTestTables(["products", "product_popularity_7d"]);
});

async function seedProduct(pg: Client, category: string, title: string): Promise<string> {
  const r = await pg.query(
    `INSERT INTO products (source, source_product_id, title, description, price_cents, currency, metadata)
     VALUES ('test', $1, $2, '', 1000, 'USD', $3::jsonb) RETURNING id::text`,
    [randomUUID(), title, JSON.stringify({ category })],
  );
  return r.rows[0].id as string;
}

describe("fetchCategoryPage (D6)", () => {
  test("filtra por categoría, ordena por popularidad materializada y pagina con hasNext", async () => {
    await withTestDb(async (pg) => {
      const audio: string[] = [];
      for (let i = 0; i < CATEGORY_PAGE_SIZE + 3; i++) {
        audio.push(await seedProduct(pg, "audio", `A${i}`));
      }
      await seedProduct(pg, "hogar", "H1"); // otra categoría: fuera

      // popularidad materializada: el ÚLTIMO sembrado es el más popular
      const star = audio[audio.length - 1];
      await pg.query(
        `INSERT INTO product_popularity_7d (product_id, events_7d, category) VALUES ($1, 99, 'audio')`,
        [star],
      );

      const p1 = await fetchCategoryPage("audio", 1, pg);
      expect(p1.items).toHaveLength(CATEGORY_PAGE_SIZE);
      expect(p1.hasNext).toBe(true);
      expect(p1.items[0].id).toBe(star); // fast path por events_7d
      expect(p1.items.map((x) => x.id)).not.toContain(
        (await pg.query(`SELECT id::text FROM products WHERE title='H1'`)).rows[0].id,
      );

      const p2 = await fetchCategoryPage("audio", 2, pg);
      expect(p2.items.length).toBe(3);
      expect(p2.hasNext).toBe(false);
      const all = new Set([...p1.items, ...p2.items].map((x) => x.id));
      expect(all.size).toBe(CATEGORY_PAGE_SIZE + 3); // sin solapes entre páginas
    });
  });

  test("fallback determinista (created_at) cuando la tabla de popularidad está vacía", async () => {
    await withTestDb(async (pg) => {
      await seedProduct(pg, "audio", "viejo");
      await new Promise((r) => setTimeout(r, 20));
      const newest = await seedProduct(pg, "audio", "nuevo");
      const p = await fetchCategoryPage("audio", 1, pg);
      expect(p.items[0].id).toBe(newest);
      expect(p.hasNext).toBe(false);
    });
  });
});
