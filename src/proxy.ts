import { NextResponse, type NextRequest } from "next/server";
import { auth0 } from "@/lib/auth";
import { ensureAnonymousId, ensureSession } from "@/sectors/a-tracking/identity";
import { getPgClient } from "@/lib/db/pg";

export async function proxy(req: NextRequest) {
  const res = NextResponse.next();

  // Identity layer: cookies + DB upserts on every request.
  const pg = await getPgClient({ scope: "public" });
  try {
    const anonymousId = await ensureAnonymousId(req, res, pg);
    // user_id is unknown at proxy time (Auth0 has not parsed yet) — pass null.
    // Identity merge happens later in /api/identity/merge.
    await ensureSession(req, res, pg, { anonymous_id: anonymousId, user_id: null });
  } finally {
    await pg.end();
  }

  // Auth0 wraps on top — attaches session if cookie present, doesn't enforce.
  const authRes = await auth0.middleware(req);
  // Merge cookies: copy any Set-Cookie from authRes onto our res.
  authRes.cookies.getAll().forEach((c) => res.cookies.set(c.name, c.value, c));
  // Forward auth0-owned responses: redirects (/auth/callback) and terminal
  // responses like /auth/profile (200 JSON, 401, 204) that must NOT fall
  // through to the Next.js page router.
  const pathname = req.nextUrl.pathname;
  if (
    authRes.status >= 300 ||
    pathname.startsWith("/auth/")
  ) {
    return authRes;
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/cron).*)"],
};
