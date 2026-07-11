import type { Client } from "pg";
import type { MockProduct } from "@/sectors/b-catalog/mock/types";
import { embed } from "@/lib/embeddings/voyage";
import { normalizeWithLLM, type NormalizedMetadata } from "./normalizer";
import { buildCanonicalText } from "./canonical";
import { attrsForStorage } from "./attrs";

export interface ProcessResult {
  productId: string;
  inserted: boolean;
  enrichmentStatus: NormalizedMetadata["enrichment_status"];
}

export async function processProduct(
  raw: MockProduct,
  pg: Client,
): Promise<ProcessResult> {
  const normalized = await normalizeWithLLM(raw);
  const attrs = attrsForStorage(raw.attributes);
  const metadata = { ...normalized, ...(attrs !== undefined ? { attrs } : {}) };
  const canonical = buildCanonicalText(raw, metadata);
  const [embedding] = await embed([canonical], { inputType: "document" });

  const r = await pg.query(
    `INSERT INTO products
      (source, source_product_id, title, description, price_cents, currency, image_url, raw_category, url, metadata, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::vector)
     ON CONFLICT (source, source_product_id) DO UPDATE SET
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       price_cents = EXCLUDED.price_cents,
       image_url = EXCLUDED.image_url,
       raw_category = EXCLUDED.raw_category,
       url = EXCLUDED.url,
       metadata = CASE
         WHEN products.metadata->'attrs'->>'hydrated_at' IS NOT NULL THEN
           jsonb_set(
             EXCLUDED.metadata, '{attrs}',
             (EXCLUDED.metadata->'attrs')
               || jsonb_build_object('hydrated_at', products.metadata->'attrs'->'hydrated_at')
               || CASE WHEN products.metadata->'attrs' ? 'variants'
                       THEN jsonb_build_object('variants', products.metadata->'attrs'->'variants')
                       ELSE '{}'::jsonb END,
             true
           )
         ELSE EXCLUDED.metadata
       END,
       embedding = EXCLUDED.embedding,
       last_refreshed_at = now()
     RETURNING id, (xmax = 0) AS inserted`,
    [
      raw.source,
      raw.source_product_id,
      raw.title,
      raw.description,
      raw.price_cents,
      "USD",
      raw.image_url,
      raw.raw_category,
      raw.url ?? null,
      JSON.stringify(metadata),
      `[${embedding.join(",")}]`,
    ],
  );

  return {
    productId: r.rows[0].id,
    inserted: r.rows[0].inserted,
    enrichmentStatus: metadata.enrichment_status,
  };
}
