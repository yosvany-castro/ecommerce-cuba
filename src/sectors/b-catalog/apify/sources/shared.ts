import type { FetchOptions } from "../../mock/aggregator";
import type { MockCategory } from "../../mock/types";

// Query por defecto cuando el cron llama por categoría sin query explícita.
const CATEGORY_QUERY: Record<MockCategory, string> = {
  ropa: "ropa mujer",
  electronica: "electronics gadgets",
  hogar: "home kitchen",
  juguetes_bebe: "toys baby",
  belleza: "beauty skincare",
  otros: "deals",
};

export function queryFromOpts(opts: FetchOptions): string {
  if (opts.query && opts.query.trim().length > 0) return opts.query;
  if (opts.category) return CATEGORY_QUERY[opts.category];
  return "deals";
}

/**
 * USD → céntimos enteros. Acepta number, string numérico, o string con símbolo
 * de moneda ("US $12.34", "$1,234.56"). Conservador: si no se puede parsear a un
 * valor > 0 devuelve null (→ item descartado o old_price omitido).
 * ponytail: locale US — la coma es separador de miles y se descarta; añadir
 * manejo de coma-decimal solo si aparece una fuente no-US.
 */
export function usdToCents(v: unknown): number | null {
  let n: number;
  if (typeof v === "number") {
    n = v;
  } else if (typeof v === "string") {
    n = parseFloat(v.replace(/[^0-9.,]/g, "").replace(/,/g, ""));
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** number|string numérico → number, o undefined si no parsea (para rating). */
export function toNumber(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Copia solo las claves con dato real (dropea undefined/null y arrays vacíos). */
export function compactAttrs(a: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(a)) {
    if (val === undefined || val === null) continue;
    if (Array.isArray(val) && val.length === 0) continue;
    out[k] = val;
  }
  return out;
}

export function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
