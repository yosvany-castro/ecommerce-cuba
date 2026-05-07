import { describe, test, expect, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { ensureAnonymousId } from "@/sectors/a-tracking/identity";

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
