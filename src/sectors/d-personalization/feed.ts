import type { Client } from "pg";
import { normalize } from "@/lib/math";
import { effectiveUserVector } from "./vector/effective";
import { retrieveTopKByVector, type FeedItem } from "./retrieve";
import { fetchAllModesInBucket } from "./multimode/dispatch";
import { rrfFuse, type RankedList } from "./retrieve/rrf";
import { fetchPopularByCohort } from "./retrieve/popular-by-cohort";
import { fetchLastViewedProduct } from "./retrieve/last-viewed";
import { readSessionState } from "./session/state";
import type { CohortId } from "./cohorts/definitions";
import { getOrInitProfileMode } from "./profile-mode";
import type { ProductListRow } from "@/sectors/b-catalog/repository/products";
import { mmrSelect } from "./retrieve/mmr";
import { rerankWithLLM } from "./reranker/rerank";
import { buildProfileSummary } from "./reranker/profile-summary";
import { buildRerankCacheKey } from "./reranker/cache-key";
import {
  lookupRerankCache,
  writeRerankCache,
  type CachedRerankItem,
} from "./reranker/cache";

const DAYS_ES = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

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

async function fetchProductEmbeddings(
  ids: string[],
  pg: Client,
): Promise<Map<string, number[]>> {
  if (ids.length === 0) return new Map();
  const r = await pg.query(
    `SELECT id::text, embedding::text AS v
     FROM products WHERE id = ANY($1::uuid[]) AND embedding IS NOT NULL`,
    [ids],
  );
  const out = new Map<string, number[]>();
  for (const row of r.rows as { id: string; v: string }[]) {
    out.set(row.id, JSON.parse(row.v) as number[]);
  }
  return out;
}

async function fetchRerankerCandidates(
  ids: string[],
  pg: Client,
): Promise<
  Array<{
    product_id: string;
    title: string;
    price_cents: number;
    brand: string;
    category: string;
  }>
> {
  if (ids.length === 0) return [];
  const r = await pg.query(
    `SELECT id::text AS product_id, title, price_cents,
            COALESCE(metadata->>'brand', '') AS brand,
            COALESCE(metadata->>'category', '') AS category
     FROM products WHERE id = ANY($1::uuid[]) AND is_active = true`,
    [ids],
  );
  return r.rows as Array<{
    product_id: string;
    title: string;
    price_cents: number;
    brand: string;
    category: string;
  }>;
}

async function resolveWithReasons(
  items: CachedRerankItem[],
  pg: Client,
): Promise<FeedItem[]> {
  if (items.length === 0) return [];
  const ids = items.map((x) => x.product_id);
  const r = await pg.query(
    `SELECT id, title, description, price_cents, currency, image_url, metadata, created_at
     FROM products
     WHERE id = ANY($1::uuid[]) AND is_active = true`,
    [ids],
  );
  const byId = new Map<string, ProductListRow>(
    (r.rows as ProductListRow[]).map((p) => [p.id, p]),
  );
  return items
    .filter((it) => byId.has(it.product_id))
    .map((it) => ({
      product: byId.get(it.product_id) as ProductListRow,
      similarity: 1 / (it.rank + 1),
      reason: it.reason || undefined,
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

  const listsA: RankedList[] = [];
  if (profile_id) {
    let modes = await fetchAllModesInBucket(
      {
        user_profile_id: profile_id,
        recipient_id: recipientId,
        cohort_id: cohortId,
      },
      pg,
    );
    if (modes.length === 0) {
      const init = await getOrInitProfileMode(
        {
          user_profile_id: profile_id,
          recipient_id: recipientId,
          cohort_id: cohortId,
        },
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

  let listB: RankedList = { source: "cooccurrence", items: [] };
  let lastViewedTitle: string | null = null;
  if (opts.session_id) {
    const lastViewed = await fetchLastViewedProduct(opts.session_id, pg);
    if (lastViewed) {
      const tR = await pg.query(`SELECT title FROM products WHERE id = $1`, [
        lastViewed,
      ]);
      lastViewedTitle = tR.rows[0]?.title ?? null;
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

  const popularItems = await fetchPopularByCohort(cohortId, excluded, 20, pg);
  const listC: RankedList = { source: "popular", items: popularItems };

  const all: RankedList[] = [...listsA, listB, listC].filter(
    (l) => l.items.length > 0,
  );
  if (all.length === 0) return [];

  const fused = rrfFuse(all).slice(0, 100);
  if (fused.length === 0) return [];

  const embeddings = await fetchProductEmbeddings(
    fused.map((f) => f.id),
    pg,
  );
  const top30 = mmrSelect({ candidates: fused, embeddings, k: 30 });
  if (top30.length === 0) return [];

  if (!profile_id || top30.length < 10) {
    const items: CachedRerankItem[] = top30.slice(0, limit).map((t, i) => ({
      product_id: t.id,
      rank: i + 1,
      reason: "",
    }));
    return resolveWithReasons(items, pg);
  }

  const top30Ids = top30.map((t) => t.id);
  const cacheKey = buildRerankCacheKey(profile_id, top30Ids);
  let cached = await lookupRerankCache(cacheKey, pg);

  if (!cached) {
    try {
      const candidates = await fetchRerankerCandidates(top30Ids, pg);
      const context = {
        profile_summary: await buildProfileSummary(
          profile_id,
          recipientId,
          cohortId,
          pg,
        ),
        hour: new Date().getHours(),
        day_of_week: DAYS_ES[new Date().getDay()],
        last_interaction: lastViewedTitle
          ? `Vio ${lastViewedTitle} hace pocos minutos`
          : null,
        recent_query: null,
      };
      const r = await rerankWithLLM({ candidates, context });
      cached = r.items;
      await writeRerankCache(cacheKey, profile_id, cached, pg);
    } catch (e) {
      console.warn("[feed] reranker failed, fallback to MMR top-10:", e);
      cached = top30.slice(0, 10).map((t, i) => ({
        product_id: t.id,
        rank: i + 1,
        reason: "",
      }));
    }
  }

  return resolveWithReasons(cached.slice(0, limit), pg);
}
