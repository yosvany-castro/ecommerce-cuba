-- 0043: secciones destacadas en LISTADOS (superficie 'search' del slate, que
-- 0025 ya permitía pero nadie usaba). Seed: "Lo más buscado" (popular por
-- categoría del listado; sin categoría cae a global) en el slot 20 y la
-- intención del vendedor en el 40. El agente puede colocar más (slots 20-90).
INSERT INTO public.ui_placements
  (surface, slot, section_type, params, rule, scope, status, risk_tier, created_by)
SELECT v.surface, v.slot, v.section_type, v.params::jsonb, NULL,
       'global', 'approved', 'low', 'seed'
FROM (VALUES
  ('search', 20::smallint, 'popular', '{"mode": "pdp_category", "limit": 8}'),
  ('search', 40::smallint, 'intent_complements', '{"limit": 8}')
) AS v(surface, slot, section_type, params)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ui_placements p
  WHERE p.surface = v.surface AND p.slot = v.slot AND p.created_by = 'seed'
);
