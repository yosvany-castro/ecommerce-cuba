import type { FetchOptions } from "../../mock/aggregator";
import type { MockProduct } from "../../mock/types";
import { asRecord, compactAttrs, queryFromOpts, str, toNumber, usdToCents } from "./shared";

// devcake/aliexpress-products-scraper
export const ACTOR_SLUG = "devcake/aliexpress-products-scraper";
export const PER_ITEM_USD = 0.0015;
// Smoke en vivo: 8.8s. Margen amplio, el más rápido de las 3 fuentes.
export const TIMEOUT_SECS = 120;

export function buildInput(opts: FetchOptions): Record<string, unknown> {
  // El actor exige maxProducts >= 50 (piso duro); el cliente recorta a `limit` al leer
  // el dataset, así que igual solo ingerimos `limit` items aunque el actor raspe 50.
  return { searchQueries: [queryFromOpts(opts)], maxProducts: Math.max(50, opts.limit ?? 50) };
}

export function mapItem(raw: unknown): MockProduct | null {
  const o = asRecord(raw);
  if (!o) return null;

  // Campos reales (devcake): productId, priceCurrent(Min) string/number con símbolo,
  // priceOriginal(Min), ratingValue, soldDescription. Se mantienen los alias viejos por si acaso.
  const id = str(o.productId) ?? str(o.id);
  const title = str(o.title);
  const price = usdToCents(o.priceCurrentMin ?? o.priceCurrent ?? o.price ?? o.salePrice);
  if (!id || !title || price === null) return null;

  const oldPrice = usdToCents(o.priceOriginalMin ?? o.priceOriginal ?? o.originalPrice);
  const orders = str(o.soldDescription) ?? o.soldCount ?? o.orders;

  return {
    id: `aliexpress:${id}`,
    source: "aliexpress",
    source_product_id: id,
    title,
    description: str(o.description) ?? title,
    image_url: str(o.imageUrl) ?? str(o.image) ?? "",
    price_cents: price,
    brand: str(o.brand) ?? "",
    // categoryName no viene en el output real; searchQuery sí — hint para el normalizador LLM.
    raw_category: str(o.categoryName) ?? str(o.searchQuery) ?? "",
    attributes: compactAttrs({
      old_price_cents: oldPrice !== null && oldPrice > price ? oldPrice : undefined,
      rating: toNumber(o.ratingValue ?? o.rating),
      orders: typeof orders === "string" || typeof orders === "number" ? orders : undefined,
    }),
  };
}
