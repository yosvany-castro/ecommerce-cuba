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
});
