/**
 * Supabase JS client for app code (server components, route handlers).
 * For test_schema access in integration tests, prefer getPgClient() — the REST
 * API only exposes schemas configured in the Supabase dashboard, while pg client
 * goes direct to Postgres and respects any schema in search_path.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Scope = "public" | "test";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!url || !anonKey) {
  throw new Error("Supabase env vars missing (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)");
}

export function getSupabaseClient(opts: { scope?: Scope; admin?: boolean } = {}): SupabaseClient {
  const { scope = "public", admin = false } = opts;
  if (scope === "test") {
    throw new Error(
      "getSupabaseClient({ scope: 'test' }) is not supported: the Supabase REST API " +
      "only exposes schemas configured in the dashboard (public by default). " +
      "For integration tests against test_schema, use getPgClient({ scope: 'test' }) instead."
    );
  }
  const key = admin ? serviceKey : anonKey;
  if (admin && !serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY required for admin client");
  return createClient(url, key, {
    db: { schema: "public" },
    auth: { persistSession: false },
  });
}
