import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";

beforeEach(async () => {
  await truncateTestTables([
    "co_occurrence",
    "events",
    "user_profile_modes",
    "user_profiles",
    "session_vectors",
    "cohort_centroids",
    "products",
    "anonymous_sessions",
  ]);
});

describe("track-hook F3b extensions", () => {
  test("captures co-occurrence between two products viewed in same session", async () => {
    await withTestDb(async (pg) => {
      const pA = await seedProductWithEmbedding(pg, {
        title: "A",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      const pB = await seedProductWithEmbedding(pg, {
        title: "B",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      await computeCohortCentroids(pg);

      const anonymous_id = randomUUID();
      const session_id = randomUUID();
      const t0 = new Date().toISOString();
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
        [anonymous_id, session_id, t0, JSON.stringify({ product_id: pA.id, source: "home" })],
      );
      await processEventForPersonalization(
        {
          anonymous_id,
          user_id: null,
          session_id,
          event_type: "product_view",
          payload: { product_id: pA.id, source: "home" },
          occurred_at: t0,
        },
        pg,
      );

      const t1 = new Date(Date.now() + 1000).toISOString();
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
        [anonymous_id, session_id, t1, JSON.stringify({ product_id: pB.id, source: "home" })],
      );
      await processEventForPersonalization(
        {
          anonymous_id,
          user_id: null,
          session_id,
          event_type: "product_view",
          payload: { product_id: pB.id, source: "home" },
          occurred_at: t1,
        },
        pg,
      );

      const r = await pg.query(`SELECT count FROM co_occurrence`);
      expect(r.rows.length).toBe(1);
      expect(Number(r.rows[0].count)).toBe(1);
    });
  }, 180_000);

  test("triggers multi-modo recompute when aggregate crosses 20-event threshold", async () => {
    await withTestDb(async (pg) => {
      const ps: string[] = [];
      for (let i = 0; i < 10; i++) {
        const p = await seedProductWithEmbedding(pg, {
          title: `P${i}`,
          metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
        });
        ps.push(p.id);
      }
      await computeCohortCentroids(pg);

      const anonymous_id = randomUUID();
      const session_id = randomUUID();
      await pg.query(`INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1)`, [anonymous_id]);

      // With warmup=3, events 1-2 don't update vector. Event 3 closes warmup
      // and starts vector updates. So n_events_in_mode = N - 2 for N total events.
      // To cross the threshold 20 (modesForEvents trigger), we need 22 events
      // (n_events_in_mode = 20).

      // 21 events → n_events_in_mode = 19 → still 1 mode
      for (let i = 0; i < 21; i++) {
        const id = ps[i % 10];
        const now = new Date(Date.now() + i * 1000).toISOString();
        await pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
          [anonymous_id, session_id, now, JSON.stringify({ product_id: id, source: "home" })],
        );
        await processEventForPersonalization(
          {
            anonymous_id,
            user_id: null,
            session_id,
            event_type: "product_view",
            payload: { product_id: id, source: "home" },
            occurred_at: now,
          },
          pg,
        );
      }
      const before = await pg.query(`SELECT count(*)::int AS c FROM user_profile_modes`);
      expect(before.rows[0].c).toBe(1);

      // Event 22 → n_events_in_mode = 20 → modesForEvents=2 → trigger
      const id = ps[0];
      const t22 = new Date(Date.now() + 30000).toISOString();
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
        [anonymous_id, session_id, t22, JSON.stringify({ product_id: id, source: "home" })],
      );
      await processEventForPersonalization(
        {
          anonymous_id,
          user_id: null,
          session_id,
          event_type: "product_view",
          payload: { product_id: id, source: "home" },
          occurred_at: t22,
        },
        pg,
      );

      const after = await pg.query(`SELECT count(*)::int AS c FROM user_profile_modes`);
      expect(after.rows[0].c).toBe(2);
    });
  }, 240_000);
});
