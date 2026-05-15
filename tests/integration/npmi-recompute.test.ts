import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import {
  recomputeNPMI,
  MIN_COUNT_FOR_NPMI,
} from "@/sectors/d-personalization/co-occurrence/npmi-recompute";

beforeEach(async () => {
  await truncateTestTables(["co_occurrence_top", "co_occurrence", "products"]);
});

describe("recomputeNPMI", () => {
  test("MIN_COUNT_FOR_NPMI is 3", () => {
    expect(MIN_COUNT_FOR_NPMI).toBe(3);
  });

  test("symmetric expansion: positive-NPMI pair yields rows for a→b AND b→a", async () => {
    await withTestDb(async (pg) => {
      // 4 products: two strong pairs (p1↔p2 and p3↔p4) + an under-threshold
      // pair (p1,p3) that should be filtered. This avoids the degeneracy where
      // one product dominates and yields NPMI = 0.
      const p1 = await seedProductWithEmbedding(pg, { title: "P1" });
      const p2 = await seedProductWithEmbedding(pg, { title: "P2" });
      const p3 = await seedProductWithEmbedding(pg, { title: "P3" });
      const p4 = await seedProductWithEmbedding(pg, { title: "P4" });

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
      await insertPair(p1.id, p3.id, 2); // below threshold

      await recomputeNPMI(pg);

      const r = await pg.query(
        `SELECT product_id::text AS pid, related_product_id::text AS rid
         FROM co_occurrence_top ORDER BY product_id, rank`,
      );
      const pairs = r.rows.map(
        (x: { pid: string; rid: string }) => `${x.pid}->${x.rid}`,
      );
      // (p1,p3) filtered → no direction stored
      expect(pairs).not.toContain(`${p1.id}->${p3.id}`);
      expect(pairs).not.toContain(`${p3.id}->${p1.id}`);
      // (p1,p2) symmetric
      expect(pairs).toContain(`${p1.id}->${p2.id}`);
      expect(pairs).toContain(`${p2.id}->${p1.id}`);
      // (p3,p4) symmetric
      expect(pairs).toContain(`${p3.id}->${p4.id}`);
      expect(pairs).toContain(`${p4.id}->${p3.id}`);
    });
  });

  test("filters npmi <= 0 (degenerate single-pair P(ab)=1 → 0)", async () => {
    await withTestDb(async (pg) => {
      const p1 = await seedProductWithEmbedding(pg, { title: "P1" });
      const p2 = await seedProductWithEmbedding(pg, { title: "P2" });
      const [lo, hi] = p1.id < p2.id ? [p1.id, p2.id] : [p2.id, p1.id];
      await pg.query(
        `INSERT INTO co_occurrence (product_a_id, product_b_id, count, last_seen_at)
         VALUES ($1, $2, 5, now())`,
        [lo, hi],
      );
      await recomputeNPMI(pg);
      const r = await pg.query(`SELECT count(*)::int AS c FROM co_occurrence_top`);
      expect(r.rows[0].c).toBe(0);
    });
  });
});
