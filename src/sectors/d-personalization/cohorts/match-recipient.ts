import type { Client } from "pg";
import { parseCohort, AGE_BAND_RANGES, type CohortId } from "./definitions";

export async function matchRecipientOrNull(
  user_id: string | null,
  cohort_id: CohortId,
  pg: Client,
): Promise<string | null> {
  if (!user_id) return null;
  const { gender, age_band } = parseCohort(cohort_id);
  if (!gender || !age_band) return null;
  const range = AGE_BAND_RANGES[age_band];
  const r = await pg.query(
    `SELECT id::text FROM recipients
      WHERE user_id = $1
        AND gender = $2
        AND age BETWEEN $3 AND $4
      ORDER BY created_at DESC
      LIMIT 1`,
    [user_id, gender, range.min, range.max],
  );
  return r.rows[0]?.id ?? null;
}
