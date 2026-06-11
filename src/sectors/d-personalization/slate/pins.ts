import type { SlateItem } from "./store";

/** Max pinned products per session (clicked items the user can re-find). */
export const PIN_CAP = 4;

/**
 * Inject pinned products at the FRONT of a fresh slate (re-materialization
 * within a session): items the user clicked must stay reachable even if the
 * new ranking would bury them — they become the continuity anchor ("Seguías
 * mirando"). Pure; positions are renumbered to stay 1..N contiguous.
 *
 * Pins that are no longer in the candidate slate are appended from nowhere?
 * No: a pin only survives if it exists in `items` OR is explicitly provided
 * as resolvable — here we keep it simple: pins not present in `items` are
 * inserted at the front anyway (they were real products the user saw; the
 * resolver drops them later if they went inactive).
 */
export function injectPins(
  items: readonly SlateItem[],
  pinnedIds: readonly string[],
  cap: number = PIN_CAP,
): SlateItem[] {
  const pins = [...new Set(pinnedIds)].slice(0, cap);
  if (pins.length === 0) return [...items];
  const pinSet = new Set(pins);
  const pinned: SlateItem[] = [];
  const rest: SlateItem[] = [];
  const known = new Map(items.map((it) => [it.product_id, it]));
  for (const id of pins) {
    const existing = known.get(id);
    pinned.push(
      existing ?? { product_id: id, position: 0, source: "exploit", propensity: 1 },
    );
  }
  for (const it of items) {
    if (!pinSet.has(it.product_id)) rest.push(it);
  }
  return [...pinned, ...rest].map((it, i) => ({ ...it, position: i + 1 }));
}
