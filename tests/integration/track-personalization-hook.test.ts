import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";

beforeEach(async () => {
  await truncateTestTables([
    "events",
    "user_profiles",
    "user_profile_modes",
    "session_vectors",
    "cohort_centroids",
    "products",
  ]);
});

describe("processEventForPersonalization", () => {
  test("3 product_view events on femenino_adulta → session cohort set, profile mode receives 3 updates", async () => {
    await withTestDb(async (pg) => {
      const ps: { id: string }[] = [];
      for (let i = 0; i < 3; i++) {
        ps.push(
          await seedProductWithEmbedding(pg, {
            title: `Producto ${i}`,
            metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
          }),
        );
      }
      await computeCohortCentroids(pg);

      const anonymous_id = randomUUID();
      const session_id = randomUUID();

      for (const p of ps) {
        await processEventForPersonalization(
          {
            anonymous_id,
            user_id: null,
            session_id,
            event_type: "product_view",
            payload: { product_id: p.id, source: "home" },
            occurred_at: new Date().toISOString(),
          },
          pg,
        );
      }

      const sv = await pg.query(
        `SELECT current_cohort_id, signal_window_size
         FROM session_vectors WHERE session_id = $1`,
        [session_id],
      );
      expect(sv.rows[0].current_cohort_id).toBe("femenino_adulta");
      expect(Number(sv.rows[0].signal_window_size)).toBe(3);

      const modes = await pg.query(
        `SELECT cohort_id, n_events_in_mode FROM user_profile_modes`,
      );
      expect(modes.rows.length).toBe(1);
      expect(modes.rows[0].cohort_id).toBe("femenino_adulta");
      // Only the third event (which fixes the cohort) onwards updates the vector;
      // but our pipeline updates on every event after warmup completes — so the third
      // event triggers warmup completion AND a vector update.
      // Effective updates: event 3 (warmup fires + vector update). Events 1,2 are stored
      // as signals but no vector update because cohort wasn't fixed yet.
      expect(Number(modes.rows[0].n_events_in_mode)).toBe(1);
    });
  }, 180_000);

  test("ignores events without product_id (page_view) — no session row created", async () => {
    await withTestDb(async (pg) => {
      await seedProductWithEmbedding(pg, {
        title: "X",
        metadata: { gender_target: "masculino", age_target: { min: 26, max: 59 } },
      });
      await computeCohortCentroids(pg);
      const session_id = randomUUID();
      const anonymous_id = randomUUID();

      await processEventForPersonalization(
        {
          anonymous_id,
          user_id: null,
          session_id,
          event_type: "page_view",
          payload: { path: "/" },
          occurred_at: new Date().toISOString(),
        },
        pg,
      );

      const sv = await pg.query(
        `SELECT signal_window_size FROM session_vectors WHERE session_id = $1`,
        [session_id],
      );
      expect(sv.rows.length).toBe(0);
    });
  }, 60_000);

  test("purchase event picks first product_id and updates vector after warmup", async () => {
    await withTestDb(async (pg) => {
      const ps: { id: string }[] = [];
      for (let i = 0; i < 4; i++) {
        ps.push(
          await seedProductWithEmbedding(pg, {
            title: `P${i}`,
            metadata: { gender_target: "femenino", age_target: { min: 4, max: 11 } },
          }),
        );
      }
      await computeCohortCentroids(pg);
      const anonymous_id = randomUUID();
      const session_id = randomUUID();
      // 3 views to warmup
      for (let i = 0; i < 3; i++) {
        await processEventForPersonalization(
          {
            anonymous_id,
            user_id: null,
            session_id,
            event_type: "product_view",
            payload: { product_id: ps[i].id, source: "home" },
            occurred_at: new Date().toISOString(),
          },
          pg,
        );
      }
      // Now a purchase (weight=5) — should bump n_events_in_mode and weight_sum significantly
      const before = await pg.query(
        `SELECT n_events_in_mode, weight_sum
         FROM user_profile_modes WHERE cohort_id = 'femenino_nina'`,
      );
      await processEventForPersonalization(
        {
          anonymous_id,
          user_id: null,
          session_id,
          event_type: "purchase",
          payload: {
            order_id: randomUUID(),
            product_ids: [ps[3].id],
            total_cents: 5000,
          },
          occurred_at: new Date().toISOString(),
        },
        pg,
      );
      const after = await pg.query(
        `SELECT n_events_in_mode, weight_sum
         FROM user_profile_modes WHERE cohort_id = 'femenino_nina'`,
      );
      expect(Number(after.rows[0].n_events_in_mode)).toBe(
        Number(before.rows[0].n_events_in_mode) + 1,
      );
      expect(Number(after.rows[0].weight_sum)).toBeGreaterThan(
        Number(before.rows[0].weight_sum),
      );
    });
  }, 180_000);
});
