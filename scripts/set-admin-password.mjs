// Fija la contraseña de un usuario Supabase SIN pasarla por argv ni por el
// historial: la pide interactivamente en TU terminal. Uso:
//   node scripts/set-admin-password.mjs [email]
// (default: chinok0307@gmail.com)
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";
import { readFileSync } from "node:fs";

// .env.local a mano (sin dotenv como dep del script)
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const email = process.argv[2] ?? "chinok0307@gmail.com";
const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = (await rl.question(`Nueva contraseña para ${email} (se ve al teclear, solo en TU terminal): `)).trim();
rl.close();
if (password.length < 8) {
  console.error("Muy corta (mínimo 8). Nada cambiado.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

// Buscar el usuario por email (paginado defensivo por si hay varios)
let userId = null;
for (let page = 1; page <= 10 && !userId; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) { console.error("listUsers falló:", error.message); process.exit(1); }
  userId = data.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase())?.id ?? null;
  if (data.users.length < 200) break;
}

if (!userId) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) { console.error("createUser falló:", error.message); process.exit(1); }
  console.log(`Usuario creado y contraseña fijada: ${email} (${data.user.id})`);
} else {
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) { console.error("updateUser falló:", error.message); process.exit(1); }
  console.log(`Contraseña actualizada para ${email} (${userId})`);
}
