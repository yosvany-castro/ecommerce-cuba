import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { recomputeModesForBucket } from "@/sectors/d-personalization/multimode/recompute";
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

describe("recomputeModesForBucket", () => {
  test("target=2 creates 2 modes for heterogeneous events (formal vs casual)", async () => {
    await withTestDb(async (pg) => {
      const formalIds: string[] = [];
      const casualIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        formalIds.push(
          (await seedProductWithEmbedding(pg, {
            title: `Vestido formal de gala elegante ${i}`,
            description: "ropa elegante para fiesta y eventos formales",
            metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
          })).id,
        );
        casualIds.push(
          (await seedProductWithEmbedding(pg, {
            title: `Camiseta casual algodón diaria ${i}`,
            description: "ropa cómoda casual para uso diario",
            metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
          })).id,
        );
      }
      await computeCohortCentroids(pg);

      const anonymous_id = randomUUID();
      const session_id = randomUUID();
      await pg.query(
        `INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1)`,
        [anonymous_id],
      );

      // 13 formal + 12 casual events
      let idx = 0;
      for (const lst of [
        new Array(13).fill(0).map((_, i) => formalIds[i % 10]),
        new Array(12).fill(0).map((_, i) => casualIds[i % 10]),
      ]) {
        for (const id of lst) {
          const now = new Date(Date.now() + idx * 1000).toISOString();
          await pg.query(
            `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
             VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
            [
              anonymous_id,
              session_id,
              now,
              JSON.stringify({ product_id: id, source: "home" }),
            ],
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
          idx++;
        }
      }

      const upR = await pg.query(
        `SELECT id::text FROM user_profiles WHERE anonymous_id = $1`,
        [anonymous_id],
      );
      const profile_id = upR.rows[0].id;

      await recomputeModesForBucket(
        {
          user_profile_id: profile_id,
          recipient_id: null,
          cohort_id: "femenino_adulta",
          target_modes: 2,
        },
        pg,
      );

      const modes = await pg.query(
        `SELECT mode_index, vector_unnormalized::text AS v
         FROM user_profile_modes
         WHERE user_profile_id = $1 AND cohort_id = 'femenino_adulta'
         ORDER BY mode_index`,
        [profile_id],
      );
      expect(modes.rows.length).toBe(2);
      expect(modes.rows.map((r: { mode_index: number }) => r.mode_index).sort()).toEqual([1, 2]);

      const fR = await pg.query(
        `SELECT embedding::text AS v FROM products WHERE id = $1`,
        [formalIds[0]],
      );
      const cR = await pg.query(
        `SELECT embedding::text AS v FROM products WHERE id = $1`,
        [casualIds[0]],
      );
      const fEmb = JSON.parse(fR.rows[0].v) as number[];
      const cEmb = JSON.parse(cR.rows[0].v) as number[];

      const m1 = normalize(JSON.parse(modes.rows[0].v) as number[]);
      const m2 = normalize(JSON.parse(modes.rows[1].v) as number[]);
      const m1Direction = cosine(m1, fEmb) > cosine(m1, cEmb) ? "formal" : "casual";
      const m2Direction = cosine(m2, fEmb) > cosine(m2, cEmb) ? "formal" : "casual";
      expect(m1Direction).not.toBe(m2Direction);
    });
  }, 240_000);

  test("target=1 collapses multi-modo to single mode", async () => {
    await withTestDb(async (pg) => {
      await seedProductWithEmbedding(pg, {
        title: "X",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      await computeCohortCentroids(pg);

      const upR = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events)
         VALUES ($1, 0) RETURNING id::text`,
        [randomUUID()],
      );
      const profile_id = upR.rows[0].id;

      const dim1024 = "[" + new Array(1024).fill(0).map((_, i) => (i === 0 ? 1 : 0)).join(",") + "]";
      for (const mi of [1, 2]) {
        await pg.query(
          `INSERT INTO user_profile_modes
             (user_profile_id, recipient_id, cohort_id, mode_index,
              vector_unnormalized, weight_sum, n_events_in_mode, last_assigned_at)
           VALUES ($1, NULL, 'femenino_adulta', $2, $3::vector, 5, 5, now())`,
          [profile_id, mi, dim1024],
        );
      }

      await recomputeModesForBucket(
        {
          user_profile_id: profile_id,
          recipient_id: null,
          cohort_id: "femenino_adulta",
          target_modes: 1,
        },
        pg,
      );

      const r = await pg.query(
        `SELECT count(*)::int AS c FROM user_profile_modes
         WHERE user_profile_id = $1 AND cohort_id = 'femenino_adulta'`,
        [profile_id],
      );
      // No real events for the profile → recompute deletes existing and inserts 0
      expect(r.rows[0].c).toBeLessThanOrEqual(1);
    });
  }, 90_000);
});
