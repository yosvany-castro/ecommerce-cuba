import { describe, it, expect } from "vitest";
import { evaluateRule } from "@/sectors/f-slate/rules/evaluate";
import { isValidRule } from "@/sectors/f-slate/rules/schema";
import type { Rule, SlateRuleContext } from "@/sectors/f-slate/rules/types";

const ctx: SlateRuleContext = {
  surface: "home",
  hour_of_day: 14,
  day_of_week: 1,
  is_logged_in: false,
  user_segment: null,
  session_cohort: "adulto_femenino",
  recipient_active: false,
  signal_window_size: 3,
  gift_confirmed: false,
  cart_item_count: 2,
  pdp_product_id: null,
  pdp_category: null,
};

describe("evaluateRule (D1) — fail-closed por construcción", () => {
  it("null/undefined = siempre (placement sin regla)", () => {
    expect(evaluateRule(null, ctx)).toBe(true);
    expect(evaluateRule(undefined, ctx)).toBe(true);
  });

  it("operadores básicos contra el contexto", () => {
    expect(evaluateRule({ field: "cart_item_count", op: "gte", value: 1 }, ctx)).toBe(true);
    expect(evaluateRule({ field: "cart_item_count", op: "lt", value: 2 }, ctx)).toBe(false);
    expect(evaluateRule({ field: "surface", op: "eq", value: "home" }, ctx)).toBe(true);
    expect(evaluateRule({ field: "session_cohort", op: "in", value: ["adulto_femenino", "x"] }, ctx)).toBe(true);
    expect(evaluateRule({ field: "user_segment", op: "exists" }, ctx)).toBe(false);
    expect(evaluateRule({ field: "session_cohort", op: "exists" }, ctx)).toBe(true);
  });

  it("composición all/any/not", () => {
    const r: Rule = {
      all: [
        { field: "cart_item_count", op: "gte", value: 1 },
        { any: [{ field: "surface", op: "eq", value: "cart" }, { field: "surface", op: "eq", value: "home" }] },
        { not: { field: "gift_confirmed", op: "eq", value: true } },
      ],
    };
    expect(evaluateRule(r, ctx)).toBe(true);
  });

  it("FAIL-CLOSED: campo desconocido, tipo incompatible, op inválido, listas fuera de rango", () => {
    expect(evaluateRule({ field: "password" as never, op: "exists" }, ctx)).toBe(false);
    expect(evaluateRule({ field: "cart_item_count", op: "gt", value: "dos" }, ctx)).toBe(false);
    expect(evaluateRule({ field: "surface", op: "matches" as never, value: ".*" }, ctx)).toBe(false);
    expect(evaluateRule({ field: "surface", op: "in", value: [] }, ctx)).toBe(false);
    expect(evaluateRule({ field: "surface", op: "in", value: Array(51).fill("x") }, ctx)).toBe(false);
    // not(basura) también es false — la negación no blanquea lo malformado:
    expect(evaluateRule({ not: { field: "nope" as never, op: "eq", value: 1 } }, ctx)).toBe(false);
    // eq contra objeto (inyección de estructura) es false:
    expect(evaluateRule({ field: "surface", op: "eq", value: { $gt: "" } as never }, ctx)).toBe(false);
  });

  it("límites de profundidad y nodos cortan en false", () => {
    let deep: Rule = { field: "surface", op: "eq", value: "home" };
    for (let i = 0; i < 10; i++) deep = { not: deep };
    expect(evaluateRule(deep, ctx)).toBe(false); // profundidad > 5

    const wide: Rule = { all: Array(40).fill({ field: "surface", op: "eq", value: "home" }) };
    expect(evaluateRule(wide, ctx)).toBe(false); // nodos > 32
  });
});

describe("RuleSchema (write/load-time)", () => {
  it("acepta reglas bien formadas y null", () => {
    expect(isValidRule(null)).toBe(true);
    expect(isValidRule({ field: "cart_item_count", op: "gte", value: 1 })).toBe(true);
    expect(isValidRule({ all: [{ field: "surface", op: "eq", value: "pdp" }] })).toBe(true);
  });

  it("rechaza campos fuera de la whitelist, claves extra y profundidad excesiva", () => {
    expect(isValidRule({ field: "email", op: "eq", value: "x" })).toBe(false);
    expect(isValidRule({ field: "surface", op: "eq", value: "home", extra: 1 })).toBe(false);
    let deep: unknown = { field: "surface", op: "eq", value: "home" };
    for (let i = 0; i < 7; i++) deep = { not: deep };
    expect(isValidRule(deep)).toBe(false);
  });
});
