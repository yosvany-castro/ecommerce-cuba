import { describe, test, expect } from "vitest";
import { getPgClient } from "@/lib/db/pg";
import { sampleCatalog } from "@/thesis/data/catalog-model";
import { buildRelations } from "@/thesis/data/relations-model";
import { embed } from "@/lib/embeddings/voyage";
import { complementRecallAtK } from "@/thesis/eval/metrics";

/**
 * Plants a small catalog with a known complement graph, then verifies the eval
 * harness DISCRIMINATES commercial relation from linguistic proximity: a phone's
 * text-cosine nearest neighbours are dominated by other tech (substitutes), NOT
 * its accessory complements, whereas the ground-truth graph holds the
 * complements by construction. This is the core thesis claim, on real data.
 *
 * NOTE: mutates the `thesis` schema (truncates + reseeds thesis.products). That
 * is consistent with how this repo's integration tests use their schema; the
 * data CLIs regenerate the working dataset deterministically afterwards.
 */
describe("harness discrimination (real DB, thesis schema)", () => {
  test("text cosine misses accessory complements that the GT graph holds", async () => {
    const pg = await getPgClient({ scope: "thesis" });
    try {
      await pg.query(`TRUNCATE thesis.products CASCADE`);
      const cat = sampleCatalog(120, 314);
      const vectors = await embed(cat.map((p) => p.canonicalText), { inputType: "document" });
      const idByName = new Map<string, string>();
      for (let i = 0; i < cat.length; i++) {
        const p = cat[i];
        const ins = await pg.query(
          `INSERT INTO thesis.products (source, source_product_id, title, description, price_cents, currency, raw_category, metadata, embedding)
           VALUES ('thesis-syn',$1,$2,$3,$4,'USD',$5,$6::jsonb,$7::vector) RETURNING id::text`,
          [p.source_product_id, p.title, p.description, p.price_cents, p.attrs.category, JSON.stringify({ subcategory: p.attrs.subcategory, brand: p.attrs.brand }), "[" + vectors[i].join(",") + "]"],
        );
        idByName.set(p.source_product_id, ins.rows[0].id);
      }

      const rels = buildRelations(cat);
      const phone = cat.find((p) => p.attrs.subcategory === "smartphone" && rels.some((r) => r.product_a_id === p.source_product_id && r.relation_type === "complement"));
      // The seed/size is chosen so a phone-with-complements exists; assert that, don't silently skip.
      expect(phone === undefined).toBe(false);
      const phoneId = idByName.get(phone!.source_product_id)!;
      const complementIds = new Set(
        rels.filter((r) => r.product_a_id === phone!.source_product_id && r.relation_type === "complement").map((r) => idByName.get(r.product_b_id)!),
      );
      expect(complementIds.size).toBeGreaterThan(0);

      const near = await pg.query(
        `SELECT id::text id FROM thesis.products WHERE id <> $1
         ORDER BY embedding <=> (SELECT embedding FROM thesis.products WHERE id=$1) LIMIT 10`,
        [phoneId],
      );
      const cosineNeighbours = (near.rows as { id: string }[]).map((r) => r.id);

      const cosComplementRecall = complementRecallAtK(cosineNeighbours, complementIds, 10);
      const gtComplementRecall = complementRecallAtK([...complementIds], complementIds, complementIds.size);

      expect(gtComplementRecall).toBe(1);
      // The thesis claim: text cosine does NOT surface the commercial complements as well as the GT graph.
      expect(cosComplementRecall).toBeLessThan(gtComplementRecall);
    } finally {
      await pg.end();
    }
  }, 120_000);
});
