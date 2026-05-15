CREATE TABLE IF NOT EXISTS public.searches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_id       uuid,
  user_id            uuid REFERENCES public.users(id) ON DELETE SET NULL,
  raw_query          text NOT NULL,
  normalized_json    jsonb,
  prompt_version     text,
  search_method      text CHECK (search_method IN ('like', 'bm25_only', 'cosine_only', 'hybrid_rrf')),
  results_count      integer,
  hit_cache          boolean,
  called_mock        boolean,
  occurred_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS searches_user_time_idx
  ON public.searches (user_id, occurred_at DESC) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.product_query_cache (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash          text NOT NULL UNIQUE,
  query_embedding     vector(1024),
  normalized_json     jsonb,
  products_returned   uuid[] NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  ttl_until           timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS product_query_cache_ttl_idx
  ON public.product_query_cache (ttl_until);

CREATE INDEX IF NOT EXISTS product_query_cache_embedding_idx
  ON public.product_query_cache USING hnsw (query_embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS public.mock_calls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  called_at       timestamptz NOT NULL DEFAULT now(),
  params          jsonb,
  response_size   integer,
  simulated_cost_cents integer NOT NULL DEFAULT 4,
  latency_ms      integer,
  was_error       boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS mock_calls_time_idx ON public.mock_calls (called_at DESC);
