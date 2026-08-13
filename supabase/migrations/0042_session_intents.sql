-- 0042: EL VENDEDOR QUE INTUYE (feedback Yosvany 2026-08-13). La sesión mira
-- "mochila escolar" → el sistema INFIERE la intención de compra (curso escolar)
-- y sus complementos (lápices, libretas…) → los resuelve contra el catálogo →
-- la próxima navegación SPA muestra la sección "Completa tu idea" en home.
-- Si el catálogo no tiene los complementos, se dispara la ingesta del término
-- (misma maquinaria/presupuesto de búsqueda): el vendedor va y SURTE el estante.
CREATE TABLE session_intents (
  session_id    uuid PRIMARY KEY,
  label         text NOT NULL,
  terms         text[] NOT NULL,
  product_ids   uuid[] NOT NULL DEFAULT '{}',
  -- último product_id visto cuando se computó — freshness barata: solo se
  -- re-paga el LLM cuando la sesión miró algo nuevo.
  computed_from text,
  computed_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.ui_sections
  (section_type, title_default, display, layout, default_params, freshness_policy,
   priority, min_items, budget_ms, budget_queries, title_template)
VALUES
  ('intent_complements', 'Completa tu idea', 'carousel',
   '{"card_aspect": "3/4", "min_height_px": 280}',
   '{"limit": 8}', 'per_request', 1, 3, 250, 1, NULL)
ON CONFLICT (section_type) DO NOTHING;

-- home slot 40: la zona de scroll del vendedor (tras los slots del agente).
INSERT INTO public.ui_placements
  (surface, slot, section_type, params, rule, scope, status, risk_tier, created_by)
SELECT 'home', 40::smallint, 'intent_complements', '{"limit": 8}'::jsonb, NULL,
       'global', 'approved', 'low', 'seed'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ui_placements p
  WHERE p.surface = 'home' AND p.slot = 40 AND p.created_by = 'seed'
);
