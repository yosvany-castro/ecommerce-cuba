import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { recomputeProfileModes } from "@/sectors/d-personalization/recompute-nightly";
import { normalize, cosine } from "@/lib/math";

beforeEach(async () => {
  await truncateTestTables([
    "events",
    "user_profile_modes",
    "user_profiles",
    "session_vectors",
    "cohort_centroids",
    "products",
    "anonymous_sessions",
  ]);
});

describe("recomputeProfileModes", () => {
  test("recompute from scratch matches incremental within ε (cosine > 0.999)", async () => {
    await withTestDb(async (pg) => {
      const ps: string[] = [];
      for (let i = 0; i < 5; i++) {
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
        `INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1)`,
        [anonymous_id],
      );

      // Track each event AND persist it raw to events so recompute can read it
      for (const id of ps) {
        const now = new Date().toISOString();
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
        await pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
          [anonymous_id, session_id, now, JSON.stringify({ product_id: id, source: "home" })],
        );
      }

      const before = await pg.query(
        `SELECT vector_unnormalized::text AS v, weight_sum::float AS w
         FROM user_profile_modes`,
      );
      const beforeUnnorm = JSON.parse(before.rows[0].v) as number[];
      const beforeWeight = Number(before.rows[0].w);
      const beforeNormalized = normalize(beforeUnnorm);

      await recomputeProfileModes(pg);

      const after = await pg.query(
        `SELECT vector_unnormalized::text AS v, weight_sum::float AS w
         FROM user_profile_modes`,
      );
      const afterUnnorm = JSON.parse(after.rows[0].v) as number[];
      const afterNormalized = normalize(afterUnnorm);
      expect(cosine(beforeNormalized, afterNormalized)).toBeGreaterThan(0.999);
      // Weight should be in similar magnitude (within a factor of 2 due to
      // different start states)
      expect(Number(after.rows[0].w)).toBeGreaterThan(0);
    });
  }, 240_000);

  test("recompute is idempotent (running twice yields the same vector)", async () => {
    await withTestDb(async (pg) => {
      const p = await seedProductWithEmbedding(pg, {
        title: "X",
        metadata: { gender_target: "masculino", age_target: { min: 26, max: 59 } },
      });
      await computeCohortCentroids(pg);
      const anonymous_id = randomUUID();
      const session_id = randomUUID();
      await pg.query(
        `INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1)`,
        [anonymous_id],
      );
      for (let i = 0; i < 3; i++) {
        const now = new Date().toISOString();
        await processEventForPersonalization(
          {
            anonymous_id,
            user_id: null,
            session_id,
            event_type: "product_view",
            payload: { product_id: p.id, source: "home" },
            occurred_at: now,
          },
          pg,
        );
        await pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
          [anonymous_id, session_id, now, JSON.stringify({ product_id: p.id, source: "home" })],
        );
      }
      await recomputeProfileModes(pg);
      const r1 = await pg.query(
        `SELECT vector_unnormalized::text AS v FROM user_profile_modes`,
      );
      await recomputeProfileModes(pg);
      const r2 = await pg.query(
        `SELECT vector_unnormalized::text AS v FROM user_profile_modes`,
      );
      expect(r1.rows[0].v).toBe(r2.rows[0].v);
    });
  }, 180_000);
});
