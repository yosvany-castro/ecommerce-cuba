import { Auth0Client } from "@auth0/nextjs-auth0/server";
import type { Client } from "pg";

export const auth0 = new Auth0Client({
  domain: process.env.AUTH0_DOMAIN!,
  clientId: process.env.AUTH0_CLIENT_ID!,
  clientSecret: process.env.AUTH0_CLIENT_SECRET!,
  appBaseUrl: process.env.APP_BASE_URL!,
  secret: process.env.AUTH0_SECRET!,
});

/**
 * Looks up or creates a `users` row by `auth0_sub`. Returns the user id.
 * Idempotent: running twice with the same sub returns the same id.
 */
export async function getOrCreateUserByAuth0Sub(
  pg: Client,
  auth0Sub: string,
  email: string,
  name: string | null = null,
): Promise<{ id: string }> {
  const r = await pg.query(
    `INSERT INTO users (auth0_sub, email, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (auth0_sub) DO UPDATE SET email = EXCLUDED.email, name = COALESCE(EXCLUDED.name, users.name)
     RETURNING id`,
    [auth0Sub, email, name],
  );
  return { id: r.rows[0].id };
}

/**
 * Admin gate (PageSlate foundation F3). Until now every /admin page and
 * /api/admin route only checked that an Auth0 session EXISTED — any logged-in
 * user could read admin surfaces, and any future placement write-path would
 * have been stored-UI injection for all users.
 *
 * Allowlist via ADMIN_EMAILS (comma-separated, case-insensitive). Empty or
 * unset ⇒ NOBODY is admin (fail-closed).
 *
 * Returns the admin's email, or null when the caller is not an admin
 * (callers decide redirect vs 401/403 per surface).
 */
export function isAdminEmail(
  email: string | null | undefined,
  rawAllowlist: string | undefined,
): boolean {
  const allowlist = (rawAllowlist ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length === 0) return false; // fail-closed: sin lista no hay admins
  if (!email) return false;
  return allowlist.includes(email.trim().toLowerCase());
}

export async function requireAdmin(req?: Request): Promise<string | null> {
  const session = req
    ? await auth0.getSession(req as never).catch(() => null)
    : await auth0.getSession().catch(() => null);
  const email = (session?.user?.email as string | undefined) ?? null;
  return isAdminEmail(email, process.env.ADMIN_EMAILS) ? email!.trim().toLowerCase() : null;
}
