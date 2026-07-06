import type { FetchOptions } from "../../mock/aggregator";
import type { MockProduct } from "../../mock/types";
import { asRecord, compactAttrs, queryFromOpts, str, toNumber, usdToCents } from "./shared";

// junglee/amazon-crawler
export const ACTOR_SLUG = "junglee/amazon-crawler";
export const PER_ITEM_USD = 0.003;

export function buildInput(opts: FetchOptions): Record<string, unknown> {
  const q = queryFromOpts(opts);
  return {
    categoryOrProductUrls: [{ url: `https://www.amazon.com/s?k=${encodeURIComponent(q)}` }],
    maxItemsPerStartUrl: opts.limit ?? 20,
    proxyCountry: "US",
  };
}

// variantAttributes: array de {key|name, value}. Defensivo: forma desconocida → {}.
function variantColorsSizes(va: unknown): { colors?: string[]; sizes?: string[] } {
  if (!Array.isArray(va)) return {};
  const colors: string[] = [];
  const sizes: string[] = [];
  for (const entry of va) {
    const o = asRecord(entry);
    if (!o) continue;
    const key = String(o.key ?? o.name ?? "").toLowerCase();
    const value = str(o.value);
    if (!value) continue;
    if (key.includes("color") || key.includes("colour")) colors.push(value);
    else if (key.includes("size") || key.includes("talla")) sizes.push(value);
  }
  return {
    colors: colors.length ? colors : undefined,
    sizes: sizes.length ? sizes : undefined,
  };
}

export function mapItem(raw: unknown): MockProduct | null {
  const o = asRecord(raw);
  if (!o) return null;

  const id = str(o.asin);
  const title = str(o.title);
  const price = usdToCents(asRecord(o.price)?.value);
  if (!id || !title || price === null) return null;

  const listPrice = usdToCents(asRecord(o.listPrice)?.value);
  const oldPrice = listPrice !== null && listPrice > price ? listPrice : undefined;
  const brand = str(o.brand);
  const { colors, sizes } = variantColorsSizes(o.variantAttributes);

  return {
    id: `amazon:${id}`,
    source: "amazon",
    source_product_id: id,
    title,
    description: str(o.description) ?? title,
    image_url: str(o.thumbnailImage) ?? "",
    price_cents: price,
    brand: brand ?? "",
    raw_category: str(o.category) ?? "",
    attributes: compactAttrs({
      old_price_cents: oldPrice,
      rating: toNumber(o.stars),
      colors,
      sizes,
      brand,
    }),
  };
}
