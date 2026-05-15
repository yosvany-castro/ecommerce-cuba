import type { Client } from "pg";

export interface CoOccurrenceTopRow {
  product_id: string;
  product_title: string;
  related_product_id: string;
  related_product_title: string;
  npmi_score: number;
  rank: number;
}

/**
 * Returns the global top pairs by NPMI score with product titles joined.
 * Useful in admin to detect artifacts (products that co-occur with everything).
 */
export async function getCoOccurrenceTopAdmin(
  opts: { limit?: number },
  pg: Client,
): Promise<CoOccurrenceTopRow[]> {
  const limit = opts.limit ?? 50;
  const r = await pg.query(
    `SELECT co.product_id::text AS product_id,
            p.title AS product_title,
            co.related_product_id::text AS related_product_id,
            rp.title AS related_product_title,
            co.npmi_score, co.rank
     FROM co_occurrence_top co
     JOIN products p  ON p.id  = co.product_id
     JOIN products rp ON rp.id = co.related_product_id
     ORDER BY co.npmi_score DESC, co.rank ASC
     LIMIT $1`,
    [limit],
  );
  return (
    r.rows as Array<{
      product_id: string;
      product_title: string;
      related_product_id: string;
      related_product_title: string;
      npmi_score: string;
      rank: number;
    }>
  ).map((row) => ({
    product_id: row.product_id,
    product_title: row.product_title,
    related_product_id: row.related_product_id,
    related_product_title: row.related_product_title,
    npmi_score: Number(row.npmi_score),
    rank: row.rank,
  }));
}
