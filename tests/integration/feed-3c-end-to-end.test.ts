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
    "co_occurrence_top",
    "co_occurrence",
    "events",
    "user_profile_modes",
    "user_profiles",
    "session_vectors",
    "cohort_centroids",
    "excluded_products",
    "products",
    "anonymous_sessions",
  ]);
});

describe("generateFeed with F3c reranker (end-to-end with REAL LLM)", () => {
  test("returns top-10 with non-empty reasons after a real user flow", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 30; i++) {
        await seedProductWithEmbedding(pg, {
          title: `Vestido elegante ${i}`,
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
      const generic =
        /^(producto recomendado|para ti|popular|te puede gustar|alto rating)$/i;
      let withReason = 0;
      for (const it of feed) {
        if (it.reason && it.reason.length > 0) {
          withReason++;
          expect(it.reason.length).toBeGreaterThan(3);
          expect(generic.test(it.reason.trim())).toBe(false);
        }
      }
      expect(withReason).toBe(10);
    });
  }, 240_000);
});
