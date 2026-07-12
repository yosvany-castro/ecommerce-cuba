import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ensureAnonymousId, ensureSession } from "@/sectors/a-tracking/identity";

/**
 * Request proxy (PageSlate foundation F2): COOKIE-ONLY identity + refresh de
 * sesión de Supabase Auth. ZERO database work here — the site renders even
 * with the DB down. Identity rows are created by the first tracked event.
 *
 * REFRESH DE COOKIE (patrón oficial @supabase/ssr): los Server Components no
 * pueden escribir cookies, así que si el access token expiró, ESTE es el único
 * lugar que puede refrescarlo y persistirlo (getClaims() dispara el refresh y
 * setAll escribe el token nuevo en request y response). Sin esto, el refresh
 * token se consumiría sin guardarse → usuarios deslogueados al azar.
 *
 * A DIFERENCIA del ejemplo oficial: NO se redirige a /login cuando no hay
 * usuario — este sitio es anonymous-first (carrito, checkout y personalización
 * funcionan sin cuenta); las páginas admin se protegen solas.
 */
export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
          // headers anti-caché (2º arg del setAll actual): que ningún CDN
          // cachee una respuesta que lleva Set-Cookie de sesión.
          Object.entries(headers ?? {}).forEach(([k, v]) => res.headers.set(k, v as string));
        },
      },
    },
  );

  // No correr código entre createServerClient y getClaims() (regla oficial).
  // getClaims valida la firma del JWT y refresca el token si expiró.
  await supabase.auth.getClaims();

  // Identidad anónima DESPUÉS del refresh: si setAll re-creó `res`, las
  // cookies anónimas se aplican sobre la respuesta final (una sola vez —
  // re-ejecutarlas antes generaría uuids distintos).
  ensureAnonymousId(req, res);
  ensureSession(req, res);

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/cron).*)"],
};
