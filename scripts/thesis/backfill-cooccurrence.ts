#!/usr/bin/env tsx
/**
 * Rebuild thesis.co_occurrence from thesis.events (co-viewed/co-purchased product
 * pairs per session, weighted view=1/cart=3/purchase=5, pair stored a<b), then
 * run recomputeNPMI to populate thesis.co_occurrence_top. Idempotent.
 *
 * --train-only (LEAK-FREE mode): excludes every event of a HOLDOUT-TEST session
 * (the session containing a held-out test purchase). Without it, the graph is
 * TRANSDUCTIVE: it contains the co-occurrence pairs of the very sessions the
 * harness evaluates on (purchases at weight 5), so the NPMI source partially
 * reads back the answer (auditoría destructiva 2026-06-09: NPMI-source hit-rate
 * 64 % → 13 % leak-free; 69 % of hit edges existed ONLY because of test
 * sessions). In production the graph is recomputed nightly and can never
 * contain the session being served — --train-only is the production-faithful
 * build. Cf. Ji et al., "A Critical Study on Data Leakage in Recommender
 * System Offline Evaluation" (TOIS 2023): global-timeline discipline applies
 * to GLOBAL models, not just the user's own history.
 *
 * Usage: pnpm thesis:backfill-cooccurrence [--train-only]
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getPgClient } from "@/lib/db/pg";
import { recomputeNPMI } from "@/sectors/d-personalization/co-occurrence/npmi-recompute";

const TRAIN_ONLY = process.argv.includes("--train-only");

/** Sessions containing a held-out test purchase — excluded in --train-only mode. */
const TEST_SESSIONS_CTE = `
      test_sessions AS (
        SELECT DISTINCT e.session_id
        FROM thesis.holdout h
        JOIN thesis.events e
          ON e.anonymous_id = h.user_id
         AND e.payload->>'product_id' = h.product_id::text
         AND e.event_type = 'purchase'
        WHERE h.split = 'test'
      ),`;

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    await pg.query(`TRUNCATE thesis.co_occurrence`);
    await pg.query(`
      WITH ${TRAIN_ONLY ? TEST_SESSIONS_CTE : ""}
      session_items AS (
        SELECT e.session_id,
               (e.payload->>'product_id')::uuid AS pid,
               MAX(CASE e.event_type WHEN 'purchase' THEN 5 WHEN 'add_to_cart' THEN 3 ELSE 1 END) AS w
        FROM thesis.events e
        WHERE e.payload->>'product_id' IS NOT NULL
          AND e.event_type IN ('product_view','add_to_cart','purchase')
          ${TRAIN_ONLY ? "AND e.session_id NOT IN (SELECT session_id FROM test_sessions)" : ""}
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
    console.log(`[cooc] mode=${TRAIN_ONLY ? "TRAIN-ONLY (leak-free)" : "all-events (transductive — NOT valid for offline eval)"}`);
    console.log(`[cooc] co_occurrence pairs: ${pairCount}`);
    await recomputeNPMI(pg);
    const topCount = (await pg.query(`SELECT count(*)::int c FROM thesis.co_occurrence_top`)).rows[0].c;
    console.log(`[cooc] co_occurrence_top rows: ${topCount}`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
