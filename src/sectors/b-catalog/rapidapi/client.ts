// src/sectors/b-catalog/rapidapi/client.ts — helper HTTP mínimo para los
// providers RapidAPI (amazon-rtd, aliexpress-datahub, axesso-amazon).
//
// OJO CUOTA: los planes gratuitos de estos hosts en RapidAPI son durísimos —
// hasta 100 requests/mes en algunos. Por eso NO hay reintentos automáticos
// acá: un fallo (red, timeout, HTTP != 200) es un throw inmediato, sin
// reintento — reintentar quemaría cuota sin necesidad. Si hace falta
// resiliencia ante fallos del proveedor, que la decida el caller (ver
// withFallback en ../fallback.ts), no este cliente.
const DEFAULT_TIMEOUT_MS = 60_000;

export async function rapidApiGet(
  host: string,
  path: string,
  params: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) throw new Error("RAPIDAPI_KEY is required");

  const url = new URL(`https://${host}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "x-rapidapi-host": host, "x-rapidapi-key": key },
      signal: controller.signal,
    });
    if (res.status !== 200) {
      const text = await res.text().catch(() => "");
      throw new Error(`RapidAPI ${host}${path} → HTTP ${res.status}: ${text}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
