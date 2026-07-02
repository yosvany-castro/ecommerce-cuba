-- 0029: purchase attribution (F1) — the conversion reward, finally joinable.
--
-- WHY (crítico del diseño 2026-06-10): orders/purchase events never linked to
-- the impressions that caused them — the reward of the WHOLE system was
-- irrecoverable. One row per purchased product: which slate exposure (if any)
-- preceded it, at what position, exploit/explore, under which policy, and
-- whether the user actually SAW it (viewport) — the denominators experiments
-- and Fase-2 agents will read. NULL feed_request_id = organic purchase
-- (search/category/direct), counted too: attribution must never inflate the
-- feed's credit by dropping organics.

CREATE TABLE IF NOT EXISTS public.purchase_attributions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id UUID NOT NULL,
  product_id UUID NOT NULL,
  feed_request_id UUID,
  position SMALLINT,
  source TEXT,
  policy TEXT,
  seen BOOLEAN NOT NULL DEFAULT false,
  unit_price_cents INT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_attr_order ON public.purchase_attributions (order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_attr_feed
  ON public.purchase_attributions (feed_request_id) WHERE feed_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS test_schema.purchase_attributions (
  LIKE public.purchase_attributions INCLUDING ALL
);
