import { describe, expect, it } from "vitest";
import { shipOptions, validateShipping } from "@/components/tuki/checkout-core";

describe("checkout core", () => {
  it("bloquea métodos por peso con razón", () => {
    const opts = shipOptions(12, 3000);
    expect(opts.find((o) => o.id === "rapido")!.blocked).toBe(true);
    expect(opts.find((o) => o.id === "rapido")!.reason).toContain("10");
    expect(shipOptions(2, 3000).find((o) => o.id === "lento")!.blocked).toBe(true);
  });
  it("estándar gratis desde $50", () => {
    expect(shipOptions(3, 5000).find((o) => o.id === "estandar")!.effectivePriceCents).toBe(0);
    expect(shipOptions(3, 4999).find((o) => o.id === "estandar")!.effectivePriceCents).toBe(499);
  });
  it("valida carnet de 6+ dígitos", () => {
    expect(validateShipping({ nombre: "A", ci: "1234", tel: "5", dir: "d", ciudad: "c" }).ci).toBe(true);
    expect(validateShipping({ nombre: "A", ci: "123456", tel: "5", dir: "d", ciudad: "c" }).ci).toBe(false);
  });
});
