import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProduct } from "@/../tests/helpers/seed";
import { bm25Search } from "@/sectors/c-search/retrieve/bm25";

beforeEach(async () => {
  await truncateTestTables(["products"]);
});

describe("bm25Search (real tsvector + ts_rank_cd)", () => {
  test("ranks exact-match title higher than partial match", async () => {
    await withTestDb(async (pg) => {
      const target = await seedProduct(pg, { title: "Nike Air Max 270 talle 42" });
      await seedProduct(pg, { title: "Adidas Ultraboost talle 42" });
      await seedProduct(pg, { title: "Puma RS-X talle 42" });

      const out = await bm25Search("Nike Air Max 270 talle 42", {}, 10, pg);
      expect(out[0].id).toBe(target.id);
    });
  });

  test("returns empty array on no match", async () => {
    await withTestDb(async (pg) => {
      await seedProduct(pg, { title: "Camiseta de algodón" });
      const out = await bm25Search("xyzabc nothingmatches", {}, 10, pg);
      expect(out).toEqual([]);
    });
  });

  test("respects K limit", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 5; i++) {
        await seedProduct(pg, { title: `Camiseta deportiva ${i}` });
      }
      const out = await bm25Search("camiseta", {}, 3, pg);
      expect(out.length).toBe(3);
    });
  });

  test("filter by category restricts results", async () => {
    await withTestDb(async (pg) => {
      await seedProduct(pg, { title: "Camiseta deportiva", metadata: { category: "ropa" } });
      const elec = await seedProduct(pg, { title: "Camiseta de monitor LCD", metadata: { category: "electronica" } });
      const out = await bm25Search("camiseta", { categories: ["electronica"] }, 10, pg);
      expect(out.map((r) => r.id)).toEqual([elec.id]);
    });
  });

  test("excludes is_active=false products", async () => {
    await withTestDb(async (pg) => {
      const a = await seedProduct(pg, { title: "Camiseta activa" });
      const b = await seedProduct(pg, { title: "Camiseta inactiva" });
      await pg.query(`UPDATE products SET is_active=false WHERE id=$1`, [b.id]);
      const out = await bm25Search("camiseta", {}, 10, pg);
      expect(out.map((r) => r.id)).toEqual([a.id]);
    });
  });
});
