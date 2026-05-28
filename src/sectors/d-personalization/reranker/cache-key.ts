import { createHash } from "node:crypto";
import { PROMPT_VERSION } from "./prompt";

/**
 * Builds a deterministic sha256 cache key for the rerank cache.
 * Sort-independent: same set of top-30 ids in any order yields the same key.
 * Includes PROMPT_VERSION so changing the prompt naturally invalidates cache.
 */
export function buildRerankCacheKey(
  user_profile_id: string,
  top30Ids: string[],
): string {
  const sorted = [...top30Ids].sort();
  const input = `${user_profile_id}|${sorted.join(",")}|${PROMPT_VERSION}`;
  return createHash("sha256").update(input).digest("hex");
}
