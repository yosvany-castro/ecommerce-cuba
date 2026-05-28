import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "../helpers/db";
import { seedProductWithEmbedding } from "../helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { generateFeed } from "@/sectors/d-personalization/feed";

let savedKey: string | undefined;

beforeEach(async () => {
  savedKey = process.env.DEEPSEEK_API_KEY;
  await truncateTestTables([
    "feed_rerank_cache",
    "events",
    "user_profile_modes",
    "user_profiles",
    "session_vectors",
    "cohort_centroids",
    "co_occurrence_top",
    "co_occurrence",
    "products",
    "anonymous_sessions",
  ]);
});

afterEach(() => {
  if (savedKey !== undefined) process.env.DEEPSEEK_API_KEY = savedKey;
  else delete process.env.DEEPSEEK_API_KEY;
});

describe("generateFeed F3c fallback when LLM fails", () => {
  test("returns top-10 with empty reasons if DEEPSEEK_API_KEY is invalid", async () => {
    process.env.DEEPSEEK_API_KEY = "invalid-key-to-force-failure";
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

      const feed = await generateFeed(
        { user_id: null, anonymous_id, session_id, limit: 10 },
        pg,
      );
      expect(feed.length).toBe(10);
      for (const it of feed) {
        expect(it.reason === "" || it.reason === undefined).toBe(true);
      }
    });
  }, 120_000);
});
