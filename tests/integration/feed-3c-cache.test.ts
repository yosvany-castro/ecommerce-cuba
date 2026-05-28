import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "../helpers/db";
import { seedProductWithEmbedding } from "../helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { generateFeed } from "@/sectors/d-personalization/feed";

beforeEach(async () => {
  await truncateTestTables([
    "feed_rerank_cache",
    "events",
    "user_profile_modes",
    "user_profiles",
    "session_vectors",
    "cohort_centroids",
    "co_occurrence_top",
    "co_occurrence",
    "excluded_products",
    "products",
    "anonymous_sessions",
  ]);
});

describe("generateFeed cache hit (F3c)", () => {
  test("second call with same top-30 is significantly faster (cache hit)", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 30; i++) {
        await seedProductWithEmbedding(pg, {
          title: `Vestido ${i}`,
          metadata: {
            gender_target: "femenino",
            age_target: { min: 26, max: 59 },
          },
        });
      }
      await computeCohortCentroids(pg);

      const anonymous_id = randomUUID();
      const session_id = randomUUID();
      await pg.query(
        `INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1)`,
        [anonymous_id],
      );

      const pidsR = await pg.query(`SELECT id::text FROM products LIMIT 5`);
      for (const row of pidsR.rows as { id: string }[]) {
        const now = new Date().toISOString();
        await pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
          [
            anonymous_id,
            session_id,
            now,
            JSON.stringify({ product_id: row.id, source: "home" }),
          ],
        );
        await processEventForPersonalization(
          {
            anonymous_id,
            user_id: null,
            session_id,
            event_type: "product_view",
            payload: { product_id: row.id, source: "home" },
            occurred_at: now,
          },
          pg,
        );
      }

      const t0 = Date.now();
      const feed1 = await generateFeed(
        { user_id: null, anonymous_id, session_id, limit: 10 },
        pg,
      );
      const tFirst = Date.now() - t0;
      expect(feed1.length).toBe(10);

      const cR = await pg.query(
        `SELECT count(*)::int AS c FROM feed_rerank_cache`,
      );
      expect(cR.rows[0].c).toBeGreaterThanOrEqual(1);

      const t1 = Date.now();
      const feed2 = await generateFeed(
        { user_id: null, anonymous_id, session_id, limit: 10 },
        pg,
      );
      const tSecond = Date.now() - t1;
      expect(feed2.length).toBe(10);

      expect(tSecond * 3).toBeLessThan(tFirst);
    });
  }, 240_000);
});
