import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { hashQuery } from "@/sectors/c-search/cache/hash";
import { writeExact } from "@/sectors/c-search/cache/exact";
import { lookupSemantic, DEFAULT_THETA } from "@/sectors/c-search/cache/semantic";
import { embed } from "@/lib/embeddings/voyage";

beforeEach(async () => {
  await truncateTestTables(["product_query_cache"]);
});

const sampleNormalized = {
  intent: "compra" as const,
  recipient_gender: null,
  recipient_age_min: null,
  recipient_age_max: null,
  categories: ["electronica"],
  style: [],
  price_range: null,
  search_terms: "auriculares",
  confidence: 0.9,
  prompt_version: "v1.0.0-fase2",
};

describe("cache/semantic (REAL Voyage embeddings)", () => {
  test("identical query hits with similarity ≈ 1", async () => {
    await withTestDb(async (pg) => {
      const [emb] = await embed(["auriculares inalambricos sony"], { inputType: "query" });
      await writeExact(
        {
          query_hash: hashQuery("auriculares inalambricos sony"),
          query_embedding: emb,
          normalized_json: sampleNormalized,
          products_returned: ["a1111111-1111-4111-8111-111111111111"],
        },
        pg,
      );
      // Same exact embedding → similarity = 1
      const hit = await lookupSemantic(emb, DEFAULT_THETA, pg);
      expect(hit?.products_returned).toEqual(["a1111111-1111-4111-8111-111111111111"]);
    });
  }, 30_000);

  test("very different query does NOT hit (sim < θ)", async () => {
    await withTestDb(async (pg) => {
      const [embCached] = await embed(["auriculares sony bluetooth"], { inputType: "query" });
      await writeExact(
        {
          query_hash: hashQuery("auriculares sony bluetooth"),
          query_embedding: embCached,
          normalized_json: sampleNormalized,
          products_returned: ["a1111111-1111-4111-8111-111111111111"],
        },
        pg,
      );
      const [embDifferent] = await embed(["zapatillas deportivas hombre"], { inputType: "query" });
      const hit = await lookupSemantic(embDifferent, DEFAULT_THETA, pg);
      expect(hit).toBeNull();
    });
  }, 30_000);

  test("expired rows are excluded from semantic lookup", async () => {
    await withTestDb(async (pg) => {
      const [emb] = await embed(["test query"], { inputType: "query" });
      await writeExact(
        {
          query_hash: hashQuery("test query"),
          query_embedding: emb,
          normalized_json: sampleNormalized,
          products_returned: ["a1111111-1111-4111-8111-111111111111"],
        },
        pg,
      );
      await pg.query(`UPDATE product_query_cache SET ttl_until = now() - interval '1 hour'`);
      const hit = await lookupSemantic(emb, DEFAULT_THETA, pg);
      expect(hit).toBeNull();
    });
  }, 30_000);

  test("empty cache → null", async () => {
    await withTestDb(async (pg) => {
      const [emb] = await embed(["anything"], { inputType: "query" });
      const hit = await lookupSemantic(emb, DEFAULT_THETA, pg);
      expect(hit).toBeNull();
    });
  }, 30_000);

  test("DEFAULT_THETA is 0.92", () => {
    expect(DEFAULT_THETA).toBe(0.92);
  });
});
