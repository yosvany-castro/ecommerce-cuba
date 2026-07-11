import type { FetchOptions, FetchResult } from "../../mock/aggregator";
import type { MockProduct } from "../../mock/types";
import { asRecord, compactAttrs, queryFromOpts, str, toNumber, usdToCents } from "../../apify/sources/shared";
import { rapidApiGet } from "../client";

// axesso-amazon-data-service (RapidAPI) — endpoint
// /amz/amazon-search-by-keyword-asin. Alternativa a rapidapi-amazon (RTD),
// no forma parte del fallback por defecto (ver ../../fallback.ts + provider.ts).
export const PROVIDER_NAME = "rapidapi-axesso-amazon";
const HOST = "axesso-axesso-amazon-data-service-v1.p.rapidapi.com";

export function mapItem(raw: unknown): MockProduct | null {
  const o = asRecord(raw);
  if (!o) return null;

  const id = str(o.asin);
  const title = str(o.productDescription);
  const price = usdToCents(o.price);
  if (!id || !title || price === null) return null;

  const retail = usdToCents(o.retailPrice);

  return {
    id: `amazon:${id}`,
    source: "amazon",
    source_product_id: id,
    title,
    description: title,
    image_url: str(o.imgUrl) ?? "",
    price_cents: price,
    brand: str(o.manufacturer) ?? "",
    raw_category: "",
    // dpUrl del fixture es relativo y trae params de tracking — no se usa.
    url: `https://www.amazon.com/dp/${id}`,
    attributes: compactAttrs({
      old_price_cents: retail !== null && retail > price ? retail : undefined,
      rating: toNumber(o.productRating), // "4.5 out of 5 stars" → parseFloat capta el 4.5
    }),
  };
}

export async function fetchProducts(opts: FetchOptions): Promise<FetchResult> {
  const t0 = Date.now();
  const json = await rapidApiGet(HOST, "/amz/amazon-search-by-keyword-asin", {
    domainCode: "com",
    keyword: queryFromOpts(opts),
    page: "1",
    excludeSponsored: "true",
    sortBy: "relevanceblender",
  });

  const o = asRecord(json);
  if (str(o?.responseStatus) !== "PRODUCT_FOUND_RESPONSE") {
    return { products: [], cost_cents: 0, latency_ms: Date.now() - t0 };
  }

  const list = Array.isArray(o?.searchProductDetails) ? o!.searchProductDetails : [];
  const products = list.map(mapItem).filter((p): p is MockProduct => p !== null);

  return {
    products: opts.limit ? products.slice(0, opts.limit) : products,
    cost_cents: 0, // ver comentario de cuota en ../client.ts
    latency_ms: Date.now() - t0,
  };
}
