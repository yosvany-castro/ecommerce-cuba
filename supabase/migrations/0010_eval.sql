CREATE TABLE IF NOT EXISTS public.eval_holdout (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  purchased_at    timestamptz NOT NULL,
  used_in_eval    boolean NOT NULL DEFAULT false,
  CONSTRAINT eval_holdout_unique UNIQUE (user_id, product_id, purchased_at)
);

CREATE INDEX IF NOT EXISTS eval_holdout_unused_idx
  ON public.eval_holdout (used_in_eval) WHERE used_in_eval = false;
