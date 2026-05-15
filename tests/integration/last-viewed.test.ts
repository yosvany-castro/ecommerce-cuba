import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { fetchLastViewedProduct } from "@/sectors/d-personalization/retrieve/last-viewed";

beforeEach(async () => {
  await truncateTestTables(["events"]);
});

describe("fetchLastViewedProduct", () => {
  test("returns null when no product_view in session within window", async () => {
    await withTestDb(async (pg) => {
      const sid = randomUUID();
      const out = await fetchLastViewedProduct(sid, pg);
      expect(out).toBeNull();
    });
  });

  test("returns most recent product_view within window", async () => {
    await withTestDb(async (pg) => {
      const sid = randomUUID();
      const aid = randomUUID();
      const oldId = randomUUID();
      const newId = randomUUID();
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', now() - interval '20 minutes', $3::jsonb),
                ($1, $2, 'product_view', now() - interval '5 minutes', $4::jsonb)`,
        [
          aid,
          sid,
          JSON.stringify({ product_id: oldId, source: "home" }),
          JSON.stringify({ product_id: newId, source: "home" }),
        ],
      );
      const out = await fetchLastViewedProduct(sid, pg);
      expect(out).toBe(newId);
    });
  });

  test("ignores product_views older than 30 minutes", async () => {
    await withTestDb(async (pg) => {
      const sid = randomUUID();
      const aid = randomUUID();
      const old = randomUUID();
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', now() - interval '2 hours', $3::jsonb)`,
        [aid, sid, JSON.stringify({ product_id: old, source: "home" })],
      );
      const out = await fetchLastViewedProduct(sid, pg);
      expect(out).toBeNull();
    });
  });
});
