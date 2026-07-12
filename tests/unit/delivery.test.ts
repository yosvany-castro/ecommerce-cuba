import { describe, expect, it } from "vitest";
import {
  estimateDelivery,
  estimateDeliveryForCart,
  formatDeliveryRange,
  deliveryDates,
  deliveryPhrase,
  hasMultipleStores,
} from "@/lib/delivery";

describe("estimateDelivery", () => {
  it("suma tramo tienda→depósito + depósito→Cuba por vía", () => {
    const amazonAir = estimateDelivery("amazon", "aereo");
    expect(amazonAir).toEqual({ minDays: 10, maxDays: 22, via: "aereo" });
    const aliSea = estimateDelivery("aliexpress", "maritimo");
    expect(aliSea.minDays).toBe(35);
    expect(aliSea.maxDays).toBe(70);
  });
  it("los días del PROVEEDOR (por producto) acortan el tramo 1 y mandan sobre el default", () => {
    // aliexpress default aéreo: 17–40; con shippingTime real "3-9": 10–24
    expect(estimateDelivery("aliexpress", "aereo")).toEqual({ minDays: 17, maxDays: 40, via: "aereo" });
    expect(estimateDelivery("aliexpress", "aereo", { min: 3, max: 9 })).toEqual({ minDays: 10, maxDays: 24, via: "aereo" });
  });
  it("tienda desconocida cae al default conservador (nunca promete de más)", () => {
    const unknown = estimateDelivery("temu", "aereo");
    expect(unknown.minDays).toBeGreaterThanOrEqual(estimateDelivery("amazon", "aereo").minDays);
  });
  it("marítimo siempre es más lento que aéreo para la misma tienda", () => {
    for (const s of ["amazon", "shein", "aliexpress", "walmart"]) {
      expect(estimateDelivery(s, "maritimo").minDays).toBeGreaterThan(estimateDelivery(s, "aereo").minDays);
    }
  });
});

describe("estimateDeliveryForCart", () => {
  it("manda el item más lento del carrito", () => {
    const mix = estimateDeliveryForCart(["amazon", "aliexpress"], "aereo");
    expect(mix).toEqual(estimateDelivery("aliexpress", "aereo"));
  });
  it("carrito vacío no revienta", () => {
    expect(estimateDeliveryForCart([], "aereo").minDays).toBeGreaterThan(0);
  });
});

it("formatDeliveryRange y hasMultipleStores", () => {
  expect(formatDeliveryRange(estimateDelivery("shein", "aereo"))).toBe("15–30 días");
  expect(hasMultipleStores(["shein", "shein"])).toBe(false);
  expect(hasMultipleStores(["shein", "amazon"])).toBe(true);
});

it("deliveryDates/deliveryPhrase: fechas concretas es-MX (presentación elegida)", () => {
  // ancla fija: 2026-07-12 12:00 UTC → amazon aéreo 10–22 días = 22 jul / 3 ago
  const now = Date.UTC(2026, 6, 12, 12);
  const e = estimateDelivery("amazon", "aereo");
  const d = deliveryDates(e, now);
  expect(d.from).toMatch(/22 jul/);
  expect(d.to).toMatch(/3 ago/);
  expect(deliveryPhrase(e, now)).toBe(`entre el ${d.from} y el ${d.to}`);
});
