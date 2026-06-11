import { describe, test, expect } from "vitest";
import { gateVerdict } from "@/sectors/g-agents/sim/stats";

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
});
