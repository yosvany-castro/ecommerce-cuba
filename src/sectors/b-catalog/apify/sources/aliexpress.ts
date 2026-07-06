import type { FetchOptions } from "../../mock/aggregator";
import type { MockProduct } from "../../mock/types";
import { asRecord, compactAttrs, queryFromOpts, str, toNumber, usdToCents } from "./shared";

// devcake/aliexpress-products-scraper
export const ACTOR_SLUG = "devcake/aliexpress-products-scraper";
export const PER_ITEM_USD = 0.0015;

export function buildInput(opts: FetchOptions): Record<string, unknown> {
  return { searchQueries: [queryFromOpts(opts)], maxProducts: opts.limit ?? 20 };
}

export function mapItem(raw: unknown): MockProduct | null {
  const o = asRecord(raw);
  if (!o) return null;

  const id = str(o.id) ?? str(o.productId);
  const title = str(o.title);
  const price = usdToCents(o.price ?? o.salePrice);
  if (!id || !title || price === null) return null;

  const oldPrice = usdToCents(o.originalPrice ?? o.originalPriceStr);
  const orders = o.orders ?? o.tradeCount;

  return {
    id: `aliexpress:${id}`,
    source: "aliexpress",
    source_product_id: id,
    title,
    description: str(o.description) ?? title,
    image_url: str(o.imageUrl) ?? str(o.image) ?? "",
    price_cents: price,
    brand: str(o.brand) ?? "",
    raw_category: str(o.categoryName) ?? "",
    attributes: compactAttrs({
      old_price_cents: oldPrice !== null && oldPrice > price ? oldPrice : undefined,
      rating: toNumber(o.rating),
      orders: typeof orders === "string" || typeof orders === "number" ? orders : undefined,
    }),
  };
}
