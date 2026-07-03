"use client";
// src/components/tuki/CategoryView.tsx — landing de categoría (T7): monta
// Listing sobre las cards SSR de la page server; sin fetch propio (la data
// y la paginación por enlaces viven en la page, que es la garantía SEO).
import type { StorefrontCard } from "@/storefront/contract";
import { Listing, type ListingHeader } from "./Listing";

export function CategoryView({ cards, header }: { cards: StorefrontCard[]; header: ListingHeader }) {
  return <Listing cards={cards} source="category" header={header} sidebar />;
}
