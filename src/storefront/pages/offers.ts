// src/storefront/pages/offers.ts — ofertas del día (bento v2 + ruta /ofertas).
// Selección nocturna persistida (daily_offers, cron:ofertas); fallback en vivo
// con el MISMO criterio si el cron aún no corrió hoy — la columna del bento
// jamás queda vacía y el descuento SIEMPRE es real (old_price del proveedor).
import "server-only";
import { withPg } from "@/lib/db/helpers";
import type { StorefrontCard } from "@/storefront/contract";
import { imgSrc } from "@/lib/img";

interface OfferRow {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  image_url: string | null;
  source: string;
  category: string | null;
  old_price_cents: number | null;
  rating: number | null;
}

const OFFER_SELECT = `
  SELECT p.id, p.title, p.price_cents, p.currency, p.image_url, p.source,
         p.metadata->>'category' AS category,
         (p.metadata->'attrs'->>'old_price_cents')::int AS old_price_cents,
         (p.metadata->'attrs'->>'rating')::float AS rating
  FROM products p`;

function toOfferCard(r: OfferRow): StorefrontCard {
  return {
    id: r.id,
    title: r.title,
    price_cents: r.price_cents,
    currency: r.currency,
    image_url: imgSrc(r.image_url, r.source, 350),
    category: r.category,
    source: r.source,
    attrs: {
      ...(r.old_price_cents != null ? { old_price_cents: r.old_price_cents } : {}),
      ...(r.rating != null ? { rating: r.rating } : {}),
    },
  };
}

export async function getDailyOffers(): Promise<{ cards: StorefrontCard[]; total: number }> {
  return withPg(async (pg) => {
    const fixed = await pg.query(`SELECT product_ids FROM daily_offers WHERE day = CURRENT_DATE`);
    const ids: string[] | null = fixed.rows[0]?.product_ids ?? null;
    const r = ids
      ? await pg.query(`${OFFER_SELECT} WHERE p.id = ANY($1::uuid[]) AND p.is_active = true`, [ids])
      : await pg.query(
          `${OFFER_SELECT}
           WHERE p.is_active = true AND p.image_url IS NOT NULL AND p.image_url <> ''
             AND (p.metadata->'attrs'->>'old_price_cents')::int > p.price_cents
           ORDER BY ((p.metadata->'attrs'->>'old_price_cents')::int - p.price_cents)::float
                    / NULLIF((p.metadata->'attrs'->>'old_price_cents')::int, 0) DESC
           LIMIT 12`,
        );
    const rows = r.rows as OfferRow[];
    // conserva el orden fijado del cron
    const byId = new Map(rows.map((x) => [x.id, x]));
    const ordered = ids ? ids.map((id) => byId.get(id)).filter((x): x is OfferRow => !!x) : rows;
    return { cards: ordered.map(toOfferCard), total: ordered.length };
  });
}
