// POST /auth/signout — cierra la sesión de Supabase (borra las cookies) y
// vuelve al inicio. POST a propósito: cerrar sesión muta estado.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
