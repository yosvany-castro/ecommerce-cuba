import { NextResponse, type NextRequest } from "next/server";
import { auth0 } from "@/lib/auth";
import { ensureAnonymousId, ensureSession } from "@/sectors/a-tracking/identity";

/**
 * Request proxy (PageSlate foundation F2): COOKIE-ONLY identity + Auth0.
 * ZERO database work here — the site renders even with the DB down, and no
 * navigation pays connection/upsert latency. Identity rows are created by the
 * first tracked event (/api/track → ensureIdentityRows).
 */
export async function proxy(req: NextRequest) {
  const res = NextResponse.next();

  ensureAnonymousId(req, res);
  ensureSession(req, res);

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
