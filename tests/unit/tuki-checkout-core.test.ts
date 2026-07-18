import { describe, expect, it } from "vitest";
import { shipOptions, validateShipping } from "@/components/tuki/checkout-core";

describe("checkout core — envío por libra (spec B1)", () => {
  it("solo aéreo cuando marítimo no tiene tarifa (default env)", () => {
    const opts = shipOptions(2.5, ["shein"]);
    expect(opts.map((o) => o.id)).toEqual(["aereo"]);
    expect(opts[0].quote.ship_cents).toBe(4 * 350); // ceil(2.5 + max(0.375, 1)) = 4 lb
    expect(opts[0].d1).toBeGreaterThan(0);
    expect(opts[0].d2).toBeGreaterThanOrEqual(opts[0].d1);
  });
  it("carrito vacío → quote en 0", () => {
    expect(shipOptions(0, [])[0].quote.ship_cents).toBe(0);
  });
  it("valida carnet de 6+ dígitos", () => {
    expect(validateShipping({ nombre: "A", ci: "1234", tel: "5", dir: "d", ciudad: "c" }).ci).toBe(true);
    expect(validateShipping({ nombre: "A", ci: "123456", tel: "5", dir: "d", ciudad: "c" }).ci).toBe(false);
  });
});
