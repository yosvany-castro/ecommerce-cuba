#!/usr/bin/env tsx
/**
 * Ground-truth relation graph generator CLI.
 *
 * Reads the synthetic catalog from `thesis.products`, reconstructs minimal
 * SynthProduct objects, invokes `buildRelations` to produce the deterministic
 * complement/substitute graph, and persists it into
 * `thesis.gt_product_relations`.
 *
 * Key design decisions:
 *  - TRUNCATE before insert guarantees idempotency: re-running is always safe.
 *  - uuid mapping is done in-process (Map<source_product_id, uuid>) — no
 *    correlated sub-queries, no round-trips per row.
 *  - ON CONFLICT DO NOTHING is belt-and-suspenders against any race or
 *    duplicate source_product_id in the catalog.
 *  - Only `source_product_id`, `metadata.subcategory`, and `metadata.brand`
 *    are read from the DB; all other SynthProduct fields are filled with safe
 *    defaults because `buildRelations` never reads them.
 *
 * Usage:
 *   pnpm thesis:relations
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getPgClient } from "@/lib/db/pg";
import { buildRelations } from "@/thesis/data/relations-model";
import type { SynthProduct } from "@/thesis/data/catalog-model";

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const pg = await getPgClient({ scope: "thesis" });

  try {
    // 1. Fetch catalog rows — only the fields buildRelations actually reads
    const { rows } = await pg.query<{
      id: string;
      source_product_id: string;
      metadata: {
        category?: string;
        subcategory: string;
        brand: string;
        gender_target?: string | null;
        price_band?: number;
        style?: string;
      };
      price_cents: number;
    }>(
      `SELECT id::text AS id, source_product_id, metadata, price_cents
       FROM thesis.products`,
    );

    if (rows.length === 0) {
      console.error("[relations] ERROR: thesis.products is empty — run pnpm thesis:catalog first");
      process.exit(1);
    }

    // 2. Build lookup: source_product_id → postgres uuid
    const idByName = new Map<string, string>();
    for (const row of rows) {
      idByName.set(row.source_product_id, row.id);
    }

    // 3. Reconstruct minimal SynthProduct[] — buildRelations only reads
    //    source_product_id, attrs.subcategory, attrs.brand
    const catalog: SynthProduct[] = rows.map((row) => ({
      source_product_id: row.source_product_id,
      title: "",
      description: "",
      canonicalText: "",
      price_cents: row.price_cents,
      attrs: {
        category:   row.metadata.category   ?? "",
        subcategory: row.metadata.subcategory,
        brand:       row.metadata.brand,
        gender:      (row.metadata.gender_target as "masculino" | "femenino" | "unisex") ?? "unisex",
        ageBand:     "adulto",
        priceBand:   Number(row.metadata.price_band ?? 0),
        style:       row.metadata.style ?? "",
      },
      factor_vector: [],
    }));

    // 4. Build the deterministic ground-truth relation graph
    const rels = buildRelations(catalog);
    console.log(`[relations] buildRelations produced ${rels.length} raw relations`);

    // 5. Truncate existing data to guarantee idempotency
    await pg.query("TRUNCATE thesis.gt_product_relations");

    // 6. Insert each relation, mapping source_product_id → uuid
    let inserted = 0;
    let skipped = 0;

    for (const rel of rels) {
      const aUuid = idByName.get(rel.product_a_id);
      const bUuid = idByName.get(rel.product_b_id);

      if (!aUuid || !bUuid) {
        skipped++;
        continue; // source_product_id not found in DB — skip silently
      }

      await pg.query(
        `INSERT INTO thesis.gt_product_relations
           (product_a_id, product_b_id, relation_type, strength)
         VALUES ($1::uuid, $2::uuid, $3, $4)
         ON CONFLICT DO NOTHING`,
        [aUuid, bUuid, rel.relation_type, rel.strength],
      );
      inserted++;
    }

    if (skipped > 0) {
      console.warn(`[relations] skipped ${skipped} relations (source_product_id not in DB)`);
    }

    if (inserted === 0) {
      console.error("[relations] ERROR: 0 relations inserted — check catalog and taxonomy COMPLEMENTS map");
      process.exit(1);
    }

    console.log(`[relations] inserted ${inserted} ground-truth relations`);
  } finally {
    await pg.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
