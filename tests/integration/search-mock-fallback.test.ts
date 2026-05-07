import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { resetCallCount, getCallCount } from "@/sectors/b-catalog/mock/aggregator";
import { hybridSearch } from "@/sectors/c-search/search";

beforeEach(async () => {
  await truncateTestTables(["product_query_cache", "searches", "products", "mock_calls"]);
  resetCallCount();
  process.env.HYBRID_SEARCH_MOCK_LIMIT = "2"; // keep tests cheap
});

afterEach(() => {
  delete process.env.HYBRID_SEARCH_MOCK_LIMIT;
});

describe("hybridSearch mock fallback (REAL APIs, capped at 2 products per call)", () => {
  test("count < 12 + confidence > 0.5 → mock invoked + products enriched + retrieval re-runs", async () => {
    await withTestDb(async (pg) => {
      // No products seeded → count starts at 0
      const callsBefore = getCallCount();
      const result = await hybridSearch("auriculares bluetooth con cancelación de ruido", {
        pg,
        anonymous_id: randomUUID(),
        user_id: null,
      });
      expect(result.calledMock).toBe(true);
      expect(getCallCount() - callsBefore).toBeGreaterThanOrEqual(1);

      // mock_calls table received the call
      const mc = await pg.query(`SELECT count(*)::int AS c FROM mock_calls`);
      expect(mc.rows[0].c).toBeGreaterThanOrEqual(1);

      // Products got enriched and stored
      const productCount = await pg.query(`SELECT count(*)::int AS c FROM products`);
      expect(productCount.rows[0].c).toBeGreaterThan(0);

      // searches row reflects called_mock=true
      const search = await pg.query(`SELECT called_mock FROM searches`);
      expect(search.rows[0].called_mock).toBe(true);
    });
  }, 240_000);

  test("count >= 12 + confidence > 0.5 → mock NOT invoked even with valid query", async () => {
    await withTestDb(async (pg) => {
      // Seed 15 products in 'electronica' so count >= 12
      const { seedProductWithEmbedding } = await import("@/../tests/helpers/seed");
      for (let i = 0; i < 15; i++) {
        await seedProductWithEmbedding(pg, {
          title: `Audífonos modelo ${i}`,
          description: "auriculares bluetooth",
          metadata: { category: "electronica" },
          raw_category: "electronica",
        });
      }
      const callsBefore = getCallCount();
      const result = await hybridSearch("audífonos bluetooth", { pg, anonymous_id: randomUUID(), user_id: null });
      expect(result.calledMock).toBe(false);
      expect(getCallCount() - callsBefore).toBe(0);
    });
  }, 240_000);

  test("low confidence + count < 12 → mock NOT invoked (early skip)", async () => {
    await withTestDb(async (pg) => {
      // No products. Garbage query → low confidence.
      const callsBefore = getCallCount();
      const result = await hybridSearch("asdfgh qwerty zzzz", { pg, anonymous_id: randomUUID(), user_id: null });
      expect(result.calledMock).toBe(false);
      expect(getCallCount() - callsBefore).toBe(0);
      const mc = await pg.query(`SELECT count(*)::int AS c FROM mock_calls`);
      expect(mc.rows[0].c).toBe(0);
    });
  }, 60_000);
});
