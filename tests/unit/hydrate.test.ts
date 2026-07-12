import { describe, test, expect } from "vitest";
import {
  parseAmazonVariants,
  parseAliexpressVariants,
  parseWalmartVariants,
  parseSheinVariants,
  parseAliexpressPackageWeightGrams,
  parseAliexpressShippingDays,
} from "@/sectors/b-catalog/hydrate";
import amazonFx from "../fixtures/rapidapi/amazon-rtd-detail-variants.json";
import aliexpressFx from "../fixtures/rapidapi/aliexpress-datahub-detail-variants.json";
import aliexpressDetailFx from "../fixtures/rapidapi/aliexpress-datahub-detail.json";
import walmartFx from "../fixtures/rapidapi/walmart-axesso-detail-variants.json";
import sheinFx from "../fixtures/rapidapi/shein-otapi-detail-variants.json";

describe("parseAmazonVariants", () => {
  test("extrae color+size, sin precio/foto; 2 asins con misma combo (dedupe lo resuelve curateVariants, no el parser)", () => {
    const out = parseAmazonVariants(amazonFx);
    expect(out).toHaveLength(4);
    expect(out).toContainEqual({ color: "Rinse", size: "32W x 32L" });
  });
  test("sin all_product_variations → []", () => {
    expect(parseAmazonVariants({ data: {} })).toEqual([]);
  });
});

describe("parseAliexpressVariants", () => {
  test("mapea propMap→color/size vía props, precio en promotionPrice, available por quantity>0", () => {
    const out = parseAliexpressVariants(aliexpressFx);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ color: "GRAY", size: "XL", price_cents: 1077, available: true });
  });
});

describe("parseWalmartVariants", () => {
  test("resuelve ids de variantCriteria a nombres + precio/stock/foto por SKU", () => {
    const out = parseWalmartVariants(walmartFx);
    expect(out).toHaveLength(2);
    expect(out).toContainEqual({ color: "Coal Black", size: "38X32", price_cents: 2098, available: true, image: expect.stringContaining("walmartimages.com") });
  });
});

describe("parseAliexpressPackageWeightGrams / parseAliexpressShippingDays (fixture real)", () => {
  test("packageDetail.weight 0.5 kg → 500 g (ya es peso de PAQUETE, sin pad extra)", () => {
    expect(parseAliexpressPackageWeightGrams(aliexpressDetailFx)).toBe(500);
  });
  test("shippingList[0].shippingTime '3-9' → {min:3, max:9}", () => {
    expect(parseAliexpressShippingDays(aliexpressDetailFx)).toEqual({ min: 3, max: 9 });
  });
  test("respuesta sin delivery → undefined, sin inventar", () => {
    expect(parseAliexpressPackageWeightGrams({ result: {} })).toBeUndefined();
    expect(parseAliexpressShippingDays({ result: {} })).toBeUndefined();
  });
});

describe("parseSheinVariants", () => {
  test("resuelve Configurators Pid/Vid contra Attributes[IsConfigurator], precio+stock, sin foto", () => {
    const out = parseSheinVariants(sheinFx);
    expect(out).toHaveLength(4);
    expect(out).toContainEqual({ size: "XL", price_cents: 1700, available: true });
    expect(out.some((v) => "image" in (v as Record<string, unknown>))).toBe(false);
  });
});
