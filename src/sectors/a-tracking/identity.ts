import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import type { NextRequest, NextResponse } from "next/server";
import { insertEvent } from "./events/insert";

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

const SESSION_COOKIE = "session_id";
const SESSION_LAST_ACTIVITY_COOKIE = "session_last_activity";
const SESSION_TIMEOUT_SECONDS = 30 * 60;

export interface SessionCtx {
  anonymous_id: string;
  user_id: string | null;
}

export async function ensureSession(
  req: NextRequest,
  res: NextResponse,
  pg: Client,
  ctx: SessionCtx,
): Promise<string> {
  const existingSid = req.cookies.get(SESSION_COOKIE)?.value;
  const lastActivityRaw = req.cookies.get(SESSION_LAST_ACTIVITY_COOKIE)?.value;
  const lastActivity = lastActivityRaw ? Number(lastActivityRaw) : 0;
  const nowSec = Math.floor(Date.now() / 1000);

  let sid: string;
  let issueNew = false;
  let expiredOld: { sid: string; lastActivity: number } | null = null;

  if (
    existingSid &&
    UUID_REGEX.test(existingSid) &&
    Number.isFinite(lastActivity) &&
    nowSec - lastActivity <= SESSION_TIMEOUT_SECONDS
  ) {
    sid = existingSid;
  } else {
    if (existingSid && UUID_REGEX.test(existingSid) && Number.isFinite(lastActivity) && lastActivity > 0) {
      expiredOld = { sid: existingSid, lastActivity };
    }
    sid = randomUUID();
    issueNew = true;
  }

  if (expiredOld) {
    const durationMs = (nowSec - expiredOld.lastActivity) * 1000;
    await insertEvent(
      {
        event_type: "session_end",
        occurred_at: new Date(Date.now() - 1).toISOString(),
        payload: { duration_ms: durationMs },
      },
      { pg, anonymous_id: ctx.anonymous_id, session_id: expiredOld.sid, user_id: ctx.user_id },
    );
  }

  if (issueNew) {
    res.cookies.set(SESSION_COOKIE, sid, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TIMEOUT_SECONDS,
    });
    await insertEvent(
      {
        event_type: "session_start",
        occurred_at: new Date().toISOString(),
        payload: {},
      },
      { pg, anonymous_id: ctx.anonymous_id, session_id: sid, user_id: ctx.user_id },
    );
  }

  res.cookies.set(SESSION_LAST_ACTIVITY_COOKIE, String(nowSec), {
    httpOnly: false,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TIMEOUT_SECONDS,
  });

  return sid;
}
