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
});
