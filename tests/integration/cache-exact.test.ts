import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { hashQuery } from "@/sectors/c-search/cache/hash";
import { lookupExact, writeExact, EXACT_CACHE_TTL_SECONDS } from "@/sectors/c-search/cache/exact";

beforeEach(async () => {
  await truncateTestTables(["product_query_cache"]);
});

const sampleEmbedding = Array.from({ length: 1024 }, (_, i) => (i % 2 === 0 ? 0.5 : -0.5));
const norm = Math.sqrt(sampleEmbedding.reduce((s, x) => s + x * x, 0));
const normSampleEmbedding = sampleEmbedding.map((x) => x / norm);

const sampleNormalized = {
  intent: "compra" as const,
  recipient_gender: null,
  recipient_age_min: null,
  recipient_age_max: null,
  categories: ["ropa"],
  style: [],
  price_range: null,
  search_terms: "camiseta deportiva",
  confidence: 0.9,
  prompt_version: "v1.0.0-fase2",
};

const sampleProductIds = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
];

describe("cache/exact", () => {
  test("writeExact then lookupExact returns the same row", async () => {
    await withTestDb(async (pg) => {
      const hash = hashQuery("camiseta deportiva");
      await writeExact(
        {
          query_hash: hash,
          query_embedding: normSampleEmbedding,
          normalized_json: sampleNormalized,
          products_returned: sampleProductIds,
        },
        pg,
      );
      const got = await lookupExact(hash, pg);
      expect(got?.query_hash).toBe(hash);
      expect(got!.products_returned).toEqual(sampleProductIds);
      expect(got!.normalized_json.search_terms).toBe("camiseta deportiva");
    });
  });

  test("lookupExact returns null when hash not present", async () => {
    await withTestDb(async (pg) => {
      const got = await lookupExact(hashQuery("nothing here"), pg);
      expect(got).toBeNull();
    });
  });

  test("expired rows are NOT returned by lookupExact", async () => {
    await withTestDb(async (pg) => {
      const hash = hashQuery("expired query");
      await writeExact(
        {
          query_hash: hash,
          query_embedding: normSampleEmbedding,
          normalized_json: sampleNormalized,
          products_returned: sampleProductIds,
          ttl_seconds: 1,
        },
        pg,
      );
      // Verify that ttl_seconds: 1 was actually honored — ttl_until should be ~1 second from now,
      // not the default 24h. This catches mutations where writeExact ignores the ttl_seconds parameter.
      const written = await pg.query(`SELECT EXTRACT(EPOCH FROM (ttl_until - now())) AS seconds_left FROM product_query_cache WHERE query_hash = $1`, [hash]);
      expect(Number(written.rows[0].seconds_left)).toBeLessThan(5);

      // Force expiration by updating ttl_until directly to past
      await pg.query(`UPDATE product_query_cache SET ttl_until = now() - interval '1 hour' WHERE query_hash = $1`, [hash]);
      const got = await lookupExact(hash, pg);
      expect(got).toBeNull();
    });
  });

  test("writeExact UPSERTs on conflict (same hash → updates fields)", async () => {
    await withTestDb(async (pg) => {
      const hash = hashQuery("conflict query");
      await writeExact(
        { query_hash: hash, query_embedding: normSampleEmbedding, normalized_json: sampleNormalized, products_returned: sampleProductIds },
        pg,
      );
      const newProducts = ["33333333-3333-4333-8333-333333333333"];
      await writeExact(
        { query_hash: hash, query_embedding: normSampleEmbedding, normalized_json: sampleNormalized, products_returned: newProducts },
        pg,
      );
      const got = await lookupExact(hash, pg);
      expect(got!.products_returned).toEqual(newProducts);
      const count = await pg.query(`SELECT count(*)::int FROM product_query_cache`);
      expect(count.rows[0].count).toBe(1);
    });
  });

  test("EXACT_CACHE_TTL_SECONDS is 24h (86400)", () => {
    expect(EXACT_CACHE_TTL_SECONDS).toBe(24 * 60 * 60);
  });
});
