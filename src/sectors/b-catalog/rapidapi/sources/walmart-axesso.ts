import type { FetchOptions, FetchResult } from "../../mock/aggregator";
import type { MockProduct } from "../../mock/types";
import { asRecord, compactAttrs, queryFromOpts, str, toNumber, usdToCents } from "../../apify/sources/shared";
import { rapidApiGet } from "../client";

// axesso-walmart-data-service (RapidAPI) — endpoint
// /wlm/walmart-search-by-keyword. Sin fallback por defecto (ver
// ../../fallback.ts + provider.ts): es la única fuente de walmart hoy, no hay
// actor Apify equivalente.
export const PROVIDER_NAME = "rapidapi-axesso-walmart";
const HOST = "axesso-walmart-data-service.p.rapidapi.com";

export function mapItem(raw: unknown): MockProduct | null {
  const o = asRecord(raw);
  if (!o) return null;

  const id = str(o.usItemId);
  const title = str(o.name);
  const priceInfo = asRecord(o.priceInfo);
  // linePrice es el precio mostrado ("$20.98"); itemPrice es el fallback que
  // trae el fixture cuando linePrice viene vacío.
  const price = usdToCents(priceInfo?.linePrice) ?? usdToCents(priceInfo?.itemPrice);
  if (!id || !title || price === null) return null;

  const canonicalUrl = str(o.canonicalUrl);
  const imageInfo = asRecord(o.imageInfo);

  return {
    id: `walmart:${id}`,
    source: "walmart",
    source_product_id: id,
    title,
    description: title, // el endpoint de búsqueda no trae descripción
    image_url: str(imageInfo?.thumbnailUrl) ?? "",
    price_cents: price,
    brand: str(o.brand) ?? "",
    raw_category: str(o.departmentName) ?? "",
    url: canonicalUrl ? `https://www.walmart.com${canonicalUrl}` : `https://www.walmart.com/ip/${id}`,
    attributes: compactAttrs({
      rating: toNumber(o.averageRating),
    }),
  };
}

// Pura y testeable sin red: toma la respuesta cruda del endpoint y devuelve
// los productos mapeados, o [] si responseStatus no es PRODUCT_FOUND_RESPONSE
// (p.ej. sin resultados o keyword inválido — respuesta válida, no un fallo
// del cliente) o si la cadena de acceso no trae items.
export function parseSearchResponse(json: unknown): MockProduct[] {
  const o = asRecord(json);
  if (str(o?.responseStatus) !== "PRODUCT_FOUND_RESPONSE") return [];

  // Cadena de acceso larga y variable — defensiva en cada nivel con asRecord.
  const item = asRecord(o?.item);
  const props = asRecord(item?.props);
  const pageProps = asRecord(props?.pageProps);
  const initialData = asRecord(pageProps?.initialData);
  const searchResult = asRecord(initialData?.searchResult);
  const stacks = searchResult?.itemStacks;
  const firstStack = Array.isArray(stacks) ? asRecord(stacks[0]) : null;
  const list = Array.isArray(firstStack?.items) ? firstStack!.items : [];

  return list.map(mapItem).filter((p): p is MockProduct => p !== null);
}

export async function fetchProducts(opts: FetchOptions): Promise<FetchResult> {
  const t0 = Date.now();
  const json = await rapidApiGet(HOST, "/wlm/walmart-search-by-keyword", {
    keyword: queryFromOpts(opts),
    page: "1",
    sortBy: "best_match",
  });

  const products = parseSearchResponse(json);

  return {
    products: opts.limit ? products.slice(0, opts.limit) : products,
    cost_cents: 0, // ver comentario de cuota en ../client.ts
    latency_ms: Date.now() - t0,
  };
}
