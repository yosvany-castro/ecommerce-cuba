import type { Client } from "pg";
import type { RankedProduct } from "./rrf";

export interface SearchFilters {
  categories?: string[];
  // gender_target/age_target/price_range deferred to Phase 3a
}

export async function bm25Search(
  searchTerms: string,
  filters: SearchFilters,
  K: number,
  pg: Client,
): Promise<RankedProduct[]> {
  if (!searchTerms || searchTerms.trim().length === 0) return [];
  const cats = filters.categories?.length ? filters.categories : null;
  const r = await pg.query(
    `SELECT id, ts_rank_cd(tsvector_es, websearch_to_tsquery('spanish', $1)) AS score
     FROM products
     WHERE is_active = true
       AND tsvector_es @@ websearch_to_tsquery('spanish', $1)
       AND ($2::text[] IS NULL OR (metadata->>'category') = ANY($2::text[]))
     ORDER BY score DESC
     LIMIT $3`,
    [searchTerms, cats, K],
  );
  return r.rows.map((row, i) => ({ id: row.id, rank: i + 1, score: Number(row.score) }));
}
