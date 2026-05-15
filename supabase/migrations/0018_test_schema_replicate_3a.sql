-- Replicate Fase 3a alters into test_schema (matches 0016 pattern)
ALTER TABLE test_schema.session_vectors ADD COLUMN IF NOT EXISTS
  current_recipient_id uuid;
ALTER TABLE test_schema.session_vectors ADD COLUMN IF NOT EXISTS
  current_cohort_id text;
ALTER TABLE test_schema.session_vectors ADD COLUMN IF NOT EXISTS
  signal_window jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE test_schema.session_vectors ADD COLUMN IF NOT EXISTS
  signal_window_size smallint NOT NULL DEFAULT 0;

ALTER TABLE test_schema.user_profile_modes ADD COLUMN IF NOT EXISTS
  cohort_id text;
ALTER TABLE test_schema.user_profile_modes DROP CONSTRAINT IF EXISTS user_profile_modes_uniq;
ALTER TABLE test_schema.user_profile_modes ADD CONSTRAINT user_profile_modes_uniq
  UNIQUE (user_profile_id, recipient_id, cohort_id, mode_index);

CREATE UNIQUE INDEX IF NOT EXISTS excluded_products_anon_product_uniq_test
  ON test_schema.excluded_products (anonymous_id, product_id)
  WHERE anonymous_id IS NOT NULL AND user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS excluded_products_user_product_uniq_test
  ON test_schema.excluded_products (user_id, product_id)
  WHERE user_id IS NOT NULL;
