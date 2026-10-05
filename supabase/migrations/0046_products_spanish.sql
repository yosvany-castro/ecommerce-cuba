-- 0046: sitio 100% en español. products.title/description pasan a guardar la
-- versión ESPAÑOLA (traducida por el normalizador LLM al ingerir; backfill con
-- scripts/translate-catalog.ts). El texto del proveedor queda en *_original:
-- el fast-path de ingesta compara contra él (si no, re-normalizaría todo cada
-- refresh). tsvector_es (spanish) por fin indexa texto en español.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS title_original text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS description_original text;
ALTER TABLE test_schema.products ADD COLUMN IF NOT EXISTS title_original text;
ALTER TABLE test_schema.products ADD COLUMN IF NOT EXISTS description_original text;
COMMENT ON COLUMN public.products.weight_source IS 'measured|provider|llm|heuristic — measured jamás se sobreescribe; heuristic = congelado del título original antes de traducir (el LLM lo puede refinar).';
