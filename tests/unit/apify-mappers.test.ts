import { describe, test, expect } from "vitest";
import { usdToCents, queryFromOpts } from "@/sectors/b-catalog/apify/sources/shared";
import * as amazon from "@/sectors/b-catalog/apify/sources/amazon";
import * as aliexpress from "@/sectors/b-catalog/apify/sources/aliexpress";
import * as shein from "@/sectors/b-catalog/apify/sources/shein";
import type { MockProduct } from "@/sectors/b-catalog/mock/types";
// Fixtures reales capturados en vivo (T3): endurecen los mappers con las formas de verdad.
import amazonFxRaw from "../fixtures/apify/amazon-sample.json";
import aliexpressFxRaw from "../fixtures/apify/aliexpress-sample.json";
import sheinFxRaw from "../fixtures/apify/shein-sample.json";

const amazonFx = amazonFxRaw as Record<string, unknown>[];
const aliexpressFx = aliexpressFxRaw as Record<string, unknown>[];
const sheinFx = sheinFxRaw as Record<string, unknown>[];
const notNull = (p: MockProduct | null): p is MockProduct => p !== null;

describe("usdToCents", () => {
  test("number float → integer cents", () => {
    expect(usdToCents(12.34)).toBe(1234);
    expect(usdToCents(29.99)).toBe(2999);
  });
  test("numeric string", () => {
    expect(usdToCents("12.34")).toBe(1234);
  });
  test("string with currency symbol", () => {
    expect(usdToCents("US $12.34")).toBe(1234);
  });
  test("string with comma thousands separator", () => {
    expect(usdToCents("$1,234.56")).toBe(123456);
  });
  test("unparseable → null", () => {
    expect(usdToCents("free")).toBeNull();
    expect(usdToCents("")).toBeNull();
    expect(usdToCents(null)).toBeNull();
    expect(usdToCents(undefined)).toBeNull();
    expect(usdToCents({})).toBeNull();
  });
  test("zero or negative → null (price must be > 0)", () => {
    expect(usdToCents(0)).toBeNull();
    expect(usdToCents(-5)).toBeNull();
  });
});

describe("queryFromOpts", () => {
  test("prefers explicit query", () => {
    expect(queryFromOpts({ query: "audifonos bluetooth" })).toBe("audifonos bluetooth");
  });
  test("derives from category when no query", () => {
    expect(queryFromOpts({ category: "ropa" })).toBe("ropa mujer");
    expect(queryFromOpts({ category: "electronica" })).toBe("electronics gadgets");
  });
  test("falls back to deals with neither", () => {
    expect(queryFromOpts({})).toBe("deals");
  });
});

