import type { FetchOptions } from "../../mock/aggregator";
import type { MockProduct } from "../../mock/types";
import { asRecord, compactAttrs, queryFromOpts, str, usdToCents } from "./shared";

// api-empire/shein-search-products-scraper
export const ACTOR_SLUG = "api-empire/shein-search-products-scraper";
export const PER_ITEM_USD = 0.005;
// Smoke en vivo: 330s (anti-bot pesado). Default de runActorGetItems (180s) no alcanza.
export const TIMEOUT_SECS = 420;

export function buildInput(opts: FetchOptions): Record<string, unknown> {
  // Schema real: query es array; countryCode enum en minúsculas.
  return { query: [queryFromOpts(opts)], maxItems: opts.limit ?? 20, countryCode: "us" };
}

// salePrice/retailPrice: { amount, usdAmount } (strings numéricos). Prefiere usd.
function priceCents(p: unknown): number | null {
  const o = asRecord(p);
  if (!o) return usdToCents(p);
  return usdToCents(o.usdAmount ?? o.amount);
}

// relatedColorNew: [{ colorImage, goods_id, skc_name }]. skc_name es el nombre del color
// (null en electrónica, poblado en ropa). Devolvemos solo los nombres reales.
function relatedColors(rcn: unknown): string[] | undefined {
  if (!Array.isArray(rcn)) return undefined;
  const names = rcn
    .map((c) => asRecord(c)?.skc_name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);
  return names.length ? names : undefined;
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
  // El output real no trae una URL de producto directa. goods_url_name es el
  // slug SEO; junto a goods_id arma la URL real de SHEIN (patrón {slug}-p-{id}.html).
  const urlName = str(o.goods_url_name);

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
    url: urlName ? `https://us.shein.com/${urlName}-p-${id}.html` : null,
    attributes: compactAttrs({
      old_price_cents: retail !== null && retail > price ? retail : undefined,
      images,
      colors: relatedColors(o.relatedColorNew),
    }),
  };
}
