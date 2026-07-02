/**
 * Client-side feed snapshot (C6): pages 2+ and scroll position survive the
 * PDP→back round-trip with ZERO network — re-downloading pages the user
 * already paid for is spending twice on metered data.
 *
 * The staleness window is THE shared 300s (slate soft-TTL): one policy,
 * client and server, never two numbers to keep aligned.
 */

export const SNAPSHOT_TTL_MS = 300_000; // == SLATE_SOFT_TTL_S del servidor

export interface FeedSnapshot<TItem> {
  slate_id: string | null;
  items: TItem[];
  cursor: string | null;
  scroll_y: number;
  saved_at: number;
}

/**
 * Pure restore decision:
 *  - stale snapshot (>=TTL) → discard (the sentinel will refetch fresh);
 *  - the SSR page served a DIFFERENT slate → discard (mixing two slates would
 *    duplicate/skip items);
 *  - otherwise restore.
 */
export function shouldRestoreSnapshot<TItem>(
  snapshot: FeedSnapshot<TItem> | null,
  currentSlateId: string | null,
  now: number,
): boolean {
  if (!snapshot) return false;
  if (now - snapshot.saved_at >= SNAPSHOT_TTL_MS) return false;
  // Sin slate (camino fallback) no hay identidad que casar: no restaurar.
  if (!snapshot.slate_id || !currentSlateId) return false;
  if (snapshot.slate_id !== currentSlateId) return false;
  return snapshot.items.length > 0;
}

export function parseSnapshot<TItem>(raw: string | null): FeedSnapshot<TItem> | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as FeedSnapshot<TItem>;
    if (!Array.isArray(s.items) || typeof s.saved_at !== "number") return null;
    return s;
  } catch {
    return null;
  }
}
