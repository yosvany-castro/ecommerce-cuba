import type { Client } from "pg";
import type { RequestTiming } from "@/lib/timing";
import { normalize } from "@/lib/math";
import { effectiveUserVector } from "./vector/effective";
import { retrieveTopKByVector, type FeedItem } from "./retrieve";
import { fetchAllModesInBucket } from "./multimode/dispatch";
import { rrfFuse, type RankedList } from "./retrieve/rrf";
import { fetchPopularByCohort } from "./retrieve/popular-by-cohort";
import { fetchLastViewedProduct } from "./retrieve/last-viewed";
import { fetchViewsCategoriesList } from "./retrieve/views-categories-source";
import { fetchPopularGlobal } from "./retrieve/popular-global";
import { fetchEventCounts7d } from "./retrieve/event-popularity";
import { applyPopularityPrior } from "./ranking/pop-prior";
import { readSessionState } from "./session/state";
import type { CohortId } from "./cohorts/definitions";
import { getOrInitProfileMode } from "./profile-mode";
import type { ProductListRow } from "@/sectors/b-catalog/repository/products";
import { mmrSelect } from "./retrieve/mmr";
import { applyEpsilonExploration } from "./explore/epsilon";
import { randomUUID } from "crypto";
import { rerankWithLLM } from "./reranker/rerank";
import { buildProfileSummary } from "./reranker/profile-summary";
import { buildRerankCacheKey } from "./reranker/cache-key";
import {
  lookupRerankCache,
  writeRerankCache,
  type CachedRerankItem,
} from "./reranker/cache";
import {
  insertSlate,
  loadLiveSlate,
  loadSlateById,
  logSlatePageImpressions,
  fetchServedProductIds,
  type SlateItem,
  type SlateRow,
} from "./slate/store";
import { decodeCursor, encodeCursor } from "./slate/cursor";
import { injectPins } from "./slate/pins";
import {
  SLATE_DEPTH,
  SLATE_SPARES,
  PAGE_SIZE_FIRST,
  PAGE_SIZE_CURSOR,
} from "./slate/constants";

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
  /** Extra product ids to exclude (slate regeneration dedupe). */
  extraExcludedIds?: string[];
  /** Optional per-request phase timing (F5 instrumentation). */
  timing?: RequestTiming;
}

export interface FeedPageResult {
  items: FeedItem[];
  /** The slate this page was served from (null: cold fallback / LLM / no session). */
  slate: SlateRow | null;
  /** Absolute position of the last served item (cursor continuation point). */
  servedTo: number;
}

/**
 * READ-ONLY profile lookup (F2): the feed never creates profiles anymore —
 * profile birth belongs to the first tracked event (track-hook), so a
 * bouncing visitor costs zero writes and the home request path stays
 * read-only. A brand-new visitor gets profile_id=null → the deterministic
 * cold slate (popular-global / views-categories carry the feed).
 */
