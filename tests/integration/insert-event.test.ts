import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { createUser, createAnonymousSession, seedProduct } from "@/../tests/helpers/seed";
import { insertEvent } from "@/sectors/a-tracking/events/insert";

beforeEach(async () => {
  await truncateTestTables(["events", "anonymous_sessions", "users", "products"]);
});

describe("insertEvent", () => {
  test("inserts a product_view event with all required columns populated", async () => {
    await withTestDb(async (pg) => {
      const product = await seedProduct(pg);
      const anonId = await createAnonymousSession(pg);
      const sessionId = randomUUID();
      const occurredAt = new Date().toISOString();

      const result = await insertEvent(
        {
          event_type: "product_view",
          occurred_at: occurredAt,
          payload: { product_id: product.id, source: "home" },
        },
        { pg, anonymous_id: anonId, session_id: sessionId, user_id: null },
      );

      expect(result.deduped).toBe(false);
      expect(result.event_id).toMatch(/^[0-9a-f-]{36}$/);

      const row = await pg.query(
        `SELECT anonymous_id, user_id, session_id, event_type, occurred_at, payload, client_event_id
         FROM events WHERE id = $1`,
        [result.event_id],
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0].anonymous_id).toBe(anonId);
      expect(row.rows[0].user_id).toBeNull();
      expect(row.rows[0].session_id).toBe(sessionId);
      expect(row.rows[0].event_type).toBe("product_view");
      expect(row.rows[0].payload).toEqual({ product_id: product.id, source: "home" });
      expect(row.rows[0].client_event_id).toBeNull();
    });
  });

  test("attaches user_id when ctx provides one", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      const anonId = await createAnonymousSession(pg);
      const result = await insertEvent(
        {
          event_type: "page_view",
          occurred_at: new Date().toISOString(),
          payload: { path: "/" },
        },
        { pg, anonymous_id: anonId, session_id: randomUUID(), user_id: user.id },
      );
      const row = await pg.query(`SELECT user_id FROM events WHERE id = $1`, [result.event_id]);
      expect(row.rows[0].user_id).toBe(user.id);
    });
  });

  test("idempotency: same client_event_id twice → 1 row, second result.deduped=true", async () => {
    await withTestDb(async (pg) => {
      const anonId = await createAnonymousSession(pg);
      const sessionId = randomUUID();
      const ceid = randomUUID();
      const input = {
        client_event_id: ceid,
        event_type: "page_view" as const,
        occurred_at: new Date().toISOString(),
        payload: { path: "/" },
      };
      const ctx = { pg, anonymous_id: anonId, session_id: sessionId, user_id: null };
      const r1 = await insertEvent(input, ctx);
      const r2 = await insertEvent(input, ctx);
      expect(r1.deduped).toBe(false);
      expect(r2.deduped).toBe(true);
      expect(r2.event_id).toBeNull();
      const count = await pg.query(`SELECT count(*)::int FROM events WHERE client_event_id = $1`, [ceid]);
      expect(count.rows[0].count).toBe(1);
    });
  });

  test("rejects payload that does not match the event_type schema", async () => {
    await withTestDb(async (pg) => {
      const anonId = await createAnonymousSession(pg);
      await expect(
        insertEvent(
          {
            event_type: "product_view",
            occurred_at: new Date().toISOString(),
            payload: { /* missing product_id and source */ },
          },
          { pg, anonymous_id: anonId, session_id: randomUUID(), user_id: null },
        ),
      ).rejects.toThrow();
    });
  });
});
