import type { Client } from "pg";
import type { RankedProduct } from "./rrf";

export interface SearchFilters {
  categories?: string[];
  gender_target?: "femenino" | "masculino" | "unisex";
  age_min?: number;
  age_max?: number;
  price_range?: "bajo" | "medio" | "alto";
}

export async function bm25Search(
  searchTerms: string,
  filters: SearchFilters,
  K: number,
  pg: Client,
): Promise<RankedProduct[]> {
  if (!searchTerms || searchTerms.trim().length === 0) return [];
  const cats = filters.categories?.length ? filters.categories : null;
  const gender = filters.gender_target ?? null;
  const ageMin = filters.age_min ?? null;
  const ageMax = filters.age_max ?? null;
  const priceRange = filters.price_range ?? null;
  const r = await pg.query(
    `SELECT id, ts_rank_cd(tsvector_es, websearch_to_tsquery('spanish', $1)) AS score
     FROM products
     WHERE is_active = true
       AND tsvector_es @@ websearch_to_tsquery('spanish', $1)
       AND ($2::text[] IS NULL OR (metadata->>'category') = ANY($2::text[]))
       AND (
         $3::text IS NULL
         OR (metadata->>'gender_target') IS NULL
         OR (metadata->>'gender_target') = 'unisex'
         OR (metadata->>'gender_target') = $3
       )
       AND (
         $4::int IS NULL
         OR (metadata->'age_target') IS NULL
         OR (
           COALESCE((metadata->'age_target'->>'max')::int, 999) >= $4
           AND COALESCE((metadata->'age_target'->>'min')::int, 0) <= $5
         )
       )
       AND (
         $6::text IS NULL
         OR ($6 = 'bajo'  AND price_cents BETWEEN 0 AND 1999)
         OR ($6 = 'medio' AND price_cents BETWEEN 2000 AND 9999)
         OR ($6 = 'alto'  AND price_cents >= 10000)
       )
     ORDER BY score DESC
     LIMIT $7`,
    [searchTerms, cats, gender, ageMin, ageMax, priceRange, K],
  );
  return r.rows.map((row, i) => ({ id: row.id, rank: i + 1, score: Number(row.score) }));
}
