-- 0032_orders_anonymous_demo.sql
-- Checkout anónimo (demo Tuki): datos de envío del formulario en jsonb.
-- Mirror a test_schema como 0031 (misma columna en ambos esquemas).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping jsonb;
ALTER TABLE test_schema.orders ADD COLUMN IF NOT EXISTS shipping jsonb;
