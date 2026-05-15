import type { Client } from "pg";
import type { NormalizedQuery } from "../normalizer/prompt";

export type SearchMethod = "hybrid_rrf" | "bm25_only" | "cosine_only";

export interface PersistSearchInput {
  anonymous_id: string | null;
  user_id: string | null;
  raw_query: string;
  normalized_json: (NormalizedQuery & { prompt_version: string }) | null;
  prompt_version: string | null;
  search_method: SearchMethod;
  results_count: number;
  hit_cache: boolean;
  called_mock: boolean;
}

export async function persistSearch(input: PersistSearchInput, pg: Client): Promise<void> {
  await pg.query(
    `INSERT INTO searches
       (anonymous_id, user_id, raw_query, normalized_json, prompt_version,
        search_method, results_count, hit_cache, called_mock)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)`,
    [
      input.anonymous_id,
      input.user_id,
      input.raw_query,
      input.normalized_json ? JSON.stringify(input.normalized_json) : null,
      input.prompt_version,
      input.search_method,
      input.results_count,
      input.hit_cache,
      input.called_mock,
    ],
  );
}