async function getProfileIdForFeed(
  user_id: string | null,
  anonymous_id: string | null,
  pg: Client,
): Promise<string | null> {
  if (user_id) {
    const r = await pg.query(`SELECT id::text FROM user_profiles WHERE user_id = $1`, [user_id]);
    return r.rows[0]?.id ?? null;
  }
  if (anonymous_id) {
    const r = await pg.query(
      `SELECT id::text FROM user_profiles WHERE anonymous_id = $1`,
      [anonymous_id],
    );
    return r.rows[0]?.id ?? null;
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

/**
 * Per-slot exploration probability. ε=0.1 ⇒ ~1 of 10 slots serves a uniform
 * draw from the retrieved-but-not-served candidates. This is what makes the
 * "store that learns from its own interactions" measurable: without exploration
 * the retrain loop only ever sees its own choices (degenerate feedback,
 * Jiang et al. AIES'19) and the logs carry no propensities for off-policy
 * evaluation (src/thesis/eval/ope.ts). Set EXPLORATION_EPSILON=0 to disable.
 */
const EXPLORATION_EPSILON = (() => {
  const raw = parseFloat(process.env.EXPLORATION_EPSILON ?? "0.1");
  return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.1;
})();

/**
 * Multiplicative popularity prior on the cosine retrieval lists
 * (ranking/pop-prior.ts). Pure cosine is popularity-blind — it buries
 * best-sellers (auditoría 2026-06-09; exp-I revived the vector path ×11 with
 * this prior). 0 disables (pure cosine, pre-fix behaviour).
 */
const FEED_POP_PRIOR_STRENGTH = (() => {
  const raw = parseFloat(process.env.FEED_POP_PRIOR_STRENGTH ?? "1");
  return Number.isFinite(raw) ? Math.max(0, raw) : 1;
})();

/**
 * Apply ε-greedy exploration to the final slate and log one impression per slot
 * (product, source exploit|explore, serving propensity) to `feed_impressions`.
 * Logging is fire-and-forget: a logging failure NEVER fails the feed request.
 */
async function serveWithExploration(
  items: CachedRerankItem[],
  explorePoolIds: string[],
  ctx: { profile_id: string | null; session_id: string | null },
  pg: Client,
): Promise<CachedRerankItem[]> {
  const explored = applyEpsilonExploration(items, explorePoolIds, {
    epsilon: EXPLORATION_EPSILON,
  });
  try {
    if (explored.length > 0) {
      const requestId = randomUUID();
      await pg.query(
        `INSERT INTO feed_impressions
           (feed_request_id, user_profile_id, session_id, position, product_id, source, propensity)
         SELECT $1, $2, $3, u.position, u.product_id::uuid, u.source, u.propensity
         FROM unnest($4::smallint[], $5::text[], $6::text[], $7::float8[])
           AS u(position, product_id, source, propensity)
         ON CONFLICT (feed_request_id, position) DO NOTHING`,
        [
          requestId,
          ctx.profile_id,
          ctx.session_id,
          explored.map((x) => x.rank),
          explored.map((x) => x.product_id),
          explored.map((x) => x.source),
          explored.map((x) => x.propensity),
        ],
      );
    }
  } catch (e) {
    console.warn("[feed] impression logging failed (feed unaffected):", e);
  }
  return explored.map((x) => ({ product_id: x.product_id, rank: x.rank, reason: x.reason }));
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
      position: it.rank,
    }));
}

/**
 * E2 — rótulos honestos por item del slate: el usuario debe PERCIBIR
 * personalización, no aleatoriedad. Solo dos casos, ambos baratos y veraces:
 * pins ("Seguías mirando" — continuidad de SU gesto) y slots ε-explore
 * ("Para descubrir" — el cambio rotulado). Todo lo demás va sin reason.
 */
function slateItemReason(item: SlateItem, pins: readonly string[]): string {
  if (pins.includes(item.product_id)) return "Seguías mirando";
  if (item.source === "explore") return "Para descubrir";
  return "";
}

/** Legacy contract: first page only. Internals (slate/cursor) in generateFeedInternal. */
export async function generateFeed(opts: GenerateFeedOpts, pg: Client): Promise<FeedItem[]> {
  return (await generateFeedInternal(opts, pg)).items;
}

