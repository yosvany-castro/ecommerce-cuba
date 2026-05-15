-- Enable pgvector for embeddings and pg_trgm for similarity search.
-- Idempotent: IF NOT EXISTS guards against re-runs and drift with existing DB state.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
