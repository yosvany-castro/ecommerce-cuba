import { describe, test, expect, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { ensureAnonymousId, ensureSession } from "@/sectors/a-tracking/identity";

beforeEach(async () => {
  await truncateTestTables(["anonymous_sessions", "events", "users"]);
});

function makeReq(cookies: Record<string, string> = {}, url = "http://localhost:3000/"): NextRequest {
  const headers = new Headers();
  const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (cookieStr) headers.set("cookie", cookieStr);
  return new NextRequest(url, { headers });
}

describe("ensureAnonymousId", () => {
  test("first visit: generates uuid + Set-Cookie + persists in anonymous_sessions", async () => {
    await withTestDb(async (pg) => {
      const req = makeReq();
      const res = NextResponse.next();

      const id = await ensureAnonymousId(req, res, pg);

      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      const setCookie = res.cookies.get("anonymous_id");
      expect(setCookie?.value).toBe(id);
      expect(setCookie?.httpOnly).toBeFalsy();   // cliente debe poder leerla
      expect(setCookie?.sameSite).toBe("lax");
      expect(setCookie?.secure).toBe(true);
      expect(setCookie?.maxAge).toBe(365 * 24 * 60 * 60);

      const row = await pg.query(`SELECT count(*)::int FROM anonymous_sessions WHERE anonymous_id = $1`, [id]);
      expect(row.rows[0].count).toBe(1);
    });
  });

  test("returning visit: existing cookie is preserved, last_seen_at advances", async () => {
    await withTestDb(async (pg) => {
      const req1 = makeReq();
      const res1 = NextResponse.next();
      const id1 = await ensureAnonymousId(req1, res1, pg);
      const t1 = (await pg.query(`SELECT last_seen_at FROM anonymous_sessions WHERE anonymous_id=$1`, [id1])).rows[0].last_seen_at;

      await new Promise((r) => setTimeout(r, 30));

      const req2 = makeReq({ anonymous_id: id1 });
      const res2 = NextResponse.next();
      const id2 = await ensureAnonymousId(req2, res2, pg);
      expect(id2).toBe(id1);
      expect(res2.cookies.get("anonymous_id")).toBeUndefined();

      const t2 = (await pg.query(`SELECT last_seen_at FROM anonymous_sessions WHERE anonymous_id=$1`, [id1])).rows[0].last_seen_at;
      expect(new Date(t2).getTime()).toBeGreaterThan(new Date(t1).getTime());
    });
  });

  test("two distinct first visits produce two distinct uuids and two rows", async () => {
    await withTestDb(async (pg) => {
      const id1 = await ensureAnonymousId(makeReq(), NextResponse.next(), pg);
      const id2 = await ensureAnonymousId(makeReq(), NextResponse.next(), pg);
      expect(id1).not.toBe(id2);
      const r = await pg.query(`SELECT count(*)::int FROM anonymous_sessions`);
      expect(r.rows[0].count).toBe(2);
    });
  });

  test("malformed cookie value is replaced, not trusted", async () => {
    await withTestDb(async (pg) => {
      const req = makeReq({ anonymous_id: "not-a-uuid" });
      const res = NextResponse.next();
      const id = await ensureAnonymousId(req, res, pg);
      expect(id).not.toBe("not-a-uuid");
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.cookies.get("anonymous_id")?.value).toBe(id);
    });
  });
});

describe("ensureSession", () => {
  test("first call generates session_id and emits session_start event", async () => {
    await withTestDb(async (pg) => {
      const req = makeReq();
      const res = NextResponse.next();
      const anonId = await ensureAnonymousId(req, res, pg);

      const sessionId = await ensureSession(req, res, pg, { anonymous_id: anonId, user_id: null });

      expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
      const cookie = res.cookies.get("session_id");
      expect(cookie?.value).toBe(sessionId);
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.maxAge).toBe(30 * 60);

      const events = await pg.query(
        `SELECT event_type, payload FROM events WHERE anonymous_id = $1 ORDER BY occurred_at`,
        [anonId],
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0].event_type).toBe("session_start");
      expect(events.rows[0].payload).toEqual({});
    });
  });

  test("returning within 30 min: same session_id, no new session_start", async () => {
    await withTestDb(async (pg) => {
      const req1 = makeReq();
      const res1 = NextResponse.next();
      const anonId = await ensureAnonymousId(req1, res1, pg);
      const sid = await ensureSession(req1, res1, pg, { anonymous_id: anonId, user_id: null });

      const now = Math.floor(Date.now() / 1000);
      const req2 = makeReq({
        anonymous_id: anonId,
        session_id: sid,
        session_last_activity: String(now),
      });
      const res2 = NextResponse.next();
      const sid2 = await ensureSession(req2, res2, pg, { anonymous_id: anonId, user_id: null });
      expect(sid2).toBe(sid);

      const events = await pg.query(
        `SELECT count(*)::int AS c FROM events WHERE anonymous_id=$1 AND event_type='session_start'`,
        [anonId],
      );
      expect(events.rows[0].c).toBe(1);
    });
  });

  test("expired (>30 min idle): emits session_end for old + session_start for new + new session_id", async () => {
    await withTestDb(async (pg) => {
      const req1 = makeReq();
      const res1 = NextResponse.next();
      const anonId = await ensureAnonymousId(req1, res1, pg);
      const oldSid = await ensureSession(req1, res1, pg, { anonymous_id: anonId, user_id: null });

      const stale = Math.floor(Date.now() / 1000) - 31 * 60;
      const req2 = makeReq({
        anonymous_id: anonId,
        session_id: oldSid,
        session_last_activity: String(stale),
      });
      const res2 = NextResponse.next();
      const newSid = await ensureSession(req2, res2, pg, { anonymous_id: anonId, user_id: null });
      expect(newSid).not.toBe(oldSid);

      const events = await pg.query(
        `SELECT event_type, session_id FROM events WHERE anonymous_id=$1 ORDER BY occurred_at`,
        [anonId],
      );
      expect(events.rows.map((r: { event_type: string }) => r.event_type)).toEqual(["session_start", "session_end", "session_start"]);
      expect(events.rows[1].session_id).toBe(oldSid);
      expect(events.rows[2].session_id).toBe(newSid);
    });
  });

  test("each call refreshes session_last_activity cookie (sliding window)", async () => {
    await withTestDb(async (pg) => {
      const req1 = makeReq();
      const res1 = NextResponse.next();
      const anonId = await ensureAnonymousId(req1, res1, pg);
      await ensureSession(req1, res1, pg, { anonymous_id: anonId, user_id: null });

      const cookie = res1.cookies.get("session_last_activity");
      expect(Number(cookie?.value)).toBeGreaterThan(Math.floor(Date.now() / 1000) - 5);
      expect(cookie?.maxAge).toBe(30 * 60);
    });
  });
});
