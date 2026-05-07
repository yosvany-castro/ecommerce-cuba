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
