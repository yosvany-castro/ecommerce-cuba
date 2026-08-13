import type { FetchOptions } from "../../mock/aggregator";
import type { MockProduct } from "../../mock/types";
import { asRecord, compactAttrs, queryFromOpts, str, toNumber, usdToCents } from "./shared";

// amit123/temu-products-scraper — elegido 2026-08-12 (0 runs fallidos/30d,
// $6/1k). Input schema real (openapi del actor): searchQueries[], currency,
// maxResults (MÍNIMO 20 — el actor no acepta menos por run).
// OJO: mapper calibrado contra el fixture del smoke run
// (tests/fixtures/apify/temu-sample.json) — si el actor cambia su shape,
// re-correr `pnpm apify:smoke --source temu` y ajustar.
export const ACTOR_SLUG = "amit123/temu-products-scraper";
export const PER_ITEM_USD = 0.006;
export const TIMEOUT_SECS = 180;

export function buildInput(opts: FetchOptions): Record<string, unknown> {
  const q = queryFromOpts(opts);
  return {
    searchQueries: [q],
    currency: "USD",
    // el actor exige mínimo 20 por query
    maxResults: Math.max(20, opts.limit ?? 20),
  };
}

// Campos defensivos: los scrapers de Temu varían el shape entre versiones.
// Se intenta cada alias conocido; el fixture del smoke fija los reales.
function firstStr(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = str(o[k]);
    if (v) return v;
  }
  return undefined;
}

function firstPrice(o: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = usdToCents(o[k]);
    if (v !== null) return v;
  }
  return null;
}

export function mapItem(raw: unknown): MockProduct | null {
  const o = asRecord(raw);
  if (!o) return null;

  const id = firstStr(o, ["goodsId", "goods_id", "productId", "product_id", "id", "itemId"]);
  const title = firstStr(o, ["title", "goodsName", "goods_name", "name", "productName"]);
  const price = firstPrice(o, ["price", "salePrice", "sale_price", "currentPrice", "minPrice"]);
  if (!id || !title || price === null) return null;

  const oldPrice = firstPrice(o, ["originalPrice", "original_price", "marketPrice", "listPrice", "oldPrice"]);
  const imagesRaw = o.images ?? o.imageUrls ?? o.gallery;
  const images = Array.isArray(imagesRaw) ? imagesRaw.filter((x): x is string => typeof x === "string") : undefined;
  const image = firstStr(o, ["image", "imageUrl", "image_url", "thumbUrl", "thumbnail", "mainImage"]) ?? images?.[0];
  const url = firstStr(o, ["url", "productUrl", "product_url", "link", "detailUrl"]);
  const sold = firstStr(o, ["sold", "salesTip", "sales_tip", "soldQuantity", "sales"]);

  return {
    id: `temu:${id}`,
    source: "temu",
    source_product_id: id,
    title,
    description: firstStr(o, ["description", "desc"]) ?? title,
    image_url: image ?? "",
    price_cents: price,
    brand: firstStr(o, ["brand", "mallName", "storeName"]) ?? "",
    raw_category: firstStr(o, ["category", "categoryName", "catName"]) ?? "",
    url: url ?? `https://www.temu.com/g-${id}.html`,
    weight_grams: null,
    attributes: compactAttrs({
      old_price_cents: oldPrice !== null && oldPrice > price ? oldPrice : undefined,
      rating: toNumber(o.rating ?? o.goodsScore ?? o.score),
      sold,
      images,
    }),
  };
}
