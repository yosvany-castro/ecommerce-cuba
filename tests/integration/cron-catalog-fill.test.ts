import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { resetCallCount, getCallCount, fetchFromAggregator } from "@/sectors/b-catalog/mock/aggregator";
import { runCatalogFill } from "@/sectors/b-catalog/cron/catalog-fill";
import { processProduct } from "@/sectors/b-catalog/enrichment/pipeline";

beforeEach(async () => {
  await truncateTestTables(["products", "mock_calls"]);
  resetCallCount();
});

describe("runCatalogFill (REAL APIs)", () => {
  test("--pages 1 --categories ropa: 1 mock_calls row + cost_cents=4", async () => {
    await withTestDb(async (pg) => {
      const r = await runCatalogFill({ categories: ["ropa"], pagesPerCategory: 1, concurrency: 3, pg, productsPerCallOverride: 2 });
      expect(r.totalCalls).toBe(1);
      const calls = await pg.query(
        `SELECT simulated_cost_cents, response_size, was_error FROM mock_calls ORDER BY called_at`,
      );
      expect(calls.rows).toHaveLength(1);
      expect(calls.rows[0].simulated_cost_cents).toBe(4);
      // Always verify products count == r.totalProducts (not conditional)
      const productCount = await pg.query(`SELECT count(*)::int FROM products`);
      expect(productCount.rows[0].count).toBe(r.totalProducts);
      // If mock errored, totalProducts is 0 and was_error=true; otherwise products > 0
      if (calls.rows[0].was_error) {
        expect(r.totalProducts).toBe(0);
      } else {
        expect(r.totalProducts).toBeGreaterThan(0);
        expect(r.totalProducts).toBeLessThanOrEqual(2);
      }
    });
  }, 120_000);

  test("UPSERT updates fields on re-run with same source_product_id", async () => {
    await withTestDb(async (pg) => {
      // Manually seed a product with stale data
      const sample = (await fetchFromAggregator({ category: "ropa" })).products[0];
      await pg.query(
        `INSERT INTO products (source, source_product_id, title, description, price_cents, currency, raw_category, metadata)
         VALUES ($1, $2, 'OLD TITLE', 'OLD DESC', 0, 'USD', 'ropa', '{}'::jsonb)`,
        [sample.source, sample.source_product_id],
      );
      const before = await pg.query(`SELECT title, last_refreshed_at FROM products WHERE source=$1 AND source_product_id=$2`, [sample.source, sample.source_product_id]);
      expect(before.rows[0].title).toBe("OLD TITLE");

      // Process via pipeline → must update title to the mock's title
      await processProduct(sample, pg);
      const after = await pg.query(`SELECT title, last_refreshed_at FROM products WHERE source=$1 AND source_product_id=$2`, [sample.source, sample.source_product_id]);
      expect(after.rows[0].title).toBe(sample.title);
      expect(after.rows[0].title).not.toBe("OLD TITLE");
      expect(new Date(after.rows[0].last_refreshed_at).getTime()).toBeGreaterThan(new Date(before.rows[0].last_refreshed_at).getTime());
    });
  }, 60_000);

  test("re-running same category does not duplicate (UPSERT) — products count is bounded", async () => {
    await withTestDb(async (pg) => {
      const a = await runCatalogFill({ categories: ["ropa"], pagesPerCategory: 1, concurrency: 3, pg, productsPerCallOverride: 2 });
      const c1 = (await pg.query(`SELECT count(*)::int FROM products`)).rows[0].count;
      const b = await runCatalogFill({ categories: ["ropa"], pagesPerCategory: 1, concurrency: 3, pg, productsPerCallOverride: 2 });
      const c2 = (await pg.query(`SELECT count(*)::int FROM products`)).rows[0].count;

      // Both calls write to mock_calls (so 2 calls), but the mock samples WITH replacement from the same pool —
      // products may overlap and dedupe. c2 should be >= c1 but never grow by 2 if there are repeats.
      expect(c2).toBeGreaterThanOrEqual(c1);
      expect(c2).toBeLessThanOrEqual(4);

      const calls = await pg.query(`SELECT count(*)::int FROM mock_calls`);
      expect(calls.rows[0].count).toBe(2);

      // Both runs count toward totalCalls
      expect(a.totalCalls + b.totalCalls).toBe(2);
    });
  }, 240_000);
});
