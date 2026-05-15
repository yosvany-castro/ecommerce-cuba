import type { Client } from "pg";
import { EMBEDDING_DIM } from "@/lib/embeddings/voyage";
import { buildInitialUnnormalized } from "./vector/init";
import { applyDecayAndAccumulate } from "./vector/update";
import { EVENT_WEIGHTS, TAU_PROFILE_DAYS } from "./vector/constants";
import { inferSignalFromProductMetadata } from "./cohorts/infer";
import type { CohortId } from "./cohorts/definitions";

interface ModeRow {
  id: string;
  user_profile_id: string;
  recipient_id: string | null;
  cohort_id: CohortId;
}

interface EventRow {
  event_type: string;
  occurred_at: Date;
  payload: { product_id?: string; product_ids?: string[] };
}

function parseVecText(s: string): number[] {
  return JSON.parse(s) as number[];
}

async function fetchCohortPrior(
  cohort_id: CohortId,
  pg: Client,
): Promise<number[]> {
  const r = await pg.query(
    `SELECT centroid_vector::text AS v FROM cohort_centroids WHERE cohort_id = $1`,
    [cohort_id],
  );
  if (r.rows.length === 0) return new Array(EMBEDDING_DIM).fill(0);
  return parseVecText(r.rows[0].v);
}

export async function recomputeProfileModes(pg: Client): Promise<void> {
  const modes = await pg.query(
    `SELECT id::text, user_profile_id::text, recipient_id::text, cohort_id
     FROM user_profile_modes WHERE n_events_in_mode > 0`,
  );

  for (const m of modes.rows as ModeRow[]) {
    const prior = await fetchCohortPrior(m.cohort_id, pg);
    let { unnorm, weight } = buildInitialUnnormalized(prior);
    let lastTs = new Date();

    const idR = await pg.query(
      `SELECT anonymous_id::text AS aid, user_id::text AS uid
       FROM user_profiles WHERE id = $1`,
      [m.user_profile_id],
    );
    const anon = idR.rows[0]?.aid;
    const uid = idR.rows[0]?.uid;

    const evR = await pg.query(
      `SELECT event_type, occurred_at, payload FROM events
       WHERE occurred_at > now() - interval '90 days'
         AND ((anonymous_id::text = $1 AND $1 IS NOT NULL)
           OR (user_id::text = $2 AND $2 IS NOT NULL))
       ORDER BY occurred_at ASC`,
      [anon, uid],
    );

    for (const e of evR.rows as EventRow[]) {
      const weightFor =
        EVENT_WEIGHTS[e.event_type as keyof typeof EVENT_WEIGHTS] ?? 0;
      if (weightFor <= 0) continue;

      const product_id =
        e.payload.product_id ??
        (e.payload.product_ids ? e.payload.product_ids[0] : undefined);
      if (!product_id) continue;

      const pr = await pg.query(
        `SELECT metadata, embedding::text AS v FROM products
         WHERE id = $1 AND embedding IS NOT NULL`,
        [product_id],
      );
      if (pr.rows.length === 0) continue;

      // Only events that match the cohort of this mode contribute
      const sig = inferSignalFromProductMetadata(pr.rows[0].metadata as never);
      if (sig.cohort_id !== m.cohort_id) continue;

      const productVec = parseVecText(pr.rows[0].v);
      const r = applyDecayAndAccumulate({
        unnorm,
        weight,
        lastUpdatedAt: lastTs,
        product: productVec,
        eventWeight: weightFor,
        now: e.occurred_at,
        tauMs: TAU_PROFILE_DAYS * 24 * 3600 * 1000,
      });
      unnorm = r.newUnnorm;
      weight = r.newWeight;
      lastTs = e.occurred_at;
    }

    await pg.query(
      `UPDATE user_profile_modes
          SET vector_unnormalized = $1::vector,
              weight_sum = $2,
              last_assigned_at = $3
        WHERE id = $4`,
      ["[" + unnorm.join(",") + "]", weight, lastTs, m.id],
    );
  }
}
