#!/usr/bin/env tsx
/**
 * Public-dataset adapter — maps a public JSONL e-commerce dataset into the
 * `thesis` Postgres schema with source='public', producing real products
 * (with Voyage AI embeddings) and purchase events.
 *
 * Expected JSONL shape (one JSON object per line):
 *   {
 *     product_id: string;       // REQUIRED — unique product identifier
 *     title?:       string;     // product name
 *     description?: string;     // textual description
 *     price_cents?: number;     // integer price in cents
 *     category?:    string;     // raw category label
 *     user_id?:     string;     // if present → generates a purchase event
 *     ts?:          string;     // ISO-8601 timestamp for the purchase event
 *   }
 *
 * Usage:
 *   pnpm thesis:public --file /path/to/data.jsonl --limit 5000
 *
 * Note: real-data products have no ground-truth factor vectors and are
 * therefore EXCLUDED from GT-based metrics (complement/substitute invariants).
 * They are included only for text-similarity and behaviour cross-checks that
 * test external validity of the synthetic pipeline.
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { getPgClient } from "@/lib/db/pg";
import { embed } from "@/lib/embeddings/voyage";

// ─── CLI args ─────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    file:  { type: "string" },
    limit: { type: "string", default: "5000" },
  },
  allowPositionals: false,
  strict: false,
});

// Guard: --file is required BEFORE any DB connection or file I/O
if (!values.file || typeof values.file !== "string" || values.file.trim() === "") {
  process.stderr.write("--file is required\n");
  process.exit(1);
}

const FILE  = (values.file as string).trim();
const LIMIT = parseInt(String(values.limit ?? "5000"), 10);
const BATCH_SIZE = 128;

// ─── Record shape ─────────────────────────────────────────────────────────────

interface PublicRecord {
  product_id:   string;
  title?:       string;
  description?: string;
  price_cents?: number;
  category?:    string;
  user_id?:     string;
  ts?:          string;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Read + parse JSONL
  const raw = readFileSync(FILE, "utf8");
  const records: PublicRecord[] = raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(0, LIMIT)
    .map((line) => JSON.parse(line) as PublicRecord)
    .filter((r) => typeof r.product_id === "string" && r.product_id.trim() !== "");

  console.log(`[public] Parsed ${records.length} records from ${FILE}`);

  // 2. Deduplicate products by product_id (first occurrence wins)
  const seenPids = new Set<string>();
  const uniqueProducts: PublicRecord[] = [];
  for (const r of records) {
    if (!seenPids.has(r.product_id)) {
      seenPids.add(r.product_id);
      uniqueProducts.push(r);
    }
  }
  console.log(`[public] ${uniqueProducts.length} unique products after dedup`);

  // 3. Connect to DB
  const pg = await getPgClient({ scope: "thesis" });

  try {
    // 4. Idempotent cleanup — only our source rows, synthetic rows untouched
    await pg.query("DELETE FROM thesis.products WHERE source = 'public'");
    await pg.query("DELETE FROM thesis.events WHERE source = 'public'");
    console.log("[public] Cleared prior source='public' rows");

    // 5. Embed + insert products in batches of 128
    const idByPid = new Map<string, string>(); // product_id → thesis products.id (uuid)

    for (let start = 0; start < uniqueProducts.length; start += BATCH_SIZE) {
      const batch = uniqueProducts.slice(start, start + BATCH_SIZE);

      // Build embedding texts
      const texts = batch.map((p) => {
        const combined = `${p.title ?? ""}\n${p.description ?? ""}`.trim();
        return combined !== "" ? combined : (p.title ?? p.product_id);
      });

      // Voyage embedding
      const vectors = await embed(texts, { inputType: "document" });

      console.log(
        `[public] Embedding batch ${Math.floor(start / BATCH_SIZE) + 1}/${Math.ceil(uniqueProducts.length / BATCH_SIZE)} (${batch.length} items)`,
      );

      // Insert each product
      for (let j = 0; j < batch.length; j++) {
        const p   = batch[j];
        const vec = vectors[j];

        const vectorLiteral = `[${vec.join(",")}]`;
        const metadata      = JSON.stringify({ category: p.category ?? null });

        const res = await pg.query<{ id: string }>(
          `INSERT INTO thesis.products
             (source, source_product_id, title, description,
              price_cents, currency, raw_category, metadata, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)
           ON CONFLICT (source, source_product_id) DO NOTHING
           RETURNING id`,
          [
            "public",
            p.product_id,
            p.title       ?? null,
            p.description ?? null,
            p.price_cents ?? 0,
            "USD",
            p.category    ?? "",
            metadata,
            vectorLiteral,
          ],
        );

        if (res.rows.length > 0) {
          idByPid.set(p.product_id, res.rows[0].id);
        }
      }
    }

    const productCount = idByPid.size;

    // 6. Insert purchase events for records that have a user_id + mapped product
    let eventCount = 0;
    for (const r of records) {
      if (!r.user_id) continue;
      const productUuid = idByPid.get(r.product_id);
      if (!productUuid) continue;

      const payload = JSON.stringify({ product_id: productUuid, public_user: r.user_id });
      const ts      = r.ts ?? "2026-01-01T00:00:00Z";

      await pg.query(
        `INSERT INTO thesis.events
           (anonymous_id, session_id, event_type, occurred_at, payload, source)
         VALUES
           (gen_random_uuid(), gen_random_uuid(), 'purchase', $1::timestamptz, $2::jsonb, 'public')`,
        [ts, payload],
      );
      eventCount++;
    }

    console.log(`[public] products=${productCount} events=${eventCount}`);
  } finally {
    await pg.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
