// src/storefront/map.ts
import "server-only";
import type { ComposedPage } from "@/sectors/f-slate/compose";
import type { ResolvedSection } from "@/sectors/f-slate/sections/types";
import type { CuratedAttrs } from "@/sectors/b-catalog/enrichment/attrs";
import type { StorefrontCard, StorefrontSection, StorefrontPage } from "./contract";
import { imgSrc } from "@/lib/img";

// orders crudo (string ya-formateado del proveedor, o número) -> `sold` legible.
function formatSold(orders: string | number | undefined): string | undefined {
  if (orders === undefined) return undefined;
  // el UI ya añade su propio "ventas"/"vendidos" — quitar el sufijo "sold" del
  // proveedor real evita el doble idioma ("10,000+ sold vendidos", F4 review).
  if (typeof orders === "string") return orders.replace(/\s*sold\s*$/i, "");
  return orders >= 1000 ? (orders / 1000).toFixed(1) + "k" : String(orders);
}

function toCardAttrs(attrs: CuratedAttrs | undefined, source: string): StorefrontCard["attrs"] {
  if (!attrs) return undefined;
  // 3G: imágenes de galería/variantes pueden volverse la foto GRANDE de la PDP
  // al elegir color → tamaño 640 (no 350). Ver src/lib/img.ts.
  const img640 = (u: string | undefined) => (u ? (imgSrc(u, source, 640) ?? u) : undefined);
  return {
    ...(attrs.colors ? { colors: attrs.colors } : {}),
    ...(attrs.sizes ? { sizes: attrs.sizes } : {}),
    ...(attrs.images ? { images: attrs.images.map((u) => img640(u)!).filter(Boolean) } : {}),
    ...(attrs.old_price_cents !== undefined ? { old_price_cents: attrs.old_price_cents } : {}),
    ...(attrs.rating !== undefined ? { rating: attrs.rating } : {}),
    ...(attrs.orders !== undefined ? { sold: formatSold(attrs.orders) } : {}),
    ...(attrs.hydrated_at ? { hydrated_at: attrs.hydrated_at } : {}),
    ...(attrs.variants ? { variants: attrs.variants.map((v) => ({ ...v, ...(v.image ? { image: img640(v.image) } : {}) })) } : {}),
  };
}

/**
 * Único mapper producto→card (T2): antes duplicado inline en el feed
 * (/api/feed/page) y en el hero_grid de f-slate/resolve — mismo literal,
 * dos sitios. category viene de metadata.category (siempre presente como
 * objeto, NOT NULL DEFAULT '{}' en products).
 */
export function toCard(
  product: {
    id: string;
    title: string;
    price_cents: number;
    currency: string;
    image_url: string | null;
    source: string;
    metadata?: unknown;
    weight_grams?: number | null;
    url?: string | null;
  },
  reason?: string,
  position?: number,
): StorefrontCard {
  const meta = product.metadata as { category?: string; attrs?: CuratedAttrs } | undefined;
  const attrs = toCardAttrs(meta?.attrs, product.source);
  return {
    id: product.id,
    title: product.title,
    price_cents: product.price_cents,
    currency: product.currency,
    // 3G: tamaño de card (350px) — la PDP pide su propia variante 640
    image_url: imgSrc(product.image_url, product.source, 350),
    category: meta?.category ?? null,
    source: product.source,
    ...(product.weight_grams != null ? { weight_grams: product.weight_grams } : {}),
    ...(product.url ? { url: product.url } : {}),
    ...(reason ? { reason } : {}),
    ...(position ? { position } : {}),
    ...(attrs ? { attrs } : {}),
  };
}

export function toSection(s: ResolvedSection): StorefrontSection {
  return {
    placement_id: s.placement_id,
    section_type: s.section_type,
    title: s.title,
    display: s.display,
    outcome: s.outcome,
    items: s.items, // SectionCardDTO ≡ StorefrontCard (structural)
    next_cursor: s.next_cursor,
    slate_id: s.slate_id,
  };
}

export function toPage(page: ComposedPage, sections: ResolvedSection[], surface: string): StorefrontPage {
  return { composition_id: page.composition_id, surface, sections: sections.map(toSection) };
}
