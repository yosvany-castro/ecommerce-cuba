import { z } from "zod";
import { RuleSchema } from "@/sectors/f-slate/rules/schema";
import type { Rule } from "@/sectors/f-slate/rules/types";
import { COHORT_IDS } from "@/sectors/d-personalization/cohorts/definitions";

/**
 * Input schema of the propose_placement tool (Fase 2 C2, A5 §1.2). The LLM
 * never declares risk_tier/version/timestamps — those are computed from SQL
 * facts (tier.ts / write.ts). strictObject everywhere: an unknown key (e.g. a
 * smuggled "risk_tier") is a parse error the model must read and fix.
 */

/** Secciones que el agente puede colocar. hero_grid EXCLUIDO: no está en
 *  SECTION_REGISTRY (caso especial del runner) y es el feed principal
 *  (priority 0, "never sacrificed" — 0025:26). */
export const AGENT_SECTION_WHITELIST = ["popular", "cross_sell", "cart_addons"] as const;
export const AGENT_SURFACES = ["home", "pdp", "cart"] as const; // search: sin placements aún

/** Slots seed (0026): (home,10) hero, (pdp,10) cross_sell, (cart,10) cart_addons.
 *  El agente NUNCA aplica directo sobre un slot ocupado por una fila no-agente.
 *  La constante vive en f-slate/select (el guard de servicio la necesita y el
 *  request path no puede importar g-agents); aquí solo se re-exporta. */
export { PROTECTED_SLOTS } from "@/sectors/f-slate/select";

const createAction = z.strictObject({
  action: z.literal("create"),
  surface: z.enum(AGENT_SURFACES),
  slot: z.number().int().min(20).max(90).multipleOf(10), // entre los gaps; slot 10 = seed, fuera
  section_type: z.enum(AGENT_SECTION_WHITELIST),
  params: z.record(z.string(), z.unknown()).default({}), // validación fina en params.ts
  rule: RuleSchema.nullable().default(null),
  scope: z.enum(["global", "segment"]), // 'user' PROHIBIDO: ni parsea (A5 §2.4)
  scope_ref: z.string().min(1).max(64).nullable().default(null),
  ttl_hours: z.number().int().min(1).max(168).default(72), // rollback obligatorio ≤7d
  rationale: z.string().min(40).max(2000), // evidencia citando read_metrics
});

const supersedeAction = createAction.omit({ action: true, slot: true }).extend({
  action: z.literal("supersede"),
  // puede apuntar a CUALQUIER slot (incl. protegidos) — pero el tier computado
  // sobre slot ocupado por fila no-agente fuerza 'pending' (tier.ts)
  slot: z.number().int().min(10).max(90).multipleOf(10),
});

const pauseOwnAction = z.strictObject({
  action: z.literal("pause_own"),
  placement_id: z.uuid(),
  rationale: z.string().min(40).max(2000),
});

const requestPauseAction = z.strictObject({
  action: z.literal("request_pause"), // pausar fila humana/seed: SIEMPRE pending
  target_placement_id: z.uuid(),
  rationale: z.string().min(40).max(2000),
});

export const PlacementProposalSchema = z.discriminatedUnion("action", [
  createAction,
  supersedeAction,
  pauseOwnAction,
  requestPauseAction,
]);
export type PlacementProposal = z.infer<typeof PlacementProposalSchema>;

const COHORT_SET: ReadonlySet<string> = new Set(COHORT_IDS);

/**
 * Semántica que el Zod no puede expresar por rama: scope_ref de segment debe
 * ser una cohorte VIVA (único vocabulario de segmento hoy). Compartida por
 * backend-pg y backend-sim — rechazo legible, jamás throw.
 */
export function proposalSemanticReason(p: PlacementProposal): string | null {
  if (p.action !== "create" && p.action !== "supersede") return null;
  if (p.scope === "segment" && (p.scope_ref === null || !COHORT_SET.has(p.scope_ref))) {
    return `scope=segment requires scope_ref in known cohorts: ${COHORT_IDS.join(", ")}`;
  }
  if (p.scope === "global" && p.scope_ref !== null) {
    return "scope=global must not carry scope_ref";
  }
  return null;
}

/**
 * Fase D (H2): serve-time jamás lee scope_ref (config.ts sirve scope=segment a
 * TODOS los usuarios, con rank > global). Para que el blast radius de segment
 * sea la cohorte DE VERDAD, el write path inyecta session_cohort=scope_ref en
 * la rule — fail-closed: una sesión sin cohorte no ve la fila. Compartida por
 * backend-pg y backend-sim (paridad sim↔prod del guard).
 */
export function effectiveRule(
  p: Extract<PlacementProposal, { action: "create" | "supersede" }>,
): Rule | null {
  const rule = p.rule as Rule | null;
  if (p.scope !== "segment" || p.scope_ref === null) return rule;
  const cohortCond: Rule = { field: "session_cohort", op: "eq", value: p.scope_ref };
  return rule === null ? cohortCond : { all: [cohortCond, rule] };
}
