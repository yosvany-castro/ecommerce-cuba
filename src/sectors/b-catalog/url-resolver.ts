// src/sectors/b-catalog/url-resolver.ts — parsea una URL de producto pegada
// en la barra de búsqueda (modelo de reventa: los clientes mandan links de
// amazon/aliexpress/shein/walmart) a {source, source_product_id}. Puro, sin
// deps de server (fetch/pg/next) — se importa tanto desde el endpoint
// /api/products/resolve-url (server) como desde useTukiSearch (client).
import type { MockProductSource } from "./mock/types";

export interface ParsedProductUrl {
  source: MockProductSource;
  source_product_id: string;
}

function normalizeUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withProtocol);
  } catch {
    return null; // texto normal (con espacios, etc.) no es una URL válida
  }
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

// pathname ya viene sin query string (URL la separa), así que los patrones
// no necesitan lidiar con "?...".
const AMAZON_ASIN = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i;
const ALIEXPRESS_ITEM = /\/item\/(\d+)\.html/i;
// OJO: el source_product_id de shein en nuestra DB NO lleva el prefijo "sh-"
// (ver revalidate.ts fetchDetailJson, que lo re-antepone al llamar al detalle).
const SHEIN_ITEM = /-p-(\d+)\.html/i;
const WALMART_ITEM = /\/ip\/(?:.*\/)?(\d+)$/i;

/** Forma absoluta (con protocolo) de la URL pegada — usada por
 * /api/products/resolve-url para pasarle una URL real a fetchDetailJson
 * (walmart la necesita literal, ver revalidate.ts::fetchDetailJson). */
export function toAbsoluteUrl(raw: string): string | null {
  const url = normalizeUrl(raw);
  return url ? url.toString() : null;
}

export function parseProductUrl(raw: string): ParsedProductUrl | null {
  const url = normalizeUrl(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname;

  if (hostMatches(host, "amazon.com")) {
    const m = path.match(AMAZON_ASIN);
    return m ? { source: "amazon", source_product_id: m[1].toUpperCase() } : null;
  }
  if (hostMatches(host, "aliexpress.com")) {
    const m = path.match(ALIEXPRESS_ITEM);
    return m ? { source: "aliexpress", source_product_id: m[1] } : null;
  }
  if (hostMatches(host, "shein.com")) {
    const m = path.match(SHEIN_ITEM);
    return m ? { source: "shein", source_product_id: m[1] } : null;
  }
  if (hostMatches(host, "walmart.com")) {
    const m = path.match(WALMART_ITEM);
    return m ? { source: "walmart", source_product_id: m[1] } : null;
  }
  return null;
}
