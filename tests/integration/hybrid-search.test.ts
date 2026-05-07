import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { hybridSearch } from "@/sectors/c-search/search";

beforeEach(async () => {
  await truncateTestTables(["product_query_cache", "searches", "products", "anonymous_sessions", "users"]);
});

describe("hybridSearch (REAL APIs)", () => {
  test("cache miss → LLM called + BM25+cosine + cache populated + persists row", async () => {
    await withTestDb(async (pg) => {
      // Seed enough products so count >= 12 and mock won't be invoked
      for (let i = 0; i < 15; i++) {
        await seedProductWithEmbedding(pg, {
          title: `Camiseta deportiva ${i}`,
          description: "ropa para correr",
          metadata: { category: "ropa" },
          raw_category: "ropa",
        });
      }
      const result = await hybridSearch("camiseta deportiva", { pg, anonymous_id: randomUUID(), user_id: null });
      expect(result.hitCache).toBe(false);
      expect(result.calledMock).toBe(false);
      expect(result.products.length).toBeGreaterThan(0);
      expect(result.normalized?.prompt_version).toBe("v1.0.0-fase2");

      // Cache populated
      const cached = await pg.query(`SELECT count(*)::int FROM product_query_cache`);
      expect(cached.rows[0].count).toBe(1);

      // Verify the cache was populated with the SAME product IDs that hybridSearch returned —
      // catches mutations where the cache stores wrong/empty/reordered IDs.
      const cacheContent = await pg.query(
        `SELECT products_returned FROM product_query_cache LIMIT 1`,
      );
      expect(cacheContent.rows[0].products_returned).toEqual(result.products.map((p) => p.id));

      // searches row inserted
      const search = await pg.query(`SELECT search_method, hit_cache, called_mock FROM searches`);
      expect(search.rows[0].search_method).toBe("hybrid_rrf");
      expect(search.rows[0].hit_cache).toBe(false);
      expect(search.rows[0].called_mock).toBe(false);
    });
  }, 120_000);

  test("same query twice: second call hits exact cache", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 15; i++) {
        await seedProductWithEmbedding(pg, { title: `Vestido ${i}`, metadata: { category: "ropa" }, raw_category: "ropa" });
      }
      const r1 = await hybridSearch("vestido elegante", { pg, anonymous_id: randomUUID(), user_id: null });
      const r2 = await hybridSearch("vestido elegante", { pg, anonymous_id: randomUUID(), user_id: null });
      expect(r1.hitCache).toBe(false);
      expect(r2.hitCache).toBe(true);
      expect(r2.products.map((p) => p.id)).toEqual(r1.products.map((p) => p.id));

      const persists = await pg.query(`SELECT hit_cache FROM searches ORDER BY occurred_at`);
      expect(persists.rows.map((r) => r.hit_cache)).toEqual([false, true]);
    });
  }, 120_000);

  test("3 permutations of same words → 1 cache row, 2nd and 3rd hit", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 15; i++) {
        await seedProductWithEmbedding(pg, { title: `Juguete ${i}`, metadata: { category: "juguetes_bebe" }, raw_category: "juguetes_bebe" });
      }
      await hybridSearch("regalo niña 8 años", { pg, anonymous_id: randomUUID(), user_id: null });
      await hybridSearch("niña 8 años regalo", { pg, anonymous_id: randomUUID(), user_id: null });
      await hybridSearch("8 años niña regalo", { pg, anonymous_id: randomUUID(), user_id: null });

      const cacheRows = await pg.query(`SELECT count(*)::int FROM product_query_cache`);
      expect(cacheRows.rows[0].count).toBe(1);
      const searchRows = await pg.query(`SELECT hit_cache FROM searches ORDER BY occurred_at`);
      expect(searchRows.rows.map((r) => r.hit_cache)).toEqual([false, true, true]);
    });
  }, 180_000);

  test("garbage query → confidence < 0.5 → mock NOT invoked + persists row", async () => {
    await withTestDb(async (pg) => {
      const result = await hybridSearch("asdfgh qwerty zzzz", { pg, anonymous_id: randomUUID(), user_id: null });
      expect(result.calledMock).toBe(false);
      // normalized may be null if LLM throws, OR confidence is < 0.5
      if (result.normalized) {
        expect(result.normalized.confidence).toBeLessThan(0.5);
      }
      // Persist row exists with called_mock = false
      const search = await pg.query(`SELECT called_mock FROM searches`);
      expect(search.rows[0].called_mock).toBe(false);
    });
  }, 60_000);
});