export async function generateFeedInternal(
  opts: GenerateFeedOpts,
  pg: Client,
): Promise<FeedPageResult> {
  const limit = opts.limit ?? 20;
  // F5: phase timing (no-op without opts.timing — zero cost in untimed paths)
  const timed = <T,>(name: string, fn: () => Promise<T>): Promise<T> =>
    opts.timing ? opts.timing.time(name, fn) : fn();
  const profile_id = await timed("profile", () => getProfileIdForFeed(
    opts.user_id,
    opts.anonymous_id,
    pg,
  ));

  let cohortId: CohortId = "unisex_indeterminado";
  let recipientId: string | null = null;
  let nEventsSession = 0;
  let sessionUnnorm: number[] | null = null;

  if (opts.session_id) {
    const s = await timed("session_state", () => readSessionState(opts.session_id!, pg));
    if (s.current_cohort_id) cohortId = s.current_cohort_id;
    recipientId = s.current_recipient_id;
    nEventsSession = s.signal_window_size;
    sessionUnnorm = await timed("session_vector", () => fetchSessionVectorUnnorm(opts.session_id!, pg));
  }

  const excluded = await timed("excluded", () => fetchExcludedIds(opts.user_id, opts.anonymous_id, pg));
  if (opts.extraExcludedIds?.length) excluded.push(...opts.extraExcludedIds);

  // ── Slate HIT path (Etapa C): a live snapshot for this session serves the
  //    page in ~2 queries instead of recomputing the whole pipeline. Dismissed
  //    products are filtered AT SERVE (compaction only touches unserved), and
  //    the page backfills from deeper absolute positions, preserving them. ──
  if (opts.session_id) {
    const live = await timed("slate_hit", () => loadLiveSlate(opts.session_id!, "home", pg));
    if (live) {
      const excludedSet = new Set(excluded);
      const page = live.items
        .filter((it) => !excludedSet.has(it.product_id))
        .slice(0, limit);
      if (page.length > 0) {
        await logSlatePageImpressions(
          live,
          page,
          { user_profile_id: profile_id, page_request_id: randomUUID() },
          pg,
        );
        const items = await resolveWithReasons(
          page.map((it) => ({ product_id: it.product_id, rank: it.position, reason: slateItemReason(it, live.pins) })),
          pg,
        );
        return { items, slate: live, servedTo: page[page.length - 1].position };
      }
    }
  }

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
    // Retrieve a wide candidate set per mode (150), then re-rank with the
    // multiplicative popularity prior and keep the top-50: cosine proposes,
    // popularity re-weighs (the exp-I fix — pure cosine buries best-sellers).
    const retrievedByMode: { mode_index: number; items: { id: string; score: number }[] }[] = [];
    for (const m of modes) {
      const u = normalize(m.vector_unnormalized);
      const sessionNorm = sessionUnnorm ? normalize(sessionUnnorm) : null;
      const eff = effectiveUserVector(u, sessionNorm, nEventsSession);
      const wideK = FEED_POP_PRIOR_STRENGTH > 0 ? 150 : 50;
      const items = await timed("retrieve_modes", () => retrieveTopKByVector(eff, excluded, wideK, pg));
      retrievedByMode.push({
        mode_index: m.mode_index,
        items: items.map((it) => ({ id: it.product.id, score: it.similarity })),
      });
    }
    const popCounts =
      FEED_POP_PRIOR_STRENGTH > 0
        ? await timed("pop_counts", () => fetchEventCounts7d(
            [...new Set(retrievedByMode.flatMap((l) => l.items.map((x) => x.id)))],
            pg,
          ))
        : new Map<string, number>();
    for (const l of retrievedByMode) {
      const ordered =
        FEED_POP_PRIOR_STRENGTH > 0
          ? applyPopularityPrior(
              l.items,
              (id) => popCounts.get(id) ?? 0,
              FEED_POP_PRIOR_STRENGTH,
            )
          : l.items;
      listsA.push({
        source: `mode_${l.mode_index}`,
        items: ordered.slice(0, 50).map((it, r) => ({ id: it.id, rank: r + 1 })),
      });
    }
  }

  // weight 2: keeps the cross-sell list ("combina con lo que viste") from
  // being diluted now that the fusion has 2 more lists (views-categories +
  // popular-global) — without it the co-occurrence hit drops out of the top-10.
  const listB: RankedList = { source: "cooccurrence", items: [], weight: 2 };
  let lastViewedTitle: string | null = null;
  if (opts.session_id) {
    const lastViewed = await timed("cooccurrence", () => fetchLastViewedProduct(opts.session_id!, pg));
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

  // Cohort popularity when the demographic cohort is known; GLOBAL popularity
  // as the ensemble's rescue half (and the unisex_indeterminado fallback —
  // before this fix that cohort had NO popularity list at all).
  const popularItems = await timed("popular_cohort", () => fetchPopularByCohort(cohortId, excluded, 20, pg));
  const listC: RankedList = { source: "popular", items: popularItems };
  const listE: RankedList = {
    source: "popular-global",
    items: await timed("popular_global", () => fetchPopularGlobal(excluded, 20, pg)),
  };

  // Views-categories source (exp-K champion family): categories predicted from
  // the user's recent views (current session ×3) × popularity quotas inside.
  const listD: RankedList = {
    source: "views-categories",
    items: await timed("views_categories", () => fetchViewsCategoriesList(
      {
        user_id: opts.user_id,
        anonymous_id: opts.anonymous_id,
        session_id: opts.session_id,
        excludedIds: excluded,
        limit: 20,
      },
      pg,
    )),
  };

  // Home fusion (exp-K ablation, 3 seeds + seed-7 ablation): the winning shape
  // is ensemble(views-categories ×2, popular-global ×2) + cross-sell(×2). The
  // mode (vector) lists DILUTE the slate when category signal exists
  // (feed-w2-noModes 0.0517 ≈ slim champion 0.0527 vs feed-w2 0.0482 on the
  // failing seed) — so they only join as the cold fallback when the user has
  // no categorized views. Caveat (documented): the simulator's vector space is
  // synthetic prod2vec; real Voyage-text modes are unmeasured offline — the
  // A/B pilot is where this call gets revisited with real data.
  listD.weight = 2;
  listE.weight = 2;
  const hasCategorySignal = listD.items.length > 0;
  const all: RankedList[] = [
    ...(hasCategorySignal ? [] : listsA),
    listB,
    listD,
    listC,
    listE,
  ].filter((l) => l.items.length > 0);
  // Deterministic catalog fallback (F2 cold start): a brand-new visitor in a
  // store with no usable signal yet (no profile, no views, no events for the
  // popularity sources) still gets a real slate — newest active products —
  // instead of an empty home. Replaces the pre-F2 behaviour where the feed
  // CREATED a profile and ranked by cosine against a zero vector (arbitrary).
  if (all.length === 0) {
    const r = await pg.query(
      `SELECT id::text FROM products
       WHERE is_active = true AND NOT (id = ANY($1::uuid[]))
       ORDER BY created_at DESC, id ASC
       LIMIT $2`,
      [excluded, limit],
    );
    const items: CachedRerankItem[] = (r.rows as { id: string }[]).map((row, i) => ({
      product_id: row.id,
      rank: i + 1,
      reason: "",
    }));
    if (items.length === 0) return { items: [], slate: null, servedTo: 0 };
    const served = await serveWithExploration(
      items,
      [],
      { profile_id, session_id: opts.session_id ?? null },
      pg,
    );
    return { items: await resolveWithReasons(served, pg), slate: null, servedTo: served.length };
  }

  const fusedFull = rrfFuse(all);
  const fused = fusedFull.slice(0, SLATE_DEPTH);
  if (fused.length === 0) return { items: [], slate: null, servedTo: 0 };

  const embeddings = await fetchProductEmbeddings(
    fused.map((f) => f.id),
    pg,
  );
  const top30 = mmrSelect({ candidates: fused, embeddings, k: 30 });
  if (top30.length === 0) return { items: [], slate: null, servedTo: 0 };

  // LLM reranker OFF by default (docs/decision-llm-reranker-2026-06-10.md):
  // in the clean F6 head-to-head it never beat RRF+MMR on relevance, its
  // latency (~8-10 s/call) violates the Fase-3c p99<1.5 s gate by ~6x, and it
  // costs ~$0.48 per 1000 feeds. Re-enable with LLM_RERANK_ENABLED=true only
  // for gated special-case experiments (explicit gift, conversational search,
  // argued upsell), each with its own evaluation before production.
  const llmEnabled = process.env.LLM_RERANK_ENABLED === "true";
  if (!llmEnabled || !profile_id || top30.length < 10) {
    // ── Slate MISS path: materialize the immutable post-exploration snapshot
    //    to SLATE_DEPTH, fix exploration ONCE across every position (explore
    //    pool = fusion tail beyond the depth), persist, serve page 1. ──
    if (opts.session_id) {
      // Head: RRF+MMR over the fused candidates (the exp-K validated shape).
      const headOrdered = mmrSelect({
        candidates: fused,
        embeddings,
        k: Math.min(SLATE_DEPTH, fused.length),
      }).map((t) => t.id);
      // Tail: popularity-ordered continuation (exp-K's fuseWithPopTail — the
      // fusion alone is capped by per-source limits ~20-50; without this tail
      // the infinite scroll would end after two pages in a 5000-item store).
      const headSet = new Set(headOrdered);
      const popTail = (
        await timed("slate_tail", () =>
          fetchPopularGlobal(excluded, SLATE_DEPTH + SLATE_SPARES, pg),
        )
      )
        .map((x) => x.id)
        .filter((id) => !headSet.has(id));
      const allCandidates = [...headOrdered, ...popTail];
      const base: CachedRerankItem[] = allCandidates
        .slice(0, SLATE_DEPTH)
        .map((id, i) => ({ product_id: id, rank: i + 1, reason: "" }));
      const tailPool = allCandidates.slice(SLATE_DEPTH, SLATE_DEPTH + SLATE_SPARES);
      // C5: pins of the session's PREVIOUS slate (even expired) survive the
      // re-materialization at the front — clicked items stay reachable.
      const prevPins = (
        await pg.query(
          `SELECT pins FROM feed_slates
           WHERE session_id = $1 AND surface = 'home'
           ORDER BY created_at DESC LIMIT 1`,
          [opts.session_id],
        )
      ).rows[0]?.pins as string[] | undefined;
      const explored = applyEpsilonExploration(base, tailPool, {
        epsilon: EXPLORATION_EPSILON,
      });
      const slateItems: SlateItem[] = injectPins(
        explored.map((x) => ({
          product_id: x.product_id,
          position: x.rank,
          source: x.source,
          propensity: x.propensity,
        })),
        prevPins ?? [],
      );
      const usedExplore = new Set(
        explored.filter((x) => x.source === "explore").map((x) => x.product_id),
      );
      const spares = tailPool.filter((id) => !usedExplore.has(id));
      const slate: SlateRow = {
        slate_id: randomUUID(),
        session_id: opts.session_id,
        surface: "home",
        version: 1,
        items: slateItems,
        pins: [],
        spares,
        policy: "default",
      };
      await timed("slate_write", () =>
        insertSlate(
          {
            slate_id: slate.slate_id,
            user_profile_id: profile_id,
            anonymous_id: opts.anonymous_id,
            session_id: slate.session_id,
            surface: slate.surface,
            items: slateItems,
            spares,
          },
          pg,
        ),
      );
      const page = slateItems.slice(0, limit);
      await logSlatePageImpressions(
        slate,
        page,
        { user_profile_id: profile_id, page_request_id: randomUUID() },
        pg,
      );
      const items = await resolveWithReasons(
        page.map((it) => ({ product_id: it.product_id, rank: it.position, reason: slateItemReason(it, slate.pins) })),
        pg,
      );
      return { items, slate, servedTo: page.length > 0 ? page[page.length - 1].position : 0 };
    }

    // Legacy path (no session: crawlers / deterministic cold variant).
    const items: CachedRerankItem[] = top30.slice(0, limit).map((t, i) => ({
      product_id: t.id,
      rank: i + 1,
      reason: "",
    }));
    const servedSet = new Set(items.map((x) => x.product_id));
    const explorePool = fused.map((f) => f.id).filter((id) => !servedSet.has(id));
    const served = await serveWithExploration(
      items,
      explorePool,
      { profile_id, session_id: opts.session_id ?? null },
      pg,
    );
    return { items: await resolveWithReasons(served, pg), slate: null, servedTo: served.length };
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

  const finalItems = cached.slice(0, limit);
  const servedSet = new Set(finalItems.map((x) => x.product_id));
  const explorePool = fused.map((f) => f.id).filter((id) => !servedSet.has(id));
  const served = await serveWithExploration(
    finalItems,
    explorePool,
    { profile_id, session_id: opts.session_id ?? null },
    pg,
  );
  return { items: await resolveWithReasons(served, pg), slate: null, servedTo: served.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cursor serving (Etapa C): pages 2+ of the materialized slate.
// ─────────────────────────────────────────────────────────────────────────────

export interface ServeFeedPageOpts {
  user_id: string | null;
  anonymous_id: string | null;
  session_id: string | null;
  /** Opaque cursor from the previous page; absent ⇒ first page. */
  cursor?: string | null;
  /** Optional per-request phase timing (F5). */
  timing?: RequestTiming;
}

export interface ServedFeedPage {
  items: FeedItem[];
  next_cursor: string | null;
  slate_id: string | null;
}

/**
 * Serve one feed page. With a VALID cursor (live slate, same session, same
 * version): slice the immutable snapshot — 1-2 queries, no recompute. With an
 * invalid/expired/foreign cursor: TRANSPARENT regeneration deduped against
 * everything this session was already served (never a 410 — on a 300-600ms
 * RTT network, discarding client state is the most expensive possible answer).
 * Exhausted slate ⇒ next_cursor null (explicit end of feed).
 */
export async function serveFeedPage(
  opts: ServeFeedPageOpts,
  pg: Client,
): Promise<ServedFeedPage> {
  const cur = decodeCursor(opts.cursor);

  if (cur && opts.session_id) {
    const slate = await loadSlateById(cur.slate_id, pg);
    if (slate && slate.session_id === opts.session_id && slate.version === cur.v) {
      const remaining = slate.items.filter((it) => it.position > cur.pos);
      if (remaining.length === 0) {
        return { items: [], next_cursor: null, slate_id: slate.slate_id };
      }
      const page = remaining.slice(0, PAGE_SIZE_CURSOR);
      const profile_id = await getProfileIdForFeed(opts.user_id, opts.anonymous_id, pg);
      await logSlatePageImpressions(
        slate,
        page,
        { user_profile_id: profile_id, page_request_id: randomUUID() },
        pg,
      );
      const items = await resolveWithReasons(
        page.map((it) => ({ product_id: it.product_id, rank: it.position, reason: slateItemReason(it, slate.pins) })),
        pg,
      );
      const last = page[page.length - 1].position;
      const hasMore = slate.items.some((it) => it.position > last);
      return {
        items,
        next_cursor: hasMore
          ? encodeCursor({ slate_id: slate.slate_id, pos: last, v: slate.version })
          : null,
        slate_id: slate.slate_id,
      };
    }
  }

  // First page, or regeneration after an invalid/expired cursor.
  const isFirstPage = !opts.cursor;
  const servedBefore =
    !isFirstPage && opts.session_id ? await fetchServedProductIds(opts.session_id, pg) : [];
  const result = await generateFeedInternal(
    {
      user_id: opts.user_id,
      anonymous_id: opts.anonymous_id,
      session_id: opts.session_id,
      limit: isFirstPage ? PAGE_SIZE_FIRST : PAGE_SIZE_CURSOR,
      extraExcludedIds: servedBefore,
      timing: opts.timing,
    },
    pg,
  );
  return {
    items: result.items,
    next_cursor:
      result.slate && result.servedTo > 0 && result.slate.items.some((it) => it.position > result.servedTo)
        ? encodeCursor({
            slate_id: result.slate.slate_id,
            pos: result.servedTo,
            v: result.slate.version,
          })
        : null,
    slate_id: result.slate?.slate_id ?? null,
  };
}
