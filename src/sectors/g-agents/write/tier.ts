import { PROTECTED_SLOTS, type PlacementProposal } from "./schema";

/**
 * deriveEffectiveTier (A5 §1.3) — PURE. The tier is never an input of the
 * LLM: it is computed from SQL facts so a misaligned agent cannot demote its
 * own risk. The mapping tier→status (low=auto-apply+TTL, medium=env-gated,
 * high=pending ALWAYS) lives with the backends.
 */

export type EffectiveTier = "low" | "medium" | "high";

export interface TierContext {
  /** filas approved/pending en (surface,slot) con created_by NOT LIKE 'agent:%' */
  slotHasNonAgentRow: boolean;
  isProtectedSlot: boolean;
}

export function deriveEffectiveTier(p: PlacementProposal, ctx: TierContext): EffectiveTier {
  if (p.action === "request_pause") return "high"; // tocar lo humano = humano decide
  if (p.action === "pause_own") return "low"; // retirar lo propio = siempre seguro
  if (ctx.isProtectedSlot || ctx.slotHasNonAgentRow) return "high"; // ocupar/superseder seed o humano
  if (p.action === "supersede") return "medium"; // reemplaza una fila agente viva
  if (p.scope === "segment") return "medium"; // blast radius menor pero menos observado
  return "low"; // create en slot libre, global, con TTL
}

export function isProtectedSlot(surface: string, slot: number): boolean {
  return PROTECTED_SLOTS.has(`${surface}:${slot}`);
}
