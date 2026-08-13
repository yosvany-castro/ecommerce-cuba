-- 0041: cupones por campaña (decisión Yosvany 2026-08-12: él los crea desde
-- el admin para campañas/especiales). % de descuento sobre el SUBTOTAL de
-- productos (el envío y el tax no se descuentan: el envío es su margen y el
-- tax es su costo real). Validación SIEMPRE server-side en el checkout.
CREATE TABLE coupons (
  code       text PRIMARY KEY CHECK (code = upper(code) AND length(code) BETWEEN 3 AND 24),
  pct        int  NOT NULL CHECK (pct BETWEEN 1 AND 90),
  starts_at  timestamptz NOT NULL DEFAULT now(),
  ends_at    timestamptz,
  max_uses   int CHECK (max_uses > 0),
  uses       int NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
