import { describe, test, expect } from "vitest";
import { wilson95 } from "@/sectors/g-agents/metrics/confidence";

describe("wilson95 (confianza del agente)", () => {
  test("muestras inválidas ⇒ null (jamás un intervalo inventado)", () => {
    expect(wilson95(0, 0)).toBeNull();
    expect(wilson95(5, 0)).toBeNull();
    expect(wilson95(-1, 10)).toBeNull();
    expect(wilson95(11, 10)).toBeNull();
  });

  test("valores conocidos: wilson95(5,100) ≈ [0.0215, 0.1118]", () => {
    const ci = wilson95(5, 100)!;
    expect(ci[0]).toBeCloseTo(0.0215, 3);
    expect(ci[1]).toBeCloseTo(0.1118, 3);
  });

  test("clamping a [0,1] en los extremos", () => {
    const zero = wilson95(0, 10)!;
    expect(zero[0]).toBe(0);
    expect(zero[1]).toBeGreaterThan(0);
    const full = wilson95(10, 10)!;
    expect(full[1]).toBeLessThanOrEqual(1);
    expect(full[1]).toBeCloseTo(1, 10);
    expect(full[0]).toBeLessThan(1);
  });
});
