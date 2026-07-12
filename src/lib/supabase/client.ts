"use client";
// Cliente de Supabase para el BROWSER (páginas de auth, IdentityMergeOnLogin).
// createBrowserClient es singleton: N llamadas devuelven la misma instancia.
// Escribe la sesión en cookies (sb-<ref>-auth-token) legibles por el server.
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
