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
}

export const CATEGORY_PAGE_SIZE = 24;

export async function fetchCategoryPage(
  category: string,
  page: number, // 1-based
  pg: Client,
): Promise<{ items: CategoryPageItem[]; hasNext: boolean }> {
  const offset = (page - 1) * CATEGORY_PAGE_SIZE;
  const usePop = await isPopularityTableReady(pg);
  const r = usePop
    ? await pg.query(
        `SELECT p.id::text, p.title, p.price_cents, p.currency, p.image_url
         FROM products p
         LEFT JOIN product_popularity_7d pop ON pop.product_id = p.id
         WHERE p.is_active = true AND p.metadata->>'category' = $1
         ORDER BY COALESCE(pop.events_7d, 0) DESC, p.created_at DESC, p.id ASC
         LIMIT $2 OFFSET $3`,
        [category, CATEGORY_PAGE_SIZE + 1, offset],
      )
    : await pg.query(
        `SELECT p.id::text, p.title, p.price_cents, p.currency, p.image_url
         FROM products p
         WHERE p.is_active = true AND p.metadata->>'category' = $1
         ORDER BY p.created_at DESC, p.id ASC
         LIMIT $2 OFFSET $3`,
        [category, CATEGORY_PAGE_SIZE + 1, offset],
      );
  const rows = r.rows as CategoryPageItem[];
  return { items: rows.slice(0, CATEGORY_PAGE_SIZE), hasNext: rows.length > CATEGORY_PAGE_SIZE };
}
