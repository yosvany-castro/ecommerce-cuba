-- 0033_products_url.sql
-- URL original del producto en el marketplace — requisito de negocio: todo
-- producto real debe tener source y url. Mirror a test_schema (patrón 0032).
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS url text;
COMMENT ON COLUMN public.products.url IS 'URL original del producto en el marketplace — requisito de negocio: todo producto real debe tener source y url.';

ALTER TABLE test_schema.products ADD COLUMN IF NOT EXISTS url text;
COMMENT ON COLUMN test_schema.products.url IS 'URL original del producto en el marketplace — requisito de negocio: todo producto real debe tener source y url.';
