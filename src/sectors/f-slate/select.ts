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
 *
 * Agent containment (Fase D): agent rows never serve in PROTECTED_SLOTS (a
 * write-path regression can't hijack the hero) and, over the cap, agent rows
 * are dropped first (a legal agent create can't evict a non-agent incumbent).
 */

export const MAX_PLACEMENTS_PER_SURFACE = 8;

/** Slots seed (0026) que el agente jamás ocupa en la página servida. Vive en
 *  f-slate (el request path no puede importar g-agents); g-agents/write la
 *  re-exporta para deriveEffectiveTier. */
export const PROTECTED_SLOTS: ReadonlySet<string> = new Set(["home:10", "pdp:10", "cart:10"]);

const SCOPE_RANK = { user: 3, segment: 2, global: 1 } as const;

const isAgentRow = (p: PlacementConfig): boolean => p.created_by.startsWith("agent:");

export function selectPlacements(
  placements: PlacementConfig[],
  ctx: SlateRuleContext,
): PlacementConfig[] {
  const yesBySlot = new Map<number, PlacementConfig>();
  for (const p of placements) {
    if (!evaluateRule(p.rule, ctx)) continue;
    if (isAgentRow(p) && PROTECTED_SLOTS.has(`${p.surface}:${p.slot}`)) continue;
    const current = yesBySlot.get(p.slot);
    if (
      !current ||
      SCOPE_RANK[p.scope] > SCOPE_RANK[current.scope] ||
      (SCOPE_RANK[p.scope] === SCOPE_RANK[current.scope] && p.version > current.version)
    ) {
      yesBySlot.set(p.slot, p);
    }
  }
  const winners = [...yesBySlot.values()].sort((a, b) => a.slot - b.slot);
  if (winners.length <= MAX_PLACEMENTS_PER_SURFACE) return winners;
  let excess = winners.length - MAX_PLACEMENTS_PER_SURFACE;
  const dropped = new Set<PlacementConfig>();
  for (let i = winners.length - 1; i >= 0 && excess > 0; i--) {
    if (isAgentRow(winners[i])) {
      dropped.add(winners[i]);
      excess--;
    }
  }
  return winners.filter((p) => !dropped.has(p)).slice(0, MAX_PLACEMENTS_PER_SURFACE);
}
