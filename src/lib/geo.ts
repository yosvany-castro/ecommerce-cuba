// src/lib/geo.ts — país del visitante por IP. Vercel lo resuelve gratis en el
// edge y lo manda en `x-vercel-ip-country` (ISO-2). En local no existe: se
// prueba con ?pais=CU. ponytail: sin base GeoIP propia; si se sale de Vercel,
// el header equivalente de Cloudflare es `cf-ipcountry`.
import { headers } from "next/headers";

export async function visitorCountry(override?: string | null): Promise<string | null> {
  if (override && /^[A-Za-z]{2}$/.test(override)) return override.toUpperCase();
  const h = await headers();
  return h.get("x-vercel-ip-country") ?? h.get("cf-ipcountry") ?? null;
}
