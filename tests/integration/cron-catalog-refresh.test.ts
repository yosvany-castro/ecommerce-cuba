import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { runCatalogRefresh, selectQueries } from "@/sectors/b-catalog/cron/catalog-refresh";
import type { AggregatorProvider } from "@/sectors/b-catalog/provider";
import type { MockProduct } from "@/sectors/b-catalog/mock/types";

function fakeProvider(products: MockProduct[], costCents: number) {
  const calls: { query?: string; limit?: number }[] = [];
  const provider: AggregatorProvider = {
    name: "fake",
    async fetch(opts) {
      calls.push({ query: opts.query, limit: opts.limit });
      return { products, cost_cents: costCents, latency_ms: 123 };
    },
  };
  return { provider, calls };
}

function makeProduct(n: number): MockProduct {
  return {
    id: `fake-${n}`,
    source: "amazon",
    source_product_id: `FAKE${n}`,
    title: `Fake Product ${n}`,
    description: `A fake test product number ${n}`,
    image_url: `https://example.com/${n}.jpg`,
    price_cents: 1999 + n,
    brand: "FakeBrand",
    raw_category: "electronica",
    attributes: { colors: ["red", "blue"], images: [`https://example.com/${n}.jpg`] },
  };
}

beforeEach(async () => {
  await truncateTestTables(["products", "mock_calls", "searches"]);
});

describe("selectQueries", () => {
  test("mixes top real searches with fixed-category fallback to reach n", async () => {
    await withTestDb(async (pg) => {
      // 3× zapatos, 1× telescopio, plus whitespace/empty that must be excluded.
      const insert = (q: string) =>
        pg.query(`INSERT INTO searches (raw_query) VALUES ($1)`, [q]);
      await Promise.all([
        insert("zapatos"), insert("zapatos"), insert("zapatos"),
        insert("telescopio"),
        insert("   "), insert(""),
      ]);

      const qs = await selectQueries(pg, 5);
      expect(qs).toHaveLength(5);
      // Real searches first, by frequency.
      expect(qs[0]).toBe("zapatos");
      expect(qs[1]).toBe("telescopio");
      // Remainder filled from the fixed category→query map (rotation order).
      expect(qs.slice(2)).toEqual(["ropa mujer", "electronics gadgets", "home kitchen"]);
      // Nothing empty/whitespace leaked in.
      expect(qs.some((q) => q.trim() === "")).toBe(false);
    });
  });
});

describe("runCatalogRefresh", () => {
  test("budget exceeded before first call → 0 calls, skipped_by_budget, provider untouched", async () => {
    await withTestDb(async (pg) => {
      await pg.query(
        `INSERT INTO mock_calls (params, simulated_cost_cents) VALUES ('{}'::jsonb, 50)`,
      );
      const { provider, calls } = fakeProvider([makeProduct(1)], 7);

      const summary = await runCatalogRefresh(pg, [provider], { queries: 2, limit: 5, budgetCents: 10 });

      expect(summary.skipped_by_budget).toBe(true);
      expect(summary.calls).toBe(0);
      expect(summary.products_processed).toBe(0);
      expect(calls).toHaveLength(0); // provider never invoked
      expect(summary.spent_today_cents).toBe(50);
    });
  });

  test("happy path with fake provider → products processed + mock_calls logged with real cost", async () => {
    await withTestDb(async (pg) => {
      const { provider, calls } = fakeProvider([makeProduct(1), makeProduct(2)], 7);

      const summary = await runCatalogRefresh(pg, [provider], { queries: 1, limit: 5, budgetCents: 1000 });

      expect(summary.calls).toBe(1);
      expect(calls[0]).toEqual({ query: expect.any(String), limit: 5 });
      // All products accounted for (processed or failed), none lost.
      expect(summary.products_processed + summary.products_failed).toBe(2);

      const call = await pg.query(
        `SELECT params, simulated_cost_cents FROM mock_calls WHERE was_error = false ORDER BY called_at`,
      );
      expect(call.rows).toHaveLength(1);
      expect(call.rows[0].simulated_cost_cents).toBe(7);
      expect(call.rows[0].params.source).toBe("catalog_refresh");
      expect(call.rows[0].params.provider).toBe("fake");

      // DB product count matches processed count; curated attrs persist (A4).
      const prods = await pg.query(`SELECT metadata FROM products`);
      expect(prods.rows).toHaveLength(summary.products_processed);
      if (summary.products_processed > 0) {
        expect(prods.rows[0].metadata.attrs.colors).toBeTruthy();
      }
    });
  }, 120_000);
});
