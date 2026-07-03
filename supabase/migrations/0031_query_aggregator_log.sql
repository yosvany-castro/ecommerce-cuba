-- 0031: per-query aggregator log (F4 T4).
--
-- Reemplaza la freshness POR CATEGORÍA (demasiado gruesa: ingestar 1 producto
-- de 'ropa' marcaba TODA la ropa fresca 24h y suprimía llamadas para queries
-- de ropa totalmente distintas — auditoría 2026-07-01) por freshness POR QUERY.
-- Además es el negative cache: una query que el agregador respondió con 0
-- resultados igual registra last_called_at ⇒ no se re-consulta dentro de la
-- ventana FRESHNESS_THRESHOLD_HOURS.

CREATE TABLE IF NOT EXISTS public.query_aggregator_log (
  query_hash     text PRIMARY KEY,
  last_called_at timestamptz NOT NULL DEFAULT now(),
  result_count   integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS test_schema.query_aggregator_log (
  query_hash     text PRIMARY KEY,
  last_called_at timestamptz NOT NULL DEFAULT now(),
  result_count   integer NOT NULL DEFAULT 0
);
