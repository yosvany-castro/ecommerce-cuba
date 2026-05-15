-- Fase 3a — extend session_vectors with sub-bucket state
ALTER TABLE public.session_vectors ADD COLUMN IF NOT EXISTS
  current_recipient_id uuid REFERENCES public.recipients(id) ON DELETE SET NULL;
ALTER TABLE public.session_vectors ADD COLUMN IF NOT EXISTS
  current_cohort_id text;
ALTER TABLE public.session_vectors ADD COLUMN IF NOT EXISTS
  signal_window jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.session_vectors ADD COLUMN IF NOT EXISTS
  signal_window_size smallint NOT NULL DEFAULT 0;

-- Fase 3a — extend user_profile_modes with cohort_id (one row per cohort/recipient/mode)
ALTER TABLE public.user_profile_modes ADD COLUMN IF NOT EXISTS
  cohort_id text;

-- Replace uniqueness constraint to include cohort_id
ALTER TABLE public.user_profile_modes DROP CONSTRAINT IF EXISTS user_profile_modes_uniq;
ALTER TABLE public.user_profile_modes ADD CONSTRAINT user_profile_modes_uniq
  UNIQUE (user_profile_id, recipient_id, cohort_id, mode_index);

-- Fase 3a — unique indexes on excluded_products to support ON CONFLICT DO NOTHING
CREATE UNIQUE INDEX IF NOT EXISTS excluded_products_anon_product_uniq
  ON public.excluded_products (anonymous_id, product_id)
  WHERE anonymous_id IS NOT NULL AND user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS excluded_products_user_product_uniq
  ON public.excluded_products (user_id, product_id)
  WHERE user_id IS NOT NULL;
