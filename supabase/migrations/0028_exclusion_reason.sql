-- 0028: exclusion reason (E3 — fatigue needs to be distinguishable).
--
-- excluded_products siempre fue solo-dismiss. La fatiga (≥3 impresiones
-- VISTAS sin click en 7 días) excluye con TTL más corto y semántica distinta
-- (señal débil inferida vs rechazo explícito); reason las separa para
-- métricas, depuración y para que un futuro "deshacer" no borre dismisses.

ALTER TABLE public.excluded_products
  ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT 'dismiss'
  CHECK (reason IN ('dismiss', 'fatigue', 'purchased'));

ALTER TABLE test_schema.excluded_products
  ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT 'dismiss'
  CHECK (reason IN ('dismiss', 'fatigue', 'purchased'));

-- La consulta de fatiga agrupa por (identidad, producto) sobre vistos:
CREATE INDEX IF NOT EXISTS idx_feed_impressions_seen
  ON public.feed_impressions (user_profile_id, product_id)
  WHERE seen_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_feed_impressions_seen_ts
  ON test_schema.feed_impressions (user_profile_id, product_id)
  WHERE seen_at IS NOT NULL;
