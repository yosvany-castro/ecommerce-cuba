import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { buildProfileSummary } from "@/sectors/d-personalization/reranker/profile-summary";

beforeEach(async () => {
  await truncateTestTables(["events", "user_profiles", "products"]);
});

describe("buildProfileSummary", () => {
  test("includes cohort human label + 'sin destinatario' when recipient null", async () => {
    await withTestDb(async (pg) => {
      const upR = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events)
         VALUES ($1, 0) RETURNING id::text`,
        [randomUUID()],
      );
      const summary = await buildProfileSummary(
        upR.rows[0].id,
        null,
        "femenino_adulta",
        pg,
      );
      expect(summary).toContain("mujer adulta");
      expect(summary.toLowerCase()).toContain("sin destinatario");
    });
  });

  test("includes top-3 categories when events present", async () => {
    await withTestDb(async (pg) => {
      const anonymous_id = randomUUID();
      const upR = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events)
         VALUES ($1, 0) RETURNING id::text`,
        [anonymous_id],
      );
      const profile_id = upR.rows[0].id;
      const p1 = await seedProductWithEmbedding(pg, {
        title: "Vestido",
        metadata: { category: "ropa" },
      });
      for (let i = 0; i < 3; i++) {
        await pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, 'product_view', now(), $3::jsonb)`,
          [
            anonymous_id,
            randomUUID(),
            JSON.stringify({ product_id: p1.id, source: "home" }),
          ],
        );
      }
      const summary = await buildProfileSummary(
        profile_id,
        null,
        "femenino_adulta",
        pg,
      );
      expect(summary.toLowerCase()).toContain("ropa");
    });
  });

  test("uses recipient phrase when recipient_id present", async () => {
    await withTestDb(async (pg) => {
      const upR = await pg.query(
        `INSERT INTO user_profiles (anonymous_id, n_events)
         VALUES ($1, 0) RETURNING id::text`,
        [randomUUID()],
      );
      const summary = await buildProfileSummary(
        upR.rows[0].id,
        randomUUID(),
        "masculino_nino",
        pg,
      );
      expect(summary.toLowerCase()).toContain("destinatario espec");
      expect(summary).toContain("niño");
    });
  });
});
