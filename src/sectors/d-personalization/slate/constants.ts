/**
 * Slate constants — named units (the design review found "12 vs 20 vs 100 vs
 * 200" scattered across clusters; this is the single source).
 */

/** Absolute depth of the materialized, post-exploration snapshot. */
export const SLATE_DEPTH = 100;

/** First page (SSR home) size — unchanged from the pre-slate home. */
export const PAGE_SIZE_FIRST = 20;

/** Cursor pages (infinite scroll fetches): smaller JSON on Cuban RTTs. */
export const PAGE_SIZE_CURSOR = 12;

/** Fusion-tail candidates reserved as explore pool / dismiss spares. */
export const SLATE_SPARES = 50;

/**
 * Soft-TTL seconds — deliberately equal to the client-side staleness window
 * (PDP→back restore policy): ONE staleness policy across the system.
 */
export const SLATE_SOFT_TTL_S = 300;
