import { describe, test, expect, beforeEach, vi } from "vitest";

// Estos tests miden el EJE de personalización (usuarios contrastados divergen,
// la cohorte domina). El prior de popularidad de producción (exp-I: "cosine
// proposes, popularity re-weighs") mezcla best-sellers a propósito e infla el
// Jaccard en catálogos chicos — se apaga aquí para aislar el eje bajo prueba.
vi.hoisted(() => {
  process.env.FEED_POP_PRIOR_STRENGTH = "0";
});
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { generateFeed } from "@/sectors/d-personalization/feed";
import { handleDismissAutoExclude } from "@/sectors/d-personalization/exclusion/dismiss-handler";

beforeEach(async () => {
  await truncateTestTables([
    "events",
    "user_profile_modes",
    "user_profiles",
    "session_vectors",
    "cohort_centroids",
    "excluded_products",
    "products",
  ]);
});

describe("generateFeed", () => {
  test("user with 5 product_view events on femenino_adulta → top-10 dominated by that cohort (≥60%)", async () => {
    await withTestDb(async (pg) => {
      const femAdultaIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const p = await seedProductWithEmbedding(pg, {
          title: `FemAdulta ${i}`,
          description: "vestidos blusas",
          metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
        });
        femAdultaIds.push(p.id);
      }
      for (let i = 0; i < 10; i++) {
        await seedProductWithEmbedding(pg, {
          title: `MascNino ${i}`,
          description: "juguetes",
          metadata: { gender_target: "masculino", age_target: { min: 4, max: 11 } },
        });
      }
      await computeCohortCentroids(pg);

      const anonymous_id = randomUUID();
      const session_id = randomUUID();
      for (let i = 0; i < 5; i++) {
        await processEventForPersonalization(
          {
            anonymous_id,
            user_id: null,
            session_id,
            event_type: "product_view",
            payload: { product_id: femAdultaIds[i], source: "home" },
            occurred_at: new Date().toISOString(),
          },
          pg,
        );
      }

      const feed = await generateFeed(
        { user_id: null, anonymous_id, session_id, limit: 10 },
        pg,
      );
      expect(feed.length).toBe(10);
      const inFem = feed.filter((f) => {
        const meta = f.product.metadata as { gender_target?: string };
        return meta.gender_target === "femenino";
      }).length;
      expect(inFem / feed.length).toBeGreaterThanOrEqual(0.6);
    });
  }, 240_000);

  test("excluded product does NOT appear in feed", async () => {
    await withTestDb(async (pg) => {
      for (let i = 0; i < 5; i++) {
        await seedProductWithEmbedding(pg, {
          title: `P${i}`,
          metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
        });
      }
      await computeCohortCentroids(pg);
      const anonymous_id = randomUUID();
      const session_id = randomUUID();
      const before = await generateFeed(
        { user_id: null, anonymous_id, session_id, limit: 5 },
        pg,
      );
      expect(before.length).toBeGreaterThan(0);
      const target = before[0].product.id;
      await handleDismissAutoExclude(
        { anonymous_id, user_id: null, product_id: target },
        pg,
      );
      const after = await generateFeed(
        { user_id: null, anonymous_id, session_id, limit: 5 },
        pg,
      );
      expect(after.map((f) => f.product.id)).not.toContain(target);
    });
  }, 180_000);

  test("two contrasted synthetic users → feed Jaccard < 0.30", async () => {
    await withTestDb(async (pg) => {
      const femIds: string[] = [];
      const mascIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        femIds.push(
          (
            await seedProductWithEmbedding(pg, {
              title: `Fem ${i}`,
              metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
            })
          ).id,
        );
        mascIds.push(
          (
            await seedProductWithEmbedding(pg, {
              title: `Masc ${i}`,
              metadata: { gender_target: "masculino", age_target: { min: 26, max: 59 } },
            })
          ).id,
        );
      }
      await computeCohortCentroids(pg);

      const u1_anon = randomUUID(),
        u1_session = randomUUID();
      for (let i = 0; i < 5; i++) {
        await processEventForPersonalization(
          {
            anonymous_id: u1_anon,
            user_id: null,
            session_id: u1_session,
            event_type: "product_view",
            payload: { product_id: femIds[i], source: "home" },
            occurred_at: new Date().toISOString(),
          },
          pg,
        );
      }
      const u2_anon = randomUUID(),
        u2_session = randomUUID();
      for (let i = 0; i < 5; i++) {
        await processEventForPersonalization(
          {
            anonymous_id: u2_anon,
            user_id: null,
            session_id: u2_session,
            event_type: "product_view",
            payload: { product_id: mascIds[i], source: "home" },
            occurred_at: new Date().toISOString(),
          },
          pg,
        );
      }

      const f1 = await generateFeed(
        { user_id: null, anonymous_id: u1_anon, session_id: u1_session, limit: 10 },
        pg,
      );
      const f2 = await generateFeed(
        { user_id: null, anonymous_id: u2_anon, session_id: u2_session, limit: 10 },
        pg,
      );
      const s1 = new Set(f1.map((f) => f.product.id));
      const s2 = new Set(f2.map((f) => f.product.id));
      const inter = [...s1].filter((x) => s2.has(x)).length;
      const uni = new Set([...s1, ...s2]).size;
      const jaccard = inter / uni;
      expect(jaccard).toBeLessThan(0.30);
    });
  }, 240_000);
});
