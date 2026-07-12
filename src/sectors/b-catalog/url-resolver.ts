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

// Matchea la marca en cualquier TLD/ccTLD (shein.com, es.shein.com,
// shein.com.mx, amazon.com.mx…) exigiendo frontera de label: "sheinoutlet.com"
// no matchea. Las URLs de item usan el mismo path en todos los ccTLD.
function hostMatches(host: string, brand: string): boolean {
  return new RegExp(`(^|\\.)${brand}\\.[a-z]{2,3}(\\.[a-z]{2})?$`).test(host);
}

// pathname ya viene sin query string (URL la separa), así que los patrones
// no necesitan lidiar con "?...".
const AMAZON_ASIN = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i;
const ALIEXPRESS_ITEM = /\/item\/(\d+)\.html/i;
// OJO: el source_product_id de shein en nuestra DB NO lleva el prefijo "sh-"
// (ver revalidate.ts fetchDetailJson, que lo re-antepone al llamar al detalle).
// El formato real dominante lleva sufijo de categoría: "…-p-12345678-cat-1727.html"
// (el regex viejo exigía ".html" pegado al id y por eso fallaba — bug URL Shein).
const SHEIN_ITEM = /-p-(\d+)(?:-[a-z0-9-]*)?\.html/i;
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

  if (hostMatches(host, "amazon")) {
    const m = path.match(AMAZON_ASIN);
    return m ? { source: "amazon", source_product_id: m[1].toUpperCase() } : null;
  }
  if (hostMatches(host, "aliexpress")) {
    const m = path.match(ALIEXPRESS_ITEM);
    return m ? { source: "aliexpress", source_product_id: m[1] } : null;
  }
  if (hostMatches(host, "shein")) {
    const m = path.match(SHEIN_ITEM);
    if (m) return { source: "shein", source_product_id: m[1] };
    // Links de compartir de la app llevan el id solo en query (?goods_id=NNN).
    const goodsId = url.searchParams.get("goods_id");
    return goodsId && /^\d+$/.test(goodsId) ? { source: "shein", source_product_id: goodsId } : null;
  }
  if (hostMatches(host, "walmart")) {
    const m = path.match(WALMART_ITEM);
    return m ? { source: "walmart", source_product_id: m[1] } : null;
  }
  return null;
}
