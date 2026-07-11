import type { FetchOptions, FetchResult } from "../../mock/aggregator";
import type { MockProduct } from "../../mock/types";
import { asRecord, compactAttrs, queryFromOpts, str, toNumber, usdToCents } from "../../apify/sources/shared";
import { rapidApiGet } from "../client";

// aliexpress-datahub (RapidAPI) — endpoint /item_search_2.
// OJO: item_search (v1) está ROTO — devuelve siempre error 205 "no results"
// (ver tests/fixtures/rapidapi/aliexpress-datahub-error-205.json). Usar SOLO
// item_search_2.
export const PROVIDER_NAME = "rapidapi-aliexpress";
const HOST = "aliexpress-datahub.p.rapidapi.com";

// image/itemUrl vienen protocol-relative ("//ae-pic...").
function toHttps(u: string): string {
  return u.startsWith("//") ? `https:${u}` : u;
}

export function mapItem(raw: unknown): MockProduct | null {
  const o = asRecord(raw);
  if (!o) return null;

  const id = str(o.itemId);
  const title = str(o.title);
  const def = asRecord(asRecord(o.sku)?.def);
  const price = usdToCents(def?.promotionPrice ?? def?.price);
  if (!id || !title || price === null) return null;

  const image = str(o.image);
  const url = str(o.itemUrl);

  return {
    id: `aliexpress:${id}`,
    source: "aliexpress",
    source_product_id: id,
    title,
    description: title,
    image_url: image ? toHttps(image) : "",
    price_cents: price,
    brand: "",
    raw_category: "",
    url: url ? toHttps(url) : null,
    attributes: compactAttrs({
      rating: toNumber(o.averageStarRate),
    }),
  };
}

// Pura y testeable sin red: toma la respuesta cruda del endpoint y devuelve
// los productos mapeados, o [] si status.code no es 200 (p.ej. 205 "no
// results" — respuesta válida sin resultados, no un fallo del cliente).
export function parseSearchResponse(json: unknown): MockProduct[] {
  const result = asRecord(asRecord(json)?.result);
  const code = toNumber(asRecord(result?.status)?.code);
  if (code !== 200) return [];

  const resultList = Array.isArray(result?.resultList) ? result!.resultList : [];
  return resultList
    .map((entry) => mapItem(asRecord(entry)?.item))
    .filter((p): p is MockProduct => p !== null);
}

export async function fetchProducts(opts: FetchOptions): Promise<FetchResult> {
  const t0 = Date.now();
  const json = await rapidApiGet(HOST, "/item_search_2", {
    q: queryFromOpts(opts),
    page: "1",
  });

  const products = parseSearchResponse(json);

  return {
    products: opts.limit ? products.slice(0, opts.limit) : products,
    cost_cents: 0, // ver comentario de cuota en ../client.ts
    latency_ms: Date.now() - t0,
  };
}
