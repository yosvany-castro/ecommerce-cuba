import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { getUserDebugInfo } from "@/sectors/d-personalization/admin/user-debug";

beforeEach(async () => {
  await truncateTestTables([
    "events",
    "user_profile_modes",
    "user_profiles",
    "session_vectors",
    "cohort_centroids",
    "excluded_products",
    "products",
    "anonymous_sessions",
    "users",
  ]);
});

describe("getUserDebugInfo", () => {
  test("returns null for unknown user", async () => {
    await withTestDb(async (pg) => {
      const out = await getUserDebugInfo(randomUUID(), pg);
      expect(out).toBeNull();
    });
  });

  test("returns full info for user with events and one mode", async () => {
    await withTestDb(async (pg) => {
      const u = await pg.query(
        `INSERT INTO users (email) VALUES ($1) RETURNING id::text`,
        [`t-${randomUUID()}@test.local`],
      );
      const user_id = u.rows[0].id;

      const ps: string[] = [];
      for (let i = 0; i < 4; i++) {
        const p = await seedProductWithEmbedding(pg, {
          title: `P${i}`,
          metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
        });
        ps.push(p.id);
      }
      await computeCohortCentroids(pg);

      const anonymous_id = randomUUID();
      const session_id = randomUUID();
      await pg.query(
        `INSERT INTO anonymous_sessions (anonymous_id, user_id) VALUES ($1, $2)`,
        [anonymous_id, user_id],
      );

      for (const id of ps) {
        await processEventForPersonalization(
          {
            anonymous_id,
            user_id,
            session_id,
            event_type: "product_view",
            payload: { product_id: id, source: "home" },
            occurred_at: new Date().toISOString(),
          },
          pg,
        );
        // Also persist the raw event so admin's "recent_events" finds something
        await pg.query(
          `INSERT INTO events (anonymous_id, user_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, $3, 'product_view', now(), $4::jsonb)`,
          [
            anonymous_id,
            user_id,
            session_id,
            JSON.stringify({ product_id: id, source: "home" }),
          ],
        );
      }

      const info = await getUserDebugInfo(user_id, pg);
      expect(info === null).toBe(false);
      expect(info!.user.id).toBe(user_id);
      expect(info!.modes.length).toBe(1);
      expect(info!.modes[0].cohort_id).toBe("femenino_adulta");
      expect(info!.modes[0].top_5_products.length).toBeGreaterThan(0);
      expect(info!.recent_events.length).toBeGreaterThan(0);
      expect(info!.anonymous_ids_merged).toContain(anonymous_id);
      expect(info!.active_session === null).toBe(false);
      expect(info!.active_session!.current_cohort_id).toBe("femenino_adulta");
    });
  }, 240_000);
});
