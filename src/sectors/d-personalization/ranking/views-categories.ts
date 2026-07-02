/**
 * Category-level personalization from the user's VIEW history: predict the
 * subcategories the user cares about from what they looked at, then fill a
 * head of the slate with the POPULAR items inside those subcategories,
 * proportionally to view share.
 *
 * Why this exists (exp-I, scripts/_audit/exp-i-eta-sweep.ts, pc-views-multi):
 * in the realistic Zipf world the strongest realistic cold-home signal is not
 * fine-grained vector similarity but "which subcategories does this user
 * browse" × "what actually sells inside them" — it beat the naive realistic
 * baseline ×2.3 while pure cosine collapsed to ~0. Views (not purchases) are
 * the right history: they are ~10× denser and production track-hook updates
 * profiles on every event anyway.
 *
 * Pure and deterministic: ties break by ascending subcategory/id.
 */

export interface SubcategoryShare {
  subcategory: string;
  /** Fraction of the counted views that fall in this subcategory (within the top-K kept). */
  share: number;
}

/**
 * Count views per subcategory (nulls dropped), keep the top `maxSubcategories`
 * by view count, and return them with their share of the kept total.
 * Empty input → empty output (caller decides the fallback, e.g. global popular).
 */
export function predictTopSubcategories(
  viewedSubcategories: readonly (string | null)[],
  maxSubcategories = 3,
): SubcategoryShare[] {
  const counts = new Map<string, number>();
  for (const s of viewedSubcategories) {
    if (s === null || s === "") continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return topSubcategoriesFromCounts(counts, maxSubcategories);
}

/**
 * Same as predictTopSubcategories but over pre-aggregated (possibly weighted)
 * view counts — production aggregates in SQL (e.g. current-session views ×3).
 */
export function topSubcategoriesFromCounts(
  counts: ReadonlyMap<string, number>,
  maxSubcategories = 3,
): SubcategoryShare[] {
  const top = [...counts.entries()]
    .filter(([s, c]) => s !== "" && c > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(1, maxSubcategories));
  const total = top.reduce((s, [, c]) => s + c, 0);
  if (total === 0) return [];
  return top.map(([subcategory, c]) => ({ subcategory, share: c / total }));
}

export interface QuotaRankOpts {
  /** Predicted subcategories with shares (from predictTopSubcategories). */
  topSubcategories: readonly SubcategoryShare[];
  /** Candidate ids to permute (already excludes train/excluded items). */
  candidates: readonly string[];
  subcategoryOf: (id: string) => string | null;
  popOf: (id: string) => number;
  /** Head size filled by quota (the "above the fold" slots). */
  headSize?: number;
}

/**
 * Full permutation of `candidates`: a head of `headSize` slots quota-allocated
 * across the predicted subcategories (proportional to share, minimum 1 each,
 * popularity-ordered inside each subcategory, deduped), followed by every
 * remaining candidate ordered by global popularity.
 *
 * With no predicted subcategories the result is the pure popularity ordering.
 */
export function rankByViewedCategoriesQuota(opts: QuotaRankOpts): string[] {
  const { topSubcategories, candidates, subcategoryOf, popOf } = opts;
  const headSize = opts.headSize ?? 10;
  const byPop = (a: string, b: string) => popOf(b) - popOf(a) || a.localeCompare(b);

  if (topSubcategories.length === 0) return [...candidates].sort(byPop);

  const head: string[] = [];
  const used = new Set<string>();
  for (const { subcategory, share } of topSubcategories) {
    const quota = Math.max(1, Math.round(headSize * share));
    const inSub = candidates.filter((id) => subcategoryOf(id) === subcategory).sort(byPop);
    for (const id of inSub.slice(0, quota)) {
      if (!used.has(id)) {
        used.add(id);
        head.push(id);
      }
    }
  }
  const tail = candidates.filter((id) => !used.has(id)).sort(byPop);
  return [...head, ...tail];
}
