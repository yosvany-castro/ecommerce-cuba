import type { FetchOptions, FetchResult } from "../../mock/aggregator";
import type { MockProduct } from "../../mock/types";
import { asRecord, compactAttrs, queryFromOpts, str, usdToCents } from "../../apify/sources/shared";
import { rapidApiGet } from "../client";

// otapi-shein (RapidAPI) — endpoint /BatchSearchItemsFrame. Fallback
// intermedio de la cadena "shein-prod" (ver ../../provider.ts): entre apify-shein
// (primario) y rapidapi-shein-pinto (última instancia, 10 req/mes).
export const PROVIDER_NAME = "rapidapi-otapi-shein";
const HOST = "otapi-shein.p.rapidapi.com";

export function mapItem(raw: unknown): MockProduct | null {
  const o = asRecord(raw);
  if (!o) return null;

  // Id viene con el prefijo "sh-" (namespace del agregador OTAPI, no de
  // SHEIN) — se quita para quedarnos con el id numérico real del producto.
  const rawId = str(o.Id);
  const id = rawId?.startsWith("sh-") ? rawId.slice(3) : rawId;
  const title = str(o.Title);
  const priceObj = asRecord(asRecord(asRecord(o.Price)?.ConvertedPriceList)?.Internal);
  const price = usdToCents(priceObj?.Price);
  if (!id || !title || price === null) return null;

  return {
    id: `shein:${id}`,
    source: "shein",
    source_product_id: id,
    title,
    description: title,
    image_url: str(o.MainPictureUrl) ?? "",
    price_cents: price,
    brand: str(o.BrandName) ?? "",
    raw_category: "", // solo CategoryId/ExternalCategoryId numéricos, sin nombre de texto
    url: str(o.ExternalItemUrl) ?? null,
    attributes: compactAttrs({}),
  };
}

// Pura y testeable sin red: toma la respuesta cruda del endpoint y devuelve
// los productos mapeados, o [] si ErrorCode no es "Ok"/vacío (fallo real del
// proveedor, no un throw del cliente).
export function parseSearchResponse(json: unknown): MockProduct[] {
  const o = asRecord(json);
  // ErrorCode "Ok" o vacío/ausente = éxito; cualquier otro valor → sin resultados.
  const errorCode = o?.ErrorCode;
  if (errorCode !== "Ok" && errorCode) return [];

  const content = asRecord(asRecord(asRecord(o?.Result)?.Items)?.Items)?.Content;
  return (Array.isArray(content) ? content : [])
    .map(mapItem)
    .filter((p): p is MockProduct => p !== null);
}

export async function fetchProducts(opts: FetchOptions): Promise<FetchResult> {
  const t0 = Date.now();
  const json = await rapidApiGet(HOST, "/BatchSearchItemsFrame", {
    language: "en",
    framePosition: "0",
    frameSize: String(opts.limit ?? 20),
    ItemTitle: queryFromOpts(opts),
  });

  const products = parseSearchResponse(json);

  return {
    products: opts.limit ? products.slice(0, opts.limit) : products,
    cost_cents: 0, // ver comentario de cuota en ../client.ts
    latency_ms: Date.now() - t0,
  };
}
