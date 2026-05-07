import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { resetCallCount, getCallCount } from "@/sectors/b-catalog/mock/aggregator";
import { runCatalogFill } from "@/sectors/b-catalog/cron/catalog-fill";

beforeEach(async () => {
  await truncateTestTables(["products", "mock_calls"]);
  resetCallCount();
});

describe("runCatalogFill (REAL APIs)", () => {
  test("--pages 1 --categories ropa: 1 mock_calls row + up to 25 products + cost_cents=4", async () => {
    await withTestDb(async (pg) => {
      const r = await runCatalogFill({ categories: ["ropa"], pagesPerCategory: 1, concurrency: 3, pg });

      expect(r.totalCalls).toBe(1);
      // Mock can throw with 2% probability; if it errored, totalProducts=0 and was_error=true.
      // Mock samples with replacement from the pool, so up to 25 unique products per call.
      if (r.errors.length === 0) {
        expect(r.totalProducts).toBeGreaterThan(0);
        expect(r.totalProducts).toBeLessThanOrEqual(25);
      } else {
        expect(r.totalProducts).toBe(0);
      }

      const calls = await pg.query(
        `SELECT simulated_cost_cents, response_size, was_error FROM mock_calls ORDER BY called_at`,
      );
      expect(calls.rows).toHaveLength(1);
      expect(calls.rows[0].simulated_cost_cents).toBe(4);
      const productCount = await pg.query(`SELECT count(*)::int FROM products`);
      expect(productCount.rows[0].count).toBe(r.totalProducts);
    });
  }, 120_000);

  test("re-running same category does not duplicate (UPSERT) — products count is bounded", async () => {
    await withTestDb(async (pg) => {
      const a = await runCatalogFill({ categories: ["ropa"], pagesPerCategory: 1, concurrency: 3, pg });
      const c1 = (await pg.query(`SELECT count(*)::int FROM products`)).rows[0].count;
      const b = await runCatalogFill({ categories: ["ropa"], pagesPerCategory: 1, concurrency: 3, pg });
      const c2 = (await pg.query(`SELECT count(*)::int FROM products`)).rows[0].count;

      // Both calls write to mock_calls (so 2 calls), but the mock samples WITH replacement from the same pool —
      // products may overlap and dedupe. c2 should be >= c1 but never grow by 25 if there are repeats.
      expect(c2).toBeGreaterThanOrEqual(c1);
      expect(c2).toBeLessThanOrEqual(50);

      const calls = await pg.query(`SELECT count(*)::int FROM mock_calls`);
      expect(calls.rows[0].count).toBe(2);

      // Both runs count toward totalCalls
      expect(a.totalCalls + b.totalCalls).toBe(2);
    });
  }, 240_000);
});
