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
  it("valida carnet de 11 dígitos, reparto y provincia requeridos", () => {
    expect(validateShipping({ nombre: "A", apellidos: "B", tel: "5", dir: "d", entre: "e", reparto: "r", ci: "1234567890", provincia: "La Habana", ciudad: "c" }).ci).toBe(true);
    expect(validateShipping({ nombre: "A", apellidos: "B", tel: "5", dir: "d", entre: "e", reparto: "r", ci: "12345678901", provincia: "La Habana", ciudad: "c" }).ci).toBe(false);
    expect(validateShipping({ nombre: "A", apellidos: "B", tel: "5", dir: "d", entre: "e", reparto: "r", ci: "12345678901", provincia: "La Habana", ciudad: "c" }).reparto).toBe(false);
    expect(validateShipping({ nombre: "A", apellidos: "B", tel: "5", dir: "d", entre: "e", reparto: "", ci: "12345678901", provincia: "La Habana", ciudad: "c" }).reparto).toBe(true);
    expect(validateShipping({ nombre: "A", apellidos: "B", tel: "5", dir: "d", entre: "e", reparto: "r", ci: "12345678901", provincia: "", ciudad: "c" }).provincia).toBe(true);
  });
});
