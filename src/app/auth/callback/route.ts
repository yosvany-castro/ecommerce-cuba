// /auth/callback — canje de código PKCE (patrón oficial de los docs de
// Supabase): Google OAuth, y también los enlaces de email con plantillas
// default ({{ .ConfirmationURL }} redirige aquí con ?code=). Deja la sesión
// en cookies y redirige a `next`.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  let next = searchParams.get("next") ?? "/";
  if (!next.startsWith("/") || next.startsWith("//")) next = "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Detrás de proxy inverso en producción, respeta el host reenviado.
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocal = process.env.NODE_ENV === "development";
      if (!isLocal && forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=enlace_invalido`);
}
