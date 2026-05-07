CREATE TABLE IF NOT EXISTS public.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth0_sub     text UNIQUE,
  email         text UNIQUE NOT NULL,
  name          text,
  balance_cents integer NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.anonymous_sessions (
  anonymous_id   uuid PRIMARY KEY,
  user_id        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS anonymous_sessions_user_idx
  ON public.anonymous_sessions(user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.recipients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  gender          text CHECK (gender IN ('femenino', 'masculino', 'no_especifica')),
  age             smallint CHECK (age IS NULL OR (age >= 0 AND age <= 130)),
  address_cuba    jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recipients_user_idx ON public.recipients(user_id);
