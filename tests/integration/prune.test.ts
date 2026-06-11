import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { pruneOldData } from "@/sectors/d-personalization/prune";

beforeEach(async () => {
  await truncateTestTables(["feed_impressions", "slate_decisions", "feed_slates"]);
});

describe("pruneOldData (F4)", () => {
  test("borra >90d y slates expirados >1d; lo reciente queda intacto", async () => {
    await withTestDb(async (pg) => {
      const mk = (days: number) =>
        pg.query(
          `INSERT INTO feed_impressions (feed_request_id, session_id, position, product_id, source, propensity, served_at)
           VALUES ($1, $2, 1, $3, 'exploit', 0.9, now() - make_interval(days => $4))`,
          [randomUUID(), randomUUID(), randomUUID(), days],
        );
      await mk(120); // poda
      await mk(10); // queda
      await pg.query(
        `INSERT INTO feed_slates (slate_id, session_id, items, expires_at)
         VALUES ($1, $2, '[]'::jsonb, now() - interval '3 days')`,
        [randomUUID(), randomUUID()],
      );
      await pg.query(
        `INSERT INTO feed_slates (slate_id, session_id, items, expires_at)
         VALUES ($1, $2, '[]'::jsonb, now() + interval '300 seconds')`,
        [randomUUID(), randomUUID()],
      );

      const r = await pruneOldData(pg);
      expect(r.impressions).toBe(1);
      expect(r.slates).toBe(1);
      expect((await pg.query(`SELECT count(*)::int AS c FROM feed_impressions`)).rows[0].c).toBe(1);
      expect((await pg.query(`SELECT count(*)::int AS c FROM feed_slates`)).rows[0].c).toBe(1);
    });
  });
});
