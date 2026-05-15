-- Composite index for admin filter "by method"
CREATE INDEX IF NOT EXISTS searches_method_time_idx
  ON public.searches (search_method, occurred_at DESC);

-- Index for admin filter "by prompt_version" (audit bugs by prompt revision)
CREATE INDEX IF NOT EXISTS searches_prompt_version_idx
  ON public.searches (prompt_version) WHERE prompt_version IS NOT NULL;

-- Document cache TTL semantics
COMMENT ON COLUMN public.product_query_cache.ttl_until IS
  'Rows past this timestamp are ignored by lookupExact/lookupSemantic. Cleanup via Phase 4 cron.';
