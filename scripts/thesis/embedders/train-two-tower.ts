#!/usr/bin/env tsx
/**
 * Train E3 two-tower. Item features = the E0 text embedding (thesis.products.embedding).
 * Training pairs = (anonymous_id, carted/purchased product) from thesis.events.
 * Persist item vectors to thesis.item_vectors (space='e3_two_tower').
 * Usage: pnpm thesis:train-two-tower --dim 64 --epochs 80 --negatives 5 --seed 42
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getPgClient } from "@/lib/db/pg";
import { trainTwoTower } from "@/thesis/embedders/two-tower";

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

async function main() {
  const dim = arg("dim", 64);
  const epochs = arg("epochs", 80);
  const negatives = arg("negatives", 5);
  const seed = arg("seed", 42);
  const pg = await getPgClient({ scope: "thesis" });
  try {
    const feat = await pg.query(`SELECT id::text id, embedding::text v FROM thesis.products WHERE embedding IS NOT NULL`);
    const itemFeatures = new Map<string, number[]>();
    for (const row of feat.rows as { id: string; v: string }[]) itemFeatures.set(row.id, JSON.parse(row.v) as number[]);

    const pr = await pg.query(
      `SELECT anonymous_id::text user_id, payload->>'product_id' AS item
       FROM thesis.events
       WHERE event_type IN ('add_to_cart','purchase') AND payload->>'product_id' IS NOT NULL`,
    );
    const pairs = (pr.rows as { user_id: string; item: string }[])
      .filter((p) => itemFeatures.has(p.item))
      .map((p) => ({ user: p.user_id, item: p.item }));
    console.log(`[e3] ${pairs.length} (user,item) pairs over ${itemFeatures.size} items; training dim=${dim} epochs=${epochs}`);

    const model = trainTwoTower(pairs, itemFeatures, { dim, epochs, negatives, seed });
    await pg.query(`DELETE FROM thesis.item_vectors WHERE space='e3_two_tower'`);
    let n = 0;
    for (const [pid, vec] of model.itemVectors) {
      await pg.query(
        `INSERT INTO thesis.item_vectors (space, product_id, vector) VALUES ('e3_two_tower', $1, $2)
         ON CONFLICT (space, product_id) DO UPDATE SET vector = EXCLUDED.vector`,
        [pid, vec],
      );
      n++;
    }
    console.log(`[e3] persisted ${n} item vectors`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
