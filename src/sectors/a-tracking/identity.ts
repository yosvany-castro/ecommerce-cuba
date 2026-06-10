import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import type { NextRequest, NextResponse } from "next/server";

/**
 * Identity layer (PageSlate foundation F2).
 *
 * COOKIE-ONLY in the request path: the proxy issues/refreshes cookies with
 * ZERO database work. Before this, every navigation opened a connection and
 * ran 2+ serial upserts BEFORE rendering (~200-400ms of TTFB on every page,
 * and the single biggest resilience hole: the whole site depended on the DB
 * answering before any HTML could move).
 *
 * The FIRST WRITER is /api/track (`ensureIdentityRows`): identity rows are
 * born with the first tracked event. A visitor who bounces without
 * interacting costs ZERO writes. Consequences, by design:
 *  - `anonymous_sessions.last_seen_at` advances on tracked events only
 *    (active-visitor metrics derive from `events`, not from pageviews);
 *  - `session_start` is synthesized with the first event of each session;
 *    `session_end` is no longer emitted — derive duration offline as
 *    max(occurred_at) - min(occurred_at) per session_id.
 */

const ANON_COOKIE = "anonymous_id";
const ANON_TTL_SECONDS = 365 * 24 * 60 * 60;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Issue or preserve the anonymous_id cookie. Pure cookie logic — no DB. */
export function ensureAnonymousId(req: NextRequest, res: NextResponse): string {
  const existing = req.cookies.get(ANON_COOKIE)?.value;
  if (existing && UUID_REGEX.test(existing)) return existing;

  const id = randomUUID();
  res.cookies.set(ANON_COOKIE, id, {
    httpOnly: false, // client JS reads it (CartProvider, tracking)
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ANON_TTL_SECONDS,
  });
  return id;
}

const SESSION_COOKIE = "session_id";
const SESSION_LAST_ACTIVITY_COOKIE = "session_last_activity";
const SESSION_TIMEOUT_SECONDS = 30 * 60;

/** Issue or slide the session cookies. Pure cookie logic — no DB, no events. */
export function ensureSession(req: NextRequest, res: NextResponse): string {
  const existingSid = req.cookies.get(SESSION_COOKIE)?.value;
  const lastActivityRaw = req.cookies.get(SESSION_LAST_ACTIVITY_COOKIE)?.value;
  const lastActivity = lastActivityRaw ? Number(lastActivityRaw) : 0;
  const nowSec = Math.floor(Date.now() / 1000);

  let sid: string;
  if (
    existingSid &&
    UUID_REGEX.test(existingSid) &&
    Number.isFinite(lastActivity) &&
    nowSec - lastActivity <= SESSION_TIMEOUT_SECONDS
  ) {
    sid = existingSid;
  } else {
    sid = randomUUID();
    res.cookies.set(SESSION_COOKIE, sid, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TIMEOUT_SECONDS,
    });
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

export interface IdentityCtx {
  anonymous_id: string;
  session_id: string;
  user_id: string | null;
}

/**
 * First-writer: called by /api/track on every event POST, on the SAME pooled
 * connection as the event insert. Idempotent and cheap:
 *  - upserts the anonymous_sessions row (last_seen_at = now());
 *  - synthesizes ONE session_start event per session (first tracked event
 *    wins; the anti-join makes retries and races no-ops).
 */
export async function ensureIdentityRows(pg: Client, ctx: IdentityCtx): Promise<void> {
  await pg.query(
    `INSERT INTO anonymous_sessions (anonymous_id, last_seen_at)
     VALUES ($1, now())
     ON CONFLICT (anonymous_id) DO UPDATE SET last_seen_at = now()`,
    [ctx.anonymous_id],
  );
  await pg.query(
    `INSERT INTO events (anonymous_id, user_id, session_id, event_type, occurred_at, payload, source)
     SELECT $1, $2, $3, 'session_start', now(), '{}'::jsonb, 'server'
     WHERE NOT EXISTS (
       SELECT 1 FROM events WHERE session_id = $3 AND event_type = 'session_start'
     )`,
    [ctx.anonymous_id, ctx.user_id, ctx.session_id],
  );
}
