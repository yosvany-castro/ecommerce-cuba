-- 0024: slate backbone — consolidated attribution columns on feed_impressions,
-- the materialized per-session slate (feed_slates), and the served-composition
-- log (slate_decisions).
--
-- WHY (spec 2026-06-10 dynamic-web-pageslate, capa 5): this is the IRREVERSIBLE
-- point of the program. The infinite-scroll cursor must carry
-- {slate_id, absolute position, config_version, seed} and every impression must
-- be attributable to the placement/section/experiment that produced it — none
-- of which can be reconstructed retroactively if not logged from day one.
-- ONE owner migration (five design clusters each wanted columns here; this is
-- the single consolidated schema).
--
-- feed_impressions new columns:
--   seen_at           viewport confirmation (IntersectionObserver ≥50%/≥1s,
--                     Etapa E). served_at = had the chance; seen_at = actually
--                     examined. Fatigue/guardrail denominators MUST use seen.
--   page_request_id   the serve call that produced this row (page 2+ of a
--                     cursor gets its own page_request_id; feed_request_id
--                     stays = the slate's original request for grouping).
--   section_id        ui_sections.section_type that served the slot (NULL for
--                     the pre-slate feed).
--   placement_version ui_placements.version at serve time (config attribution
--                     across the 60s config-cache window).
--   policy            ranking policy label ('default', 'reroll', holdout arm…)
--                     — ε must be constant WITHIN a policy for OPE.
--   experiment_id     denormalized experiment tag (NULL = no experiment).
--
-- unique(feed_request_id, position): a page retry on a lossy network must be
-- ON CONFLICT DO NOTHING, never a duplicate impression.

ALTER TABLE public.feed_impressions
  ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS page_request_id UUID,
  ADD COLUMN IF NOT EXISTS section_id TEXT,
  ADD COLUMN IF NOT EXISTS placement_version INT,
  ADD COLUMN IF NOT EXISTS policy TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS experiment_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS feed_impressions_request_position_uniq
  ON public.feed_impressions (feed_request_id, position);
CREATE INDEX IF NOT EXISTS idx_feed_impressions_experiment
  ON public.feed_impressions (experiment_id, served_at)
  WHERE experiment_id IS NOT NULL;

-- ── Materialized slate: the immutable post-exploration top-N a session pages
--    through. Hit path replaces the ~15-query feed recompute with 1 read.
--    items: [{product_id, position, source, propensity}] (absolute positions).
--    pins:  product_ids clicked this session (cap enforced in app code).
--    spares: backfill candidates for dismiss-compaction (never re-ranked).
--    Regeneration = NEW row (old rows keep attribution); expiry is evaluated
--    lazily by readers (expires_at = soft-TTL; session/shift logic in app). ──
CREATE TABLE IF NOT EXISTS public.feed_slates (
  slate_id UUID PRIMARY KEY,
  user_profile_id UUID,
  anonymous_id UUID,
  session_id TEXT NOT NULL,
  surface TEXT NOT NULL DEFAULT 'home',
  version INT NOT NULL DEFAULT 1,
  items JSONB NOT NULL,
  pins JSONB NOT NULL DEFAULT '[]'::jsonb,
  spares JSONB NOT NULL DEFAULT '[]'::jsonb,
  config_version TEXT,
  policy TEXT NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_feed_slates_session_surface
  ON public.feed_slates (session_id, surface, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_slates_expires
  ON public.feed_slates (expires_at) WHERE expires_at IS NOT NULL;

-- ── Served-composition log: WHICH placements composed each served slate
--    (composePage's decision record). placements: [{placement_id, slot,
--    section_type, version}]. holdout: 10% of profiles always get the
--    baseline — excluded from every experiment, the clean denominator. ──
CREATE TABLE IF NOT EXISTS public.slate_decisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slate_id UUID NOT NULL,
  surface TEXT NOT NULL,
  user_profile_id UUID,
  session_id TEXT,
  config_version TEXT,
  holdout BOOLEAN NOT NULL DEFAULT false,
  experiment_id TEXT,
  placements JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slate_decisions_slate
  ON public.slate_decisions (slate_id);
CREATE INDEX IF NOT EXISTS idx_slate_decisions_experiment
  ON public.slate_decisions (experiment_id, created_at)
  WHERE experiment_id IS NOT NULL;

-- ── test_schema replicas. The 0023 replica was created with LIKE, so the new
--    feed_impressions columns/indexes must be applied explicitly here. ──
ALTER TABLE test_schema.feed_impressions
  ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS page_request_id UUID,
  ADD COLUMN IF NOT EXISTS section_id TEXT,
  ADD COLUMN IF NOT EXISTS placement_version INT,
  ADD COLUMN IF NOT EXISTS policy TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS experiment_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS feed_impressions_request_position_uniq_ts
  ON test_schema.feed_impressions (feed_request_id, position);

CREATE TABLE IF NOT EXISTS test_schema.feed_slates (
  LIKE public.feed_slates INCLUDING ALL
);
CREATE TABLE IF NOT EXISTS test_schema.slate_decisions (
  LIKE public.slate_decisions INCLUDING ALL
);
