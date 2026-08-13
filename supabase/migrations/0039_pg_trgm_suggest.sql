-- 0039: pg_trgm para "búsquedas similares" (suggest v2, tolerante a typos).
-- El suggest deja de listar títulos de producto (ILIKE) y pasa a sugerir
-- CONSULTAS: las búsquedas pasadas con resultados, matcheadas por similitud
-- de trigramas ("olla arocera" ≈ "olla arrocera").
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS searches_raw_query_trgm
  ON searches USING gin (raw_query gin_trgm_ops);
