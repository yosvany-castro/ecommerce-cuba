#!/usr/bin/env tsx
/**
 * Thesis catalog generator CLI.
 *
 * Persists a synthetic catalog into the `thesis` Postgres schema:
 *   - TRUNCATE thesis.products CASCADE (wipes prior run)
 *   - sampleCatalog(n, seed) → N SynthProduct entries
 *   - Voyage embeddings in batches of 128
 *   - INSERTs into thesis.products + thesis.gt_product_factors
 *
 * Usage:
 *   pnpm thesis:catalog --n 5000 --seed 42
 *
 * Defaults: --n 5000  --seed 42
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { parseArgs } from "node:util";
import { getPgClient } from "@/lib/db/pg";
import { embed } from "@/lib/embeddings/voyage";
import { sampleCatalog } from "@/thesis/data/catalog-model";
import type { AgeBand } from "@/thesis/taxonomy";

// ─── CLI args ─────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    n: { type: "string", default: "5000" },
    seed: { type: "string", default: "42" },
  },
});

const N = parseInt(values.n!, 10);
const SEED = parseInt(values.seed!, 10);
const BATCH_SIZE = 128;

// ─── Age-band helper ──────────────────────────────────────────────────────────

interface AgeRange {
  min: number;
  max: number;
}

function ageTarget(ageBand: AgeBand): AgeRange {
  switch (ageBand) {
    case "bebe":  return { min: 0,  max: 3   };
    case "nino":  return { min: 4,  max: 11  };
    case "joven": return { min: 12, max: 25  };
    case "adulto":return { min: 26, max: 59  };
    case "mayor": return { min: 60, max: 130 };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const pg = await getPgClient({ scope: "thesis" });

  try {
    // 1. Clear prior synthetic catalog (cascades to gt_product_factors)
    console.log("Truncating thesis.products CASCADE …");
    await pg.query("TRUNCATE thesis.products CASCADE");

    // 2. Generate catalog
    console.log(`Sampling catalog: n=${N}, seed=${SEED} …`);
    const products = sampleCatalog(N, SEED);
    console.log(`Generated ${products.length} products.`);

    // 3. Embed + insert in batches
    let embedded = 0;
    for (let batchStart = 0; batchStart < products.length; batchStart += BATCH_SIZE) {
      const batch = products.slice(batchStart, batchStart + BATCH_SIZE);

      // Embed
      const vectors = await embed(
        batch.map((p) => p.canonicalText),
        { inputType: "document" },
      );

      // Insert each product in the batch
      for (let j = 0; j < batch.length; j++) {
        const p = batch[j];
        const vec = vectors[j];
        const { attrs } = p;

        // Build metadata JSON
        const metadata = {
          category:      attrs.category,
          subcategory:   attrs.subcategory,
          brand:         attrs.brand,
          gender_target: attrs.gender === "unisex" ? null : attrs.gender,
          age_target:    ageTarget(attrs.ageBand),
          style:         attrs.style,
          price_band:    attrs.priceBand,
        };

        // Format pgvector literal: '[x,x,x,...]'::vector
        const vectorLiteral = `[${vec.join(",")}]`;

        // INSERT product → get back the generated UUID
        const productRes = await pg.query<{ id: string }>(
          `INSERT INTO thesis.products
             (source, source_product_id, title, description,
              price_cents, currency, raw_category, metadata, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)
           RETURNING id`,
          [
            "thesis-syn",
            p.source_product_id,
            p.title,
            p.description,
            p.price_cents,
            "USD",
            attrs.category,
            JSON.stringify(metadata),
            vectorLiteral,
          ],
        );
        const productId = productRes.rows[0].id;

        // INSERT ground-truth factor row (FK: product_id → products.id)
        await pg.query(
          `INSERT INTO thesis.gt_product_factors
             (product_id, factor_vector, taxonomy)
           VALUES ($1, $2, $3)`,
          [
            productId,
            p.factor_vector,          // node-postgres maps number[] → double precision[]
            JSON.stringify(attrs),
          ],
        );
      }

      embedded += batch.length;
      console.log(`  embedded ${embedded}/${products.length}`);
    }

    // 4. Final verification count
    const countRes = await pg.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM thesis.products",
    );
    console.log(`\nDone. thesis.products count: ${countRes.rows[0].count}`);
  } finally {
    await pg.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
