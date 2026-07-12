// scripts/seed-auth-user.ts — siembra (idempotente) el usuario de prueba de
// E2E en Supabase Auth usando el service role. Lee E2E_TEST_USER_EMAIL y
// E2E_TEST_USER_PASSWORD de .env.local. Uso: pnpm exec tsx scripts/seed-auth-user.ts
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

async function main() {
  dotenv.config({ path: ".env.local" });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.E2E_TEST_USER_EMAIL;
  const password = process.env.E2E_TEST_USER_PASSWORD;
  if (!url || !serviceKey || !email || !password) {
    console.error("[seed-auth-user] faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / E2E_TEST_USER_*");
    process.exit(1);
  }
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // sin paso de confirmación para el usuario de prueba
  });
  if (error) {
    if (/already.*registered|already exists/i.test(error.message)) {
      console.log(`[seed-auth-user] ya existe: ${email} — ok`);
      return;
    }
    console.error("[seed-auth-user] error:", error.message);
    process.exit(1);
  }
  console.log(`[seed-auth-user] creado: ${data.user?.email} (${data.user?.id})`);
}

main();
