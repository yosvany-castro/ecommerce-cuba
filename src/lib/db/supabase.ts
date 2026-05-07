import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Scope = "public" | "test";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!url || !anonKey) {
  throw new Error("Supabase env vars missing (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)");
}

// The Supabase dashboard exposes test_schema as "test" in the API.
// Direct pg connections use the full schema name "test_schema".
// The "test" schema tables are only accessible with the service role key (no anon grants).
const SUPABASE_SCHEMA_ALIAS: Record<Scope, string> = {
  public: "public",
  test: "test",
};

export function getSupabaseClient(opts: { scope?: Scope; admin?: boolean } = {}): SupabaseClient {
  const { scope = "public", admin = false } = opts;
  // "test" scope requires service role because the test schema has no anon grants
  const needsAdmin = admin || scope === "test";
  const key = needsAdmin ? serviceKey : anonKey;
  if (needsAdmin && !serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY required for admin or test-scope client");
  return createClient(url, key, {
    db: { schema: SUPABASE_SCHEMA_ALIAS[scope] as never },
    auth: { persistSession: false },
  });
}
