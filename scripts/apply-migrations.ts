#!/usr/bin/env tsx
/**
 * Applies all SQL migrations in supabase/migrations/ in lexical order.
 * - Records each as (filename, applied_at, checksum) in `_migrations`.
 * - Aborts if a previously-applied migration's checksum changed (drift detection).
 * - Idempotent: skips migrations already applied.
 *
 * Usage: pnpm migrate
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function ensureMigrationsTable(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public._migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function applyMigrations() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is required");

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await ensureMigrationsTable(client);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.log("[migrate] No migrations found.");
      return;
    }

    const applied = await client.query(
      `SELECT filename, checksum FROM public._migrations`,
    );
    const appliedMap = new Map<string, string>(
      applied.rows.map((r) => [r.filename, r.checksum]),
    );

    for (const file of files) {
      const sqlPath = join(MIGRATIONS_DIR, file);
      const sql = readFileSync(sqlPath, "utf8");
      const checksum = sha256(sql);

      const previous = appliedMap.get(file);
      if (previous === checksum) {
        console.log(`[migrate] = ${file} (already applied)`);
        continue;
      }
      if (previous !== undefined && previous !== checksum) {
        throw new Error(
          `Drift detected: ${file} was applied with checksum ${previous} but file now hashes to ${checksum}. ` +
            `Edit a NEW migration instead of mutating an applied one.`,
        );
      }

      console.log(`[migrate] + ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO public._migrations (filename, checksum) VALUES ($1, $2)`,
          [file, checksum],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`[migrate] FAILED ${file}: ${(err as Error).message}`);
      }
    }

    console.log(`[migrate] OK — ${files.length} files processed.`);
  } finally {
    await client.end();
  }
}

applyMigrations().catch((err) => {
  console.error(err);
  process.exit(1);
});
