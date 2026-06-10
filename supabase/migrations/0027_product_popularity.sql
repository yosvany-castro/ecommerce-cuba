-- 0027: materialized 7-day popularity (product_popularity_7d).
--
-- WHY (deep-dive composepage-contracts Q2 — the cheapest latency lever):
-- fetchPopularGlobal, fetchEventCounts7d and the views-categories source each
-- re-aggregate SEVEN DAYS of `events` on EVERY request. This table is that
-- aggregation computed once by cron (every 10-15 min), read by index at serve
-- time. Consumers keep a live-aggregation fallback while the table is empty
-- (cron not yet scheduled ⇒ nothing breaks).

CREATE TABLE IF NOT EXISTS public.product_popularity_7d (
  product_id    UUID PRIMARY KEY,
  events_7d     INT NOT NULL CHECK (events_7d >= 0),
  views_7d      INT NOT NULL DEFAULT 0,
  carts_7d      INT NOT NULL DEFAULT 0,
  purchases_7d  INT NOT NULL DEFAULT 0,
  category      TEXT,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_popularity_events
  ON public.product_popularity_7d (events_7d DESC);
CREATE INDEX IF NOT EXISTS idx_product_popularity_category
  ON public.product_popularity_7d (category, events_7d DESC);

CREATE TABLE IF NOT EXISTS test_schema.product_popularity_7d (
  LIKE public.product_popularity_7d INCLUDING ALL
);
