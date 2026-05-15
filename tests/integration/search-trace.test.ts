import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { hybridSearch } from "@/sectors/c-search/search";

beforeEach(async () => {
  await truncateTestTables(["product_query_cache", "searches", "products", "mock_calls"]);
  process.env.HYBRID_SEARCH_MOCK_LIMIT = "2";
  process.env.MOCK_AGGREGATOR_ERROR_RATE = "0";
});

afterEach(() => {
  delete process.env.HYBRID_SEARCH_MOCK_LIMIT;
  delete process.env.MOCK_AGGREGATOR_ERROR_RATE;
});

describe("hybridSearch trace mode", () => {
  test("opts.trace=true returns trace with all top-level fields populated", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 15; i++) {
        await seedProductWithEmbedding(pg, {
          title: `Audifono modelo ${i}`,
          description: "auriculares bluetooth",
          metadata: { category: "electronica" },
          raw_category: "electronica",
        });
      }
      const result = await hybridSearch(
        "audifonos bluetooth",
        { pg, anonymous_id: randomUUID(), user_id: null },
        { trace: true },
      );
      const trace = result.trace;
      expect(trace).toBeDefined();
      expect(trace!.raw_query).toBe("audifonos bluetooth");
      expect(typeof trace!.hash).toBe("string");
      expect(trace!.hash.length).toBeGreaterThan(0);
      expect(trace!.cache.exact_hit).toBe(false);
      expect(trace!.cache.semantic_hit).toBe(false);
      expect(trace!.embedding).not.toBeNull();
      expect(trace!.embedding!.dim).toBeGreaterThan(0);
      expect(trace!.normalized).not.toBeNull();
      expect(typeof trace!.filters_applied).toBe("object");
      expect(typeof trace!.freshness).toBe("object");
      expect(Array.isArray(trace!.retrieval.bm25)).toBe(true);
      expect(Array.isArray(trace!.retrieval.cosine)).toBe(true);
      expect(Array.isArray(trace!.retrieval.fused)).toBe(true);
      // 15 seeded → fused.length >= 12 → no mock
      expect(trace!.decision.should_call_mock).toBe(false);
      expect(typeof trace!.decision.reason).toBe("string");
      expect(trace!.mock_fallback.invoked).toBe(false);
      expect(trace!.final.method).toBe(result.method);
      expect(trace!.final.products_count).toBe(result.products.length);
      expect(trace!.timings_ms.total).toBeGreaterThan(0);
    });
  }, 240_000);

  test("without opts.trace, result.trace is undefined (no overhead)", async () => {
    await withTestDb(async (pg) => {
      await seedProductWithEmbedding(pg, {
        title: "Producto test",
        metadata: { category: "ropa" },
      });
      const result = await hybridSearch("producto test", {
        pg,
        anonymous_id: randomUUID(),
        user_id: null,
      });
      expect(result.trace).toBeUndefined();
    });
  }, 60_000);
});
