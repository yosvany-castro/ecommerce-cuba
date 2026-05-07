CREATE TABLE IF NOT EXISTS public.cart_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity    integer NOT NULL CHECK (quantity > 0),
  added_at    timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cart_items_user_product_unique UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS cart_items_user_idx ON public.cart_items (user_id);
