import { describe, test, expect } from "vitest";
import { buildRerankCacheKey } from "@/sectors/d-personalization/reranker/cache-key";

/**
 * AUDIT FINDING (P1) — Rerank cache key is context-blind.
 *
 * The LLM reranker is documented as CONTEXTUAL: prompt.ts tells it to
 * "re-rankear ... para ESTE usuario en ESTE momento" and feed.ts:296-309 feeds
 * it `hour`, `day_of_week` and `last_interaction` (the last-viewed product).
 *
 * But the cache key (cache-key.ts:14) is built ONLY from
 *   `${user_profile_id}|${sorted_top30_ids}|${PROMPT_VERSION}`
 * — none of the contextual inputs participate. So as long as the candidate set
 * is unchanged, two requests in genuinely different contexts (morning vs night,
 * just viewed a winter coat vs a swimsuit) collide on the same key and the
 * second request is served the FIRST context's cached reasons/order for up to
 * CACHE_TTL_HOURS (4h). The contextual reranker is silently frozen.
 *
 * This makes the "Vio X hace pocos minutos" reasons go stale: after the user
 * views a different product, the feed can still say "complementa el iPhone que
 * viste" because the candidate set (and therefore the key) did not change.
 *
 * EXPECTED ON MAIN: FAILS — the two keys are identical because the function has
 * no context dimension to vary on.
 */
describe("AUDIT: rerank cache key ignores reranker context", () => {
  test("same user + same candidates but different context should produce different keys", () => {
    const profileId = "11111111-1111-1111-1111-111111111111";
    const top30Ids = [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      "cccccccc-cccc-cccc-cccc-cccccccccccc",
    ];

    // The reranker's output legitimately differs between these two contexts,
    // because its prompt receives hora/dia/ultima_interaccion:
    const contextMorning = { hour: 9, day: "lunes", lastViewed: "abrigo de invierno" };
    const contextNight = { hour: 23, day: "sábado", lastViewed: "traje de baño" };
    // Sanity: the contexts genuinely differ.
    expect(JSON.stringify(contextMorning)).not.toBe(JSON.stringify(contextNight));

    // ...yet buildRerankCacheKey cannot accept context, so both requests map to
    // the same cache entry. A context-aware key would differ.
    const keyMorning = buildRerankCacheKey(profileId, top30Ids);
    const keyNight = buildRerankCacheKey(profileId, top30Ids);

    expect(keyMorning).not.toBe(keyNight);
  });
});
