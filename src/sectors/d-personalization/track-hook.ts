import type { Client } from "pg";
import type { EventType } from "@/sectors/a-tracking/events/schema";
import { EVENT_WEIGHTS } from "./vector/constants";
import {
  inferSignalFromProductMetadata,
  type EventSignal,
} from "./cohorts/infer";
import { applySignalToState } from "./session/shift-detection";
import { readSessionState, persistSessionState } from "./session/state";
import { matchRecipientOrNull } from "./cohorts/match-recipient";
import {
  getOrInitProfileMode,
  updateProfileModeWithProduct,
} from "./profile-mode";
import type { CohortId } from "./cohorts/definitions";
import { captureCoOccurrence } from "./co-occurrence/capture";
import { modesForEvents } from "./multimode/thresholds";
import { recomputeModesForBucket } from "./multimode/recompute";
import { fetchAllModesInBucket, pickBestMode } from "./multimode/dispatch";

interface TrackInput {
  anonymous_id: string;
  user_id: string | null;
  session_id: string;
  event_type: EventType | "dismiss";
  payload: Record<string, unknown>;
  occurred_at: string;
}

async function getOrCreateProfile(
  anonymous_id: string,
  user_id: string | null,
  pg: Client,
): Promise<string> {
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

async function fetchProductInfo(
  product_id: string,
  pg: Client,
): Promise<{ product_id: string; metadata: Record<string, unknown> } | null> {
  const r = await pg.query(`SELECT metadata FROM products WHERE id = $1`, [
    product_id,
  ]);
  if (r.rows.length === 0) return null;
  return { product_id, metadata: r.rows[0].metadata ?? {} };
}

function pickProductIdFromPayload(
  event_type: TrackInput["event_type"],
  payload: Record<string, unknown>,
): string | null {
  switch (event_type) {
    case "product_view":
    case "add_to_cart":
    case "remove_from_cart":
    case "add_to_wishlist":
    case "product_dwell":
    case "dismiss":
      return typeof payload.product_id === "string" ? payload.product_id : null;
    case "purchase": {
      const ids = payload.product_ids;
      if (Array.isArray(ids) && ids.length > 0 && typeof ids[0] === "string") {
        return ids[0];
      }
      return null;
    }
    default:
      return null;
  }
}

export async function processEventForPersonalization(
  input: TrackInput,
  pg: Client,
): Promise<void> {
  const product_id = pickProductIdFromPayload(input.event_type, input.payload);
  if (!product_id) return;
  const productInfo = await fetchProductInfo(product_id, pg);
  if (!productInfo) return;

  const signal = inferSignalFromProductMetadata(
    productInfo.metadata as never,
  ) as EventSignal;

  await runPipeline(input, signal, productInfo.product_id, pg);
}

async function runPipeline(
  input: TrackInput,
  signal: EventSignal,
  product_id: string,
  pg: Client,
): Promise<void> {
  const prevState = await readSessionState(input.session_id, pg);
  const advanced = applySignalToState(prevState, signal);
  const newCohort = advanced.current_cohort_id;
  const cohortChanged = newCohort !== prevState.current_cohort_id;
  const recipient_id = cohortChanged && newCohort
    ? await matchRecipientOrNull(input.user_id, newCohort, pg)
    : prevState.current_recipient_id;
  await persistSessionState(
    input.session_id,
    { ...advanced, current_recipient_id: recipient_id },
    pg,
  );

  // Co-occurrence capture runs INDEPENDENT of warmup state — pairs accumulate
  // from the very first event in a session.
  if (
    input.event_type === "product_view" ||
    input.event_type === "add_to_cart" ||
    input.event_type === "purchase"
  ) {
    await captureCoOccurrence(
      {
        session_id: input.session_id,
        current_product_id: product_id,
        current_event_type: input.event_type,
      },
      pg,
    );
  }

  if (!newCohort) return; // warmup not complete — no vector update yet

  const profile_id = await getOrCreateProfile(
    input.anonymous_id,
    input.user_id,
    pg,
  );
  const mode = await getOrInitProfileMode(
    {
      user_profile_id: profile_id,
      recipient_id,
      cohort_id: newCohort as CohortId,
    },
    pg,
  );

  const weight =
    EVENT_WEIGHTS[input.event_type as keyof typeof EVENT_WEIGHTS] ?? 0;
  if (weight > 0) {
    // If bucket has multi-modo (>1 mode), dispatch to closest mode by cosine
    const modes = await fetchAllModesInBucket(
      {
        user_profile_id: profile_id,
        recipient_id,
        cohort_id: newCohort as CohortId,
      },
      pg,
    );
    let targetModeId = mode.id;
    if (modes.length > 1) {
      const productR = await pg.query(
        `SELECT embedding::text AS v FROM products
         WHERE id = $1 AND embedding IS NOT NULL`,
        [product_id],
      );
      if (productR.rows.length > 0) {
        const productEmb = JSON.parse(productR.rows[0].v) as number[];
        const best = await pickBestMode(
          {
            user_profile_id: profile_id,
            recipient_id,
            cohort_id: newCohort as CohortId,
          },
          productEmb,
          pg,
        );
        if (best) targetModeId = best.id;
      }
    }
    await updateProfileModeWithProduct(
      { mode_id: targetModeId, product_id, event_weight: weight },
      pg,
    );

    // Trigger multi-modo recompute if aggregate n_events crosses threshold
    const totalR = await pg.query(
      `SELECT COALESCE(SUM(n_events_in_mode), 0)::int AS total
       FROM user_profile_modes
       WHERE user_profile_id = $1
         AND ((recipient_id IS NULL AND $2::uuid IS NULL) OR recipient_id = $2)
         AND cohort_id = $3`,
      [profile_id, recipient_id, newCohort],
    );
    const total = Number(totalR.rows[0].total);
    const target = modesForEvents(total);
    if (target > modes.length && target > 0) {
      await recomputeModesForBucket(
        {
          user_profile_id: profile_id,
          recipient_id,
          cohort_id: newCohort as CohortId,
          target_modes: target as 1 | 2 | 3,
        },
        pg,
      );
    }
  }

  await pg.query(
    `UPDATE user_profiles SET n_events = n_events + 1, updated_at = now()
     WHERE id = $1`,
    [profile_id],
  );
}
