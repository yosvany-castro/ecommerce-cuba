import type { Client } from "pg";
import { PROMPT_VERSION } from "./prompt";

export const CACHE_TTL_HOURS = 4;

export interface CachedRerankItem {
  product_id: string;
  rank: number;
  reason: string;
}

export async function lookupRerankCache(
  cache_key: string,
  pg: Client,
): Promise<CachedRerankItem[] | null> {
  const r = await pg.query(
    `SELECT top10_json FROM feed_rerank_cache
     WHERE cache_key = $1 AND ttl_until > now()`,
    [cache_key],
  );
  if (r.rows.length === 0) return null;
  return r.rows[0].top10_json as CachedRerankItem[];
}

export async function writeRerankCache(
  cache_key: string,
  user_profile_id: string,
  items: CachedRerankItem[],
  pg: Client,
): Promise<void> {
  await pg.query(
    `INSERT INTO feed_rerank_cache
       (cache_key, user_profile_id, top10_json, prompt_version, ttl_until)
     VALUES ($1, $2, $3::jsonb, $4, now() + ($5 || ' hours')::interval)
     ON CONFLICT (cache_key) DO UPDATE SET
       top10_json = EXCLUDED.top10_json,
       prompt_version = EXCLUDED.prompt_version,
       ttl_until = EXCLUDED.ttl_until`,
    [
      cache_key,
      user_profile_id,
      JSON.stringify(items),
      PROMPT_VERSION,
      CACHE_TTL_HOURS,
    ],
  );
}

export async function cleanupExpiredRerankCache(pg: Client): Promise<number> {
  const r = await pg.query(
    `DELETE FROM feed_rerank_cache WHERE ttl_until <= now() RETURNING 1`,
  );
  return r.rows.length;
}
