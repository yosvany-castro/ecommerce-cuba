-- 0035: secciones de recomendación de la PDP — 'similar' (vecinos por
-- embedding, siempre con datos) y 'upsell' (misma categoría, banda de precio
-- superior). Completan las 4 pedidas: relacionados (similar), complementarios/
-- cross-sell (cross_sell, ya sembrada en 0026) y upsell.
-- Mismo patrón idempotente de 0026. public only (tests siembran su fixture).

INSERT INTO public.ui_sections
  (section_type, title_default, display, layout, default_params, freshness_policy,
   priority, min_items, budget_ms, budget_queries, title_template)
VALUES
  ('similar', 'Relacionados con esto', 'carousel',
   '{"card_aspect": "3/4", "min_height_px": 280}',
   '{"limit": 8}', 'per_request', 1, 3, 250, 2, NULL),
  ('upsell', 'Sube de nivel', 'carousel',
   '{"card_aspect": "3/4", "min_height_px": 280}',
   '{"limit": 6}', 'per_request', 2, 2, 250, 1, NULL)
ON CONFLICT (section_type) DO NOTHING;

-- pdp: similar en slot 8 (antes del cross_sell slot 10) y upsell en slot 30.
INSERT INTO public.ui_placements
  (surface, slot, section_type, params, rule, scope, status, risk_tier, created_by)
SELECT v.surface, v.slot, v.section_type, v.params::jsonb, NULL,
       'global', 'approved', 'low', 'seed'
FROM (VALUES
  ('pdp', 8::smallint, 'similar', '{"limit": 8}'),
  ('pdp', 30::smallint, 'upsell', '{"limit": 6}')
) AS v(surface, slot, section_type, params)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ui_placements p
  WHERE p.surface = v.surface AND p.slot = v.slot AND p.created_by = 'seed'
);
