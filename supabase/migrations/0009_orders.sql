DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE t.typname = 'order_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.order_status AS ENUM (
      'pendiente', 'comprada', 'en_bodega', 'en_transito',
      'para_entrega', 'entregada',
      'stock_fantasma', 'precio_subido', 'danada_o_no_entregada'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recipient_id        uuid REFERENCES public.recipients(id) ON DELETE SET NULL,
  status              public.order_status NOT NULL DEFAULT 'pendiente',
  total_charged_cents integer NOT NULL,
  total_cost_cents    integer NOT NULL,
  margin_cents        integer GENERATED ALWAYS AS (total_charged_cents - total_cost_cents) STORED,
  status_history      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_user_idx ON public.orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON public.orders (status);

CREATE TABLE IF NOT EXISTS public.order_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id          uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_snapshot    jsonb NOT NULL,
  quantity            integer NOT NULL CHECK (quantity > 0),
  unit_price_cents    integer NOT NULL CHECK (unit_price_cents >= 0),
  unit_cost_cents     integer NOT NULL CHECK (unit_cost_cents >= 0)
);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON public.order_items (order_id);
