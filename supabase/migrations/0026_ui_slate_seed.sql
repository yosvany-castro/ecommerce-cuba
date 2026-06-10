-- 0026: seed the section catalog and the default composition.
--
-- The seed REPLICATES today's pages exactly (home = single hero grid), so
-- migrating the renderer to SlateRenderer produces ZERO visual change day-1
-- (guarded by the home-equivalence integration test, Etapa D). PDP cross-sell
-- and cart add-ons are the first NEW surfaces; their placements ship approved
-- but render nothing until the surfaces consume composePage (Etapa D).
--
-- public only: tests seed their own test_schema fixtures (withTestDb).
-- Idempotent: ON CONFLICT DO NOTHING (re-running migrations never duplicates).

INSERT INTO public.ui_sections
  (section_type, title_default, display, layout, default_params, freshness_policy,
   priority, min_items, budget_ms, budget_queries, title_template)
VALUES
  ('hero_grid', 'Catálogo', 'grid',
   '{"card_aspect": "3/4", "grid_cols": {"base": 2, "sm": 3, "lg": 4}}',
   '{"limit": 20}', 'per_session_snapshot', 0, 10, 1500, 4, NULL),
  ('cross_sell', 'Combina con esto', 'carousel',
   '{"card_aspect": "3/4", "min_height_px": 280}',
   '{"limit": 8}', 'per_request', 1, 3, 250, 1, 'Combina con {anchor_title}'),
  ('popular', 'Lo más buscado', 'carousel',
   '{"card_aspect": "3/4", "min_height_px": 280}',
   '{"limit": 10, "mode": "global"}', 'per_request', 2, 3, 250, 1, NULL),
  ('cart_addons', 'Completa tu compra', 'carousel',
   '{"card_aspect": "3/4", "min_height_px": 280}',
   '{"limit": 6}', 'per_request', 1, 2, 300, 1, NULL)
ON CONFLICT (section_type) DO NOTHING;

-- ui_placements has no unique(surface, slot) BY DESIGN (collisions are the
-- specificity mechanism), so idempotency is via anti-join on created_by='seed'.
INSERT INTO public.ui_placements
  (surface, slot, section_type, params, rule, scope, status, risk_tier, created_by)
SELECT v.surface, v.slot, v.section_type, v.params::jsonb, v.rule::jsonb,
       'global', 'approved', 'low', 'seed'
FROM (VALUES
  -- home: réplica exacta de la página actual (solo el grid).
  ('home', 10::smallint, 'hero_grid', '{"limit": 20}', NULL),
  -- pdp: primera superficie nueva de valor (cross-sell por co-ocurrencia).
  ('pdp', 10::smallint, 'cross_sell', '{"limit": 8}', NULL),
  -- cart: add-ons solo cuando hay items en el carrito.
  ('cart', 10::smallint, 'cart_addons', '{"limit": 6}',
   '{"field": "cart_item_count", "op": "gte", "value": 1}')
) AS v(surface, slot, section_type, params, rule)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ui_placements p
  WHERE p.surface = v.surface AND p.slot = v.slot AND p.created_by = 'seed'
);
