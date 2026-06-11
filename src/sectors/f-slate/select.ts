import { evaluateRule } from "./rules/evaluate";
import type { SlateRuleContext } from "./rules/types";
import type { PlacementConfig } from "./config";

/**
 * selectPlacements (C0): the ONE placement selector — composePage (prod) and
 * the agent eval sim import this same function, so the world the agent is
 * graded in can never diverge from the page the store serves.
 *
 * Semantics extracted verbatim from compose.ts: rule filter (fail-closed),
 * slot collision won by scope specificity user > segment > global, tie broken
 * by version DESC, output sorted by slot. The cap is defense in depth against
 * a write surface gone rogue: page weight stays bounded no matter how many
 * rows pile up in ui_placements.
 */

export const MAX_PLACEMENTS_PER_SURFACE = 8;

const SCOPE_RANK = { user: 3, segment: 2, global: 1 } as const;

export function selectPlacements(
  placements: PlacementConfig[],
  ctx: SlateRuleContext,
): PlacementConfig[] {
  const yesBySlot = new Map<number, PlacementConfig>();
  for (const p of placements) {
    if (!evaluateRule(p.rule, ctx)) continue;
    const current = yesBySlot.get(p.slot);
    if (
      !current ||
      SCOPE_RANK[p.scope] > SCOPE_RANK[current.scope] ||
      (SCOPE_RANK[p.scope] === SCOPE_RANK[current.scope] && p.version > current.version)
    ) {
      yesBySlot.set(p.slot, p);
    }
  }
  return [...yesBySlot.values()]
    .sort((a, b) => a.slot - b.slot)
    .slice(0, MAX_PLACEMENTS_PER_SURFACE);
}
