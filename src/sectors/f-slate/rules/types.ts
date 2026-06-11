/**
 * Declarative rule DSL for ui_placements.rule (Etapa D / Fase 2 seam).
 *
 * Closed by construction: flat whitelisted fields, fixed operators, bounded
 * depth/size — no eval, no paths, no regex. Agents (Fase 2) write these as
 * jsonb; a malformed rule can NEVER 500 a page (fail-closed at evaluation).
 */

export type RuleOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "not_in"
  | "exists";

export interface RuleCondition {
  field: keyof SlateRuleContext;
  op: RuleOp;
  value?: unknown;
}

export type Rule =
  | { all: Rule[] }
  | { any: Rule[] }
  | { not: Rule }
  | RuleCondition;

/** Per-request evaluation context — ONLY data the request already has. */
export interface SlateRuleContext {
  surface: "home" | "pdp" | "cart" | "search";
  hour_of_day: number; // 0-23 (hora del servidor; TZ de la tienda)
  day_of_week: number; // 0=domingo
  is_logged_in: boolean;
  user_segment: string | null; // seam Fase 2 (null hoy)
  session_cohort: string | null;
  recipient_active: boolean;
  signal_window_size: number;
  gift_confirmed: boolean; // seam gift/suggest (false hoy)
  cart_item_count: number;
  pdp_product_id: string | null;
  pdp_category: string | null;
}

export const MAX_RULE_DEPTH = 5;
export const MAX_RULE_NODES = 32;
export const MAX_IN_LIST = 50;
