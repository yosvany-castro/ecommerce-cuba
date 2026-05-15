import type { Client } from "pg";
import { normalize } from "@/lib/math";
import { effectiveUserVector } from "./vector/effective";
import { retrieveTopKByVector, type FeedItem } from "./retrieve";
import { getOrInitProfileMode } from "./profile-mode";
import { readSessionState } from "./session/state";
import { EMBEDDING_DIM } from "@/lib/embeddings/voyage";
import type { CohortId } from "./cohorts/definitions";

export interface GenerateFeedOpts {
  user_id: string | null;
  anonymous_id: string | null;
  session_id: string | null;
  limit?: number;
}

async function getOrCreateProfileForFeed(
  user_id: string | null,
  anonymous_id: string | null,
  pg: Client,
): Promise<string | null> {
  if (user_id) {
    const r = await pg.query(
      `SELECT id::text FROM user_profiles WHERE user_id = $1`,
      [user_id],
    );
    if (r.rows.length > 0) return r.rows[0].id;
    const ins = await pg.query(
      `INSERT INTO user_profiles (user_id, n_events) VALUES ($1, 0) RETURNING id::text`,
      [user_id],
    );
    return ins.rows[0].id;
  }
  if (anonymous_id) {
    const r = await pg.query(
      `SELECT id::text FROM user_profiles WHERE anonymous_id = $1`,
      [anonymous_id],
    );
    if (r.rows.length > 0) return r.rows[0].id;
    const ins = await pg.query(
      `INSERT INTO user_profiles (anonymous_id, n_events) VALUES ($1, 0) RETURNING id::text`,
      [anonymous_id],
    );
    return ins.rows[0].id;
  }
  return null;
}

async function fetchExcludedIds(
  user_id: string | null,
  anonymous_id: string | null,
  pg: Client,
): Promise<string[]> {
  const r = await pg.query(
    `SELECT product_id::text FROM excluded_products
     WHERE ttl_until > now()
       AND ((user_id IS NOT NULL AND user_id = $1)
         OR (user_id IS NULL AND anonymous_id = $2))`,
    [user_id, anonymous_id],
  );
  return (r.rows as { product_id: string }[]).map((x) => x.product_id);
}

async function fetchSessionVectorUnnorm(
  session_id: string,
  pg: Client,
): Promise<number[] | null> {
  const r = await pg.query(
    `SELECT vector_unnormalized::text AS v, weight_sum
     FROM session_vectors WHERE session_id = $1`,
    [session_id],
  );
  if (r.rows.length === 0) return null;
  if (Number(r.rows[0].weight_sum) <= 0) return null;
  return JSON.parse(r.rows[0].v) as number[];
}

export async function generateFeed(
  opts: GenerateFeedOpts,
  pg: Client,
): Promise<FeedItem[]> {
  const limit = opts.limit ?? 20;
  const profile_id = await getOrCreateProfileForFeed(
    opts.user_id,
    opts.anonymous_id,
    pg,
  );

  let cohortId: CohortId = "unisex_indeterminado";
  let recipientId: string | null = null;
  let nEventsSession = 0;
  let sessionUnnorm: number[] | null = null;

  if (opts.session_id) {
    const s = await readSessionState(opts.session_id, pg);
    if (s.current_cohort_id) cohortId = s.current_cohort_id;
    recipientId = s.current_recipient_id;
    nEventsSession = s.signal_window_size;
    sessionUnnorm = await fetchSessionVectorUnnorm(opts.session_id, pg);
  }

  let modeVec: number[];
  if (profile_id) {
    const mode = await getOrInitProfileMode(
      {
        user_profile_id: profile_id,
        recipient_id: recipientId,
        cohort_id: cohortId,
      },
      pg,
    );
    modeVec = mode.vector_unnormalized;
  } else {
    modeVec = new Array<number>(EMBEDDING_DIM).fill(0);
  }

  const profileNorm = normalize(modeVec);
  const sessionNorm = sessionUnnorm ? normalize(sessionUnnorm) : null;
  const eff = effectiveUserVector(profileNorm, sessionNorm, nEventsSession);

  const excluded = await fetchExcludedIds(opts.user_id, opts.anonymous_id, pg);
  const items = await retrieveTopKByVector(eff, excluded, limit * 3, pg);
  return items.slice(0, limit);
}
