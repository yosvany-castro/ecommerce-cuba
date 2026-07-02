#!/usr/bin/env tsx
/**
 * Read-only diagnostic: row counts for every table in the `thesis` schema,
 * plus event date range. Spends NO API. Safe to run anytime to confirm the
 * study dataset is intact (e.g. after running tests that might TRUNCATE it).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { getPgClient } from "@/lib/db/pg";

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    const tables = await pg.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname='thesis' ORDER BY tablename`,
    );
    console.log("=== thesis schema row counts ===");
    for (const { tablename } of tables.rows) {
      const c = await pg.query<{ n: string }>(`SELECT count(*)::text n FROM thesis.${tablename}`);
      console.log(`${tablename.padEnd(28)} ${c.rows[0].n.padStart(10)}`);
    }
    // event date range (if events table exists)
    const hasEvents = tables.rows.some((t) => t.tablename === "events" || t.tablename === "sim_events");
    if (hasEvents) {
      const ev = tables.rows.some((t) => t.tablename === "events") ? "events" : "sim_events";
      const tsCol = await pg.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='thesis' AND table_name=$1
           AND data_type IN ('timestamp with time zone','timestamp without time zone','date')
         ORDER BY ordinal_position LIMIT 1`,
        [ev],
      );
      if (tsCol.rows[0]) {
        const col = tsCol.rows[0].column_name;
        const range = await pg.query(
          `SELECT min(${col}) lo, max(${col}) hi FROM thesis.${ev}`,
        );
        console.log(`\nevents.${col} range: ${range.rows[0].lo} .. ${range.rows[0].hi}`);
      }
    }
  } finally {
    await pg.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
