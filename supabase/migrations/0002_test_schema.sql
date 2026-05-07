-- Dedicated schema for integration tests so prod-style data and test data never mix.
-- Tables themselves are populated by 0012_test_schema_replicate.sql (generated).
CREATE SCHEMA IF NOT EXISTS test_schema;
