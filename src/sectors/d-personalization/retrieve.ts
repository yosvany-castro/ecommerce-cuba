import type { Client } from "pg";
import type { ProductListRow } from "@/sectors/b-catalog/repository/products";

export interface FeedItem {
  product: ProductListRow;
  similarity: number;
  reason?: string;
  /** Posición ABSOLUTA en el slate (para el reporte de viewport, E3). */
  position?: number;
}

export async function retrieveTopKByVector(
  vector: number[],
  excludedIds: string[],
  K: number,
  pg: Client,
): Promise<FeedItem[]> {
  const r = await pg.query(
    `SELECT id, title, description, price_cents, currency, image_url, url, metadata, created_at,
            1 - (embedding <=> $1::vector) AS similarity
     FROM products
     WHERE is_active = true
       AND embedding IS NOT NULL
       AND NOT (id = ANY($2::uuid[]))
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    ["[" + vector.join(",") + "]", excludedIds, K],
  );
  return r.rows.map((row) => ({
    product: {
      id: row.id,
      title: row.title,
      description: row.description,
      price_cents: row.price_cents,
      currency: row.currency,
      image_url: row.image_url,
      url: row.url,
      metadata: row.metadata,
      created_at: row.created_at,
    },
    similarity: Number(row.similarity),
  }));
}
