CREATE TABLE IF NOT EXISTS public.products (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source              text NOT NULL,
  source_product_id   text NOT NULL,
  title               text NOT NULL,
  description         text NOT NULL DEFAULT '',
  price_cents         integer NOT NULL CHECK (price_cents >= 0),
  currency            text NOT NULL DEFAULT 'USD',
  image_url           text,
  raw_category        text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding           vector(1024),
  tsvector_es         tsvector GENERATED ALWAYS AS (
                        to_tsvector(
                          'spanish',
                          coalesce(title, '') || ' ' || coalesce(description, '')
                        )
                      ) STORED,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_refreshed_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_source_unique UNIQUE (source, source_product_id)
);

CREATE INDEX IF NOT EXISTS products_tsvector_idx
  ON public.products USING GIN (tsvector_es);

CREATE INDEX IF NOT EXISTS products_embedding_hnsw_idx
  ON public.products USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS products_metadata_gin_idx
  ON public.products USING GIN (metadata);

CREATE INDEX IF NOT EXISTS products_active_idx
  ON public.products (is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS products_last_refreshed_idx
  ON public.products (last_refreshed_at);
