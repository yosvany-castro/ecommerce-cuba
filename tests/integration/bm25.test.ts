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
      expect(out[0].rank).toBe(1);
      expect(out[1].rank).toBe(2);
      expect(out[2].rank).toBe(3);
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

  test("filter by gender_target='femenino' excludes 'masculino' but includes 'unisex'", async () => {
    await withTestDb(async (pg) => {
      const fem = await seedProduct(pg, {
        title: "Vestido elegante",
        metadata: { category: "ropa", gender_target: "femenino" },
      });
      await seedProduct(pg, {
        title: "Vestido camisa",
        metadata: { category: "ropa", gender_target: "masculino" },
      });
      const uni = await seedProduct(pg, {
        title: "Vestido casual unisex",
        metadata: { category: "ropa", gender_target: "unisex" },
      });
      const out = await bm25Search("vestido", { gender_target: "femenino" }, 10, pg);
      const ids = out.map((r) => r.id);
      expect(ids).toContain(fem.id);
      expect(ids).toContain(uni.id);
      expect(ids).toHaveLength(2);
    });
  });

  test("filter by age range narrows results: age_min=60 excludes products with age_target.max<=12", async () => {
    await withTestDb(async (pg) => {
      const adult = await seedProduct(pg, {
        title: "Reloj clasico",
        metadata: { category: "otros", age_target: { min: 18, max: 99 } },
      });
      await seedProduct(pg, {
        title: "Reloj infantil",
        metadata: { category: "juguetes_bebe", age_target: { min: 4, max: 12 } },
      });
      const out = await bm25Search("reloj", { age_min: 60, age_max: 80 }, 10, pg);
      expect(out.map((r) => r.id)).toEqual([adult.id]);
    });
  });

  test("filter by price_range='bajo' excludes products > $19.99 (>1999 cents)", async () => {
    await withTestDb(async (pg) => {
      const cheap = await seedProduct(pg, { title: "Pulsera barata", price_cents: 999 });
      await seedProduct(pg, { title: "Pulsera premium", price_cents: 20000 });
      const out = await bm25Search("pulsera", { price_range: "bajo" }, 10, pg);
      expect(out.map((r) => r.id)).toEqual([cheap.id]);
    });
  });

  test("filter by price_range='medio' includes $20-$99.99 ($2000-$9999 cents)", async () => {
    await withTestDb(async (pg) => {
      const med = await seedProduct(pg, { title: "Cargador medio", price_cents: 5000 });
      await seedProduct(pg, { title: "Cargador caro", price_cents: 20000 });
      await seedProduct(pg, { title: "Cargador barato", price_cents: 500 });
      const out = await bm25Search("cargador", { price_range: "medio" }, 10, pg);
      expect(out.map((r) => r.id)).toEqual([med.id]);
    });
  });

  test("filter by price_range='alto' includes only products >= $100 (>=10000 cents)", async () => {
    await withTestDb(async (pg) => {
      const high = await seedProduct(pg, { title: "Tablet costosa", price_cents: 25000 });
      await seedProduct(pg, { title: "Tablet barata", price_cents: 5000 });
      const out = await bm25Search("tablet", { price_range: "alto" }, 10, pg);
      expect(out.map((r) => r.id)).toEqual([high.id]);
    });
  });

  test("filters compose: gender_target + age + price together narrow to single match", async () => {
    await withTestDb(async (pg) => {
      const target = await seedProduct(pg, {
        title: "Camiseta deportiva mujer adulta",
        price_cents: 5000,
        metadata: { category: "ropa", gender_target: "femenino", age_target: { min: 18, max: 65 } },
      });
      // Wrong gender
      await seedProduct(pg, {
        title: "Camiseta deportiva hombre adulto",
        price_cents: 5000,
        metadata: { category: "ropa", gender_target: "masculino", age_target: { min: 18, max: 65 } },
      });
      // Wrong age
      await seedProduct(pg, {
        title: "Camiseta deportiva niña",
        price_cents: 5000,
        metadata: { category: "ropa", gender_target: "femenino", age_target: { min: 4, max: 12 } },
      });
      // Wrong price (alto)
      await seedProduct(pg, {
        title: "Camiseta deportiva premium",
        price_cents: 25000,
        metadata: { category: "ropa", gender_target: "femenino", age_target: { min: 18, max: 65 } },
      });
      const out = await bm25Search(
        "camiseta deportiva",
        { gender_target: "femenino", age_min: 25, age_max: 50, price_range: "medio" },
        10,
        pg,
      );
      expect(out.map((r) => r.id)).toEqual([target.id]);
    });
  });
});
