import type { Client } from "pg";

export const MIN_COUNT_FOR_NPMI = 3;
export const NPMI_TOP_K = 50;

export interface NPMIInput {
  countAB: number;
  countA: number;
  countB: number;
  nTotal: number;
}

/**
 * Normalized Pointwise Mutual Information.
 * NPMI = ln(P(a,b)/(P(a)*P(b))) / -ln(P(a,b))
 * Range: [-1, 1]. Returns 0 for degenerate inputs (zero counts, P_ab >= 1).
 */
export function npmiFromCounts(input: NPMIInput): number {
  if (input.countAB <= 0 || input.countA <= 0 || input.countB <= 0) return 0;
  if (input.nTotal <= 0) return 0;
  const pAB = input.countAB / input.nTotal;
  const pA = input.countA / input.nTotal;
  const pB = input.countB / input.nTotal;
  if (pAB >= 1) return 0; // -ln(1) = 0 denominator
  const numerator = Math.log(pAB / (pA * pB));
  const denominator = -Math.log(pAB);
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Recomputes NPMI over all co_occurrence pairs with count >= MIN_COUNT_FOR_NPMI,
 * persists top-NPMI_TOP_K per product (symmetric: a→b AND b→a) to co_occurrence_top.
 * Filters npmi <= 0 (only positive associations kept).
 */
export async function recomputeNPMI(pg: Client): Promise<void> {
  await pg.query(`TRUNCATE co_occurrence_top`);

  const totR = await pg.query(
    `SELECT COALESCE(SUM(count), 0)::float AS total
     FROM co_occurrence WHERE count >= $1`,
    [MIN_COUNT_FOR_NPMI],
  );
  const nTotal = Number(totR.rows[0].total ?? 0);
  if (nTotal <= 0) return;

  await pg.query(
    `
    WITH
    filtered AS (
      SELECT product_a_id, product_b_id, count
      FROM co_occurrence WHERE count >= $1
    ),
    per_product AS (
      SELECT product_id, SUM(count) AS n FROM (
        SELECT product_a_id AS product_id, count FROM filtered
        UNION ALL
        SELECT product_b_id AS product_id, count FROM filtered
      ) t GROUP BY product_id
    ),
    pairs AS (
      SELECT
        f.product_a_id, f.product_b_id,
        f.count / $2::numeric AS p_ab,
        na.n  / $2::numeric AS p_a,
        nb.n  / $2::numeric AS p_b
      FROM filtered f
      JOIN per_product na ON na.product_id = f.product_a_id
      JOIN per_product nb ON nb.product_id = f.product_b_id
    ),
    scored AS (
      SELECT product_a_id, product_b_id,
        CASE
          WHEN p_ab > 0 AND p_a > 0 AND p_b > 0 AND p_ab < 1
          THEN LN(p_ab / (p_a * p_b)) / (-LN(p_ab))
          ELSE 0
        END AS npmi
      FROM pairs
    ),
    expanded AS (
      SELECT product_a_id AS product_id, product_b_id AS related_product_id, npmi
        FROM scored WHERE npmi > 0
      UNION ALL
      SELECT product_b_id AS product_id, product_a_id AS related_product_id, npmi
        FROM scored WHERE npmi > 0
    ),
    ranked AS (
      SELECT product_id, related_product_id, npmi,
             ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY npmi DESC) AS rank
      FROM expanded
    )
    INSERT INTO co_occurrence_top (product_id, related_product_id, npmi_score, rank, last_recompute_at)
    SELECT product_id, related_product_id, npmi, rank::smallint, now()
    FROM ranked WHERE rank <= $3
    `,
    [MIN_COUNT_FOR_NPMI, nTotal, NPMI_TOP_K],
  );
}
