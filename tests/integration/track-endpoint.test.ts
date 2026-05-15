import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { createAnonymousSession, seedProduct } from "@/../tests/helpers/seed";
import { POST } from "@/app/api/track/route";

beforeEach(async () => {
  await truncateTestTables(["events", "anonymous_sessions", "users", "products"]);
});

function makePostReq(body: unknown, cookies: Record<string, string> = {}): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (cookieStr) headers.set("cookie", cookieStr);
  return new NextRequest("http://localhost:3000/api/track", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/track", () => {
  test("happy path: persists product_view event with cookies as identity source", async () => {
    await withTestDb(async (pg) => {
      const product = await seedProduct(pg);
      const anonId = await createAnonymousSession(pg);
      const sessionId = randomUUID();
      const req = makePostReq(
        {
          event_type: "product_view",
          occurred_at: new Date().toISOString(),
          payload: { product_id: product.id, source: "home" },
        },
        { anonymous_id: anonId, session_id: sessionId },
      );

      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.event_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.deduped).toBe(false);

      const row = await pg.query(`SELECT * FROM events WHERE id=$1`, [body.event_id]);
      expect(row.rows[0].anonymous_id).toBe(anonId);
      expect(row.rows[0].session_id).toBe(sessionId);
      expect(row.rows[0].user_id).toBeNull();
    });
  });

  test("missing anonymous_id cookie → 400 no_identity", async () => {
    const req = makePostReq({
      event_type: "page_view",
      occurred_at: new Date().toISOString(),
      payload: { path: "/" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "no_identity" });
  });

  test("missing session_id cookie → 400 no_identity", async () => {
    const req = makePostReq(
      { event_type: "page_view", occurred_at: new Date().toISOString(), payload: { path: "/" } },
      { anonymous_id: randomUUID() },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "no_identity" });
  });

  test("malformed envelope (unknown event_type) → 400 invalid_input", async () => {
    const req = makePostReq(
      {
        event_type: "fake_type",
        occurred_at: new Date().toISOString(),
        payload: {},
      },
      { anonymous_id: randomUUID(), session_id: randomUUID() },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_input");
  });

  test("malformed payload (mismatched shape) → 400 invalid_payload", async () => {
    await withTestDb(async (pg) => {
      const anonId = await createAnonymousSession(pg);
      const req = makePostReq(
        {
          event_type: "product_view",
          occurred_at: new Date().toISOString(),
          payload: { source: "home" /* product_id missing */ },
        },
        { anonymous_id: anonId, session_id: randomUUID() },
      );
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_payload");
    });
  });

  test("idempotency: same client_event_id twice → 200 both, second deduped:true", async () => {
    await withTestDb(async (pg) => {
      const product = await seedProduct(pg);
      const anonId = await createAnonymousSession(pg);
      const ceid = randomUUID();
      const body = {
        client_event_id: ceid,
        event_type: "product_view" as const,
        occurred_at: new Date().toISOString(),
        payload: { product_id: product.id, source: "home" },
      };
      const cookies = { anonymous_id: anonId, session_id: randomUUID() };
      const r1 = await POST(makePostReq(body, cookies));
      const r2 = await POST(makePostReq(body, cookies));
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect((await r1.json()).deduped).toBe(false);
      expect((await r2.json()).deduped).toBe(true);
      const c = await pg.query(`SELECT count(*)::int FROM events WHERE client_event_id=$1`, [ceid]);
      expect(c.rows[0].count).toBe(1);
    });
  });
});
