import { describe, expect, it } from "vitest";
import { estimateDelivery, estimateDeliveryForCart, formatDeliveryRange, hasMultipleStores } from "@/lib/delivery";

describe("estimateDelivery", () => {
  it("suma tramo tienda→depósito + depósito→Cuba por vía", () => {
    const amazonAir = estimateDelivery("amazon", "aereo");
    expect(amazonAir).toEqual({ minDays: 10, maxDays: 22, via: "aereo" });
    const aliSea = estimateDelivery("aliexpress", "maritimo");
    expect(aliSea.minDays).toBe(45);
    expect(aliSea.maxDays).toBe(90);
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
  expect(formatDeliveryRange(estimateDelivery("shein", "aereo"))).toBe("16–33 días");
  expect(hasMultipleStores(["shein", "shein"])).toBe(false);
  expect(hasMultipleStores(["shein", "amazon"])).toBe(true);
});
