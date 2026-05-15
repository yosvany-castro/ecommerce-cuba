import type { Client } from "pg";
import type { NormalizedQuery } from "../normalizer/prompt";

export const EXACT_CACHE_TTL_SECONDS = 24 * 60 * 60;

export interface CachedQueryRow {
  query_hash: string;
  query_embedding: number[] | null;
  normalized_json: NormalizedQuery & { prompt_version: string };
  products_returned: string[];
}

interface DbRow {
  query_hash: string;
  query_embedding: string | null;
  normalized_json: NormalizedQuery & { prompt_version: string };
  products_returned: string[];
}

function decodeRow(r: DbRow): CachedQueryRow {
  return {
    query_hash: r.query_hash,
    query_embedding: r.query_embedding ? (JSON.parse(r.query_embedding) as number[]) : null,
    normalized_json: r.normalized_json,
    products_returned: r.products_returned,
  };
}

export async function lookupExact(hash: string, pg: Client): Promise<CachedQueryRow | null> {
  const r = await pg.query(
    `SELECT query_hash, query_embedding::text AS query_embedding,
            normalized_json, products_returned
     FROM product_query_cache
     WHERE query_hash = $1 AND ttl_until > now()`,
    [hash],
  );
  if (r.rows.length === 0) return null;
  return decodeRow(r.rows[0] as DbRow);
}

export interface WriteExactInput {
  query_hash: string;
  query_embedding: number[];
  normalized_json: NormalizedQuery & { prompt_version: string };
  products_returned: string[];
  ttl_seconds?: number;
}

export async function writeExact(input: WriteExactInput, pg: Client): Promise<void> {
  await pg.query(
    `INSERT INTO product_query_cache
       (query_hash, query_embedding, normalized_json, products_returned, ttl_until)
     VALUES ($1, $2::vector, $3::jsonb, $4::uuid[], now() + ($5 || ' seconds')::interval)
     ON CONFLICT (query_hash) DO UPDATE SET
       query_embedding = EXCLUDED.query_embedding,
       normalized_json = EXCLUDED.normalized_json,
       products_returned = EXCLUDED.products_returned,
       ttl_until = EXCLUDED.ttl_until`,
    [
      input.query_hash,
      "[" + input.query_embedding.join(",") + "]",
      JSON.stringify(input.normalized_json),
      input.products_returned,
      String(input.ttl_seconds ?? EXACT_CACHE_TTL_SECONDS),
    ],
  );
}
