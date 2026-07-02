import { z } from "zod";
import type { AGENT_SECTION_WHITELIST } from "./schema";

/**
 * STRICT write-time params validator (A5 §2.3). The registry paramsSchema
 * uses .catch(default) — resilient at runtime (a broken config never kills
 * the page) but useless at write time: it would silently swallow garbage.
 * This mirror is STRICT: out-of-bounds or unknown keys are a legible
 * rejection the LLM can correct. Parity with the registry is pinned by
 * tests/unit/agent-params-parity.test.ts.
 */

export const STRICT_PARAMS: Record<(typeof AGENT_SECTION_WHITELIST)[number], z.ZodType> = {
  cross_sell: z.strictObject({ limit: z.number().int().min(1).max(20) }).partial(),
  cart_addons: z.strictObject({ limit: z.number().int().min(1).max(20) }).partial(),
  popular: z
    .strictObject({
      limit: z.number().int().min(1).max(30),
      mode: z.enum(["global", "cohort", "pdp_category"]),
    })
    .partial(),
};

/** null = OK; string = legible rejection for the LLM. */
export function paramsReason(
  section: (typeof AGENT_SECTION_WHITELIST)[number],
  params: Record<string, unknown>,
): string | null {
  const r = STRICT_PARAMS[section].safeParse(params);
  if (r.success) return null;
  return `invalid params for ${section}: ${r.error.issues
    .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
    .join("; ")}`;
}
