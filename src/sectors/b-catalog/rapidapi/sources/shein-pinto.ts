import type { FetchOptions, FetchResult } from "../../mock/aggregator";
import type { MockProduct } from "../../mock/types";
import { asRecord, compactAttrs, queryFromOpts, str, toNumber, usdToCents } from "../../apify/sources/shared";
import { rapidApiGet } from "../client";

// shein-data-api (RapidAPI) — endpoint /search/v2.
// OJO CUOTA DURA: el plan free de este host es 10 requests/MES en total (no
// por día). Este provider es SOLO fallback de última instancia (ver cadena
// "shein-prod" en ../../provider.ts) — jamás debe ser primario ni usarse en
// smoke tests repetidos, quema la cuota del mes entero en minutos.
export const PROVIDER_NAME = "rapidapi-shein-pinto";
const HOST = "shein-data-api.p.rapidapi.com";

// image viene protocol-relative ("//img.ltwebstatic.com/...").
function toHttps(u: string): string {
  return u.startsWith("//") ? `https:${u}` : u;
}

// salePrice/retailPrice: { amount, usdAmount } (strings numéricos). Prefiere usd.
function priceCents(p: unknown): number | null {
  const o = asRecord(p);
  if (!o) return usdToCents(p);
  return usdToCents(o.usdAmount ?? o.amount);
}

export function mapItem(raw: unknown): MockProduct | null {
  const o = asRecord(raw);
  if (!o) return null;

  const id = str(o.goods_id) ?? str(o.goods_sn);
  const title = str(o.goods_name);
  const price = priceCents(o.salePrice) ?? priceCents(o.retailPrice);
  if (!id || !title || price === null) return null;

  const retail = priceCents(o.retailPrice);
  const image = str(o.goods_img);
  const urlName = str(o.goods_url_name);

  return {
    id: `shein:${id}`,
    source: "shein",
    source_product_id: id,
    title,
    description: title,
    image_url: image ? toHttps(image) : "",
    price_cents: price,
    brand: "",
    raw_category: str(o.cate_name) ?? "",
    // No hay URL de producto directa en el payload; se arma con el slug SEO +
    // goods_id, mismo patrón que apify/sources/shein.ts.
    url: urlName ? `https://us.shein.com/${urlName}-p-${id}.html` : null,
    attributes: compactAttrs({
      old_price_cents: retail !== null && retail > price ? retail : undefined,
      rating: toNumber(o.comment_rank_average),
    }),
  };
}

// Pura y testeable sin red: toma la respuesta cruda del endpoint y devuelve
// los productos mapeados, o [] si no trae un array products (error del
// proveedor o cuota agotada — respuesta sin resultados, no un throw del cliente).
export function parseSearchResponse(json: unknown): MockProduct[] {
  const list = asRecord(json)?.products;
  return (Array.isArray(list) ? list : [])
    .map(mapItem)
    .filter((p): p is MockProduct => p !== null);
}

export async function fetchProducts(opts: FetchOptions): Promise<FetchResult> {
  const t0 = Date.now();
  const json = await rapidApiGet(HOST, "/search/v2", {
    query: queryFromOpts(opts),
    page: "1",
    perPage: String(opts.limit ?? 20),
    countryCode: "us",
  });

  const products = parseSearchResponse(json);

  return {
    products: opts.limit ? products.slice(0, opts.limit) : products,
    cost_cents: 0, // ver comentario de cuota en ../client.ts
    latency_ms: Date.now() - t0,
  };
}
