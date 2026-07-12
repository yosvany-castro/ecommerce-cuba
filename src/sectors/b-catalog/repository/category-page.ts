import type { Client } from "pg";
import { isPopularityTableReady } from "@/sectors/d-personalization/popularity/recompute";

/**
 * Category landing data (D6): DETERMINISTIC, cookie-free, popularity-ordered
 * catalog pages — the crawlable/SEO surface and the honest cold variant
 * (googlebot sin cookies ve lo mismo que un humano sin cookies: cero
 * cloaking). 2 indexed queries; fast path over product_popularity_7d with a
 * created_at fallback while the cron has never run.
 */

export interface CategoryPageItem {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  image_url: string | null;
  source: string; // amazon|aliexpress|shein|walmart (T3: badge discreto de tienda)
}

export const CATEGORY_PAGE_SIZE = 24;

export async function fetchCategoryPage(
  category: string,
  page: number, // 1-based
  pg: Client,
): Promise<{ items: CategoryPageItem[]; hasNext: boolean }> {
  const offset = (page - 1) * CATEGORY_PAGE_SIZE;
  const usePop = await isPopularityTableReady(pg);
  // Barato primero (T2c): precio como criterio principal — la popularidad
  // (cuando hay tabla) sigue siendo el desempate real, pero antes de cortesía
  // por fecha. Público cubano prefiere lo barato incluso en la landing de categoría.
  const r = usePop
    ? await pg.query(
        `SELECT p.id::text, p.title, p.price_cents, p.currency, p.image_url, p.source
         FROM products p
         LEFT JOIN product_popularity_7d pop ON pop.product_id = p.id
         WHERE p.is_active = true AND p.metadata->>'category' = $1
         ORDER BY p.price_cents ASC, COALESCE(pop.events_7d, 0) DESC, p.created_at DESC, p.id ASC
         LIMIT $2 OFFSET $3`,
        [category, CATEGORY_PAGE_SIZE + 1, offset],
      )
    : await pg.query(
        `SELECT p.id::text, p.title, p.price_cents, p.currency, p.image_url, p.source
         FROM products p
         WHERE p.is_active = true AND p.metadata->>'category' = $1
         ORDER BY p.price_cents ASC, p.created_at DESC, p.id ASC
         LIMIT $2 OFFSET $3`,
        [category, CATEGORY_PAGE_SIZE + 1, offset],
      );
  const rows = r.rows as CategoryPageItem[];
  return { items: rows.slice(0, CATEGORY_PAGE_SIZE), hasNext: rows.length > CATEGORY_PAGE_SIZE };
}
