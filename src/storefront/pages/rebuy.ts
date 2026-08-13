// src/storefront/pages/rebuy.ts — "comprar de nuevo" (bento v2): lo último que
// COMPRÓ esta identidad (cuenta real o demo|anónimo). Sin compras → [] y el
// bento cae a "tendencia hoy" (honesto, sin inventar historial).
import "server-only";
import { withPg } from "@/lib/db/helpers";
import type { StorefrontCard } from "@/storefront/contract";
import { imgSrc } from "@/lib/img";

export async function getRebuy(
  userId: string | null,
  anonymousId: string | null,
  limit = 3,
): Promise<StorefrontCard[]> {
  return withPg(async (pg) => {
    let uid = userId;
    if (!uid && anonymousId) {
      const u = await pg.query(`SELECT id FROM users WHERE auth_sub = $1`, [`demo|${anonymousId}`]);
      uid = u.rows[0]?.id ?? null;
    }
    if (!uid) return [];
    const r = await pg.query(
      `SELECT DISTINCT ON (oi.product_id)
              oi.product_id AS id, p.title, p.price_cents, p.currency, p.image_url,
              p.source, p.metadata->>'category' AS category, o.created_at
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id AND p.is_active = true
       WHERE o.user_id = $1
       ORDER BY oi.product_id, o.created_at DESC`,
      [uid],
    );
    const rows = r.rows as { id: string; title: string; price_cents: number; currency: string; image_url: string | null; source: string; category: string | null; created_at: string }[];
    rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return rows.slice(0, limit).map((x) => ({
      id: x.id,
      title: x.title,
      price_cents: x.price_cents,
      currency: x.currency,
      image_url: imgSrc(x.image_url, x.source, 350),
      category: x.category,
      source: x.source,
    }));
  });
}
