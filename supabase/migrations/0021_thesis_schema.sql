-- ============================================================================
-- Thesis program — isolated `thesis` schema.
--
-- Purpose: a fully isolated playground (parallel to public / test_schema) that
-- mirrors the pipeline tables the application code consumes WITHOUT modification,
-- so generateFeed / retrieval / co-occurrence run unchanged against synthetic
-- data, PLUS ground-truth tables that only the synthetic generator and the eval
-- harness use. The ground truth (latent product factors, complement graph, true
-- user taste / gift intent, holdout split) is what makes the evaluation rigorous
-- and reproducible — every model upgrade is measured against known structure.
--
-- DDL for the mirrored tables is kept faithful to the public schema (0004/0005/
-- 0006/0007) so behavioural parity holds (tsvector_es for BM25, hnsw for ANN,
-- same indexes, same constraints).
-- ============================================================================

create schema if not exists thesis;

-- pgvector already lives in `extensions` (see 0001); this is a defensive no-op.
create extension if not exists vector with schema extensions;

set search_path to thesis, public, extensions;

-- ---------------------------------------------------------------------------
-- Mirror of pipeline tables (faithful to public DDL)
-- ---------------------------------------------------------------------------

create table if not exists thesis.products (
  id                  uuid primary key default gen_random_uuid(),
  source              text not null,
  source_product_id   text not null,
  title               text not null,
  description         text not null default '',
  price_cents         integer not null check (price_cents >= 0),
  currency            text not null default 'USD',
  image_url           text,
  raw_category        text,
  metadata            jsonb not null default '{}'::jsonb,
  embedding           vector(1024),
  tsvector_es         tsvector generated always as (
                        to_tsvector(
                          'spanish',
                          coalesce(title, '') || ' ' || coalesce(description, '')
                        )
                      ) stored,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  last_refreshed_at   timestamptz not null default now(),
  constraint thesis_products_source_unique unique (source, source_product_id)
);

create index if not exists thesis_products_tsvector_idx
  on thesis.products using gin (tsvector_es);
create index if not exists thesis_products_embedding_hnsw_idx
  on thesis.products using hnsw (embedding vector_cosine_ops);
create index if not exists thesis_products_metadata_gin_idx
  on thesis.products using gin (metadata);
create index if not exists thesis_products_active_idx
  on thesis.products (is_active) where is_active = true;

create table if not exists thesis.anonymous_sessions (
  anonymous_id   uuid primary key,
  user_id        uuid,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);

create table if not exists thesis.events (
  id              uuid primary key default gen_random_uuid(),
  client_event_id text,
  anonymous_id    uuid not null,
  user_id         uuid,
  session_id      uuid not null,
  event_type      text not null,
  occurred_at     timestamptz not null,
  payload         jsonb not null default '{}'::jsonb,
  source          text,
  created_at      timestamptz not null default now()
);

create unique index if not exists thesis_events_client_event_id_uniq
  on thesis.events (client_event_id) where client_event_id is not null;
create index if not exists thesis_events_anon_time_idx
  on thesis.events (anonymous_id, occurred_at desc);
create index if not exists thesis_events_type_time_idx
  on thesis.events (event_type, occurred_at desc);
create index if not exists thesis_events_session_idx
  on thesis.events (session_id, occurred_at);
create index if not exists thesis_events_payload_pid_idx
  on thesis.events ((payload->>'product_id'));

create table if not exists thesis.co_occurrence (
  product_a_id  uuid not null,
  product_b_id  uuid not null,
  count         integer not null default 0,
  last_seen_at  timestamptz not null default now(),
  primary key (product_a_id, product_b_id)
);

create table if not exists thesis.co_occurrence_top (
  product_id          uuid not null,
  related_product_id  uuid not null,
  npmi_score          real not null,
  rank                smallint not null,
  last_recompute_at   timestamptz not null default now(),
  primary key (product_id, related_product_id)
);

-- ---------------------------------------------------------------------------
-- Ground-truth tables (synthetic only — never present in production)
-- ---------------------------------------------------------------------------

-- The TRUE latent attribute vector of each synthetic product. The eval harness
-- plants taste clusters and the complement graph in this space; models must
-- recover that structure from text/behaviour without seeing it.
create table if not exists thesis.gt_product_factors (
  product_id    uuid primary key references thesis.products(id) on delete cascade,
  factor_vector double precision[] not null,
  taxonomy      jsonb not null
);

-- The gold-standard commercial relation graph (complement vs substitute, etc.).
-- Recoverable by co-occurrence, NOT by text cosine — the core thesis claim.
create table if not exists thesis.gt_product_relations (
  product_a_id   uuid not null references thesis.products(id) on delete cascade,
  product_b_id   uuid not null references thesis.products(id) on delete cascade,
  relation_type  text not null check (relation_type in ('complement','substitute','upgrade','accessory')),
  strength       real not null default 1.0,
  primary key (product_a_id, product_b_id, relation_type)
);

-- True user latent state (taste clusters, budget, gift propensity).
create table if not exists thesis.sim_users (
  user_id           uuid primary key,
  latent_state      jsonb not null,
  p_gift            real not null default 0,
  price_sensitivity real not null default 0
);

create table if not exists thesis.sim_user_recipients (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references thesis.sim_users(user_id) on delete cascade,
  relation  text not null,
  gender    text,
  age_min   int,
  age_max   int
);

-- True per-session intent (self vs gift, and for whom).
create table if not exists thesis.sim_sessions (
  session_id    uuid primary key,
  user_id       uuid not null references thesis.sim_users(user_id) on delete cascade,
  intent        text not null check (intent in ('self','gift')),
  recipient_id  uuid,
  started_at    timestamptz not null default now()
);

-- Temporal holdout: each user's reserved purchase(s) for leakage-free evaluation.
create table if not exists thesis.holdout (
  user_id      uuid not null,
  product_id   uuid not null,
  occurred_at  timestamptz not null,
  split        text not null check (split in ('train','test')),
  primary key (user_id, product_id, split)
);

create index if not exists thesis_holdout_split_idx on thesis.holdout (split);
