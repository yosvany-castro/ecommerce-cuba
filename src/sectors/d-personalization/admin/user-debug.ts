import type { Client } from "pg";
import { normalize } from "@/lib/math";
import { generateFeed } from "../feed";
import { retrieveTopKByVector } from "../retrieve";
import type { CohortId } from "../cohorts/definitions";
import type { EventSignal } from "../cohorts/infer";

export interface UserDebugInfo {
  user: {
    id: string;
    email: string;
    auth_sub: string | null;
    created_at: Date;
  };
  anonymous_ids_merged: string[];
  profile: {
    n_events_total: number;
    last_recompute_at: Date | null;
  };
  active_session: {
    session_id: string;
    current_recipient_id: string | null;
    current_cohort_id: CohortId | null;
    signal_window_size: number;
    signal_window: EventSignal[];
  } | null;
  modes: {
    id: string;
    recipient_id: string | null;
    recipient_name: string | null;
    cohort_id: CohortId;
    n_events_in_mode: number;
    weight_sum: number;
    last_assigned_at: Date;
    top_5_products: { id: string; title: string; similarity: number }[];
  }[];
  recent_events: { event_type: string; occurred_at: Date; payload: unknown }[];
  exclusions_active: {
    product_id: string;
    product_title: string;
    ttl_until: Date;
  }[];
  feed_now: { product_id: string; title: string; similarity: number }[];
}

function parseVecText(s: string): number[] {
  return JSON.parse(s) as number[];
}

export async function getUserDebugInfo(
  user_id: string,
  pg: Client,
): Promise<UserDebugInfo | null> {
  const ur = await pg.query(
    `SELECT id::text, email, auth_sub, created_at FROM users WHERE id = $1`,
    [user_id],
  );
  if (ur.rows.length === 0) return null;
  const user = ur.rows[0];

  const anonRes = await pg.query(
    `SELECT anonymous_id::text FROM anonymous_sessions WHERE user_id = $1`,
    [user_id],
  );
  const anonIds = (anonRes.rows as { anonymous_id: string }[]).map(
    (x) => x.anonymous_id,
  );

  const pr = await pg.query(
    `SELECT id::text, n_events, last_recompute_at FROM user_profiles WHERE user_id = $1`,
    [user_id],
  );
  const profile =
    pr.rows[0] ?? { id: null, n_events: 0, last_recompute_at: null };

  let active_session: UserDebugInfo["active_session"] = null;
  if (anonIds.length > 0) {
    const sR = await pg.query(
      `SELECT sv.session_id::text, sv.current_recipient_id::text,
              sv.current_cohort_id, sv.signal_window_size, sv.signal_window
       FROM session_vectors sv
       JOIN events e ON e.session_id = sv.session_id
       WHERE e.anonymous_id = ANY($1::uuid[])
       ORDER BY sv.updated_at DESC LIMIT 1`,
      [anonIds],
    );
    if (sR.rows.length > 0) {
      const row = sR.rows[0];
      active_session = {
        session_id: row.session_id,
        current_recipient_id: row.current_recipient_id,
        current_cohort_id: (row.current_cohort_id ?? null) as CohortId | null,
        signal_window_size: Number(row.signal_window_size),
        signal_window: (row.signal_window ?? []) as EventSignal[],
      };
    }
  }

  const mR = profile.id
    ? await pg.query(
        `SELECT upm.id::text, upm.recipient_id::text, r.name AS recipient_name,
                upm.cohort_id, upm.n_events_in_mode, upm.weight_sum,
                upm.last_assigned_at, upm.vector_unnormalized::text AS v
         FROM user_profile_modes upm
         LEFT JOIN recipients r ON r.id = upm.recipient_id
         WHERE upm.user_profile_id = $1`,
        [profile.id],
      )
    : { rows: [] };

  const modes: UserDebugInfo["modes"] = [];
  for (const row of mR.rows as Array<{
    id: string;
    recipient_id: string | null;
    recipient_name: string | null;
    cohort_id: string;
    n_events_in_mode: string;
    weight_sum: string;
    last_assigned_at: Date;
    v: string;
  }>) {
    const unnorm = parseVecText(row.v);
    const u = normalize(unnorm);
    const top = await retrieveTopKByVector(u, [], 5, pg);
    modes.push({
      id: row.id,
      recipient_id: row.recipient_id,
      recipient_name: row.recipient_name,
      cohort_id: row.cohort_id as CohortId,
      n_events_in_mode: Number(row.n_events_in_mode),
      weight_sum: Number(row.weight_sum),
      last_assigned_at: row.last_assigned_at,
      top_5_products: top.map((t) => ({
        id: t.product.id,
        title: t.product.title,
        similarity: t.similarity,
      })),
    });
  }

  const evR =
    anonIds.length > 0
      ? await pg.query(
          `SELECT event_type, occurred_at, payload FROM events
           WHERE anonymous_id = ANY($1::uuid[])
           ORDER BY occurred_at DESC LIMIT 30`,
          [anonIds],
        )
      : { rows: [] };

  const exR =
    anonIds.length > 0
      ? await pg.query(
          `SELECT ep.product_id::text, p.title AS product_title, ep.ttl_until
           FROM excluded_products ep
           JOIN products p ON p.id = ep.product_id
           WHERE ep.ttl_until > now()
             AND (ep.user_id = $1 OR ep.anonymous_id = ANY($2::uuid[]))`,
          [user_id, anonIds],
        )
      : { rows: [] };

  const feedNow =
    anonIds.length > 0 && active_session
      ? await generateFeed(
          {
            user_id,
            anonymous_id: anonIds[0],
            session_id: active_session.session_id,
            limit: 10,
          },
          pg,
        )
      : [];

  return {
    user: {
      id: user.id,
      email: user.email,
      auth_sub: user.auth_sub ?? null,
      created_at: user.created_at,
    },
    anonymous_ids_merged: anonIds,
    profile: {
      n_events_total: Number(profile.n_events ?? 0),
      last_recompute_at: profile.last_recompute_at,
    },
    active_session,
    modes,
    recent_events: evR.rows as Array<{
      event_type: string;
      occurred_at: Date;
      payload: unknown;
    }>,
    exclusions_active: exR.rows as Array<{
      product_id: string;
      product_title: string;
      ttl_until: Date;
    }>,
    feed_now: feedNow.map((f) => ({
      product_id: f.product.id,
      title: f.product.title,
      similarity: f.similarity,
    })),
  };
}
