import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "pg";

describe("migration runner", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    await client.connect();
  });

  it("creates _migrations table on first run", async () => {
    // Run the migration runner against a known-empty test_schema marker
    const { execSync } = await import("child_process");
    execSync("pnpm migrate", { stdio: "inherit", env: { ...process.env } });

    const res = await client.query(
      `SELECT to_regclass('public._migrations') AS exists`,
    );
    expect(res.rows[0].exists).toBe("_migrations");
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
});
