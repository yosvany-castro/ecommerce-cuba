import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { embed } from "@/lib/embeddings/voyage";
import { cosineSearch } from "@/sectors/c-search/retrieve/cosine";

beforeEach(async () => {
  await truncateTestTables(["products"]);
});

describe("cosineSearch (real Voyage + pgvector)", () => {
  test("synonym query catches semantically similar product", async () => {
    await withTestDb(async (pg) => {
      const target = await seedProductWithEmbedding(pg, {
        title: "Auriculares inalámbricos Sony WH-1000XM5",
        description: "tecnología noise-cancelling líder",
      });
      await seedProductWithEmbedding(pg, {
        title: "Camiseta de algodón roja",
        description: "ropa básica",
      });

      const [queryEmb] = await embed(["audífonos bluetooth con cancelación de ruido"], { inputType: "query" });
      const out = await cosineSearch(queryEmb, {}, 10, pg);
      expect(out.map((r) => r.id)).toContain(target.id);
      // Auriculares product should rank above camiseta
      const ranks = new Map(out.map((r) => [r.id, r.rank]));
      expect(ranks.get(target.id)).toBe(1);
    });
  }, 60_000);

  test("returns empty array when no products have embedding", async () => {
    await withTestDb(async (pg) => {
      const [emb] = await embed(["test query"], { inputType: "query" });
      const out = await cosineSearch(emb, {}, 10, pg);
      expect(out).toEqual([]);
    });
  }, 30_000);

  test("respects K limit", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 5; i++) {
        await seedProductWithEmbedding(pg, { title: `Producto ${i}` });
      }
      const [emb] = await embed(["producto"], { inputType: "query" });
      const out = await cosineSearch(emb, {}, 3, pg);
      expect(out.length).toBe(3);
      expect(out[0].rank).toBe(1);
      expect(out[1].rank).toBe(2);
      expect(out[2].rank).toBe(3);
    });
  }, 60_000);

  test("filter by category restricts results", async () => {
    await withTestDb(async (pg) => {
      await seedProductWithEmbedding(pg, { title: "Auriculares Sony", metadata: { category: "electronica" } });
      const target = await seedProductWithEmbedding(pg, { title: "Camiseta deportiva", metadata: { category: "ropa" } });
      const [emb] = await embed(["camiseta"], { inputType: "query" });
      const out = await cosineSearch(emb, { categories: ["ropa"] }, 10, pg);
      expect(out.map((r) => r.id)).toEqual([target.id]);
    });
  }, 60_000);

  test("excludes is_active=false products", async () => {
    await withTestDb(async (pg) => {
      const active = await seedProductWithEmbedding(pg, { title: "Activa" });
      const inactive = await seedProductWithEmbedding(pg, { title: "Inactiva" });
      await pg.query(`UPDATE products SET is_active=false WHERE id=$1`, [inactive.id]);
      const [emb] = await embed(["activa"], { inputType: "query" });
      const out = await cosineSearch(emb, {}, 10, pg);
      expect(out.map((r) => r.id)).toEqual([active.id]);
    });
  }, 60_000);

  test("filter by gender_target='femenino' excludes 'masculino' but includes 'unisex'", async () => {
    await withTestDb(async (pg) => {
      const fem = await seedProductWithEmbedding(pg, {
        title: "Vestido elegante",
        metadata: { category: "ropa", gender_target: "femenino" },
      });
      await seedProductWithEmbedding(pg, {
        title: "Camisa formal",
        metadata: { category: "ropa", gender_target: "masculino" },
      });
      const uni = await seedProductWithEmbedding(pg, {
        title: "Sudadera unisex",
        metadata: { category: "ropa", gender_target: "unisex" },
      });
      const [emb] = await embed(["ropa"], { inputType: "query" });
      const out = await cosineSearch(emb, { gender_target: "femenino" }, 10, pg);
      const ids = out.map((r) => r.id);
      expect(ids).toContain(fem.id);
      expect(ids).toContain(uni.id);
      expect(ids).toHaveLength(2);
    });
  }, 60_000);

  test("filter by age range: age_min=60 excludes products with age_target.max<=12", async () => {
    await withTestDb(async (pg) => {
      const adult = await seedProductWithEmbedding(pg, {
        title: "Bastón ortopedico",
        metadata: { category: "otros", age_target: { min: 60, max: 99 } },
      });
      await seedProductWithEmbedding(pg, {
        title: "Juguete musical",
        metadata: { category: "juguetes_bebe", age_target: { min: 0, max: 5 } },
      });
      const [emb] = await embed(["regalo abuelo"], { inputType: "query" });
      const out = await cosineSearch(emb, { age_min: 65, age_max: 90 }, 10, pg);
      expect(out.map((r) => r.id)).toEqual([adult.id]);
    });
  }, 60_000);

  test("filter by price_range='bajo' excludes products > $19.99", async () => {
    await withTestDb(async (pg) => {
      const cheap = await seedProductWithEmbedding(pg, { title: "Llavero simple", price_cents: 500 });
      await seedProductWithEmbedding(pg, { title: "Llavero premium oro", price_cents: 30000 });
      const [emb] = await embed(["llavero"], { inputType: "query" });
      const out = await cosineSearch(emb, { price_range: "bajo" }, 10, pg);
      expect(out.map((r) => r.id)).toEqual([cheap.id]);
    });
  }, 60_000);

  test("filter by price_range='medio' includes $20-$99 products only", async () => {
    await withTestDb(async (pg) => {
      const med = await seedProductWithEmbedding(pg, { title: "Mochila escolar", price_cents: 4500 });
      await seedProductWithEmbedding(pg, { title: "Mochila premium", price_cents: 25000 });
      await seedProductWithEmbedding(pg, { title: "Mochila barata", price_cents: 800 });
      const [emb] = await embed(["mochila"], { inputType: "query" });
      const out = await cosineSearch(emb, { price_range: "medio" }, 10, pg);
      expect(out.map((r) => r.id)).toEqual([med.id]);
    });
  }, 60_000);

  test("filter by price_range='alto' includes only products >= $100", async () => {
    await withTestDb(async (pg) => {
      const high = await seedProductWithEmbedding(pg, { title: "Auricular profesional", price_cents: 30000 });
      await seedProductWithEmbedding(pg, { title: "Auricular básico", price_cents: 1500 });
      const [emb] = await embed(["auricular"], { inputType: "query" });
      const out = await cosineSearch(emb, { price_range: "alto" }, 10, pg);
      expect(out.map((r) => r.id)).toEqual([high.id]);
    });
  }, 60_000);

  test("filters compose: gender + age + price together narrow to single match", async () => {
    await withTestDb(async (pg) => {
      const target = await seedProductWithEmbedding(pg, {
        title: "Vestido fiesta mujer adulta",
        price_cents: 4500,
        metadata: { category: "ropa", gender_target: "femenino", age_target: { min: 18, max: 65 } },
      });
      await seedProductWithEmbedding(pg, {
        title: "Vestido fiesta hombre",
        price_cents: 4500,
        metadata: { category: "ropa", gender_target: "masculino", age_target: { min: 18, max: 65 } },
      });
      await seedProductWithEmbedding(pg, {
        title: "Vestido fiesta infantil",
        price_cents: 4500,
        metadata: { category: "ropa", gender_target: "femenino", age_target: { min: 5, max: 11 } },
      });
      await seedProductWithEmbedding(pg, {
        title: "Vestido fiesta premium",
        price_cents: 30000,
        metadata: { category: "ropa", gender_target: "femenino", age_target: { min: 18, max: 65 } },
      });
      const [emb] = await embed(["vestido"], { inputType: "query" });
      const out = await cosineSearch(
        emb,
        { gender_target: "femenino", age_min: 25, age_max: 50, price_range: "medio" },
        10,
        pg,
      );
      expect(out.map((r) => r.id)).toEqual([target.id]);
    });
  }, 60_000);
});
