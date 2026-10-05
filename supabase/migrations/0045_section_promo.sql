-- 0045: anuncios PROPIOS de Yosvany ('promo'): productos elegidos a mano,
-- colocables en cualquier superficie (home, pdp, cart, search = listados)
-- desde /admin/promos. params: {title, product_ids[]}; rule opcional
-- (p. ej. pdp_category = listado de esa categoría). Prioridad 1: no se
-- sacrifica antes que las automáticas. min_items 1: un solo producto basta.
INSERT INTO public.ui_sections
  (section_type, title_default, display, layout, default_params, freshness_policy,
   priority, min_items, budget_ms, budget_queries, title_template)
VALUES
  ('promo', 'Destacado', 'carousel',
   '{"card_aspect": "3/4", "min_height_px": 280}',
   '{}', 'per_request', 1, 1, 250, 1, NULL)
ON CONFLICT (section_type) DO NOTHING;
