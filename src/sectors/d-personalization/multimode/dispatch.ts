import type { Client } from "pg";
import { normalize, cosine } from "@/lib/math";
import type { CohortId } from "../cohorts/definitions";

export interface ModeRow {
  id: string;
  mode_index: number;
  vector_unnormalized: number[];
  weight_sum: number;
  n_events_in_mode: number;
}

function parseVecText(s: string): number[] {
  return JSON.parse(s) as number[];
}

export async function fetchAllModesInBucket(
  opts: {
    user_profile_id: string;
    recipient_id: string | null;
    cohort_id: CohortId;
  },
  pg: Client,
): Promise<ModeRow[]> {
  const r = await pg.query(
    `SELECT id::text, mode_index, vector_unnormalized::text AS v,
            weight_sum, n_events_in_mode
     FROM user_profile_modes
     WHERE user_profile_id = $1
       AND ((recipient_id IS NULL AND $2::uuid IS NULL) OR recipient_id = $2)
       AND cohort_id = $3
     ORDER BY mode_index ASC`,
    [opts.user_profile_id, opts.recipient_id, opts.cohort_id],
  );
  return (
    r.rows as Array<{
      id: string;
      mode_index: number;
      v: string;
      weight_sum: string;
      n_events_in_mode: string;
    }>
  ).map((row) => ({
    id: row.id,
    mode_index: row.mode_index,
    vector_unnormalized: parseVecText(row.v),
    weight_sum: Number(row.weight_sum),
    n_events_in_mode: Number(row.n_events_in_mode),
  }));
}

/**
 * Dispatch: cuando el bucket tiene multi-modo, escoge el mode cuyo centroide
 * normalizado tiene mayor cosine al embedding del producto. Si hay 1 solo mode
 * o ninguno, devuelve ese (o null).
 */
export async function pickBestMode(
  opts: {
    user_profile_id: string;
    recipient_id: string | null;
    cohort_id: CohortId;
  },
  productEmbedding: number[],
  pg: Client,
): Promise<ModeRow | null> {
  const modes = await fetchAllModesInBucket(opts, pg);
  if (modes.length === 0) return null;
  if (modes.length === 1) return modes[0];

  let best = modes[0];
  let bestCos = cosine(normalize(modes[0].vector_unnormalized), productEmbedding);
  for (let i = 1; i < modes.length; i++) {
    const c = cosine(normalize(modes[i].vector_unnormalized), productEmbedding);
    if (c > bestCos) {
      best = modes[i];
      bestCos = c;
    }
  }
  return best;
}
