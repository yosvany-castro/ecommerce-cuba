-- 0044_orders_pago_familiar.sql
-- Checkout Cuba: "enviar link para familiar". La orden queda creada en
-- 'esperando_pago' y un familiar paga desde /pagar/<pay_token>.
-- pay_hide_items: el comprador eligió ocultar los productos al familiar.
-- ADD VALUE dentro de tx es válido en PG12+ mientras no se USE en la misma tx.
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'esperando_pago';
ALTER TYPE test_schema.order_status ADD VALUE IF NOT EXISTS 'esperando_pago';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pay_token uuid UNIQUE;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pay_hide_items boolean NOT NULL DEFAULT false;
ALTER TABLE test_schema.orders ADD COLUMN IF NOT EXISTS pay_token uuid UNIQUE;
ALTER TABLE test_schema.orders ADD COLUMN IF NOT EXISTS pay_hide_items boolean NOT NULL DEFAULT false;
