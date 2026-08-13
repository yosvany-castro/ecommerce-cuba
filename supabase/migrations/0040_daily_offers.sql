-- 0040: ofertas del día (bento v2). Selección NOCTURNA persistida — el
-- countdown a medianoche es honesto porque el cron (cron:ofertas) rota la
-- selección de verdad. Fuente: descuentos REALES del proveedor
-- (old_price_cents > price_cents), jamás inventados.
CREATE TABLE daily_offers (
  day         date PRIMARY KEY,
  product_ids uuid[] NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
