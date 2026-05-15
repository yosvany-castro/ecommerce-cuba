import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProduct, seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { getCategoryFreshness } from "@/sectors/c-search/decide/freshness";
import { hybridSearch } from "@/sectors/c-search/search";
import { resetCallCount, getCallCount } from "@/sectors/b-catalog/mock/aggregator";

beforeEach(async () => {
  await truncateTestTables(["products"]);
});

describe("getCategoryFreshness", () => {
  test("returns null when category is null (no filter to apply)", async () => {
    await withTestDb(async (pg) => {
      const out = await getCategoryFreshness(null, pg);
      expect(out).toBeNull();
    });
  });

  test("returns null when no products exist for that category", async () => {
    await withTestDb(async (pg) => {
      await seedProduct(pg, { metadata: { category: "ropa" } });
      const out = await getCategoryFreshness("electronica", pg);
      expect(out).toBeNull();
    });
  });

  test("returns MAX(last_refreshed_at) for matching active products", async () => {
    await withTestDb(async (pg) => {
      const a = await seedProduct(pg, { metadata: { category: "electronica" } });
      const b = await seedProduct(pg, { metadata: { category: "electronica" } });
      const olderIso = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const newerIso = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
      await pg.query(`UPDATE products SET last_refreshed_at = $1 WHERE id = $2`, [olderIso, a.id]);
      await pg.query(`UPDATE products SET last_refreshed_at = $1 WHERE id = $2`, [newerIso, b.id]);
      const out = await getCategoryFreshness("electronica", pg);
      expect(out).not.toBeNull();
      const diffMs = Math.abs(out!.getTime() - new Date(newerIso).getTime());
      expect(diffMs).toBeLessThan(1000);
    });
  });
});

describe("hybridSearch freshness gate (REAL APIs, MOCK_LIMIT=2)", () => {
  beforeEach(async () => {
    await truncateTestTables(["product_query_cache", "searches", "products", "mock_calls"]);
    resetCallCount();
    process.env.HYBRID_SEARCH_MOCK_LIMIT = "2";
  });

  afterEach(() => {
    delete process.env.HYBRID_SEARCH_MOCK_LIMIT;
  });

  test("recently-refreshed category does NOT re-trigger mock for low-count query", async () => {
    await withTestDb(async (pg) => {
      const seeded = await seedProductWithEmbedding(pg, {
        title: "Auriculares Sony WH-1000XM5",
        description: "auriculares bluetooth con cancelación de ruido",
        metadata: { category: "electronica" },
        raw_category: "electronica",
      });
      const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
      await pg.query(`UPDATE products SET last_refreshed_at = $1 WHERE id = $2`, [
        oneHourAgo,
        seeded.id,
      ]);

      const callsBefore = getCallCount();
      const result = await hybridSearch(
        "audifonos bluetooth con cancelacion de ruido",
        { pg, anonymous_id: null, user_id: null },
      );
      expect(result.calledMock).toBe(false);
      expect(getCallCount() - callsBefore).toBe(0);
    });
  }, 240_000);
});
