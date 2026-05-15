import type { Client } from "pg";
import type { SubBucketState } from "./shift-detection";
import type { EventSignal } from "../cohorts/infer";
import type { CohortId } from "../cohorts/definitions";
import { EMBEDDING_DIM } from "@/lib/embeddings/voyage";

interface Row {
  current_cohort_id: string | null;
  current_recipient_id: string | null;
  signal_window: EventSignal[] | null;
  signal_window_size: number | null;
}

export type FullSessionState = SubBucketState & {
  current_recipient_id: string | null;
};

export async function readSessionState(
  session_id: string,
  pg: Client,
): Promise<FullSessionState> {
  const r = await pg.query(
    `SELECT current_cohort_id, current_recipient_id::text AS current_recipient_id,
            signal_window, signal_window_size
     FROM session_vectors WHERE session_id = $1`,
    [session_id],
  );
  if (r.rows.length === 0) {
    return {
      current_cohort_id: null,
      current_recipient_id: null,
      signal_window: [],
      signal_window_size: 0,
    };
  }
  const row = r.rows[0] as Row;
  return {
    current_cohort_id: (row.current_cohort_id ?? null) as CohortId | null,
    current_recipient_id: row.current_recipient_id ?? null,
    signal_window: row.signal_window ?? [],
    signal_window_size: row.signal_window_size ?? 0,
  };
}

export async function persistSessionState(
  session_id: string,
  state: FullSessionState,
  pg: Client,
): Promise<void> {
  const zeroVec = "[" + new Array(EMBEDDING_DIM).fill(0).join(",") + "]";
  await pg.query(
    `INSERT INTO session_vectors
       (session_id, vector_unnormalized, weight_sum, updated_at,
        current_cohort_id, current_recipient_id, signal_window, signal_window_size)
     VALUES ($1, $2::vector, 0, now(), $3, $4, $5::jsonb, $6)
     ON CONFLICT (session_id) DO UPDATE SET
       current_cohort_id = EXCLUDED.current_cohort_id,
       current_recipient_id = EXCLUDED.current_recipient_id,
       signal_window = EXCLUDED.signal_window,
       signal_window_size = EXCLUDED.signal_window_size,
       updated_at = now()`,
    [
      session_id,
      zeroVec,
      state.current_cohort_id,
      state.current_recipient_id,
      JSON.stringify(state.signal_window),
      state.signal_window_size,
    ],
  );
}