describe("amazon.mapItem", () => {
  const rich = {
    asin: "B0RICH123",
    title: "Wireless Headphones",
    url: "https://www.amazon.com/dp/B0RICH123",
    price: { value: 29.99, currency: "USD" },
    listPrice: { value: 49.99, currency: "USD" },
    stars: 4.5,
    reviewsCount: 1200,
    brand: "Acme",
    thumbnailImage: "https://img.example/a1.jpg",
    description: "Great sound quality",
    variantAttributes: [
      { key: "Size", value: "One Size" },
      { name: "Color", value: "Black" },
    ],
  };

  test("rich item maps every field", () => {
    const p = amazon.mapItem(rich);
    expect(p).not.toBeNull();
    expect(p!.source).toBe("amazon");
    expect(p!.source_product_id).toBe("B0RICH123");
    expect(p!.title).toBe("Wireless Headphones");
    expect(p!.price_cents).toBe(2999);
    expect(p!.image_url).toBe("https://img.example/a1.jpg");
    expect(p!.brand).toBe("Acme");
    expect(p!.description).toBe("Great sound quality");
    expect(p!.attributes.old_price_cents).toBe(4999);
    expect(p!.attributes.rating).toBe(4.5);
    expect(p!.attributes.colors).toEqual(["Black"]);
    expect(p!.attributes.sizes).toEqual(["One Size"]);
    expect(p!.attributes.brand).toBe("Acme");
  });

  test("minimal item: description falls back to title, no old_price", () => {
    const p = amazon.mapItem({ asin: "B0MIN", title: "Cheap thing", price: { value: 5 } });
    expect(p).not.toBeNull();
    expect(p!.price_cents).toBe(500);
    expect(p!.description).toBe("Cheap thing");
    expect(p!.attributes.old_price_cents).toBeUndefined();
    expect(p!.attributes.colors).toBeUndefined();
  });

  test("listPrice not greater than price → no old_price", () => {
    const p = amazon.mapItem({
      asin: "B0EQ",
      title: "T",
      price: { value: 29.99 },
      listPrice: { value: 20 },
    });
    expect(p!.attributes.old_price_cents).toBeUndefined();
  });

  test("garbage (no price) → null", () => {
    expect(amazon.mapItem({ asin: "B0NO", title: "No price" })).toBeNull();
  });
  test("garbage (no id) → null", () => {
    expect(amazon.mapItem({ title: "x", price: { value: 5 } })).toBeNull();
  });
  test("non-object → null", () => {
    expect(amazon.mapItem("nope")).toBeNull();
    expect(amazon.mapItem(null)).toBeNull();
  });

  test("buildInput encodes query into amazon search url", () => {
    const input = amazon.buildInput({ query: "audifonos bluetooth", limit: 5 });
    expect(input.categoryOrProductUrls).toEqual([
      { url: "https://www.amazon.com/s?k=audifonos%20bluetooth" },
    ]);
    expect(input.maxItemsPerStartUrl).toBe(5);
    expect(input.proxyCountry).toBe("US");
  });
});

describe("aliexpress.mapItem", () => {
  // Forma real (devcake): productId, priceCurrent(Min), priceOriginal(Min), ratingValue, soldDescription.
  const mapped = aliexpressFx.map((it) => aliexpress.mapItem(it)).filter(notNull);

  test("real fixture: cada item mapea con price entero > 0", () => {
    expect(mapped.length).toBe(aliexpressFx.length);
    for (const p of mapped) {
      expect(Number.isInteger(p.price_cents)).toBe(true);
      expect(p.price_cents).toBeGreaterThan(0);
    }
  });

  test("real fixture item 0: precios/rating/orders desde los nombres reales", () => {
    const p = aliexpress.mapItem(aliexpressFx[0])!;
    expect(p.source).toBe("aliexpress");
    expect(p.source_product_id).toBe(aliexpressFx[0].productId);
    expect(p.price_cents).toBe(99); // priceCurrentMin 0.99
    expect(p.attributes.old_price_cents).toBe(325); // priceOriginalMin 3.25 > price
    expect(p.attributes.rating).toBe(4.2); // ratingValue
    expect(p.attributes.orders).toBe("10,000+ sold"); // soldDescription
    expect(p.image_url).toBe(aliexpressFx[0].imageUrl);
    // categoryName ausente en el output real; cae a searchQuery.
    expect(p.raw_category).toBe("audifonos bluetooth");
  });

  test("minimal item via alias legacy: productId + salePrice", () => {
    const p = aliexpress.mapItem({ productId: "9999", title: "Thing", salePrice: "3.00" });
    expect(p).not.toBeNull();
    expect(p!.source_product_id).toBe("9999");
    expect(p!.price_cents).toBe(300);
    expect(p!.attributes.old_price_cents).toBeUndefined();
  });

  test("garbage (no id, no price) → null", () => {
    expect(aliexpress.mapItem({ title: "no id no price" })).toBeNull();
  });

  test("buildInput fuerza maxProducts >= 50 (piso del actor)", () => {
    expect(aliexpress.buildInput({ query: "smartwatch", limit: 8 })).toEqual({
      searchQueries: ["smartwatch"],
      maxProducts: 50,
    });
  });
});

