// src/storefront/map.ts
import "server-only";
import type { ComposedPage } from "@/sectors/f-slate/compose";
import type { ResolvedSection } from "@/sectors/f-slate/sections/types";
import type { StorefrontCard, StorefrontSection, StorefrontPage } from "./contract";

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
  return {
    id: product.id,
    title: product.title,
    price_cents: product.price_cents,
    currency: product.currency,
    image_url: product.image_url,
    category: (product.metadata as { category?: string } | undefined)?.category ?? null,
    ...(reason ? { reason } : {}),
    ...(position ? { position } : {}),
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
