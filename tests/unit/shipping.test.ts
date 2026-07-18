import { describe, test, expect } from "vitest";
import { shipQuote, taxCents, taxPct, shipRateCentsPerLb } from "@/lib/shipping";

describe("shipQuote (aéreo $3.50/lb default, buffer max(15%, 1 lb), ceil)", () => {
  test("0.4 lb estimadas → buffer 1 lb → ceil(1.4)=2 lb → $7.00", () => {
    const q = shipQuote(0.4, "aereo")!;
    expect(q.buffer_lb).toBe(1);
    expect(q.chargeable_lb).toBe(2);
    expect(q.ship_cents).toBe(700);
  });
  test("10 lb → buffer 1.5 → ceil(11.5)=12 lb → $42.00", () => {
    const q = shipQuote(10, "aereo")!;
    expect(q.buffer_lb).toBe(1.5);
    expect(q.chargeable_lb).toBe(12);
    expect(q.ship_cents).toBe(4200);
  });
  test("carrito vacío (0 lb) → 0 en todo", () => {
    const q = shipQuote(0, "aereo")!;
    expect(q.chargeable_lb).toBe(0);
    expect(q.ship_cents).toBe(0);
  });
  test("marítimo sin tarifa configurada → null (vía oculta)", () => {
    expect(shipRateCentsPerLb("maritimo")).toBeNull();
    expect(shipQuote(3, "maritimo")).toBeNull();
  });
});

describe("taxCents (7.5% Hillsborough default)", () => {
  test("$100.00 → $7.50", () => expect(taxCents(10000)).toBe(750));
  test("redondeo: $9.99 × 7.5% = 74.925¢ → 75¢", () => expect(taxCents(999)).toBe(75));
  test("0 → 0", () => expect(taxCents(0)).toBe(0));
  test("pct default", () => expect(taxPct()).toBe(7.5));
});
