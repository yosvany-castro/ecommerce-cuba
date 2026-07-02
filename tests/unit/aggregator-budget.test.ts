// tests/unit/aggregator-budget.test.ts
import { describe, it, expect } from "vitest";
import { budgetExceeded } from "@/sectors/c-search/decide/budget";

describe("presupuesto del agregador", () => {
  it("bloquea al alcanzar el límite exacto", () => {
    expect(budgetExceeded(400, 400)).toBe(true);
    expect(budgetExceeded(399, 400)).toBe(false);
  });
  it("presupuesto 0 = agregador apagado", () => {
    expect(budgetExceeded(0, 0)).toBe(true);
  });
});
