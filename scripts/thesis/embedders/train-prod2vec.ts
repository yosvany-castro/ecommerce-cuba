#!/usr/bin/env tsx
/**
 * Train E1 Prod2Vec on thesis.events session sequences; persist item vectors to
 * thesis.item_vectors (space='e1_prod2vec').
 *
 * --train-only (LEAK-FREE mode): excludes every event of a HOLDOUT-TEST session
 * (the session containing a held-out test purchase). Without it, the embedding
 * space is TRANSDUCTIVE — skip-gram saw the exact basket that contains each
 * held-out purchase, pulling the test item's vector toward its session mates
 * (auditoría destructiva 2026-06-09). Production trains on the past only, so
 * --train-only is the production-faithful build for offline evaluation.
 *
 * Usage: pnpm thesis:train-prod2vec --dim 64 --epochs 30 --window 3 --negatives 5 --seed 42 [--train-only]
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getPgClient } from "@/lib/db/pg";
import { toSessionSequences, type EventRow } from "@/thesis/embedders/sessions";
import { trainProd2Vec } from "@/thesis/embedders/prod2vec";

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

async function main() {
  const dim = arg("dim", 64);
  const epochs = arg("epochs", 30);
  const window = arg("window", 3);
  const negatives = arg("negatives", 5);
  const seed = arg("seed", 42);
  const trainOnly = process.argv.includes("--train-only");
  const pg = await getPgClient({ scope: "thesis" });
  try {
    const trainOnlyClause = trainOnly
      ? `AND session_id NOT IN (
           SELECT DISTINCT e2.session_id
           FROM thesis.holdout h
           JOIN thesis.events e2
             ON e2.anonymous_id = h.user_id
            AND e2.payload->>'product_id' = h.product_id::text
            AND e2.event_type = 'purchase'
           WHERE h.split = 'test'
         )`
      : "";
    console.log(`[e1] mode=${trainOnly ? "TRAIN-ONLY (leak-free)" : "all-events (transductive — NOT valid for offline eval)"}`);
    const r = await pg.query(
      `SELECT session_id::text session_id, payload->>'product_id' AS product_id, occurred_at
       FROM thesis.events
       WHERE event_type IN ('product_view','add_to_cart','purchase') AND payload->>'product_id' IS NOT NULL
       ${trainOnlyClause}
       ORDER BY session_id, occurred_at`,
    );
    const rows: EventRow[] = (r.rows as { session_id: string; product_id: string; occurred_at: string | Date }[]).map((x) => ({
      session_id: x.session_id,
      product_id: x.product_id,
      occurred_at: new Date(x.occurred_at).toISOString(),
    }));
    const seqs = toSessionSequences(rows, 2);
    console.log(`[e1] ${seqs.length} multi-item sessions; training dim=${dim} epochs=${epochs} window=${window} negatives=${negatives}`);
    const vectors = trainProd2Vec(seqs, { dim, epochs, window, negatives, seed });

    await pg.query(`DELETE FROM thesis.item_vectors WHERE space='e1_prod2vec'`);
    let n = 0;
    for (const [pid, vec] of vectors) {
      await pg.query(
        `INSERT INTO thesis.item_vectors (space, product_id, vector) VALUES ('e1_prod2vec', $1, $2)
         ON CONFLICT (space, product_id) DO UPDATE SET vector = EXCLUDED.vector`,
        [pid, vec],
      );
      n++;
    }
    console.log(`[e1] persisted ${n} item vectors`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
