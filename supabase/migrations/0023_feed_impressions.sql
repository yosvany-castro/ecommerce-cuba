-- 0023: feed impression log with exploration propensities.
--
-- WHY (auditoría 2026-06-09 / diseño 2026-06-09 §roadmap #7): the feed had no
-- impression logging and no exploration, so (a) off-policy evaluation
-- (src/thesis/eval/ope.ts — IPS/SNIPS/DR) had no logging propensities to work
-- with (dead code), and (b) the retrain-on-own-recommendations loop risks
-- degenerate feedback (Jiang et al., AIES 2019) with no way to detect it.
-- Every served feed now logs one row per slot with the slot's serving
-- propensity: exploit slots are deterministic given the pipeline (p = 1−ε),
-- explore slots are uniform draws from the candidate pool (p = ε/|pool|).
--
-- No FKs on purpose: impression logging must be cheap and must never fail a
-- feed request (writes are fire-and-forget inside a try/catch).

CREATE TABLE IF NOT EXISTS public.feed_impressions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  feed_request_id UUID NOT NULL,
  user_profile_id UUID,
  session_id TEXT,
  position SMALLINT NOT NULL,
  product_id UUID NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('exploit', 'explore')),
  propensity DOUBLE PRECISION NOT NULL CHECK (propensity > 0 AND propensity <= 1),
  served_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feed_impressions_request
  ON public.feed_impressions (feed_request_id);
CREATE INDEX IF NOT EXISTS idx_feed_impressions_product_served
  ON public.feed_impressions (product_id, served_at);
CREATE INDEX IF NOT EXISTS idx_feed_impressions_session
  ON public.feed_impressions (session_id);

-- test_schema replica (integration tests resolve unqualified names here first).
CREATE TABLE IF NOT EXISTS test_schema.feed_impressions (
  LIKE public.feed_impressions INCLUDING ALL
);
