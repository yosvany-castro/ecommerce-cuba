#!/usr/bin/env tsx
/**
 * Build E4 late-interaction chunk vectors: embed each product's title, description,
 * and an attributes string SEPARATELY with Voyage; persist to
 * thesis.item_chunk_vectors (space='e4_late'). The study runner scores via MaxSim.
 * Usage: pnpm thesis:build-chunks
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getPgClient } from "@/lib/db/pg";
import { embed } from "@/lib/embeddings/voyage";

function attrText(m: Record<string, unknown>): string {
  return [m.subcategory, m.brand, m.style, m.gender_target].filter(Boolean).join(" ");
}

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    const r = await pg.query(`SELECT id::text id, title, description, metadata FROM thesis.products`);
    const rows = r.rows as { id: string; title: string; description: string; metadata: Record<string, unknown> }[];
    await pg.query(`DELETE FROM thesis.item_chunk_vectors WHERE space='e4_late'`);

    const BATCH = 64; // products per batch → 3*BATCH texts per Voyage call
    let persisted = 0;
    const roles = ["title", "description", "attributes"];
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const texts: string[] = [];
      for (const p of batch) {
        texts.push(p.title || p.id, p.description || p.title || p.id, attrText(p.metadata) || p.title || p.id);
      }
      const vecs = await embed(texts, { inputType: "document" });
      for (let b = 0; b < batch.length; b++) {
        for (let c = 0; c < 3; c++) {
          await pg.query(
            `INSERT INTO thesis.item_chunk_vectors (space, product_id, chunk_index, chunk_role, vector)
             VALUES ('e4_late', $1, $2, $3, $4)
             ON CONFLICT (space, product_id, chunk_index) DO UPDATE SET vector = EXCLUDED.vector, chunk_role = EXCLUDED.chunk_role`,
            [batch[b].id, c, roles[c], vecs[b * 3 + c]],
          );
        }
        persisted++;
      }
      console.log(`[e4] chunks for ${Math.min(i + BATCH, rows.length)}/${rows.length} products`);
    }
    console.log(`[e4] persisted chunks for ${persisted} products`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
