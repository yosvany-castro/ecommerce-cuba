import type { SlateItem } from "./store";

/**
 * Churn cap (E5): between consecutive materializations of the SAME session,
 * the head keeps ≥(1−cap) of its previous items — the user must RECOGNIZE
 * the page (≥50% top-overlap objective between visits without shift). The
 * ~cap×headSize new slots are the budget that rotation spends: ε-explore
 * slots (already in the fresh ranking) plus the ranking's genuine newcomers.
 *
 * Pure. Prev-head items only survive if they are still candidates in the new
 * slate (dismissed/excluded items were already filtered upstream). Positions
 * are renumbered 1..N contiguous (a fresh slate owns fresh positions).
 */
export function stabilizeSlate(
  newItems: readonly SlateItem[],
  prevItems: readonly SlateItem[],
  opts: { headSize?: number; churnCap?: number } = {},
): SlateItem[] {
  const headSize = opts.headSize ?? 20;
  const churnCap = opts.churnCap ?? 0.3;
  if (prevItems.length === 0 || newItems.length === 0) return [...newItems];

  const churnBudget = Math.floor(headSize * churnCap);
  const prevHeadIds = prevItems
    .slice()
    .sort((a, b) => a.position - b.position)
    .slice(0, headSize)
    .map((it) => it.product_id);
  const byIdNew = new Map(newItems.map((it) => [it.product_id, it]));

  const newHead = newItems.slice(0, headSize);
  const prevHeadSet = new Set(prevHeadIds);
  const entrants = newHead.filter((it) => !prevHeadSet.has(it.product_id));

  if (entrants.length <= churnBudget) {
    return newItems.map((it, i) => ({ ...it, position: i + 1 }));
  }

  // Demasiada rotación: conservar los primeros `churnBudget` entrantes (los
  // mejor rankeados — incluyen los ε-explore del head) y rellenar el resto
  // del head con los items del head ANTERIOR que sigan siendo candidatos,
  // en su orden previo. Los entrantes desplazados bajan justo tras el head.
  const keptEntrants = new Set(entrants.slice(0, churnBudget).map((it) => it.product_id));
  const displaced = entrants.slice(churnBudget);
  const stayers = newHead.filter(
    (it) => prevHeadSet.has(it.product_id) || keptEntrants.has(it.product_id),
  );
  const refill: SlateItem[] = [];
  const usedIds = new Set(stayers.map((it) => it.product_id));
  for (const id of prevHeadIds) {
    if (stayers.length + refill.length >= headSize) break;
    if (usedIds.has(id)) continue;
    const candidate = byIdNew.get(id);
    if (candidate) {
      refill.push(candidate);
      usedIds.add(id);
    }
  }
  const head = [...stayers, ...refill].slice(0, headSize);
  const headIds = new Set(head.map((it) => it.product_id));
  const tail = [
    ...displaced.filter((it) => !headIds.has(it.product_id)),
    ...newItems.filter((it) => !headIds.has(it.product_id) && !displaced.some((d) => d.product_id === it.product_id)),
  ];
  return [...head, ...tail].map((it, i) => ({ ...it, position: i + 1 }));
}
