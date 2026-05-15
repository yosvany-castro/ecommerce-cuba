import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import {
  seedCoOccurrenceForProduct,
  SEED_WEIGHT,
} from "@/sectors/d-personalization/co-occurrence/seed";

beforeEach(async () => {
  await truncateTestTables(["co_occurrence", "products"]);
});

describe("seedCoOccurrenceForProduct", () => {
  test("SEED_WEIGHT is 0.1", () => {
    expect(SEED_WEIGHT).toBe(0.1);
  });

  test("seeds pairs for products in same category and similar price (±50%)", async () => {
    await withTestDb(async (pg) => {
      const target = await seedProductWithEmbedding(pg, {
        title: "Target",
        price_cents: 2000,
        metadata: { category: "ropa" },
      });
      await seedProductWithEmbedding(pg, {
        title: "Same cat similar price",
        price_cents: 2500,
        metadata: { category: "ropa" },
      });
      await seedProductWithEmbedding(pg, {
        title: "Same cat far price",
        price_cents: 50000,
        metadata: { category: "ropa" },
      });
      await seedProductWithEmbedding(pg, {
        title: "Different cat",
        price_cents: 2500,
        metadata: { category: "electronica" },
      });

      const n = await seedCoOccurrenceForProduct(target.id, pg);
      expect(n).toBe(1);

      const r = await pg.query(
        `SELECT count FROM co_occurrence WHERE product_a_id = $1 OR product_b_id = $1`,
        [target.id],
      );
      expect(r.rows.length).toBe(1);
      expect(Number(r.rows[0].count)).toBeCloseTo(0.1, 6);
    });
  });

  test("ON CONFLICT DO NOTHING — does not overwrite existing pair", async () => {
    await withTestDb(async (pg) => {
      const a = await seedProductWithEmbedding(pg, {
        title: "A",
        price_cents: 2000,
        metadata: { category: "ropa" },
      });
      const b = await seedProductWithEmbedding(pg, {
        title: "B",
        price_cents: 2500,
        metadata: { category: "ropa" },
      });
      const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      await pg.query(
        `INSERT INTO co_occurrence (product_a_id, product_b_id, count, last_seen_at)
         VALUES ($1, $2, 100, now())`,
        [lo, hi],
      );
      await seedCoOccurrenceForProduct(a.id, pg);
      const r = await pg.query(
        `SELECT count FROM co_occurrence WHERE product_a_id = $1`,
        [lo],
      );
      expect(Number(r.rows[0].count)).toBe(100);
    });
  });
});
