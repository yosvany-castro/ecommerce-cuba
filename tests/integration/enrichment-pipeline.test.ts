import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { fetchFromAggregator } from "@/sectors/b-catalog/mock/aggregator";
import { processProduct } from "@/sectors/b-catalog/enrichment/pipeline";
import { EMBEDDING_DIM } from "@/lib/embeddings/voyage";
import { parsePgVector } from "@/../tests/helpers/pgvector";

beforeEach(async () => {
  await truncateTestTables(["products"]);
});

const VALID_CATEGORIES = ["ropa", "electronica", "hogar", "juguetes_bebe", "belleza", "outros"];

describe("processProduct (REAL Anthropic + REAL Voyage + REAL Postgres)", () => {
  test("inserts a product with valid metadata, embedding norm=1, dim=1024", async () => {
    await withTestDb(async (pg) => {
      const r = await fetchFromAggregator({ category: "electronica" });
      const sample = r.products[0];

      const result = await processProduct(sample, pg);
      expect(result.inserted).toBe(true);
      expect(result.enrichmentStatus).toBe("ok");

      const stored = await pg.query(
        `SELECT metadata, embedding::text AS embedding_text FROM products WHERE id = $1`,
        [result.productId],
      );
      const md = stored.rows[0].metadata;
      expect(VALID_CATEGORIES).toContain(md.category);
      expect(Array.isArray(md.keywords)).toBe(true);
      expect(md.keywords.length).toBeGreaterThan(0);
      expect(md.keywords.length).toBeLessThanOrEqual(8);
      expect(md.prompt_version).toBe("v1.0.0-fase1");

      const emb = parsePgVector(stored.rows[0].embedding_text);
      expect(Array.isArray(emb)).toBe(true);
      expect(emb!.length).toBe(EMBEDDING_DIM);
      const norm = Math.sqrt(emb!.reduce((s, x) => s + x * x, 0));
      expect(Math.abs(norm - 1)).toBeLessThan(1e-5);
    });
  }, 30_000);

  test("dedupe: re-processing the same product updates last_refreshed_at, not row count", async () => {
    await withTestDb(async (pg) => {
      const r = await fetchFromAggregator({ category: "ropa" });
      const sample = r.products[0];

      const a = await processProduct(sample, pg);
      const t1 = (await pg.query(`SELECT last_refreshed_at FROM products WHERE id=$1`, [a.productId])).rows[0].last_refreshed_at;

      await new Promise((r) => setTimeout(r, 50));
      const b = await processProduct(sample, pg);
      expect(b.productId).toBe(a.productId);
      expect(b.inserted).toBe(false);

      const t2 = (await pg.query(`SELECT last_refreshed_at FROM products WHERE id=$1`, [a.productId])).rows[0].last_refreshed_at;
      expect(new Date(t2).getTime()).toBeGreaterThan(new Date(t1).getTime());

      const total = await pg.query(`SELECT count(*)::int FROM products`);
      expect(total.rows[0].count).toBe(1);
    });
  }, 60_000);

  test("two distinct products produce distinct embeddings (cosine < 0.99)", async () => {
    await withTestDb(async (pg) => {
      const r = await fetchFromAggregator({ category: "electronica" });
      const a = r.products[0];
      const b = r.products.find((p) => p.source_product_id !== a.source_product_id)!;

      const ra = await processProduct(a, pg);
      const rb = await processProduct(b, pg);
      expect(ra.productId).not.toBe(rb.productId);

      const rows = await pg.query(
        `SELECT embedding::text AS e FROM products WHERE id = ANY($1)`,
        [[ra.productId, rb.productId]],
      );
      const [v1, v2] = rows.rows.map((r: { e: string }) => parsePgVector(r.e)!);
      const dot = v1.reduce((s, x, i) => s + x * v2[i], 0);
      expect(dot).toBeLessThan(0.99);
    });
  }, 60_000);

  test("tsvector_es is auto-generated and non-empty", async () => {
    await withTestDb(async (pg) => {
      const r = await fetchFromAggregator({ category: "ropa" });
      const sample = r.products[0];
      const result = await processProduct(sample, pg);
      const row = await pg.query(
        `SELECT array_length(tsvector_to_array(tsvector_es), 1) AS lexeme_count FROM products WHERE id = $1`,
        [result.productId],
      );
      expect(row.rows[0].lexeme_count).toBeGreaterThan(2);
    });
  }, 30_000);

  test("raw with real Apify-shaped attributes → metadata.attrs.colors persisted alongside metadata.category", async () => {
    await withTestDb(async (pg) => {
      const raw = {
        id: "attrs-test-1",
        source: "amazon" as const,
        source_product_id: "attrs-test-1",
        title: "Camiseta de algodón azul talla M",
        description: "Camiseta de algodón suave, corte regular.",
        image_url: "https://img.example/shirt.jpg",
        price_cents: 1999,
        brand: "Acme",
        raw_category: "ropa",
        attributes: {
          colors: ["Azul", { name: "Rojo", hex: "#ff0000" }],
          sizes: ["S", "M", "L"],
          images: ["https://img.example/shirt.jpg"],
          old_price_cents: 2999,
          rating: 4.3,
          orders: "1,000+ sold",
          brand: "Acme",
        },
      };

      const result = await processProduct(raw, pg);
      expect(result.enrichmentStatus).toBe("ok");

      const stored = await pg.query(`SELECT metadata FROM products WHERE id = $1`, [result.productId]);
      const md = stored.rows[0].metadata;
      expect(VALID_CATEGORIES).toContain(md.category);
      expect(md.attrs.colors).toEqual([{ name: "Azul" }, { name: "Rojo", hex: "#ff0000" }]);
      expect(md.attrs.brand).toBe("Acme");
    });
  }, 30_000);
});
