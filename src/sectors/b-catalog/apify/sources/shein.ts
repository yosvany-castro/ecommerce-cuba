import type { FetchOptions } from "../../mock/aggregator";
import type { MockProduct } from "../../mock/types";
import { asRecord, compactAttrs, queryFromOpts, str, usdToCents } from "./shared";

// api-empire/shein-search-products-scraper
export const ACTOR_SLUG = "api-empire/shein-search-products-scraper";
export const PER_ITEM_USD = 0.005;

export function buildInput(opts: FetchOptions): Record<string, unknown> {
  return { query: queryFromOpts(opts), maxItems: opts.limit ?? 20, countryCode: "US" };
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

  const id = str(o.goods_id);
  const title = str(o.goods_name);
  const price = priceCents(o.salePrice) ?? priceCents(o.retailPrice);
  if (!id || !title || price === null) return null;

  const retail = priceCents(o.retailPrice);
  const images = Array.isArray(o.detail_image)
    ? o.detail_image.filter((x): x is string => typeof x === "string")
    : undefined;

  return {
    id: `shein:${id}`,
    source: "shein",
    source_product_id: id,
    title,
    description: str(o.goods_name) ?? title,
    image_url: str(o.goods_img) ?? images?.[0] ?? "",
    price_cents: price,
    brand: "",
    raw_category: str(o.cate_name) ?? "",
    attributes: compactAttrs({
      old_price_cents: retail !== null && retail > price ? retail : undefined,
      images,
    }),
  };
}
