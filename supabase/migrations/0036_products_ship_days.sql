-- 0036: días de envío tienda→depósito POR PRODUCTO cuando el proveedor los da
-- (AliExpress DataHub: delivery.shippingList[].shippingTime "3-9"). Acorta el
-- rango de entrega mostrado: sin este dato se usa el default por tienda de
-- src/lib/delivery.ts. Mirror a test_schema (patrón 0033/0034).
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS provider_ship_min_days integer;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS provider_ship_max_days integer;
COMMENT ON COLUMN public.products.provider_ship_min_days IS 'Tramo tienda→depósito (días) reportado por el proveedor; NULL = usar default por tienda.';

ALTER TABLE test_schema.products ADD COLUMN IF NOT EXISTS provider_ship_min_days integer;
ALTER TABLE test_schema.products ADD COLUMN IF NOT EXISTS provider_ship_max_days integer;
