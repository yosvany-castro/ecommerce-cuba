import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import type { NextRequest, NextResponse } from "next/server";

const ANON_COOKIE = "anonymous_id";
const ANON_TTL_SECONDS = 365 * 24 * 60 * 60;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function ensureAnonymousId(
  req: NextRequest,
  res: NextResponse,
  pg: Client,
): Promise<string> {
  const existing = req.cookies.get(ANON_COOKIE)?.value;
  let id: string;
  let issuedNew = false;

  if (existing && UUID_REGEX.test(existing)) {
    id = existing;
  } else {
    id = randomUUID();
    issuedNew = true;
  }

  if (issuedNew) {
    res.cookies.set(ANON_COOKIE, id, {
      httpOnly: false,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: ANON_TTL_SECONDS,
    });
  }

  await pg.query(
    `INSERT INTO anonymous_sessions (anonymous_id, last_seen_at)
     VALUES ($1, now())
     ON CONFLICT (anonymous_id) DO UPDATE SET last_seen_at = now()`,
    [id],
  );

  return id;
}
