import type { NormalizedQuery } from "../normalizer/prompt";
import type { SearchMethod } from "../persist/searches";

export interface SearchTrace {
  raw_query: string;
  hash: string;
  cache: {
    exact_hit: boolean;
    semantic_hit: boolean;
    semantic_similarity?: number;
  };
  embedding: { dim: number; norm: number; sample: number[] } | null;
  normalized: (NormalizedQuery & { prompt_version: string }) | null;
  filters_applied: {
    categories?: string[];
    gender_target?: string;
    age_min?: number;
    age_max?: number;
    price_range?: string;
  };
  freshness: {
    query_hash: string;
    last_called_at: string | null;
    hours_old: number | null;
  };
  retrieval: {
    bm25: { id: string; rank: number; score: number; title: string }[];
    cosine: { id: string; rank: number; score: number; title: string }[];
    fused: {
      id: string;
      rrf_score: number;
      ranks: { bm25?: number; cosine?: number };
      title: string;
    }[];
  };
  decision: { should_call_mock: boolean; reason: string };
  mock_fallback: {
    invoked: boolean;
    products_fetched?: number;
    products_processed?: number;
    products_failed?: number;
  };
  final: {
    method: SearchMethod;
    products_count: number;
    top_10: { id: string; title: string; price_cents: number }[];
  };
  timings_ms: {
    hash?: number;
    exact_cache_lookup?: number;
    embed?: number;
    semantic_cache_lookup?: number;
    llm_normalize?: number;
    bm25?: number;
    cosine?: number;
    rrf?: number;
    freshness_check?: number;
    mock_fallback?: number;
    persist?: number;
    resolve_products?: number;
    total: number;
  };
}
