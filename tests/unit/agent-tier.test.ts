import { describe, test, expect } from "vitest";
import { deriveEffectiveTier, isProtectedSlot } from "@/sectors/g-agents/write/tier";
import type { PlacementProposal } from "@/sectors/g-agents/write/schema";

// Un cambio en esta tabla decide QUÉ se auto-aplica a la tienda sin humano.

const RATIONALE = "ctr_seen del placement abc cayó de 0.041 a 0.012 en la ventana 7d (read_metrics).";
const FREE = { slotHasNonAgentRow: false, isProtectedSlot: false };

const create = (over: Partial<Extract<PlacementProposal, { action: "create" }>> = {}) =>
  ({
    action: "create",
    surface: "home",
    slot: 20,
    section_type: "popular",
    params: {},
    rule: null,
    scope: "global",
    scope_ref: null,
    ttl_hours: 72,
    rationale: RATIONALE,
    ...over,
  }) as PlacementProposal;

describe("deriveEffectiveTier (C2)", () => {
  test("request_pause ⇒ high (tocar lo humano = humano decide)", () => {
    const p: PlacementProposal = {
      action: "request_pause",
      target_placement_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      rationale: RATIONALE,
    };
    expect(deriveEffectiveTier(p, FREE)).toBe("high");
  });

  test("pause_own ⇒ low (retirar lo propio = siempre seguro)", () => {
    const p: PlacementProposal = {
      action: "pause_own",
      placement_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      rationale: RATIONALE,
    };
    expect(deriveEffectiveTier(p, FREE)).toBe("low");
  });

  test("slot protegido ⇒ high aunque sea create global", () => {
    expect(deriveEffectiveTier(create(), { slotHasNonAgentRow: false, isProtectedSlot: true })).toBe("high");
  });

  test("slot ocupado por fila no-agente ⇒ high", () => {
    expect(deriveEffectiveTier(create(), { slotHasNonAgentRow: true, isProtectedSlot: false })).toBe("high");
  });

  test("supersede en slot libre de no-agentes ⇒ medium", () => {
    const sup = { ...create(), action: "supersede" } as PlacementProposal;
    expect(deriveEffectiveTier(sup, FREE)).toBe("medium");
  });

  test("create scope segment ⇒ medium", () => {
    expect(deriveEffectiveTier(create({ scope: "segment", scope_ref: "femenino_joven" }), FREE)).toBe("medium");
  });

  test("create global en slot libre ⇒ low", () => {
    expect(deriveEffectiveTier(create(), FREE)).toBe("low");
  });

  test("isProtectedSlot: los 3 slots seed y nada más", () => {
    expect(isProtectedSlot("home", 10)).toBe(true);
    expect(isProtectedSlot("pdp", 10)).toBe(true);
    expect(isProtectedSlot("cart", 10)).toBe(true);
    expect(isProtectedSlot("home", 20)).toBe(false);
  });
});
