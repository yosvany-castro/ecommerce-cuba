import type { Client } from "pg";
import type { CachedQueryRow } from "./exact";

export const DEFAULT_THETA = 0.92;

export async function lookupSemantic(
  queryEmbedding: number[],
  theta: number,
  pg: Client,
): Promise<CachedQueryRow | null> {
  const r = await pg.query(
    `SELECT query_hash, query_embedding::text AS query_embedding,
            normalized_json, products_returned,
            1 - (query_embedding <=> $1::vector) AS similarity
     FROM product_query_cache
     WHERE ttl_until > now() AND query_embedding IS NOT NULL
     ORDER BY query_embedding <=> $1::vector
     LIMIT 1`,
    ["[" + queryEmbedding.join(",") + "]"],
  );
  if (r.rows.length === 0) return null;
  if (Number(r.rows[0].similarity) < theta) return null;
  const row = r.rows[0];
  return {
    query_hash: row.query_hash,
    query_embedding: row.query_embedding ? (JSON.parse(row.query_embedding) as number[]) : null,
    normalized_json: row.normalized_json,
    products_returned: row.products_returned,
  };
}
