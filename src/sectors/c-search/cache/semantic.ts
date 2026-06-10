import type { Client } from "pg";
import type { CachedQueryRow } from "./exact";

export const DEFAULT_THETA = 0.92;

/**
 * Similarity threshold for the semantic cache, configurable via
 * SEMANTIC_CACHE_THRESHOLD. Default stays at 0.92 so behavior is unchanged
 * until a calibrated value is deployed.
 *
 * Why configurable: 0.92 was decreed, not calibrated. The F6 audit measured
 * E0/Voyage anisotropy at mean cosine 0.613 between random pairs — the
 * "floor" of cosine similarity is not 0, so any fixed θ implies an unknown
 * false-positive rate. scripts/calibrate-semantic-cache.ts estimates the
 * FPR/TPR trade-off empirically (mentor Fix 3); the definitive θ must come
 * from real query logs.
 *
 * Invalid values (non-numeric, outside (0, 1]) fall back to DEFAULT_THETA:
 * a misconfigured env var must never silently disable the threshold (θ≤0
 * would make every cached row a hit) or make it unsatisfiable (θ>1).
 */
export function getSemanticCacheTheta(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.SEMANTIC_CACHE_THRESHOLD;
  if (raw === undefined || raw.trim() === "") return DEFAULT_THETA;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return DEFAULT_THETA;
  return parsed;
}

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
