import type { Client } from "pg";
import type { RankedProduct } from "./rrf";
import type { SearchFilters } from "./bm25";

export async function cosineSearch(
  queryEmbedding: number[],
  filters: SearchFilters,
  K: number,
  pg: Client,
): Promise<RankedProduct[]> {
  const cats = filters.categories?.length ? filters.categories : null;
  const r = await pg.query(
    `SELECT id, 1 - (embedding <=> $1::vector) AS score
     FROM products
     WHERE is_active = true AND embedding IS NOT NULL
       AND ($2::text[] IS NULL OR (metadata->>'category') = ANY($2::text[]))
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    ["[" + queryEmbedding.join(",") + "]", cats, K],
  );
  return r.rows.map((row, i) => ({ id: row.id, rank: i + 1, score: Number(row.score) }));
}
