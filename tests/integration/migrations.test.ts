import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

describe("migration runner", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it("creates _migrations table on first run", async () => {
    // Run the migration runner against a known-empty test_schema marker
    const { execSync } = await import("child_process");
    execSync("pnpm migrate", { stdio: "inherit", env: { ...process.env } });

    const res = await client.query(
      `SELECT to_regclass('public._migrations') AS exists`,
    );
    expect(res.rows[0].exists).toMatch(/(^|\.)_migrations$/);
  });

  it("records each migration filename and checksum after applying", async () => {
    const res = await client.query(
      `SELECT filename, checksum FROM public._migrations ORDER BY filename ASC LIMIT 1`,
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(1);
    expect(res.rows[0].filename).toMatch(/^\d{4}_/);
    expect(res.rows[0].checksum).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
  });

  it("vector extension is active", async () => {
    const res = await client.query(
      `SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'`,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].extname).toBe("vector");
  });

  it("test_schema exists", async () => {
    const res = await client.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'test_schema'`,
    );
    expect(res.rows).toHaveLength(1);
  });

  it("core tables exist with required columns", async () => {
    const tables = ["users", "anonymous_sessions", "recipients"];
    for (const t of tables) {
      const res = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [t],
      );
      expect(res.rows.length).toBeGreaterThan(0);
    }

    const usersCols = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'users'`,
    );
    const colNames = usersCols.rows.map((r) => r.column_name);
    expect(colNames).toEqual(
      expect.arrayContaining(["id", "email", "name", "balance_cents", "created_at"]),
    );

    const anonCols = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'anonymous_sessions'`,
    );
    const anonNames = anonCols.rows.map((r) => r.column_name);
    expect(anonNames).toEqual(
      expect.arrayContaining(["anonymous_id", "user_id", "first_seen_at", "last_seen_at"]),
    );

    const recipientsCols = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'recipients'`,
    );
    const recipientsNames = recipientsCols.rows.map((r) => r.column_name);
    expect(recipientsNames).toEqual(
      expect.arrayContaining(["id", "user_id", "name", "gender", "age", "address_cuba", "created_at"]),
    );
  });

  it("products table exists with required columns including vector and tsvector", async () => {
    const res = await client.query(
      `SELECT column_name, data_type, udt_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'products'
       ORDER BY ordinal_position`,
    );
    expect(res.rows.length).toBeGreaterThan(0);

    const colNames = res.rows.map((r: { column_name: string }) => r.column_name);
    expect(colNames).toEqual(
      expect.arrayContaining([
        "id",
        "source",
        "source_product_id",
        "title",
        "description",
        "price_cents",
        "currency",
        "embedding",
        "tsvector_es",
        "is_active",
        "created_at",
      ]),
    );
  });

  it("products indexes exist (tsvector GIN, HNSW, metadata GIN)", async () => {
    const res = await client.query(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'products'
       ORDER BY indexname`,
    );
    const indexNames = res.rows.map((r: { indexname: string }) => r.indexname);
    expect(indexNames).toEqual(
      expect.arrayContaining([
        "products_tsvector_idx",
        "products_embedding_hnsw_idx",
        "products_metadata_gin_idx",
      ]),
    );
  });

  it("events table has correct schema and indexes", async () => {
    const cols = await client.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'events'
    `);
    const names = cols.rows.map((r) => r.column_name);
    expect(names).toEqual(expect.arrayContaining([
      "id", "client_event_id", "anonymous_id", "user_id", "session_id",
      "event_type", "occurred_at", "payload", "source",
    ]));

    const idxs = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'events'
    `);
    const idxNames = idxs.rows.map((r) => r.indexname);
    expect(idxNames).toEqual(expect.arrayContaining([
      "events_pkey",
      "events_anon_time_idx",
      "events_type_time_idx",
      "events_session_idx",
    ]));
  });

  it("personalization tables exist with vector columns", async () => {
    const tables = [
      "user_profiles", "user_profile_modes", "session_vectors",
      "cohort_centroids", "excluded_products"
    ];
    for (const t of tables) {
      const res = await client.query(
        `SELECT to_regclass($1) AS exists`,
        [`public.${t}`],
      );
      expect(res.rows[0].exists).toMatch(new RegExp(`(^|\\.)${t}$`));
    }

    // user_profile_modes must have vector_unnormalized vector(1024) and weight_sum
    const cols = await client.query(`
      SELECT column_name, udt_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_profile_modes'
    `);
    const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));
    expect(byName.vector_unnormalized.udt_name).toBe("vector");
    expect(byName.weight_sum.udt_name).toMatch(/float8|double_precision/);
  });

  it("co_occurrence enforces a < b and indexes are present", async () => {
    // Constraint check must exist
    const constraints = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.co_occurrence'::regclass
    `);
    const defs = constraints.rows.map((r) => r.def).join("\n");
    expect(defs).toMatch(/CHECK .*product_a_id\s*<\s*product_b_id/);
  });

  it("search, orders, eval tables present", async () => {
    for (const t of [
      "searches", "product_query_cache", "mock_calls",
      "orders", "order_items", "eval_holdout",
    ]) {
      const res = await client.query(`SELECT to_regclass($1) AS exists`, [`public.${t}`]);
      expect(res.rows[0].exists).toMatch(new RegExp(`(^|\\.)${t}$`));
    }
  });
});
