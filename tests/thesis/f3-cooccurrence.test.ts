import { describe, test, expect } from "vitest";
import { getPgClient } from "@/lib/db/pg";

/**
 * Verifies the NPMI co-occurrence graph (backfilled from synthetic events)
 * recovers GROUND-TRUTH complements far better than text cosine. This is the
 * thesis premise behind the NPMI pool source: cross-sell lives in co-occurrence,
 * not in the embedding space. Requires `pnpm thesis:backfill-cooccurrence` first.
 */
describe("F3 co-occurrence recovers GT complements (real DB)", () => {
  test("NPMI neighbours hit GT complements more than text-cosine neighbours do", async () => {
    const pg = await getPgClient({ scope: "thesis" });
    try {
      const anchors = await pg.query(`
        SELECT DISTINCT r.product_a_id::text AS id
        FROM thesis.gt_product_relations r
        WHERE r.relation_type='complement'
          AND EXISTS (SELECT 1 FROM thesis.co_occurrence_top t WHERE t.product_id = r.product_a_id)
        LIMIT 40
      `);
      expect(anchors.rows.length).toBeGreaterThan(0);

      let npmiHits = 0, cosHits = 0, total = 0;
      for (const a of anchors.rows as { id: string }[]) {
        const gt = new Set(
          (await pg.query(`SELECT product_b_id::text id FROM thesis.gt_product_relations WHERE product_a_id=$1 AND relation_type='complement'`, [a.id])).rows.map((r: { id: string }) => r.id),
        );
        if (gt.size === 0) continue;
        total++;
        const npmi = (await pg.query(`SELECT related_product_id::text id FROM thesis.co_occurrence_top WHERE product_id=$1 ORDER BY rank LIMIT 10`, [a.id])).rows.map((r: { id: string }) => r.id);
        const cosN = (await pg.query(
          `SELECT p2.id::text id
           FROM thesis.products p1
           JOIN thesis.products p2 ON p2.id<>p1.id AND p2.embedding IS NOT NULL
           WHERE p1.id=$1 AND p1.embedding IS NOT NULL
           ORDER BY p1.embedding <=> p2.embedding
           LIMIT 10`, [a.id],
        )).rows.map((r: { id: string }) => r.id);
        npmiHits += npmi.filter((id) => gt.has(id)).length;
        cosHits += cosN.filter((id) => gt.has(id)).length;
      }
      expect(total).toBeGreaterThan(0);
      // NPMI should recover strictly more GT complements than text cosine
      expect(npmiHits).toBeGreaterThan(cosHits);
    } finally {
      await pg.end();
    }
  }, 120_000);
});
