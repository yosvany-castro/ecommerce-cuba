CREATE TABLE IF NOT EXISTS public.events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_event_id text,
  anonymous_id    uuid NOT NULL,
  user_id         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  session_id      uuid NOT NULL,
  event_type      text NOT NULL,
  occurred_at     timestamptz NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  source          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS events_client_event_id_uniq
  ON public.events (client_event_id) WHERE client_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_anon_time_idx
  ON public.events (anonymous_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS events_user_time_idx
  ON public.events (user_id, occurred_at DESC) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_type_time_idx
  ON public.events (event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS events_session_idx
  ON public.events (session_id, occurred_at);
