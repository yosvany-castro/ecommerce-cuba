-- 0034_products_weight.sql
-- Peso por producto para facturar el reenvío a Cuba (aéreo/marítimo se cobra
-- por peso). Cascada de fuentes, de más a menos confiable:
--   'measured' — pesado físicamente por el admin (feedback real, nunca se pisa)
--   'provider' — vino del marketplace (Amazon Item Weight, AliExpress packageDetail)
--   'llm'      — estimado en background por DeepSeek con vecinos medidos como contexto
--   NULL       — sin dato persistido; la UI usa la heurística pura (src/lib/weight.ts)
-- Mirror a test_schema (patrón 0033).
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS weight_grams integer;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS weight_source text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS weight_measured_at timestamptz;
COMMENT ON COLUMN public.products.weight_grams IS 'Peso en gramos (base de facturación del reenvío). Fuente en weight_source.';
COMMENT ON COLUMN public.products.weight_source IS 'measured|provider|llm — measured jamás se sobreescribe automáticamente.';

ALTER TABLE test_schema.products ADD COLUMN IF NOT EXISTS weight_grams integer;
ALTER TABLE test_schema.products ADD COLUMN IF NOT EXISTS weight_source text;
ALTER TABLE test_schema.products ADD COLUMN IF NOT EXISTS weight_measured_at timestamptz;
