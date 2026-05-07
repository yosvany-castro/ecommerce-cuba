#!/usr/bin/env tsx
/**
 * Reports the live state of Supabase: extensions, schemas, tables, vector dim.
 * Exit code 0 = healthy. Non-zero = drift from expected Phase 0 state.
 */
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const REQUIRED_TABLES = [
  "users", "anonymous_sessions", "recipients",
  "products", "events",
  "user_profiles", "user_profile_modes", "session_vectors",
  "cohort_centroids", "excluded_products",
  "co_occurrence", "co_occurrence_top",
  "searches", "product_query_cache", "mock_calls",
  "orders", "order_items", "eval_holdout",
  "_migrations",
];

async function verify() {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await client.connect();
  let ok = true;

  try {
    const ext = await client.query(`SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector','pg_trgm') ORDER BY extname`);
    console.log("Extensions:", ext.rows);
    if (ext.rows.length < 2) { ok = false; console.error("Missing extensions"); }

    const schemas = await client.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('public','test_schema')`);
    console.log("Schemas:", schemas.rows.map((r) => r.schema_name));

    const tablesRes = await client.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `);
    const present = new Set(tablesRes.rows.map((r) => r.tablename));
    const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
    if (missing.length > 0) { ok = false; console.error("Missing tables:", missing); }
    console.log("Tables in public:", [...present].sort());

    const dim = await client.query(`
      SELECT atttypmod FROM pg_attribute
      WHERE attrelid = 'public.products'::regclass AND attname = 'embedding'
    `);
    if (dim.rows[0]?.atttypmod !== 1024) {
      ok = false;
      console.error(`products.embedding wrong dimension: ${dim.rows[0]?.atttypmod} (expected 1024)`);
    } else {
      console.log("products.embedding dimension: 1024 OK");
    }

    if (!ok) process.exit(1);
    console.log("\n[verify-supabase] ALL OK ✅");
  } finally {
    await client.end();
  }
}

verify().catch((e) => { console.error(e); process.exit(1); });