describe("shein.mapItem", () => {
  const rich = {
    goods_id: "sg123",
    goods_name: "Summer Dress",
    goods_img: "https://img.example/sh1.jpg",
    detail_image: ["https://img.example/sh1.jpg", "https://img.example/sh2.jpg"],
    salePrice: { amount: "12.00", usdAmount: "12.99" },
    retailPrice: { amount: "20.00", usdAmount: "21.99" },
    cate_name: "Dresses",
  };

  test("rich item prefers usdAmount and maps images", () => {
    const p = shein.mapItem(rich);
    expect(p).not.toBeNull();
    expect(p!.source).toBe("shein");
    expect(p!.source_product_id).toBe("sg123");
    expect(p!.title).toBe("Summer Dress");
    expect(p!.price_cents).toBe(1299);
    expect(p!.image_url).toBe("https://img.example/sh1.jpg");
    expect(p!.raw_category).toBe("Dresses");
    expect(p!.attributes.old_price_cents).toBe(2199);
    expect(p!.attributes.images).toEqual([
      "https://img.example/sh1.jpg",
      "https://img.example/sh2.jpg",
    ]);
  });

  test("minimal item: usdAmount only, no old_price, no images", () => {
    const p = shein.mapItem({
      goods_id: "sg9",
      goods_name: "Socks",
      salePrice: { usdAmount: "2.50" },
    });
    expect(p).not.toBeNull();
    expect(p!.price_cents).toBe(250);
    expect(p!.attributes.old_price_cents).toBeUndefined();
    expect(p!.attributes.images).toBeUndefined();
  });

  test("falls back to salePrice.amount when usdAmount missing", () => {
    const p = shein.mapItem({
      goods_id: "sg8",
      goods_name: "Hat",
      salePrice: { amount: "7.00" },
    });
    expect(p!.price_cents).toBe(700);
  });

  test("garbage (no id) → null", () => {
    expect(shein.mapItem({ goods_name: "no id" })).toBeNull();
  });

  test("buildInput: query como array, countryCode en minúsculas", () => {
    expect(shein.buildInput({ query: "vestido", limit: 6 })).toEqual({
      query: ["vestido"],
      maxItems: 6,
      countryCode: "us",
    });
  });
});

describe("real fixtures — batch mapping (capturado en vivo T3)", () => {
  test("amazon: mapea los items con precio; categoría de breadCrumbs, galería de highResolutionImages", () => {
    const mapped = amazonFx.map((it) => amazon.mapItem(it)).filter(notNull);
    expect(mapped.length).toBeGreaterThanOrEqual(4); // 1 item sin stock trae price null → descartado
    for (const p of mapped) {
      expect(p.price_cents).toBeGreaterThan(0);
      expect(p.raw_category).toContain(">"); // rastro de breadCrumbs
      expect(Array.isArray(p.attributes.images)).toBe(true);
    }
    // variantAttributes → al menos un color real
    expect(
      mapped.some((p) => Array.isArray(p.attributes.colors) && p.attributes.colors.length > 0),
    ).toBe(true);
  });

  test("amazon fixture item 1: valores exactos (Soundcore P30i, asin B0CRTR3PMF)", () => {
    const p = amazon.mapItem(amazonFx[1])!;
    expect(p.source_product_id).toBe("B0CRTR3PMF");
    expect(p.price_cents).toBe(2799); // price.value 27.99
    expect(p.attributes.old_price_cents).toBe(3999); // listPrice.value 39.99
    expect(p.attributes.rating).toBe(4.4); // stars
    expect((p.attributes.images as string[]).length).toBe(8); // highResolutionImages
    expect(p.attributes.colors).toEqual(["Green"]); // variantAttributes Color
  });

  test("shein: mapea todo; precio usdAmount, galería detail_image, categoría cate_name", () => {
    const mapped = sheinFx.map((it) => shein.mapItem(it)).filter(notNull);
    expect(mapped.length).toBe(sheinFx.length);
    const p0 = shein.mapItem(sheinFx[0])!;
    expect(p0.price_cents).toBe(1408); // salePrice.usdAmount 14.08
    expect(p0.attributes.old_price_cents).toBe(2228); // retailPrice.usdAmount 22.28
    expect(p0.raw_category).toBe("Wireless Earbuds");
    expect((p0.attributes.images as string[]).length).toBe(10);
  });
});
