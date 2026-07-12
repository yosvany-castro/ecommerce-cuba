// src/storefront/contract.ts — the only module the visual layer imports. Pure types.
export interface StorefrontCard {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  image_url: string | null;
  category?: string | null; // metadata.category normalizada (ropa|electronica|hogar|juguetes_bebe|belleza|otros)
  source: string; // products.source, NOT NULL: amazon|aliexpress|shein|walmart (T3: badge discreto de tienda)
  reason?: string;
  position?: number;
  // metadata.attrs curado (A4), presente solo si el proveedor real trajo algo.
  attrs?: {
    colors?: { name: string; hex?: string }[];
    sizes?: string[];
    images?: string[];
    old_price_cents?: number;
    rating?: number;
    sold?: string; // ya formateado ("1.2k"), no el `orders` crudo
    hydrated_at?: string; // nuevo — gate cliente
    // Combinaciones color/talla reales (Apify hydrate) — precio/foto/stock
    // por combinación exacta. Ver matchVariant en components/tuki/lib.ts.
    variants?: { color?: string; size?: string; price_cents?: number; available?: boolean; image?: string }[];
  };
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
