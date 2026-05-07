import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { POST } from "@/app/api/identity/merge/route";

beforeEach(async () => {
  await truncateTestTables(["events", "anonymous_sessions", "users", "products"]);
});

function makeReq(cookies: Record<string, string> = {}): NextRequest {
  const headers = new Headers();
  const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (cookieStr) headers.set("cookie", cookieStr);
  return new NextRequest("http://localhost:3000/api/identity/merge", {
    method: "POST",
    headers,
  });
}

// We can't mock auth0 (banned). The "logged-in" path is exercised in E2E (Task 30).
// These tests cover the negative paths: no Auth0 session, no anonymous_id cookie.
describe("POST /api/identity/merge — no Auth0 session", () => {
  test("no session cookie → 401", async () => {
    const res = await POST(makeReq({ anonymous_id: randomUUID() }));
    expect(res.status).toBe(401);
  });

  test("missing anonymous_id cookie → 400", async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
  });
});
