import type { FetchOptions, FetchResult } from "../../mock/aggregator";
import type { MockProduct } from "../../mock/types";
import { asRecord, compactAttrs, queryFromOpts, str, toNumber, usdToCents } from "../../apify/sources/shared";
import { rapidApiGet } from "../client";

// real-time-amazon-data (RapidAPI) — endpoint /search.
export const PROVIDER_NAME = "rapidapi-amazon";
const HOST = "real-time-amazon-data.p.rapidapi.com";

// El proveedor devuelve títulos con entidades HTML sin decodificar
// (&#x27; &amp; etc). Decoder chico, sin dependencia: numéricas (&#39; /
// &#x27;) + el puñado de nombradas que de verdad aparecen en catálogos.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, ent: string) => {
    if (ent[0] === "#") {
      const code =
        ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[ent] ?? match;
  });
}

export function mapItem(raw: unknown): MockProduct | null {
  const o = asRecord(raw);
  if (!o) return null;

  const id = str(o.asin);
  const titleRaw = str(o.product_title);
  const price = usdToCents(o.product_price);
  if (!id || !titleRaw || price === null) return null;

  const title = decodeHtmlEntities(titleRaw);
  const oldPrice = usdToCents(o.product_original_price);

  return {
    id: `amazon:${id}`,
    source: "amazon",
    source_product_id: id,
    title,
    description: title, // el endpoint de búsqueda no trae descripción
    image_url: str(o.product_photo) ?? "",
    price_cents: price,
    brand: "",
    raw_category: "",
    url: str(o.product_url) ?? `https://www.amazon.com/dp/${id}`,
    attributes: compactAttrs({
      old_price_cents: oldPrice !== null && oldPrice > price ? oldPrice : undefined,
      rating: toNumber(o.product_star_rating),
    }),
  };
}

export async function fetchProducts(opts: FetchOptions): Promise<FetchResult> {
  const t0 = Date.now();
  const json = await rapidApiGet(HOST, "/search", {
    query: queryFromOpts(opts),
    country: "US",
    page: "1",
  });
  const items = asRecord(asRecord(json)?.data)?.products;
  const products = (Array.isArray(items) ? items : [])
    .map(mapItem)
    .filter((p): p is MockProduct => p !== null);

  return {
    products: opts.limit ? products.slice(0, opts.limit) : products,
    // Dentro de la cuota gratuita el costo marginal es 0 — la cuota mensual
    // (no el dinero) es el límite real. Ver comentario en ../client.ts.
    cost_cents: 0,
    latency_ms: Date.now() - t0,
  };
}
