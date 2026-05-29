-- Persisted per-embedder item vectors (and E4 multi-vector chunks) so the F1
-- study runner is fast + reproducible. `space` identifies the embedder
-- (e0_text, e1_prod2vec, e2_hybrid, e3_two_tower, e4_late, e5_context3).
set search_path to thesis, public, extensions;

create table if not exists thesis.item_vectors (
  space      text not null,
  product_id uuid not null references thesis.products(id) on delete cascade,
  vector     double precision[] not null,
  primary key (space, product_id)
);

create table if not exists thesis.item_chunk_vectors (
  space       text not null,
  product_id  uuid not null references thesis.products(id) on delete cascade,
  chunk_index smallint not null,
  chunk_role  text not null,            -- title | description | attributes
  vector      double precision[] not null,
  primary key (space, product_id, chunk_index)
);

create index if not exists thesis_item_vectors_space_idx on thesis.item_vectors(space);
create index if not exists thesis_item_chunk_space_idx on thesis.item_chunk_vectors(space, product_id);
