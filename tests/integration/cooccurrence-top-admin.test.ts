import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { recomputeNPMI } from "@/sectors/d-personalization/co-occurrence/npmi-recompute";
import { getCoOccurrenceTopAdmin } from "@/sectors/d-personalization/admin/co-occurrence-top";

beforeEach(async () => {
  await truncateTestTables(["co_occurrence_top", "co_occurrence", "products"]);
});

describe("getCoOccurrenceTopAdmin", () => {
  test("returns empty when grafo vacío", async () => {
    await withTestDb(async (pg) => {
      const out = await getCoOccurrenceTopAdmin({ limit: 50 }, pg);
      expect(out).toEqual([]);
    });
  });

  test("returns pairs ordered by NPMI desc with product titles populated", async () => {
    await withTestDb(async (pg) => {
      const p1 = await seedProductWithEmbedding(pg, { title: "ProductoA" });
      const p2 = await seedProductWithEmbedding(pg, { title: "ProductoB" });
      const p3 = await seedProductWithEmbedding(pg, { title: "ProductoC" });
      const p4 = await seedProductWithEmbedding(pg, { title: "ProductoD" });
      const insertPair = async (a: string, b: string, c: number) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        await pg.query(
          `INSERT INTO co_occurrence (product_a_id, product_b_id, count, last_seen_at)
           VALUES ($1, $2, $3, now())`,
          [lo, hi, c],
        );
      };
      await insertPair(p1.id, p2.id, 10);
      await insertPair(p3.id, p4.id, 10);
      await recomputeNPMI(pg);

      const top = await getCoOccurrenceTopAdmin({ limit: 50 }, pg);
      expect(top.length).toBeGreaterThan(0);
      for (const row of top) {
        expect(typeof row.product_title).toBe("string");
        expect(row.product_title.length).toBeGreaterThan(0);
        expect(typeof row.related_product_title).toBe("string");
        expect(typeof row.npmi_score).toBe("number");
      }
      // Sorted by NPMI desc
      for (let i = 1; i < top.length; i++) {
        expect(top[i - 1].npmi_score).toBeGreaterThanOrEqual(top[i].npmi_score);
      }
    });
  });
});
