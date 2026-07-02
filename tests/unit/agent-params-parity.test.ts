import { describe, test, expect } from "vitest";
import { STRICT_PARAMS } from "@/sectors/g-agents/write/params";
import { AGENT_SECTION_WHITELIST } from "@/sectors/g-agents/write/schema";
import { SECTION_REGISTRY } from "@/sectors/f-slate/sections/registry";

/**
 * Paridad espejo↔registry: todo lo que pasa STRICT_PARAMS debe sobrevivir el
 * paramsSchema del registry SIN que su .catch() lo altere (si el catch actúa,
 * el valor escrito y el servido divergen en silencio). Caza el día en que
 * alguien sube un max del registry y olvida el espejo, o viceversa.
 */

const REGISTRY_DEFAULTS: Record<string, Record<string, unknown>> = {
  cross_sell: { limit: 8 },
  cart_addons: { limit: 6 },
  popular: { limit: 10, mode: "global" },
};

const CANDIDATES: Record<string, Record<string, unknown>[]> = {
  cross_sell: [{}, { limit: 1 }, { limit: 20 }],
  cart_addons: [{}, { limit: 1 }, { limit: 20 }],
  popular: [
    {},
    { limit: 1 },
    { limit: 30 },
    { mode: "global" },
    { mode: "cohort" },
    { mode: "pdp_category" },
    { limit: 30, mode: "cohort" },
  ],
};

describe("STRICT_PARAMS ≍ SECTION_REGISTRY (C2)", () => {
  test("la whitelist del agente existe completa en el registry", () => {
    for (const s of AGENT_SECTION_WHITELIST) {
      expect(SECTION_REGISTRY[s], `section ${s} missing in registry`).toBeDefined();
      expect(STRICT_PARAMS[s], `section ${s} missing in STRICT_PARAMS`).toBeDefined();
    }
  });

  for (const s of AGENT_SECTION_WHITELIST) {
    test(`${s}: lo que pasa el espejo sobrevive el registry sin que .catch lo toque`, () => {
      for (const candidate of CANDIDATES[s]) {
        expect(STRICT_PARAMS[s].safeParse(candidate).success, JSON.stringify(candidate)).toBe(true);
        const served = SECTION_REGISTRY[s].paramsSchema.parse(candidate) as Record<string, unknown>;
        // .catch() no actuó ⇔ lo servido = defaults del registry + lo escrito
        expect(served).toEqual({ ...REGISTRY_DEFAULTS[s], ...candidate });
      }
    });

    test(`${s}: el espejo rechaza lo que el catch del registry taparía`, () => {
      // {limit: 99999} pasa el registry (catch→default) pero el write-time debe rechazarlo
      expect(STRICT_PARAMS[s].safeParse({ limit: 99999 }).success).toBe(false);
      expect(STRICT_PARAMS[s].safeParse({ unknown_key: 1 }).success).toBe(false);
    });
  }
});
