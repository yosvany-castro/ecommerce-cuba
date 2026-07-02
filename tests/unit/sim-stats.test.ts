import { describe, test, expect } from "vitest";
import { frozenCollapsed, gateVerdict } from "@/sectors/g-agents/sim/stats";

/**
 * Gate math en los 3 bordes pre-registrados (A3 §5.3): un off-by-one aquí
 * decide un despliegue. 1.99 ⇒ FAIL (jamás se redondea); 2.0+ con CI ancho ⇒
 * escalada única; unanimidad rota ⇒ FAIL aunque Ĝ y CI pasen.
 */

describe("gateVerdict (pre-registrado, sin redondeos)", () => {
  test("Ĝ=1.99 unánime y significativo ⇒ FAIL (1.99 ≠ 2.0)", () => {
    const v = gateVerdict([1.99, 1.99, 1.99, 1.99, 1.99]);
    expect(v.geomMean).toBeCloseTo(1.99, 10);
    expect(v.unanimous).toBe(true);
    expect(v.ci95[0]).toBeGreaterThan(1);
    expect(v.pass).toBe(false);
    expect(v.escalate).toBe(false); // Ĝ<2: ni pass ni escalada
  });

  test("Ĝ≥2 con CI-low ≤ 1 ⇒ escalada única a N=10, no pass", () => {
    const v = gateVerdict([4.2, 1.05, 4.0, 1.1, 2.9]);
    expect(v.geomMean).toBeGreaterThanOrEqual(2.0);
    expect(v.ci95[0]).toBeLessThanOrEqual(1.0);
    expect(v.pass).toBe(false);
    expect(v.escalate).toBe(true);
  });

  test("unanimidad rota ⇒ FAIL aunque Ĝ≥2 y CI-low>1", () => {
    const v = gateVerdict([3.5, 3.2, 0.95, 3.8, 3.4]);
    expect(v.geomMean).toBeGreaterThanOrEqual(2.0);
    expect(v.ci95[0]).toBeGreaterThan(1.0);
    expect(v.unanimous).toBe(false);
    expect(v.pass).toBe(false);
    expect(v.escalate).toBe(false);
  });

  test("caso limpio 5/5 ⇒ PASS", () => {
    const v = gateVerdict([2.3, 2.1, 2.5, 2.2, 2.4]);
    expect(v.pass).toBe(true);
    expect(v.escalate).toBe(false);
  });

  test("n=1 (smoke) jamás puede pasar: sin réplicas no hay CI", () => {
    const v = gateVerdict([5.0]);
    expect(v.pass).toBe(false);
    expect(v.escalate).toBe(false);
  });

  test("n<5 jamás PASS ni ESCALADA aunque los ratios sean estelares (Fase D H1)", () => {
    const v = gateVerdict([2.5, 2.5]);
    expect(v.geomMean).toBeCloseTo(2.5, 10);
    expect(v.pass).toBe(false);
    expect(v.escalate).toBe(false);
  });
});

describe("frozenCollapsed (Fase D H2: e1→e2 incluido + frozen muerto)", () => {
  // traj indexada por época; medidas 2..4 (e0 orgánica fuera del detector)
  test("frozen TODO-CERO ⇒ inválido (un brazo muerto daría ratio astronómico)", () => {
    expect(frozenCollapsed([0, 0, 0, 0, 0], 2, 4)).toBe(true);
  });

  test("colapso e1→e2 (baseline→primera medida) SÍ dispara", () => {
    expect(frozenCollapsed([5e6, 1e6, 0.4e6, 0.39e6, 0.38e6], 2, 4)).toBe(true);
  });

  test("margen ≤0 en UNA época medida ⇒ inválido", () => {
    expect(frozenCollapsed([5e6, 1e6, 1e6, 0, 1e6], 2, 4)).toBe(true);
  });

  test("decadencia legítima (paso 0.59, smoke seed 123) NO dispara; e0→e1 fuera", () => {
    // ≈ smoke 123: e0 orgánica 3.6M (régimen distinto), luego 1.07M→1.06M→0.93M→0.55M
    expect(frozenCollapsed([3.6e6, 1.075e6, 1.063e6, 0.928e6, 0.552e6], 2, 4)).toBe(false);
  });
});
