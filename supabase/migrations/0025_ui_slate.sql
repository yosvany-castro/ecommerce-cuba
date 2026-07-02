-- 0025: server-driven UI — section catalog (ui_sections) and per-surface
-- composition (ui_placements).
--
-- WHY (spec 2026-06-10, capa 2): pages stop being hardcoded JSX — composePage
-- reads WHICH sections to show, in what order, under which per-user rules.
-- This is also the Fase-2 seam: AI merchandiser agents will WRITE rows here
-- (status/risk_tier encode the approval workflow; nothing else changes).
--
-- Column-vs-jsonb rule (deep-dive composepage-contracts): everything
-- composePage READS to decide behaviour is an explicit column with CHECKs;
-- jsonb only for what the resolver interprets (params) and the rule.

CREATE TABLE IF NOT EXISTS public.ui_sections (
  section_type   TEXT PRIMARY KEY,
  title_default  TEXT NOT NULL,
  display        TEXT NOT NULL CHECK (display IN ('grid', 'carousel')),
  -- layout contract consumed by renderer + skeleton + shell space reservation
  -- (single source of CLS truth): {card_aspect, rows, min_height_px...}
  layout         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- JSON Schema copy of the resolver's Zod params (admin/agent write-time
  -- validation; runtime truth is the Zod schema in the resolver).
  params_schema  JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  freshness_policy TEXT NOT NULL DEFAULT 'per_request'
    CHECK (freshness_policy IN ('per_session_snapshot', 'per_request', 'per_visit', 'nightly')),
  -- 0 = never sacrificed (main feed); higher = first to degrade on budget.
  priority       SMALLINT NOT NULL DEFAULT 3 CHECK (priority >= 0),
  min_items      SMALLINT NOT NULL DEFAULT 1 CHECK (min_items >= 1),
  budget_ms      INT NOT NULL DEFAULT 400 CHECK (budget_ms > 0),
  budget_queries SMALLINT NOT NULL DEFAULT 1 CHECK (budget_queries >= 0),
  title_template TEXT,
  schema_version INT NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ui_placements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surface       TEXT NOT NULL CHECK (surface IN ('home', 'pdp', 'cart', 'search')),
  -- vertical order; gaps of 10 so agents can insert between slots.
  slot          SMALLINT NOT NULL,
  section_type  TEXT NOT NULL REFERENCES public.ui_sections(section_type),
  params        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- declarative rule DSL (NULL = always); validated with Zod at write AND
  -- load time, evaluated fail-closed per request against the user context.
  rule          JSONB,
  scope         TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'segment', 'user')),
  scope_ref     TEXT,
  status        TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending', 'approved', 'paused', 'archived', 'killed')),
  risk_tier     TEXT NOT NULL DEFAULT 'low' CHECK (risk_tier IN ('low', 'medium', 'high')),
  experiment_id TEXT,
  ttl_until     TIMESTAMPTZ,
  created_by    TEXT NOT NULL DEFAULT 'seed',
  version       INT NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (scope = 'global' OR scope_ref IS NOT NULL)
);

-- Hot read: all live placements of a surface (global+segment; user-scoped rows
-- are looked up per request only when the hasUserScoped flag is set).
CREATE INDEX IF NOT EXISTS idx_ui_placements_surface_live
  ON public.ui_placements (surface, slot) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_ui_placements_user_scope
  ON public.ui_placements (scope_ref, surface) WHERE status = 'approved' AND scope = 'user';

-- 'killed' is IRREVERSIBLE at the data layer (guardrail kills must not be
-- resurrectable by a misaligned agent — convention in a prompt is not a
-- guarantee; this trigger is).
CREATE OR REPLACE FUNCTION public.ui_placements_killed_is_final()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'killed' AND NEW.status <> 'killed' THEN
    RAISE EXCEPTION 'ui_placements: status=killed is irreversible (placement %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ui_placements_killed_final ON public.ui_placements;
CREATE TRIGGER trg_ui_placements_killed_final
  BEFORE UPDATE ON public.ui_placements
  FOR EACH ROW EXECUTE FUNCTION public.ui_placements_killed_is_final();

-- ── test_schema replicas (FK + trigger recreated against test tables). ──
CREATE TABLE IF NOT EXISTS test_schema.ui_sections (
  LIKE public.ui_sections INCLUDING ALL
);
CREATE TABLE IF NOT EXISTS test_schema.ui_placements (
  LIKE public.ui_placements INCLUDING ALL
);

DROP TRIGGER IF EXISTS trg_ui_placements_killed_final_ts ON test_schema.ui_placements;
CREATE TRIGGER trg_ui_placements_killed_final_ts
  BEFORE UPDATE ON test_schema.ui_placements
  FOR EACH ROW EXECUTE FUNCTION public.ui_placements_killed_is_final();
