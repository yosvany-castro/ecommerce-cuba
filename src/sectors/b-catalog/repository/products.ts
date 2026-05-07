import type { Client } from "pg";
import { withPg } from "@/lib/db/helpers";

export interface ProductListRow {
  id: string;
  title: string;
  description: string;
  price_cents: number;
  currency: string;
  image_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

async function exec<T>(pg: Client | undefined, fn: (pg: Client) => Promise<T>): Promise<T> {
  if (pg) return fn(pg);
  return withPg(fn);
}

export async function listByDate(opts: { limit?: number; offset?: number; pg?: Client } = {}): Promise<ProductListRow[]> {
  return exec(opts.pg, async (pg) => {
    const r = await pg.query(
      `SELECT id, title, description, price_cents, currency, image_url, metadata, created_at
       FROM products
       WHERE is_active = true
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [opts.limit ?? 20, opts.offset ?? 0],
    );
    return r.rows;
  });
}

export async function getById(id: string, pg?: Client): Promise<ProductListRow | null> {
  return exec(pg, async (pg) => {
    const r = await pg.query(
      `SELECT id, title, description, price_cents, currency, image_url, metadata, created_at
       FROM products
       WHERE id = $1 AND is_active = true`,
      [id],
    );
    return r.rows[0] ?? null;
  });
}

export async function searchLike(opts: { query: string; limit?: number; pg?: Client }): Promise<ProductListRow[]> {
  return exec(opts.pg, async (pg) => {
    const r = await pg.query(
      `SELECT id, title, description, price_cents, currency, image_url, metadata, created_at
       FROM products
       WHERE is_active = true
         AND (title ILIKE $1 OR description ILIKE $1)
       ORDER BY created_at DESC
       LIMIT $2`,
      [`%${opts.query}%`, opts.limit ?? 30],
    );
    return r.rows;
  });
}
