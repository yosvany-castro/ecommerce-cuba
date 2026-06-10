#!/usr/bin/env tsx
/**
 * AUDIT — dump the thesis schema (current dataset: n=5000 seed=123) to local
 * JSON so the leakage experiments run locally without hammering the free-tier
 * pooler. Read-only. Preserves the loader's exact query shapes where order
 * matters (holdout train rows are dumped UNORDERED like unified-cases.ts reads
 * them, so train[0] semantics replicate).
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { writeFileSync, mkdirSync } from "fs";
import { getPgClient } from "@/lib/db/pg";

const DIR = resolve(process.cwd(), "scripts/_audit/data");

async function main() {
  mkdirSync(DIR, { recursive: true });
  const pg = await getPgClient({ scope: "thesis" });
  const save = (name: string, rows: unknown) => {
    const p = resolve(DIR, `${name}.json`);
    writeFileSync(p, JSON.stringify(rows));
    console.log(`[dump] ${name}: ${Array.isArray(rows) ? rows.length : "?"} rows -> ${p}`);
  };
  try {
    save(
      "products",
      (
        await pg.query(
          `SELECT id::text id, title, metadata, price_cents FROM thesis.products`,
        )
      ).rows,
    );
    save(
      "item_vectors_e1",
      (
        await pg.query(
          `SELECT product_id::text id, vector FROM thesis.item_vectors WHERE space='e1_prod2vec'`,
        )
      ).rows,
    );
    save(
      "events",
      (
        await pg.query(
          `SELECT session_id::text sid, anonymous_id::text uid, event_type et, payload->>'product_id' pid, occurred_at::text ts
           FROM thesis.events WHERE payload->>'product_id' IS NOT NULL
           ORDER BY anonymous_id, occurred_at`,
        )
      ).rows,
    );
    save(
      "sessions",
      (
        await pg.query(
          `SELECT session_id::text sid, user_id::text uid, intent, recipient_id::text rid, started_at::text ts FROM thesis.sim_sessions`,
        )
      ).rows,
    );
    save(
      "recipients",
      (
        await pg.query(
          `SELECT id::text id, gender, age_min, age_max FROM thesis.sim_user_recipients`,
        )
      ).rows,
    );
    // holdout train: UNORDERED on purpose (replicates unified-cases train[0])
    save(
      "holdout_train",
      (
        await pg.query(
          `SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='train'`,
        )
      ).rows,
    );
    save(
      "holdout_test",
      (
        await pg.query(
          `SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='test' ORDER BY user_id, product_id`,
        )
      ).rows,
    );
    save(
      "co_occurrence",
      (
        await pg.query(
          `SELECT product_a_id::text a, product_b_id::text b, count FROM thesis.co_occurrence`,
        )
      ).rows,
    );
    save(
      "co_occurrence_top",
      (
        await pg.query(
          `SELECT product_id::text pid, related_product_id::text rid, npmi_score s, rank FROM thesis.co_occurrence_top ORDER BY product_id, rank`,
        )
      ).rows,
    );
  } finally {
    await pg.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
