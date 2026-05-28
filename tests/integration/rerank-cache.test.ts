import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "../helpers/db";
import {
  lookupRerankCache,
  writeRerankCache,
  cleanupExpiredRerankCache,
  CACHE_TTL_HOURS,
} from "@/sectors/d-personalization/reranker/cache";

beforeEach(async () => {
  await truncateTestTables(["feed_rerank_cache", "user_profiles"]);
});

describe("rerank cache", () => {
  test("CACHE_TTL_HOURS is 4", () => {
    expect(CACHE_TTL_HOURS).toBe(4);
  });

  test("write then lookup hit returns items in order", async () => {
    await withTestDb(async (pg) => {
      const upR = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events)
         VALUES ($1, 0) RETURNING id::text`,
        [randomUUID()],
      );
      const items = [
        {
          product_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
          rank: 1,
          reason: "X",
        },
        {
          product_id: "b1234567-89ab-4cde-8abc-123456789012",
          rank: 2,
          reason: "Y",
        },
      ];
      await writeRerankCache("key-123", upR.rows[0].id, items, pg);
      const out = await lookupRerankCache("key-123", pg);
      expect(out === null).toBe(false);
      expect(out!.length).toBe(2);
      expect(out![0].reason).toBe("X");
      expect(out![1].reason).toBe("Y");
    });
  });

  test("lookup miss returns null", async () => {
    await withTestDb(async (pg) => {
      const out = await lookupRerankCache("unknown-key", pg);
      expect(out).toBeNull();
    });
  });

  test("write upsert overrides previous entry for same cache_key", async () => {
    await withTestDb(async (pg) => {
      const upR = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events)
         VALUES ($1, 0) RETURNING id::text`,
        [randomUUID()],
      );
      await writeRerankCache(
        "k1",
        upR.rows[0].id,
        [
          {
            product_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            rank: 1,
            reason: "first",
          },
        ],
        pg,
      );
      await writeRerankCache(
        "k1",
        upR.rows[0].id,
        [
          {
            product_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            rank: 1,
            reason: "second",
          },
        ],
        pg,
      );
      const out = await lookupRerankCache("k1", pg);
      expect(out![0].reason).toBe("second");
    });
  });

  test("cleanup removes expired entries only", async () => {
    await withTestDb(async (pg) => {
      const upR = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events)
         VALUES ($1, 0) RETURNING id::text`,
        [randomUUID()],
      );
      await writeRerankCache(
        "k-active",
        upR.rows[0].id,
        [
          {
            product_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            rank: 1,
            reason: "ok",
          },
        ],
        pg,
      );
      await pg.query(
        `INSERT INTO feed_rerank_cache (cache_key, user_profile_id, top10_json, prompt_version, ttl_until)
         VALUES ($1, $2, $3::jsonb, $4, now() - interval '1 hour')`,
        [
          "k-expired",
          upR.rows[0].id,
          JSON.stringify([]),
          "v1.0.0-fase3c",
        ],
      );

      const removed = await cleanupExpiredRerankCache(pg);
      expect(removed).toBeGreaterThanOrEqual(1);

      const r = await pg.query(`SELECT cache_key FROM feed_rerank_cache`);
      const keys = r.rows.map((x: { cache_key: string }) => x.cache_key);
      expect(keys).toContain("k-active");
      expect(keys).not.toContain("k-expired");
    });
  });
});
