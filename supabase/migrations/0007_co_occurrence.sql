CREATE TABLE IF NOT EXISTS public.co_occurrence (
  product_a_id    uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_b_id    uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  count           double precision NOT NULL DEFAULT 0,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_a_id, product_b_id),
  CONSTRAINT co_occurrence_ordered CHECK (product_a_id < product_b_id)
);

CREATE INDEX IF NOT EXISTS co_occurrence_b_a_idx
  ON public.co_occurrence (product_b_id, product_a_id);

CREATE TABLE IF NOT EXISTS public.co_occurrence_top (
  product_id           uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  related_product_id   uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  npmi_score           double precision NOT NULL,
  rank                 smallint NOT NULL CHECK (rank BETWEEN 1 AND 50),
  last_recompute_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, related_product_id)
);

CREATE INDEX IF NOT EXISTS co_occurrence_top_rank_idx
  ON public.co_occurrence_top (product_id, rank);
