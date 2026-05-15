import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { generateFeed } from "@/sectors/d-personalization/feed";
import { recomputeNPMI } from "@/sectors/d-personalization/co-occurrence/npmi-recompute";

beforeEach(async () => {
  await truncateTestTables([
    "co_occurrence_top",
    "co_occurrence",
    "events",
    "user_profile_modes",
    "user_profiles",
    "session_vectors",
    "cohort_centroids",
    "excluded_products",
    "products",
    "anonymous_sessions",
  ]);
});

describe("generateFeed con RRF 3 fuentes (F3b)", () => {
  test("cross-sell: last viewed iPhone, NPMI surfaces funda iPhone in top-10", async () => {
    await withTestDb(async (pg) => {
      const iPhone = await seedProductWithEmbedding(pg, {
        title: "iPhone 15 Pro 256GB",
        description: "smartphone Apple iPhone gama alta",
        metadata: { gender_target: "unisex", age_target: { min: 18, max: 59 } },
      });
      const funda = await seedProductWithEmbedding(pg, {
        title: "Funda silicona compatible iPhone 15 Pro",
        description: "accesorio protector silicona suave",
        metadata: { gender_target: "unisex", age_target: { min: 18, max: 59 } },
      });
      const randoms: { id: string }[] = [];
      for (let i = 0; i < 10; i++) {
        randoms.push(
          await seedProductWithEmbedding(pg, {
            title: `Random ${i}`,
            metadata: { gender_target: "unisex", age_target: { min: 18, max: 59 } },
          }),
        );
      }
      await computeCohortCentroids(pg);

      // 10 sessions where iPhone and funda are co-viewed
      for (let i = 0; i < 10; i++) {
        const sid = randomUUID();
        const aid = randomUUID();
        await pg.query(
          `INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1)`,
          [aid],
        );
        const t0 = new Date(Date.now() + i * 1000).toISOString();
        const t1 = new Date(Date.now() + i * 1000 + 500).toISOString();
        await pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, 'product_view', $3, $4::jsonb), ($1, $2, 'product_view', $5, $6::jsonb)`,
          [
            aid,
            sid,
            t0,
            JSON.stringify({ product_id: iPhone.id, source: "home" }),
            t1,
            JSON.stringify({ product_id: funda.id, source: "home" }),
          ],
        );
        await processEventForPersonalization(
          {
            anonymous_id: aid,
            user_id: null,
            session_id: sid,
            event_type: "product_view",
            payload: { product_id: iPhone.id, source: "home" },
            occurred_at: t0,
          },
          pg,
        );
        await processEventForPersonalization(
          {
            anonymous_id: aid,
            user_id: null,
            session_id: sid,
            event_type: "product_view",
            payload: { product_id: funda.id, source: "home" },
            occurred_at: t1,
          },
          pg,
        );
      }

      // Inject noise pairs directly: 20 random pairs with count=5 so NPMI math
      // has variance (otherwise iPhone-funda alone yields P(ab)=1 → NPMI=0).
      for (let i = 0; i < randoms.length - 1; i++) {
        for (let j = i + 1; j < randoms.length; j++) {
          const [lo, hi] =
            randoms[i].id < randoms[j].id
              ? [randoms[i].id, randoms[j].id]
              : [randoms[j].id, randoms[i].id];
          await pg.query(
            `INSERT INTO co_occurrence (product_a_id, product_b_id, count, last_seen_at)
             VALUES ($1, $2, 5, now())
             ON CONFLICT DO NOTHING`,
            [lo, hi],
          );
        }
      }
      await recomputeNPMI(pg);

      // New user views one iPhone
      const newAnon = randomUUID();
      const newSession = randomUUID();
      await pg.query(`INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1)`, [newAnon]);
      const tNow = new Date().toISOString();
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
        [newAnon, newSession, tNow, JSON.stringify({ product_id: iPhone.id, source: "home" })],
      );
      await processEventForPersonalization(
        {
          anonymous_id: newAnon,
          user_id: null,
          session_id: newSession,
          event_type: "product_view",
          payload: { product_id: iPhone.id, source: "home" },
          occurred_at: tNow,
        },
        pg,
      );

      const feed = await generateFeed(
        { user_id: null, anonymous_id: newAnon, session_id: newSession, limit: 10 },
        pg,
      );
      const ids = feed.map((f) => f.product.id);
      expect(ids).toContain(funda.id);
    });
  }, 300_000);

  test("user with 25 events gets multi-modo and feed contains products from both modes", async () => {
    await withTestDb(async (pg) => {
      const formalIds: string[] = [];
      const casualIds: string[] = [];
      for (let i = 0; i < 8; i++) {
        formalIds.push(
          (await seedProductWithEmbedding(pg, {
            title: `Vestido formal elegante gala ${i}`,
            description: "vestido formal evento elegante",
            metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
          })).id,
        );
        casualIds.push(
          (await seedProductWithEmbedding(pg, {
            title: `Camiseta casual algodón ${i}`,
            description: "ropa casual diaria cómoda",
            metadata: { gender_target: "femenino", age_target: { min: 26, max: 59 } },
          })).id,
        );
      }
      await computeCohortCentroids(pg);

      const anonymous_id = randomUUID();
      const session_id = randomUUID();
      await pg.query(`INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1)`, [anonymous_id]);

      // 13 formal + 12 casual → n_events_in_mode = 23 (warmup eats 2) → 2 modes
      const all: string[] = [
        ...new Array(13).fill(0).map((_, i) => formalIds[i % 8]),
        ...new Array(12).fill(0).map((_, i) => casualIds[i % 8]),
      ];
      let idx = 0;
      for (const id of all) {
        const now = new Date(Date.now() + idx * 1000).toISOString();
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
        idx++;
      }

      const modesR = await pg.query(`SELECT count(*)::int AS c FROM user_profile_modes`);
      expect(modesR.rows[0].c).toBe(2);

      const feed = await generateFeed(
        { user_id: null, anonymous_id, session_id, limit: 10 },
        pg,
      );
      const ids = feed.map((f) => f.product.id);
      const fcount = ids.filter((id) => formalIds.includes(id)).length;
      const ccount = ids.filter((id) => casualIds.includes(id)).length;
      // Multi-modo retrieval should contain products from BOTH clusters
      expect(fcount).toBeGreaterThanOrEqual(2);
      expect(ccount).toBeGreaterThanOrEqual(2);
    });
  }, 360_000);
});
