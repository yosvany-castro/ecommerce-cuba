import type { Client } from "pg";
import { normalize } from "@/lib/math";
import { effectiveUserVector } from "./vector/effective";
import { retrieveTopKByVector, type FeedItem } from "./retrieve";
import { fetchAllModesInBucket } from "./multimode/dispatch";
import { rrfFuse, type RankedList, type FusedItem } from "./retrieve/rrf";
import { fetchPopularByCohort } from "./retrieve/popular-by-cohort";
import { fetchLastViewedProduct } from "./retrieve/last-viewed";
import { readSessionState } from "./session/state";
import type { CohortId } from "./cohorts/definitions";
import { getOrInitProfileMode } from "./profile-mode";
import type { ProductListRow } from "@/sectors/b-catalog/repository/products";

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

async function resolveFromFused(
  fused: FusedItem[],
  pg: Client,
): Promise<FeedItem[]> {
  if (fused.length === 0) return [];
  const ids = fused.map((f) => f.id);
  const r = await pg.query(
    `SELECT id, title, description, price_cents, currency, image_url, metadata, created_at
     FROM products
     WHERE id = ANY($1::uuid[]) AND is_active = true`,
    [ids],
  );
  const byId = new Map<string, ProductListRow>(
    (r.rows as ProductListRow[]).map((p) => [p.id, p]),
  );
  return fused
    .filter((f) => byId.has(f.id))
    .map((f) => ({
      product: byId.get(f.id) as ProductListRow,
      similarity: f.rrf_score,
    }));
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

  const excluded = await fetchExcludedIds(opts.user_id, opts.anonymous_id, pg);

  // ---- Source A: semantic, one list per active mode (init if none)
  const listsA: RankedList[] = [];
  if (profile_id) {
    let modes = await fetchAllModesInBucket(
      { user_profile_id: profile_id, recipient_id: recipientId, cohort_id: cohortId },
      pg,
    );
    if (modes.length === 0) {
      const init = await getOrInitProfileMode(
        { user_profile_id: profile_id, recipient_id: recipientId, cohort_id: cohortId },
        pg,
      );
      modes = [
        {
          id: init.id,
          mode_index: 1,
          vector_unnormalized: init.vector_unnormalized,
          weight_sum: init.weight_sum,
          n_events_in_mode: init.n_events_in_mode,
        },
      ];
    }
    for (const m of modes) {
      const u = normalize(m.vector_unnormalized);
      const sessionNorm = sessionUnnorm ? normalize(sessionUnnorm) : null;
      const eff = effectiveUserVector(u, sessionNorm, nEventsSession);
      const items = await retrieveTopKByVector(eff, excluded, 50, pg);
      listsA.push({
        source: `mode_${m.mode_index}`,
        items: items.map((it, r) => ({ id: it.product.id, rank: r + 1 })),
      });
    }
  }

  // ---- Source B: co-occurrence with last viewed
  let listB: RankedList = { source: "cooccurrence", items: [] };
  if (opts.session_id) {
    const lastViewed = await fetchLastViewedProduct(opts.session_id, pg);
    if (lastViewed) {
      const r = await pg.query(
        `SELECT related_product_id::text AS id, rank
         FROM co_occurrence_top
         WHERE product_id = $1
           AND NOT (related_product_id = ANY($2::uuid[]))
         ORDER BY rank ASC LIMIT 30`,
        [lastViewed, excluded],
      );
      listB.items = (r.rows as Array<{ id: string; rank: number }>).map((x) => ({
        id: x.id,
        rank: Number(x.rank),
      }));
    }
  }

  // ---- Source C: popular by cohort
  const popularItems = await fetchPopularByCohort(cohortId, excluded, 20, pg);
  const listC: RankedList = { source: "popular", items: popularItems };

  const all: RankedList[] = [...listsA, listB, listC].filter(
    (l) => l.items.length > 0,
  );
  if (all.length === 0) return [];

  const fused = rrfFuse(all).slice(0, limit);
  return resolveFromFused(fused, pg);
}
