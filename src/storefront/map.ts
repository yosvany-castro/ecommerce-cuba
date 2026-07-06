// src/storefront/map.ts
import "server-only";
import type { ComposedPage } from "@/sectors/f-slate/compose";
import type { ResolvedSection } from "@/sectors/f-slate/sections/types";
import type { CuratedAttrs } from "@/sectors/b-catalog/enrichment/attrs";
import type { StorefrontCard, StorefrontSection, StorefrontPage } from "./contract";

// orders crudo (string ya-formateado del proveedor, o número) -> `sold` legible.
// Mismo redondeo que demoAttrs (tuki/lib.ts) pero no se comparte: una fuente
// (hash cosmético) vs. la otra (dato real de A4); coincidencia de forma, no de origen.
function formatSold(orders: string | number | undefined): string | undefined {
  if (orders === undefined) return undefined;
  if (typeof orders === "string") return orders;
  return orders >= 1000 ? (orders / 1000).toFixed(1) + "k" : String(orders);
}

function toCardAttrs(attrs: CuratedAttrs | undefined): StorefrontCard["attrs"] {
  if (!attrs) return undefined;
  return {
    ...(attrs.colors ? { colors: attrs.colors } : {}),
    ...(attrs.sizes ? { sizes: attrs.sizes } : {}),
    ...(attrs.images ? { images: attrs.images } : {}),
    ...(attrs.old_price_cents !== undefined ? { old_price_cents: attrs.old_price_cents } : {}),
    ...(attrs.rating !== undefined ? { rating: attrs.rating } : {}),
    ...(attrs.orders !== undefined ? { sold: formatSold(attrs.orders) } : {}),
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
    metadata?: unknown;
  },
  reason?: string,
  position?: number,
): StorefrontCard {
  const meta = product.metadata as { category?: string; attrs?: CuratedAttrs } | undefined;
  const attrs = toCardAttrs(meta?.attrs);
  return {
    id: product.id,
    title: product.title,
    price_cents: product.price_cents,
    currency: product.currency,
    image_url: product.image_url,
    category: meta?.category ?? null,
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
