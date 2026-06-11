import { z } from "zod";
import { MAX_IN_LIST, MAX_RULE_DEPTH } from "./types";

/**
 * Zod schema of the rule DSL — the WRITE-TIME validator (admin UI and Fase-2
 * agents must pass this before a rule reaches ui_placements.rule) and the
 * LOAD-TIME filter (rows with invalid rules are skipped with a warn, never
 * thrown at request time).
 */

const RULE_FIELDS = [
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
] as const;

const primitive = z.union([z.string(), z.number(), z.boolean()]);

const conditionSchema = z
  .object({
    field: z.enum(RULE_FIELDS),
    op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "exists"]),
    value: z.union([primitive, z.array(primitive).min(1).max(MAX_IN_LIST)]).optional(),
  })
  .strict();

type RuleShape =
  | z.infer<typeof conditionSchema>
  | { all: RuleShape[] }
  | { any: RuleShape[] }
  | { not: RuleShape };

function ruleSchema(depth: number): z.ZodType<RuleShape> {
  if (depth >= MAX_RULE_DEPTH) return conditionSchema as z.ZodType<RuleShape>;
  return z.union([
    conditionSchema,
    z.object({ all: z.array(z.lazy(() => ruleSchema(depth + 1))).min(1).max(8) }).strict(),
    z.object({ any: z.array(z.lazy(() => ruleSchema(depth + 1))).min(1).max(8) }).strict(),
    z.object({ not: z.lazy(() => ruleSchema(depth + 1)) }).strict(),
  ]) as z.ZodType<RuleShape>;
}

export const RuleSchema = ruleSchema(0);

/** Validate a raw jsonb rule; null/undefined (= always) is valid. */
export function isValidRule(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  return RuleSchema.safeParse(raw).success;
}
