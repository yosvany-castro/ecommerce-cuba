// /auth/confirm — verificación por token_hash (patrón oficial): lo usan los
// enlaces de email cuando las plantillas del dashboard se editan al formato
// recomendado: {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email|recovery&next=…
// Verifica el token, deja la sesión en cookies y redirige a `next`.
import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  let next = searchParams.get("next") ?? "/";
  if (!next.startsWith("/") || next.startsWith("//")) next = "/";

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?error=enlace_invalido`);
}
