import type { Client } from "pg";
import { EMBEDDING_DIM } from "@/lib/embeddings/voyage";
import { buildInitialUnnormalized } from "./vector/init";
import { applyDecayAndAccumulate } from "./vector/update";
import { TAU_PROFILE_DAYS } from "./vector/constants";
import type { CohortId } from "./cohorts/definitions";

export interface ProfileMode {
  id: string;
  user_profile_id: string;
  recipient_id: string | null;
  cohort_id: CohortId;
  vector_unnormalized: number[];
  weight_sum: number;
  n_events_in_mode: number;
  last_assigned_at: Date;
}

function parseVecText(s: string): number[] {
  return JSON.parse(s) as number[];
}

async function fetchCohortPrior(
  cohort_id: CohortId,
  pg: Client,
): Promise<number[] | null> {
  const r = await pg.query(
    `SELECT centroid_vector::text AS v FROM cohort_centroids WHERE cohort_id = $1`,
    [cohort_id],
  );
  if (r.rows.length === 0) return null;
  return parseVecText(r.rows[0].v);
}

async function fetchGlobalCentroidFallback(pg: Client): Promise<number[]> {
  const r = await pg.query(
    `SELECT embedding::text AS v FROM products
     WHERE is_active = true AND embedding IS NOT NULL
     LIMIT 200`,
  );
  if (r.rows.length === 0) return new Array(EMBEDDING_DIM).fill(0);
  const sum = new Array<number>(EMBEDDING_DIM).fill(0);
  for (const row of r.rows as { v: string }[]) {
    const e = parseVecText(row.v);
    if (e.length !== EMBEDDING_DIM) continue;
    for (let i = 0; i < EMBEDDING_DIM; i++) sum[i] += e[i];
  }
  return sum.map((x) => x / r.rows.length);
}

export async function getOrInitProfileMode(
  opts: {
    user_profile_id: string;
    recipient_id: string | null;
    cohort_id: CohortId;
    mode_index?: number;
  },
  pg: Client,
): Promise<ProfileMode> {
  const mode_index = opts.mode_index ?? 1;
  const r = await pg.query(
    `SELECT id::text, user_profile_id::text, recipient_id::text, cohort_id,
            vector_unnormalized::text AS v, weight_sum, n_events_in_mode,
            last_assigned_at
     FROM user_profile_modes
     WHERE user_profile_id = $1
       AND ((recipient_id IS NULL AND $2::uuid IS NULL) OR recipient_id = $2)
       AND cohort_id = $3
       AND mode_index = $4`,
    [opts.user_profile_id, opts.recipient_id, opts.cohort_id, mode_index],
  );
  if (r.rows.length > 0) {
    const row = r.rows[0];
    return {
      id: row.id,
      user_profile_id: row.user_profile_id,
      recipient_id: row.recipient_id,
      cohort_id: row.cohort_id as CohortId,
      vector_unnormalized: parseVecText(row.v),
      weight_sum: Number(row.weight_sum),
      n_events_in_mode: Number(row.n_events_in_mode),
      last_assigned_at: row.last_assigned_at,
    };
  }

  const prior =
    (await fetchCohortPrior(opts.cohort_id, pg)) ??
    (await fetchGlobalCentroidFallback(pg));
  const { unnorm, weight } = buildInitialUnnormalized(prior);
  const ins = await pg.query(
    `INSERT INTO user_profile_modes
       (user_profile_id, recipient_id, cohort_id, mode_index,
        vector_unnormalized, weight_sum, n_events_in_mode, last_assigned_at)
     VALUES ($1, $2, $3, $4, $5::vector, $6, 0, now())
     RETURNING id::text, last_assigned_at`,
    [
      opts.user_profile_id,
      opts.recipient_id,
      opts.cohort_id,
      mode_index,
      "[" + unnorm.join(",") + "]",
      weight,
    ],
  );
  return {
    id: ins.rows[0].id,
    user_profile_id: opts.user_profile_id,
    recipient_id: opts.recipient_id,
    cohort_id: opts.cohort_id,
    vector_unnormalized: unnorm,
    weight_sum: weight,
    n_events_in_mode: 0,
    last_assigned_at: ins.rows[0].last_assigned_at,
  };
}

export async function updateProfileModeWithProduct(
  opts: { mode_id: string; product_id: string; event_weight: number },
  pg: Client,
): Promise<ProfileMode> {
  const cur = await pg.query(
    `SELECT id::text, user_profile_id::text, recipient_id::text, cohort_id,
            vector_unnormalized::text AS v, weight_sum, n_events_in_mode,
            last_assigned_at
     FROM user_profile_modes WHERE id = $1`,
    [opts.mode_id],
  );
  const curRow = cur.rows[0];
  const curUnnorm = parseVecText(curRow.v);

  if (opts.event_weight <= 0) {
    return {
      id: curRow.id,
      user_profile_id: curRow.user_profile_id,
      recipient_id: curRow.recipient_id,
      cohort_id: curRow.cohort_id as CohortId,
      vector_unnormalized: curUnnorm,
      weight_sum: Number(curRow.weight_sum),
      n_events_in_mode: Number(curRow.n_events_in_mode),
      last_assigned_at: curRow.last_assigned_at,
    };
  }

  const prodR = await pg.query(
    `SELECT embedding::text AS v FROM products
     WHERE id = $1 AND embedding IS NOT NULL`,
    [opts.product_id],
  );
  if (prodR.rows.length === 0) {
    // Product has no embedding — skip update
    return {
      id: curRow.id,
      user_profile_id: curRow.user_profile_id,
      recipient_id: curRow.recipient_id,
      cohort_id: curRow.cohort_id as CohortId,
      vector_unnormalized: curUnnorm,
      weight_sum: Number(curRow.weight_sum),
      n_events_in_mode: Number(curRow.n_events_in_mode),
      last_assigned_at: curRow.last_assigned_at,
    };
  }

  const productEmb = parseVecText(prodR.rows[0].v);
  const now = new Date();
  const { newUnnorm, newWeight } = applyDecayAndAccumulate({
    unnorm: curUnnorm,
    weight: Number(curRow.weight_sum),
    lastUpdatedAt: new Date(curRow.last_assigned_at),
    product: productEmb,
    eventWeight: opts.event_weight,
    now,
    tauMs: TAU_PROFILE_DAYS * 24 * 3600 * 1000,
  });

  const upd = await pg.query(
    `UPDATE user_profile_modes
        SET vector_unnormalized = $1::vector,
            weight_sum = $2,
            n_events_in_mode = n_events_in_mode + 1,
            last_assigned_at = $3
      WHERE id = $4
      RETURNING n_events_in_mode, last_assigned_at`,
    ["[" + newUnnorm.join(",") + "]", newWeight, now, opts.mode_id],
  );
  return {
    id: curRow.id,
    user_profile_id: curRow.user_profile_id,
    recipient_id: curRow.recipient_id,
    cohort_id: curRow.cohort_id as CohortId,
    vector_unnormalized: newUnnorm,
    weight_sum: newWeight,
    n_events_in_mode: Number(upd.rows[0].n_events_in_mode),
    last_assigned_at: upd.rows[0].last_assigned_at,
  };
}
