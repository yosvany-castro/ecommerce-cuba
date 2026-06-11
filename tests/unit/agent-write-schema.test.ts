import { describe, test, expect } from "vitest";
import { PlacementProposalSchema } from "@/sectors/g-agents/write/schema";

// La puerta de entrada del agente: si este parse se ablanda, el LLM puede
// colar scope user, TTLs inmortales, slots seed o reglas basura.

const RATIONALE = "ctr_seen del placement abc cayó de 0.041 a 0.012 en la ventana 7d (read_metrics).";

const validCreate = {
  action: "create",
  surface: "home",
  slot: 20,
  section_type: "popular",
  params: { limit: 10 },
  rule: null,
  scope: "global",
  scope_ref: null,
  ttl_hours: 72,
  rationale: RATIONALE,
};

describe("PlacementProposalSchema (C2)", () => {
  test("create válido parsea con defaults aplicados", () => {
    const r = PlacementProposalSchema.safeParse(validCreate);
    expect(r.success).toBe(true);
    if (r.success && r.data.action === "create") {
      expect(r.data.ttl_hours).toBe(72);
    }
  });

  test("scope user ni parsea", () => {
    expect(PlacementProposalSchema.safeParse({ ...validCreate, scope: "user" }).success).toBe(false);
  });

  test("ttl_hours 9999 (inmortalidad) rechazado", () => {
    expect(PlacementProposalSchema.safeParse({ ...validCreate, ttl_hours: 9999 }).success).toBe(false);
  });

  test("slot 15 (fuera de los gaps de 10) rechazado", () => {
    expect(PlacementProposalSchema.safeParse({ ...validCreate, slot: 15 }).success).toBe(false);
  });

  test("create en slot 10 (seed) rechazado; supersede sí lo admite (tier lo frena)", () => {
    expect(PlacementProposalSchema.safeParse({ ...validCreate, slot: 10 }).success).toBe(false);
    const sup = PlacementProposalSchema.safeParse({ ...validCreate, action: "supersede", slot: 10 });
    expect(sup.success).toBe(true);
  });

  test("rule inválida (campo desconocido) rechazada por RuleSchema embebido", () => {
    const r = PlacementProposalSchema.safeParse({
      ...validCreate,
      rule: { field: "hacked", op: "eq", value: 1 },
    });
    expect(r.success).toBe(false);
  });

  test("risk_tier como input = clave desconocida en strictObject ⇒ rechazo", () => {
    expect(
      PlacementProposalSchema.safeParse({ ...validCreate, risk_tier: "low" }).success,
    ).toBe(false);
  });
});
