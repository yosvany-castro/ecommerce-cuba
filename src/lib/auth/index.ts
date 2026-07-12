import type { Client } from "pg";
import { createClient } from "@/lib/supabase/server";

/**
 * Identidad autenticada vía Supabase Auth (migrado de Auth0 el 2026-07-12).
 * public.users sigue siendo la fuente del user_id INTERNO (uuid propio, FKs
 * de orders/events/profiles intactas); auth.users de Supabase solo aporta el
 * sub (uuid externo) que se guarda en users.auth_sub como clave de lookup —
 * exactamente el mismo rol que cumplía el sub de Auth0.
 */

export interface AuthUser {
  sub: string;
  email: string | null;
  name: string | null;
}

/**
 * Usuario autenticado del request actual, o null. Usa getClaims(): valida la
 * firma del JWT localmente (sin viaje al Auth server) — la regla oficial es
 * NUNCA confiar en getSession() en server; el refresh real lo hace el proxy.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (!claims?.sub) return null;
    return {
      sub: claims.sub,
      email: (claims.email as string | undefined) ?? null,
      name: ((claims.user_metadata as { full_name?: string; name?: string } | undefined)?.full_name ??
        (claims.user_metadata as { name?: string } | undefined)?.name ??
        null),
    };
  } catch {
    return null; // sin sesión / cookies inválidas: anónimo
  }
}

/**
 * Looks up or creates a `users` row by `auth_sub`. Returns the user id.
 * Idempotent. Si el email ya existe con otro sub (usuario de la era Auth0, o
 * demo del checkout anónimo que luego se registra), CLAIM de esa fila: se le
 * asigna el sub nuevo y conserva su historial (orders/events por users.id).
 */
export async function getOrCreateUserBySub(
  pg: Client,
  sub: string,
  email: string,
  name: string | null = null,
): Promise<{ id: string }> {
  try {
    const r = await pg.query(
      `INSERT INTO users (auth_sub, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (auth_sub) DO UPDATE SET email = EXCLUDED.email, name = COALESCE(EXCLUDED.name, users.name)
       RETURNING id`,
      [sub, email, name],
    );
    return { id: r.rows[0].id };
  } catch (e) {
    if ((e as { code?: string }).code !== "23505") throw e; // solo unique_violation de email
    const claimed = await pg.query(
      `UPDATE users SET auth_sub = $1, name = COALESCE($3, name) WHERE email = $2 RETURNING id`,
      [sub, email, name],
    );
    if (claimed.rows.length === 0) throw e;
    return { id: claimed.rows[0].id };
  }
}

/**
 * Admin gate (PageSlate foundation F3). Allowlist via ADMIN_EMAILS
 * (comma-separated, case-insensitive). Empty or unset ⇒ NOBODY is admin
 * (fail-closed). Returns the admin's email, or null.
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

/** El param req se conserva por compatibilidad de firma (los route handlers lo
 * pasaban para Auth0); con Supabase las cookies llegan por el request context. */
export async function requireAdmin(_req?: Request): Promise<string | null> {
  const user = await getAuthUser();
  const email = user?.email ?? null;
  return isAdminEmail(email, process.env.ADMIN_EMAILS) ? email!.trim().toLowerCase() : null;
}
