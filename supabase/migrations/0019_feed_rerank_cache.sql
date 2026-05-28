CREATE TABLE IF NOT EXISTS public.feed_rerank_cache (
  cache_key       text PRIMARY KEY,
  user_profile_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  top10_json      jsonb NOT NULL,
  prompt_version  text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  ttl_until       timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS feed_rerank_cache_profile_ttl_idx
  ON public.feed_rerank_cache(user_profile_id, ttl_until);

CREATE INDEX IF NOT EXISTS feed_rerank_cache_ttl_idx
  ON public.feed_rerank_cache(ttl_until);
