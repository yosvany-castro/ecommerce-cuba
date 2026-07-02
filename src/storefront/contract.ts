// src/storefront/contract.ts — the only module the visual layer imports. Pure types.
export interface StorefrontCard {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  image_url: string | null;
  reason?: string;
  position?: number;
}
export interface StorefrontSection {
  placement_id: string;
  section_type: string;
  title: string;
  display: string; // "grid" | "carousel"
  outcome: string;
  items: StorefrontCard[];
  next_cursor?: string | null;
  slate_id?: string | null;
}
export interface StorefrontPage {
  composition_id: string;
  surface: string;
  sections: StorefrontSection[];
}
