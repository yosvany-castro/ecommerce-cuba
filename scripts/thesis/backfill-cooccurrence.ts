#!/usr/bin/env tsx
/**
 * Rebuild thesis.co_occurrence from thesis.events (co-viewed/co-purchased product
 * pairs per session, weighted view=1/cart=3/purchase=5, pair stored a<b), then
 * run recomputeNPMI to populate thesis.co_occurrence_top. Idempotent.
 * Usage: pnpm thesis:backfill-cooccurrence
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getPgClient } from "@/lib/db/pg";
import { recomputeNPMI } from "@/sectors/d-personalization/co-occurrence/npmi-recompute";

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    await pg.query(`TRUNCATE thesis.co_occurrence`);
    await pg.query(`
      WITH session_items AS (
        SELECT e.session_id,
               (e.payload->>'product_id')::uuid AS pid,
               MAX(CASE e.event_type WHEN 'purchase' THEN 5 WHEN 'add_to_cart' THEN 3 ELSE 1 END) AS w
        FROM thesis.events e
        WHERE e.payload->>'product_id' IS NOT NULL
          AND e.event_type IN ('product_view','add_to_cart','purchase')
        GROUP BY e.session_id, (e.payload->>'product_id')::uuid
      ),
      pairs AS (
        SELECT LEAST(a.pid, b.pid) AS pa, GREATEST(a.pid, b.pid) AS pb,
               GREATEST(a.w, b.w) AS w
        FROM session_items a
        JOIN session_items b ON a.session_id = b.session_id AND a.pid < b.pid
      )
      INSERT INTO thesis.co_occurrence (product_a_id, product_b_id, count, last_seen_at)
      SELECT pa, pb, SUM(w)::int, now() FROM pairs GROUP BY pa, pb
    `);
    const pairCount = (await pg.query(`SELECT count(*)::int c FROM thesis.co_occurrence`)).rows[0].c;
    console.log(`[cooc] co_occurrence pairs: ${pairCount}`);
    await recomputeNPMI(pg);
    const topCount = (await pg.query(`SELECT count(*)::int c FROM thesis.co_occurrence_top`)).rows[0].c;
    console.log(`[cooc] co_occurrence_top rows: ${topCount}`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
