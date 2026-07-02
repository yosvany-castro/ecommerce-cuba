import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import {
  ensureAnonymousId,
  ensureSession,
  ensureIdentityRows,
} from "@/sectors/a-tracking/identity";

beforeEach(async () => {
  await truncateTestTables(["anonymous_sessions", "events", "users"]);
});

function makeReq(cookies: Record<string, string> = {}, url = "http://localhost:3000/"): NextRequest {
  const headers = new Headers();
  const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (cookieStr) headers.set("cookie", cookieStr);
  return new NextRequest(url, { headers });
}

// F2: the proxy is COOKIE-ONLY (zero DB). Identity rows are born with the
// first tracked event via ensureIdentityRows on the track route's connection.

describe("ensureAnonymousId (cookie-only)", () => {
  test("first visit: generates uuid + Set-Cookie, NO database write", () => {
    const res = NextResponse.next();
    const id = ensureAnonymousId(makeReq(), res);

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const setCookie = res.cookies.get("anonymous_id");
    expect(setCookie?.value).toBe(id);
    expect(setCookie?.httpOnly).toBeFalsy(); // cliente debe poder leerla
    expect(setCookie?.sameSite).toBe("lax");
    expect(setCookie?.secure).toBe(true);
    expect(setCookie?.maxAge).toBe(365 * 24 * 60 * 60);
  });

  test("returning visit: existing cookie is preserved without re-setting", () => {
    const res1 = NextResponse.next();
    const id1 = ensureAnonymousId(makeReq(), res1);

    const res2 = NextResponse.next();
    const id2 = ensureAnonymousId(makeReq({ anonymous_id: id1 }), res2);
    expect(id2).toBe(id1);
    expect(res2.cookies.get("anonymous_id")).toBeUndefined();
  });

  test("malformed cookie value is replaced, not trusted", () => {
    const res = NextResponse.next();
    const id = ensureAnonymousId(makeReq({ anonymous_id: "not-a-uuid" }), res);
    expect(id).not.toBe("not-a-uuid");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.cookies.get("anonymous_id")?.value).toBe(id);
  });
});

describe("ensureSession (cookie-only)", () => {
  test("first call issues session cookie with sliding activity", () => {
    const res = NextResponse.next();
    const sid = ensureSession(makeReq(), res);

    expect(sid).toMatch(/^[0-9a-f-]{36}$/);
    const cookie = res.cookies.get("session_id");
    expect(cookie?.value).toBe(sid);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.maxAge).toBe(30 * 60);
    expect((res.cookies.get("session_last_activity")?.value ?? "").length).toBeGreaterThan(0);
  });

  test("returning within 30 min keeps the session_id; expired window rotates it", () => {
    const res1 = NextResponse.next();
    const sid = ensureSession(makeReq(), res1);

    const now = Math.floor(Date.now() / 1000);
    const sameSid = ensureSession(
      makeReq({ session_id: sid, session_last_activity: String(now) }),
      NextResponse.next(),
    );
    expect(sameSid).toBe(sid);

    const rotated = ensureSession(
      makeReq({ session_id: sid, session_last_activity: String(now - 31 * 60) }),
      NextResponse.next(),
    );
    expect(rotated).not.toBe(sid);
  });
});

describe("ensureIdentityRows (first-writer, on the track connection)", () => {
  test("creates the anonymous_sessions row and ONE session_start; idempotent on retries", async () => {
    await withTestDb(async (pg) => {
      const anonymous_id = randomUUID();
      const session_id = randomUUID();

      await ensureIdentityRows(pg, { anonymous_id, session_id, user_id: null });
      await ensureIdentityRows(pg, { anonymous_id, session_id, user_id: null });

      const anon = await pg.query(
        `SELECT count(*)::int AS c FROM anonymous_sessions WHERE anonymous_id = $1`,
        [anonymous_id],
      );
      expect(anon.rows[0].c).toBe(1);

      const starts = await pg.query(
        `SELECT count(*)::int AS c FROM events WHERE session_id = $1 AND event_type = 'session_start'`,
        [session_id],
      );
      expect(starts.rows[0].c).toBe(1);
    });
  });

  test("a NEW session of the same visitor gets its own session_start; last_seen_at advances", async () => {
    await withTestDb(async (pg) => {
      const anonymous_id = randomUUID();
      const s1 = randomUUID();
      const s2 = randomUUID();

      await ensureIdentityRows(pg, { anonymous_id, session_id: s1, user_id: null });
      const t1 = (
        await pg.query(`SELECT last_seen_at FROM anonymous_sessions WHERE anonymous_id=$1`, [anonymous_id])
      ).rows[0].last_seen_at;

      await new Promise((r) => setTimeout(r, 30));
      await ensureIdentityRows(pg, { anonymous_id, session_id: s2, user_id: null });

      const starts = await pg.query(
        `SELECT count(*)::int AS c FROM events WHERE anonymous_id = $1 AND event_type = 'session_start'`,
        [anonymous_id],
      );
      expect(starts.rows[0].c).toBe(2);

      const t2 = (
        await pg.query(`SELECT last_seen_at FROM anonymous_sessions WHERE anonymous_id=$1`, [anonymous_id])
      ).rows[0].last_seen_at;
      expect(new Date(t2).getTime()).toBeGreaterThan(new Date(t1).getTime());
    });
  });
});
