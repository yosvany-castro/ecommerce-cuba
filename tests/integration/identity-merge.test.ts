import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { createUser, createAnonymousSession, seedProduct } from "@/../tests/helpers/seed";
import { insertEvent } from "@/sectors/a-tracking/events/insert";
import { mergeIdentities } from "@/sectors/a-tracking/events/merge";

beforeEach(async () => {
  await truncateTestTables(["events", "anonymous_sessions", "users", "products"]);
});

describe("mergeIdentities", () => {
  test("associates all anonymous events to user_id and updates anonymous_sessions", async () => {
    await withTestDb(async (pg) => {
      const product = await seedProduct(pg);
      const anonId = await createAnonymousSession(pg);
      const sessionId = randomUUID();

      const events = [
        { event_type: "product_view" as const, payload: { product_id: product.id, source: "home" } },
        { event_type: "add_to_cart" as const, payload: { product_id: product.id, quantity: 1 } },
        { event_type: "page_view" as const, payload: { path: "/" } },
      ];
      for (const e of events) {
        await insertEvent(
          { ...e, occurred_at: new Date().toISOString() },
          { pg, anonymous_id: anonId, session_id: sessionId, user_id: null },
        );
      }

      const user = await createUser(pg);
      const result = await mergeIdentities(anonId, user.id, pg);
      expect(result.events_merged).toBe(3);

      const after = await pg.query(`SELECT user_id FROM events WHERE anonymous_id = $1`, [anonId]);
      expect(after.rows).toHaveLength(3);
      expect(after.rows.every((r: { user_id: string }) => r.user_id === user.id)).toBe(true);

      const sess = await pg.query(`SELECT user_id FROM anonymous_sessions WHERE anonymous_id = $1`, [anonId]);
      expect(sess.rows[0].user_id).toBe(user.id);
    });
  });

  test("idempotent: second call merges 0 additional events", async () => {
    await withTestDb(async (pg) => {
      const product = await seedProduct(pg);
      const anonId = await createAnonymousSession(pg);
      const sessionId = randomUUID();
      await insertEvent(
        { event_type: "product_view", occurred_at: new Date().toISOString(), payload: { product_id: product.id, source: "home" } },
        { pg, anonymous_id: anonId, session_id: sessionId, user_id: null },
      );
      const user = await createUser(pg);
      const r1 = await mergeIdentities(anonId, user.id, pg);
      const r2 = await mergeIdentities(anonId, user.id, pg);
      expect(r1.events_merged).toBe(1);
      expect(r2.events_merged).toBe(0);
    });
  });

  test("does NOT overwrite events of a DIFFERENT user (caches the WHERE user_id IS NULL guard)", async () => {
    await withTestDb(async (pg) => {
      const product = await seedProduct(pg);
      const userA = await createUser(pg, { email: "a@x.com" });
      const userB = await createUser(pg, { email: "b@x.com" });

      const anon1 = await createAnonymousSession(pg);
      await insertEvent(
        { event_type: "page_view", occurred_at: new Date().toISOString(), payload: { path: "/anon1" } },
        { pg, anonymous_id: anon1, session_id: randomUUID(), user_id: null },
      );
      await mergeIdentities(anon1, userA.id, pg);

      const anon2 = await createAnonymousSession(pg);
      await insertEvent(
        { event_type: "page_view", occurred_at: new Date().toISOString(), payload: { path: "/anon2" } },
        { pg, anonymous_id: anon2, session_id: randomUUID(), user_id: null },
      );
      await mergeIdentities(anon2, userB.id, pg);

      // Now imagine an attacker triggers mergeIdentities(anon1, userB) — should NOT touch
      // events of anon1 (already user_id=A, WHERE user_id IS NULL filters them out).
      const r = await mergeIdentities(anon1, userB.id, pg);
      expect(r.events_merged).toBe(0);

      const ev = await pg.query(`SELECT anonymous_id, user_id FROM events ORDER BY anonymous_id`);
      const byAnon = Object.fromEntries(ev.rows.map((r: { anonymous_id: string; user_id: string }) => [r.anonymous_id, r.user_id]));
      expect(byAnon[anon1]).toBe(userA.id);
      expect(byAnon[anon2]).toBe(userB.id);
    });
  });
});
