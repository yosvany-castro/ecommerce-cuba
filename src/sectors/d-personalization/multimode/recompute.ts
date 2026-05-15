import type { Client } from "pg";
import { runKMeans } from "../vector/kmeans";
import { TAU_PROFILE_DAYS, EVENT_WEIGHTS } from "../vector/constants";
import { EMBEDDING_DIM } from "@/lib/embeddings/voyage";
import { inferSignalFromProductMetadata } from "../cohorts/infer";
import type { CohortId } from "../cohorts/definitions";

interface EventForRecompute {
  embedding: number[];
  weight: number;
  ts: Date;
}

function parseVecText(s: string): number[] {
  return JSON.parse(s) as number[];
}

async function fetchBucketEvents(
  user_profile_id: string,
  cohort_id: CohortId,
  pg: Client,
): Promise<EventForRecompute[]> {
  const idR = await pg.query(
    `SELECT anonymous_id::text AS aid, user_id::text AS uid
     FROM user_profiles WHERE id = $1`,
    [user_profile_id],
  );
  const aid = idR.rows[0]?.aid;
  const uid = idR.rows[0]?.uid;

  const r = await pg.query(
    `SELECT e.event_type, e.occurred_at, p.metadata, p.embedding::text AS v
     FROM events e
     JOIN products p ON p.id = (e.payload->>'product_id')::uuid
     WHERE p.embedding IS NOT NULL
       AND e.occurred_at > now() - interval '90 days'
       AND ((e.anonymous_id::text = $1 AND $1 IS NOT NULL)
         OR (e.user_id::text = $2 AND $2 IS NOT NULL))
     ORDER BY e.occurred_at ASC`,
    [aid, uid],
  );

  const out: EventForRecompute[] = [];
  for (const row of r.rows as Array<{
    event_type: string;
    occurred_at: Date;
    metadata: Record<string, unknown>;
    v: string;
  }>) {
    const w = EVENT_WEIGHTS[row.event_type as keyof typeof EVENT_WEIGHTS] ?? 0;
    if (w <= 0) continue;
    const sig = inferSignalFromProductMetadata(row.metadata as never);
    if (sig.cohort_id !== cohort_id) continue;
    out.push({
      embedding: parseVecText(row.v),
      weight: w,
      ts: row.occurred_at,
    });
  }
  return out;
}

export async function recomputeModesForBucket(
  opts: {
    user_profile_id: string;
    recipient_id: string | null;
    cohort_id: CohortId;
    target_modes: 1 | 2 | 3;
  },
  pg: Client,
): Promise<void> {
  const events = await fetchBucketEvents(opts.user_profile_id, opts.cohort_id, pg);

  await pg.query(
    `DELETE FROM user_profile_modes
     WHERE user_profile_id = $1
       AND ((recipient_id IS NULL AND $2::uuid IS NULL) OR recipient_id = $2)
       AND cohort_id = $3`,
    [opts.user_profile_id, opts.recipient_id, opts.cohort_id],
  );

  if (events.length === 0) return;

  const now = Date.now();
  const tauMs = TAU_PROFILE_DAYS * 24 * 3600 * 1000;
  const decayedWeights = events.map((e) =>
    e.weight * Math.exp(-(now - e.ts.getTime()) / tauMs),
  );

  const { centroids, cluster_of_point } = runKMeans({
    points: events.map((e) => e.embedding),
    weights: decayedWeights,
    k: opts.target_modes,
  });

  const k = centroids.length;
  const stats = Array.from({ length: k }, () => ({
    unnorm: new Array<number>(EMBEDDING_DIM).fill(0),
    weight: 0,
    n: 0,
  }));
  for (let i = 0; i < events.length; i++) {
    const c = cluster_of_point[i];
    if (c < 0 || c >= k) continue;
    const w = decayedWeights[i];
    const emb = events[i].embedding;
    for (let d = 0; d < EMBEDDING_DIM; d++) {
      stats[c].unnorm[d] += w * emb[d];
    }
    stats[c].weight += w;
    stats[c].n += 1;
  }

  for (let m = 0; m < k; m++) {
    const s = stats[m];
    if (s.n === 0) continue;
    await pg.query(
      `INSERT INTO user_profile_modes (
         user_profile_id, recipient_id, cohort_id, mode_index,
         vector_unnormalized, weight_sum, n_events_in_mode, last_assigned_at
       ) VALUES ($1, $2, $3, $4, $5::vector, $6, $7, now())`,
      [
        opts.user_profile_id,
        opts.recipient_id,
        opts.cohort_id,
        m + 1,
        "[" + s.unnorm.join(",") + "]",
        s.weight,
        s.n,
      ],
    );
  }
}
