import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import {
  getOrInitProfileMode,
  updateProfileModeWithProduct,
} from "@/sectors/d-personalization/profile-mode";
import { KAPPA } from "@/sectors/d-personalization/vector/constants";
import { matchRecipientOrNull } from "@/sectors/d-personalization/cohorts/match-recipient";
import { normalize, cosine } from "@/lib/math";

beforeEach(async () => {
  await truncateTestTables([
    "cohort_centroids",
    "products",
    "user_profile_modes",
    "user_profiles",
    "recipients",
    "users",
  ]);
});

describe("getOrInitProfileMode (cold start)", () => {
  test("first call creates row with weight_sum = KAPPA and unnorm = KAPPA * cohort centroid", async () => {
    await withTestDb(async (pg) => {
      await seedProductWithEmbedding(pg, {
        title: "Vestido",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      await seedProductWithEmbedding(pg, {
        title: "Blusa",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      await computeCohortCentroids(pg);

      const up = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events)
         VALUES ($1, 0) RETURNING id::text`,
        [randomUUID()],
      );
      const profile_id = up.rows[0].id;

      const mode = await getOrInitProfileMode(
        {
          user_profile_id: profile_id,
          recipient_id: null,
          cohort_id: "femenino_adulta",
        },
        pg,
      );
      expect(mode.weight_sum).toBeCloseTo(KAPPA, 6);
      expect(mode.n_events_in_mode).toBe(0);
      expect(mode.cohort_id).toBe("femenino_adulta");

      const c = await pg.query(
        `SELECT centroid_vector::text AS v FROM cohort_centroids WHERE cohort_id = 'femenino_adulta'`,
      );
      const centroid = JSON.parse(c.rows[0].v) as number[];
      // Initial normalized vector should equal the centroid
      const u = normalize(mode.vector_unnormalized);
      expect(cosine(u, centroid)).toBeGreaterThan(0.999);
    });
  }, 120_000);

  test("second call returns the same row (no duplicate)", async () => {
    await withTestDb(async (pg) => {
      await seedProductWithEmbedding(pg, {
        title: "X",
        metadata: { gender_target: "masculino", age_target: { min: 26, max: 59 } },
      });
      await computeCohortCentroids(pg);
      const up = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events)
         VALUES ($1, 0) RETURNING id::text`,
        [randomUUID()],
      );
      const profile_id = up.rows[0].id;
      const m1 = await getOrInitProfileMode(
        {
          user_profile_id: profile_id,
          recipient_id: null,
          cohort_id: "masculino_adulto",
        },
        pg,
      );
      const m2 = await getOrInitProfileMode(
        {
          user_profile_id: profile_id,
          recipient_id: null,
          cohort_id: "masculino_adulto",
        },
        pg,
      );
      expect(m2.id).toBe(m1.id);
    });
  }, 90_000);

  test("different cohort_ids on same profile create separate rows", async () => {
    await withTestDb(async (pg) => {
      // seed for two cohorts
      await seedProductWithEmbedding(pg, {
        title: "Fem",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      await seedProductWithEmbedding(pg, {
        title: "Masc",
        metadata: { gender_target: "masculino", age_target: { min: 26, max: 59 } },
      });
      await computeCohortCentroids(pg);
      const up = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events)
         VALUES ($1, 0) RETURNING id::text`,
        [randomUUID()],
      );
      const profile_id = up.rows[0].id;
      const m1 = await getOrInitProfileMode(
        {
          user_profile_id: profile_id,
          recipient_id: null,
          cohort_id: "femenino_adulta",
        },
        pg,
      );
      const m2 = await getOrInitProfileMode(
        {
          user_profile_id: profile_id,
          recipient_id: null,
          cohort_id: "masculino_adulto",
        },
        pg,
      );
      expect(m2.id).not.toBe(m1.id);
    });
  }, 120_000);
});

describe("updateProfileModeWithProduct", () => {
  test("after 10 events on the same product, vector tilts toward it", async () => {
    await withTestDb(async (pg) => {
      const ps: { id: string }[] = [];
      for (let i = 0; i < 5; i++) {
        ps.push(
          await seedProductWithEmbedding(pg, {
            title: `Producto ${i}`,
            metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
          }),
        );
      }
      await computeCohortCentroids(pg);

      const up = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events)
         VALUES ($1, 0) RETURNING id::text`,
        [randomUUID()],
      );
      const profile_id = up.rows[0].id;
      let mode = await getOrInitProfileMode(
        {
          user_profile_id: profile_id,
          recipient_id: null,
          cohort_id: "femenino_adulta",
        },
        pg,
      );

      const targetEmbR = await pg.query(
        `SELECT embedding::text AS v FROM products WHERE id = $1`,
        [ps[0].id],
      );
      const targetEmb = JSON.parse(targetEmbR.rows[0].v) as number[];

      for (let i = 0; i < 10; i++) {
        mode = await updateProfileModeWithProduct(
          { mode_id: mode.id, product_id: ps[0].id, event_weight: 1 },
          pg,
        );
      }

      expect(mode.n_events_in_mode).toBe(10);
      const u = normalize(mode.vector_unnormalized);
      expect(cosine(u, targetEmb)).toBeGreaterThan(0.5);
    });
  }, 120_000);

  test("event_weight = 0 → no DB write, returns current state", async () => {
    await withTestDb(async (pg) => {
      await seedProductWithEmbedding(pg, {
        title: "X",
        metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
      });
      await computeCohortCentroids(pg);
      const up = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events)
         VALUES ($1, 0) RETURNING id::text`,
        [randomUUID()],
      );
      const mode = await getOrInitProfileMode(
        {
          user_profile_id: up.rows[0].id,
          recipient_id: null,
          cohort_id: "femenino_adulta",
        },
        pg,
      );
      const productR = await pg.query(`SELECT id::text FROM products LIMIT 1`);
      const productId = productR.rows[0].id;
      const after = await updateProfileModeWithProduct(
        { mode_id: mode.id, product_id: productId, event_weight: 0 },
        pg,
      );
      expect(after.n_events_in_mode).toBe(0);
      expect(after.weight_sum).toBeCloseTo(mode.weight_sum, 6);
    });
  }, 60_000);
});

describe("matchRecipientOrNull", () => {
  test("returns null for anonymous (user_id=null)", async () => {
    await withTestDb(async (pg) => {
      const out = await matchRecipientOrNull(null, "femenino_adulta", pg);
      expect(out).toBeNull();
    });
  });

  test("returns null when user_id has no matching recipient", async () => {
    await withTestDb(async (pg) => {
      const u = await pg.query(
        `INSERT INTO users (email) VALUES ($1) RETURNING id::text`,
        [`u-${randomUUID()}@test.local`],
      );
      const out = await matchRecipientOrNull(
        u.rows[0].id,
        "femenino_adulta",
        pg,
      );
      expect(out).toBeNull();
    });
  });

  test("returns recipient id when one matches the cohort", async () => {
    await withTestDb(async (pg) => {
      const u = await pg.query(
        `INSERT INTO users (email) VALUES ($1) RETURNING id::text`,
        [`u-${randomUUID()}@test.local`],
      );
      const r = await pg.query(
        `INSERT INTO recipients (user_id, name, gender, age)
         VALUES ($1, 'Ana', 'femenino', 35) RETURNING id::text`,
        [u.rows[0].id],
      );
      const out = await matchRecipientOrNull(
        u.rows[0].id,
        "femenino_adulta",
        pg,
      );
      expect(out).toBe(r.rows[0].id);
    });
  });

  test("returns null for unisex_indeterminado", async () => {
    await withTestDb(async (pg) => {
      const u = await pg.query(
        `INSERT INTO users (email) VALUES ($1) RETURNING id::text`,
        [`u-${randomUUID()}@test.local`],
      );
      const out = await matchRecipientOrNull(
        u.rows[0].id,
        "unisex_indeterminado",
        pg,
      );
      expect(out).toBeNull();
    });
  });
});
