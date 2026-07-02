#!/usr/bin/env tsx
/**
 * Build E5 vectors with voyage-context-3 (contextualized chunk embeddings). Each
 * product = one document with chunks [title, description, attributes]; pool the
 * returned contextual chunk vectors into ONE item vector; persist to
 * thesis.item_vectors (space='e5_context3'). This is the realistic PRODUCTION
 * serving candidate (single dense vector per item, drop-in for pgvector).
 * Usage: pnpm thesis:build-context3
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getPgClient } from "@/lib/db/pg";
import { contextualizedEmbed } from "@/lib/embeddings/voyage-context";

function attrText(m: Record<string, unknown>): string {
  return [m.subcategory, m.brand, m.style, m.gender_target].filter(Boolean).join(" ");
}
function l2(v: number[]): number[] {
  let s = 0; for (const x of v) s += x * x; const n = Math.sqrt(s);
  return n === 0 ? v.slice() : v.map((x) => x / n);
}
function meanPool(vs: number[][]): number[] {
  const d = vs[0].length; const o = new Array<number>(d).fill(0);
  for (const v of vs) for (let i = 0; i < d; i++) o[i] += v[i];
  return o.map((x) => x / vs.length);
}

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    const r = await pg.query(`SELECT id::text id, title, description, metadata FROM thesis.products`);
    const rows = r.rows as { id: string; title: string; description: string; metadata: Record<string, unknown> }[];
    await pg.query(`DELETE FROM thesis.item_vectors WHERE space='e5_context3'`);

    const BATCH = 32;
    let n = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const docs = batch.map((p) => [p.title || p.id, p.description || p.title || p.id, attrText(p.metadata) || p.title || p.id]);
      const perDocChunks = await contextualizedEmbed(docs, { inputType: "document" }); // number[][][]
      if (i === 0) console.log(`[e5] first-call shape: ${perDocChunks.length} docs, doc0 has ${perDocChunks[0]?.length} chunks, chunk0 dim ${perDocChunks[0]?.[0]?.length}`);
      for (let b = 0; b < batch.length; b++) {
        const itemVec = l2(meanPool(perDocChunks[b]));
        await pg.query(
          `INSERT INTO thesis.item_vectors (space, product_id, vector) VALUES ('e5_context3', $1, $2)
           ON CONFLICT (space, product_id) DO UPDATE SET vector = EXCLUDED.vector`,
          [batch[b].id, itemVec],
        );
        n++;
      }
      console.log(`[e5] ${Math.min(i + BATCH, rows.length)}/${rows.length} products`);
    }
    console.log(`[e5] persisted ${n} item vectors`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
