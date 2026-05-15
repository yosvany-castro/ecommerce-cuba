import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { EMBEDDING_DIM } from "@/lib/embeddings/voyage";

beforeEach(async () => {
  await truncateTestTables(["cohort_centroids", "products"]);
});

describe("computeCohortCentroids (REAL Voyage + pg)", () => {
  test("computes centroid for cohort with products, normalized to unit norm", async () => {
    await withTestDb(async (pg) => {
      // 3 products in cohort femenino_adulta + 1 decoy in another
      await seedProductWithEmbedding(pg, {
        title: "Vestido fiesta",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      await seedProductWithEmbedding(pg, {
        title: "Blusa elegante",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      await seedProductWithEmbedding(pg, {
        title: "Falda midi",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      await seedProductWithEmbedding(pg, {
        title: "Juguete bebe",
        metadata: { gender_target: "unisex", age_target: { min: 0, max: 3 } },
      });

      await computeCohortCentroids(pg);

      const r = await pg.query(
        `SELECT centroid_vector::text AS v, n_users_in_cohort
         FROM cohort_centroids WHERE cohort_id = 'femenino_adulta'`,
      );
      expect(r.rows.length).toBe(1);
      const centroid = JSON.parse(r.rows[0].v) as number[];
      expect(centroid.length).toBe(EMBEDDING_DIM);
      expect(Number(r.rows[0].n_users_in_cohort)).toBe(3);
      const norm = Math.sqrt(centroid.reduce((s, x) => s + x * x, 0));
      expect(Math.abs(norm - 1)).toBeLessThan(1e-5);
    });
  }, 120_000);

  test("does not create row for cohort without concrete products", async () => {
    await withTestDb(async (pg) => {
      await seedProductWithEmbedding(pg, {
        title: "Solo femenino_adulta",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      await computeCohortCentroids(pg);
      const r = await pg.query(`SELECT cohort_id FROM cohort_centroids ORDER BY cohort_id`);
      const ids = (r.rows as { cohort_id: string }[]).map((x) => x.cohort_id);
      expect(ids).toEqual(["femenino_adulta"]);
    });
  }, 90_000);

  test("recompute is idempotent — second run yields identical centroid", async () => {
    await withTestDb(async (pg) => {
      await seedProductWithEmbedding(pg, {
        title: "Item",
        metadata: { gender_target: "masculino", age_target: { min: 26, max: 59 } },
      });
      await computeCohortCentroids(pg);
      const r1 = await pg.query(
        `SELECT centroid_vector::text AS v FROM cohort_centroids WHERE cohort_id = 'masculino_adulto'`,
      );
      await computeCohortCentroids(pg);
      const r2 = await pg.query(
        `SELECT centroid_vector::text AS v FROM cohort_centroids WHERE cohort_id = 'masculino_adulto'`,
      );
      expect(r1.rows[0].v).toBe(r2.rows[0].v);
    });
  }, 120_000);
});
