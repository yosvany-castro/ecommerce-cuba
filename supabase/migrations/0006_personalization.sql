CREATE TABLE IF NOT EXISTS public.user_profiles (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_id            uuid,
  user_id                 uuid REFERENCES public.users(id) ON DELETE CASCADE,
  n_events                integer NOT NULL DEFAULT 0,
  cohort_id               text,
  prior_vector            vector(1024),
  interpretable_profile   jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_recompute_at       timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_profiles_identity_xor CHECK (
    (anonymous_id IS NOT NULL) OR (user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_anon_uniq
  ON public.user_profiles (anonymous_id) WHERE anonymous_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_user_uniq
  ON public.user_profiles (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.user_profile_modes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_profile_id       uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  recipient_id          uuid REFERENCES public.recipients(id) ON DELETE CASCADE,
  mode_index            smallint NOT NULL CHECK (mode_index BETWEEN 1 AND 3),
  vector_unnormalized   vector(1024) NOT NULL,
  weight_sum            double precision NOT NULL DEFAULT 0,
  n_events_in_mode      integer NOT NULL DEFAULT 0,
  last_assigned_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_profile_modes_uniq UNIQUE (user_profile_id, recipient_id, mode_index)
);

CREATE INDEX IF NOT EXISTS user_profile_modes_profile_idx
  ON public.user_profile_modes (user_profile_id);

CREATE TABLE IF NOT EXISTS public.session_vectors (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            uuid NOT NULL UNIQUE,
  vector_unnormalized   vector(1024) NOT NULL,
  weight_sum            double precision NOT NULL DEFAULT 0,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cohort_centroids (
  cohort_id           text PRIMARY KEY,
  centroid_vector     vector(1024) NOT NULL,
  n_users_in_cohort   integer NOT NULL DEFAULT 0,
  last_recompute_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.excluded_products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_id    uuid,
  user_id         uuid REFERENCES public.users(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  excluded_at     timestamptz NOT NULL DEFAULT now(),
  ttl_until       timestamptz NOT NULL,
  CONSTRAINT excluded_products_identity_xor CHECK (
    (anonymous_id IS NOT NULL) OR (user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS excluded_products_anon_ttl_idx
  ON public.excluded_products (anonymous_id, ttl_until) WHERE anonymous_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS excluded_products_user_ttl_idx
  ON public.excluded_products (user_id, ttl_until) WHERE user_id IS NOT NULL;
