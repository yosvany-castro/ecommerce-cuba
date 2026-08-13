import { describe, expect, it } from "vitest";
import { shipOptions, validateShipping } from "@/components/tuki/checkout-core";

describe("checkout core — envío por libra (spec B1)", () => {
  it("express + aéreo; marítimo oculto sin tarifa (default env)", () => {
    const opts = shipOptions(2.5, [{ source: "shein" }]);
    expect(opts.map((o) => o.id)).toEqual(["express", "aereo"]);
    const chargeableLb = 4; // ceil(2.5 + max(0.375, 1)) = 4 lb
    expect(opts[0].quote.ship_cents).toBe(chargeableLb * 600); // express $6/lb provisional
    expect(opts[1].quote.ship_cents).toBe(chargeableLb * 350);
    // express llega antes que aéreo, y ambos rangos son coherentes
    expect(opts[0].d2).toBeLessThan(opts[1].d2);
    for (const o of opts) {
      expect(o.d1).toBeGreaterThan(0);
      expect(o.d2).toBeGreaterThanOrEqual(o.d1);
    }
  });
  it("carrito vacío → quote en 0", () => {
    expect(shipOptions(0, [])[0].quote.ship_cents).toBe(0);
  });
  it("valida carnet de 6+ dígitos y provincia requerida", () => {
    expect(validateShipping({ nombre: "A", ci: "1234", tel: "5", dir: "d", provincia: "La Habana", ciudad: "c" }).ci).toBe(true);
    expect(validateShipping({ nombre: "A", ci: "123456", tel: "5", dir: "d", provincia: "La Habana", ciudad: "c" }).ci).toBe(false);
    expect(validateShipping({ nombre: "A", ci: "123456", tel: "5", dir: "d", provincia: "", ciudad: "c" }).provincia).toBe(true);
  });
});
