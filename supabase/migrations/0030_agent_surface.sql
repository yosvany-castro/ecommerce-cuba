-- 0030: agent write surface (Fase 2 C0) — auditoría + idempotencia + lectura.
--
-- proposal_key: idempotency key sha256(surface|slot|action|target|YYYY-MM-DD).
-- Re-running the daily cron after a mid-run crash must be exactly-once per
-- action/day: INSERT ... ON CONFLICT (proposal_key) DO NOTHING. Partial unique
-- index so seed/test/human rows (key NULL) never participate.
--
-- proposal_meta: AUDIT ONLY (rationale, run_id, metrics snapshot hash,
-- supersedes). composePage NEVER reads it — column-vs-jsonb rule of 0025.

ALTER TABLE public.ui_placements
  ADD COLUMN IF NOT EXISTS proposal_key  TEXT,
  ADD COLUMN IF NOT EXISTS proposal_meta JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ui_placements_proposal_key
  ON public.ui_placements (proposal_key) WHERE proposal_key IS NOT NULL;

-- Metrics-layer read indexes: the agent's offline scans filter
-- feed_impressions by served_at and purchase_attributions by attributed_at;
-- neither had an index (verified 0023/0024/0029) — fine today, seq-scan pain
-- with the tables at the full 90d window.
CREATE INDEX IF NOT EXISTS idx_feed_impressions_served_at
  ON public.feed_impressions (served_at);
CREATE INDEX IF NOT EXISTS idx_purchase_attr_attributed_at
  ON public.purchase_attributions (attributed_at);

-- ── test_schema replicas. The replicas were created with LIKE, so new
--    columns/indexes must be applied explicitly here (patrón 0024:98-107). ──
ALTER TABLE test_schema.ui_placements
  ADD COLUMN IF NOT EXISTS proposal_key  TEXT,
  ADD COLUMN IF NOT EXISTS proposal_meta JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ui_placements_proposal_key_ts
  ON test_schema.ui_placements (proposal_key) WHERE proposal_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_feed_impressions_served_at_ts
  ON test_schema.feed_impressions (served_at);
CREATE INDEX IF NOT EXISTS idx_purchase_attr_attributed_at_ts
  ON test_schema.purchase_attributions (attributed_at);
