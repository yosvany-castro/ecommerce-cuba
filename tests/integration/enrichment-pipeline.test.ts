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
        `SELECT length(tsvector_es::text) AS ts_len FROM products WHERE id = $1`,
        [result.productId],
      );
      expect(row.rows[0].ts_len).toBeGreaterThan(0);
    });
  }, 30_000);
});
