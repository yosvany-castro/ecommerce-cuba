import {
  MAX_IN_LIST,
  MAX_RULE_DEPTH,
  MAX_RULE_NODES,
  type Rule,
  type RuleCondition,
  type SlateRuleContext,
} from "./types";

/**
 * Fail-closed rule evaluation: an unknown field, a type mismatch, excess
 * depth/size or any malformed node makes the CONDITION false — rules gate
 * ADDITIVE sections, so skipping the section is always the safe default.
 * Pure, in-memory, sub-millisecond (≤32 nodes of comparisons).
 */
export function evaluateRule(rule: Rule | null | undefined, ctx: SlateRuleContext): boolean {
  if (rule === null || rule === undefined) return true; // sin regla = siempre
  const budget = { nodes: 0 };
  try {
    return evalNode(rule, ctx, 0, budget);
  } catch {
    return false;
  }
}

function evalNode(
  rule: Rule,
  ctx: SlateRuleContext,
  depth: number,
  budget: { nodes: number },
): boolean {
  if (depth > MAX_RULE_DEPTH) return false;
  if (++budget.nodes > MAX_RULE_NODES) return false;
  if (typeof rule !== "object" || rule === null) return false;

  if ("all" in rule) {
    if (!Array.isArray(rule.all) || rule.all.length === 0) return false;
    return rule.all.every((r) => evalNode(r, ctx, depth + 1, budget));
  }
  if ("any" in rule) {
    if (!Array.isArray(rule.any) || rule.any.length === 0) return false;
    return rule.any.some((r) => evalNode(r, ctx, depth + 1, budget));
  }
  if ("not" in rule) {
    // NOT must still fail CLOSED on malformed inner nodes: evaluate validity
    // separately from negation (otherwise "not(garbage)" would become true).
    const inner = rule.not as Rule;
    if (!isStructurallyValid(inner, depth + 1)) return false;
    return !evalNode(inner, ctx, depth + 1, budget);
  }
  return evalCondition(rule as RuleCondition, ctx);
}

const KNOWN_FIELDS = new Set<string>([
  "surface",
  "hour_of_day",
  "day_of_week",
  "is_logged_in",
  "user_segment",
  "session_cohort",
  "recipient_active",
  "signal_window_size",
  "gift_confirmed",
  "cart_item_count",
  "pdp_product_id",
  "pdp_category",
]);
const KNOWN_OPS = new Set<string>(["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "exists"]);

function isStructurallyValid(rule: Rule, depth: number): boolean {
  if (depth > MAX_RULE_DEPTH) return false;
  if (typeof rule !== "object" || rule === null) return false;
  if ("all" in rule) return Array.isArray(rule.all) && rule.all.length > 0 && rule.all.every((r) => isStructurallyValid(r, depth + 1));
  if ("any" in rule) return Array.isArray(rule.any) && rule.any.length > 0 && rule.any.every((r) => isStructurallyValid(r, depth + 1));
  if ("not" in rule) return isStructurallyValid(rule.not as Rule, depth + 1);
  const c = rule as RuleCondition;
  // "Válido" exige campo y operador CONOCIDOS: not(campo-desconocido) debe
  // ser false (fail-closed), no true-por-negación-de-false.
  return KNOWN_FIELDS.has(c.field as string) && KNOWN_OPS.has(c.op as string);
}

function evalCondition(cond: RuleCondition, ctx: SlateRuleContext): boolean {
  if (typeof cond.field !== "string" || !(cond.field in ctx)) return false;
  const actual = ctx[cond.field];

  switch (cond.op) {
    case "exists":
      return actual !== null && actual !== undefined;
    case "eq":
      return isPrimitive(cond.value) && actual === cond.value;
    case "neq":
      return isPrimitive(cond.value) && actual !== cond.value && actual !== null;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (typeof actual !== "number" || typeof cond.value !== "number") return false;
      if (cond.op === "gt") return actual > cond.value;
      if (cond.op === "gte") return actual >= cond.value;
      if (cond.op === "lt") return actual < cond.value;
      return actual <= cond.value;
    }
    case "in":
    case "not_in": {
      if (!Array.isArray(cond.value) || cond.value.length === 0 || cond.value.length > MAX_IN_LIST) {
        return false;
      }
      if (!cond.value.every(isPrimitive)) return false;
      const found = (cond.value as unknown[]).includes(actual);
      return cond.op === "in" ? found : !found && actual !== null;
    }
    default:
      return false;
  }
}

function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}
