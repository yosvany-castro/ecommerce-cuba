import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

describe("test_schema parity with public", () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    await client.connect();
  });
  afterAll(async () => { await client.end(); });

  it("every public table (except _migrations) has a counterpart in test_schema with same columns", async () => {
    const publicTables = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename != '_migrations'
      ORDER BY tablename
    `);

    for (const { tablename } of publicTables.rows) {
      const pubCols = await client.query(`
        SELECT column_name, udt_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [tablename]);

      const testCols = await client.query(`
        SELECT column_name, udt_name FROM information_schema.columns
        WHERE table_schema = 'test_schema' AND table_name = $1
        ORDER BY ordinal_position
      `, [tablename]);

      expect(testCols.rows.length, `test_schema.${tablename} missing or empty`).toBe(pubCols.rows.length);
      const pubNames = pubCols.rows.map((r) => r.column_name);
      const testNames = testCols.rows.map((r) => r.column_name);
      expect(testNames).toEqual(pubNames);
    }
  });
});
