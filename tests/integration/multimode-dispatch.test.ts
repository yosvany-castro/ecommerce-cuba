import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { pickBestMode } from "@/sectors/d-personalization/multimode/dispatch";

beforeEach(async () => {
  await truncateTestTables([
    "user_profile_modes",
    "user_profiles",
    "products",
    "cohort_centroids",
  ]);
});

describe("pickBestMode", () => {
  test("returns mode whose centroid is cosine-closest to product embedding", async () => {
    await withTestDb(async (pg) => {
      const pFormal = await seedProductWithEmbedding(pg, {
        title: "Vestido formal elegante de fiesta",
        description: "ropa elegante",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      const pCasual = await seedProductWithEmbedding(pg, {
        title: "Camiseta casual algodón",
        description: "ropa casual",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      await computeCohortCentroids(pg);

      const upR = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events)
         VALUES ($1, 0) RETURNING id::text`,
        [randomUUID()],
      );
      const profile_id = upR.rows[0].id;

      const fEmbR = await pg.query(
        `SELECT embedding::text AS v FROM products WHERE id = $1`,
        [pFormal.id],
      );
      const cEmbR = await pg.query(
        `SELECT embedding::text AS v FROM products WHERE id = $1`,
        [pCasual.id],
      );
      const fEmb = JSON.parse(fEmbR.rows[0].v) as number[];
      const cEmb = JSON.parse(cEmbR.rows[0].v) as number[];

      await pg.query(
        `INSERT INTO user_profile_modes
           (user_profile_id, recipient_id, cohort_id, mode_index,
            vector_unnormalized, weight_sum, n_events_in_mode, last_assigned_at)
         VALUES ($1, NULL, 'femenino_adulta', 1, $2::vector, 5, 5, now())`,
        [profile_id, "[" + fEmb.join(",") + "]"],
      );
      await pg.query(
        `INSERT INTO user_profile_modes
           (user_profile_id, recipient_id, cohort_id, mode_index,
            vector_unnormalized, weight_sum, n_events_in_mode, last_assigned_at)
         VALUES ($1, NULL, 'femenino_adulta', 2, $2::vector, 5, 5, now())`,
        [profile_id, "[" + cEmb.join(",") + "]"],
      );

      const bestForFormal = await pickBestMode(
        { user_profile_id: profile_id, recipient_id: null, cohort_id: "femenino_adulta" },
        fEmb,
        pg,
      );
      expect(bestForFormal === null).toBe(false);
      expect(bestForFormal!.mode_index).toBe(1);

      const bestForCasual = await pickBestMode(
        { user_profile_id: profile_id, recipient_id: null, cohort_id: "femenino_adulta" },
        cEmb,
        pg,
      );
      expect(bestForCasual === null).toBe(false);
      expect(bestForCasual!.mode_index).toBe(2);
    });
  }, 120_000);

  test("returns null when bucket has no modes", async () => {
    await withTestDb(async (pg) => {
      const upR = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events)
         VALUES ($1, 0) RETURNING id::text`,
        [randomUUID()],
      );
      const best = await pickBestMode(
        { user_profile_id: upR.rows[0].id, recipient_id: null, cohort_id: "femenino_adulta" },
        new Array(1024).fill(0),
        pg,
      );
      expect(best).toBeNull();
    });
  });
});
