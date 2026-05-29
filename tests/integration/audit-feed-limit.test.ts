import { describe, test, expect, beforeAll } from "vitest";
import { withTestDb, truncateTestTables } from "../helpers/db";
import { seedProductWithEmbedding } from "../helpers/seed";
import { generateFeed } from "@/sectors/d-personalization/feed";

/**
 * AUDIT FINDING (P2) — `limit` is silently ignored on the personalised path;
 * the feed is hard-capped at 10 for any user with a profile.
 *
 * generateFeed defaults limit to 20 (feed.ts:175) and honours it on the
 * no-profile path via `top30.slice(0, limit)` (feed.ts:281). But on the
 * personalised path the result can never exceed 10:
 *   - the LLM reranker is constrained to exactly 10 (rerank.ts:21 `.length(10)`),
 *   - and the fallback hard-codes `top30.slice(0, 10)` (feed.ts:315),
 * after which `cached.slice(0, limit)` (feed.ts:323) can only shrink it.
 *
 * Net effect: a logged-in / personalised user asking for limit=20 with 12 valid
 * candidates available gets 10 items, while the same call shape on the
 * no-profile path would return up to 20. The default limit (20) is never honored
 * for the users we most want to serve.
 *
 * This test forces the deterministic fallback branch (invalid DeepSeek key, same
 * technique as feed-3c-fallback.test.ts) so no paid LLM call is needed.
 *
 * EXPECTED ON MAIN: FAILS — feed.length === 10, not 12.
 */
describe("AUDIT: personalised feed ignores limit > 10", () => {
  beforeAll(() => {
    process.env.DEEPSEEK_API_KEY = "sk-invalid-deliberately-broken-audit";
  });

  test("limit=20 with 12 candidates returns 12 for a personalised user", async () => {
    await withTestDb(async (pg) => {
      await truncateTestTables([
        "feed_rerank_cache",
        "user_profile_modes",
        "user_profiles",
        "events",
        "products",
      ]);

      const N = 12;
      for (let i = 0; i < N; i++) {
        await seedProductWithEmbedding(pg, {
          title: `Producto ${i} camiseta algodón`,
          metadata: { brand: "GenericBrand", category: "ropa" },
        });
      }

      // A non-zero mode vector so vector retrieval returns all 12 in a defined
      // order (top30 = 12 ≥ 10 → personalised reranker path is taken).
      const modeVec = Array(1024).fill(0);
      modeVec[0] = 1;

      const prof = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events) VALUES ($1, 5) RETURNING id::text`,
        ["anon-limit-audit"],
      );
      const profileId = prof.rows[0].id;
      await pg.query(
        `INSERT INTO user_profile_modes
           (user_profile_id, recipient_id, cohort_id, mode_index, vector_unnormalized, weight_sum, n_events_in_mode, last_assigned_at)
         VALUES ($1, null, 'unisex_indeterminado', 1, $2::vector, 1.0, 5, now())`,
        [profileId, "[" + modeVec.join(",") + "]"],
      );

      const feed = await generateFeed(
        {
          user_id: null,
          anonymous_id: "anon-limit-audit",
          session_id: null,
          limit: 20,
        },
        pg,
      );

      // 12 valid candidates exist and limit=20 was requested, so the contract
      // implies min(20, 12) = 12. The personalised path caps at 10.
      expect(feed.length).toBe(12);
    }, 60_000);
  });
});
