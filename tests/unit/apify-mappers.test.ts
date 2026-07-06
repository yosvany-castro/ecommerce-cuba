import { describe, test, expect } from "vitest";
import { usdToCents, queryFromOpts } from "@/sectors/b-catalog/apify/sources/shared";
import * as amazon from "@/sectors/b-catalog/apify/sources/amazon";
import * as aliexpress from "@/sectors/b-catalog/apify/sources/aliexpress";
import * as shein from "@/sectors/b-catalog/apify/sources/shein";

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
  const rich = {
    id: "1005006",
    title: "Bluetooth Earbuds",
    price: "US $8.50",
    originalPrice: "US $15.00",
    rating: "4.7",
    reviewsCount: 320,
    orders: "2000+",
    productUrl: "https://aliexpress.com/item/1005006.html",
    imageUrl: "https://img.example/ae1.jpg",
  };

  test("rich item maps price strings and aliases", () => {
    const p = aliexpress.mapItem(rich);
    expect(p).not.toBeNull();
    expect(p!.source).toBe("aliexpress");
    expect(p!.source_product_id).toBe("1005006");
    expect(p!.price_cents).toBe(850);
    expect(p!.image_url).toBe("https://img.example/ae1.jpg");
    expect(p!.attributes.old_price_cents).toBe(1500);
    expect(p!.attributes.rating).toBe(4.7);
    expect(p!.attributes.orders).toBe("2000+");
  });

  test("minimal item: productId + salePrice aliases", () => {
    const p = aliexpress.mapItem({ productId: "9999", title: "Thing", salePrice: "3.00" });
    expect(p).not.toBeNull();
    expect(p!.source_product_id).toBe("9999");
    expect(p!.price_cents).toBe(300);
    expect(p!.attributes.old_price_cents).toBeUndefined();
  });

  test("garbage (no id, no price) → null", () => {
    expect(aliexpress.mapItem({ title: "no id no price" })).toBeNull();
  });

  test("buildInput", () => {
    const input = aliexpress.buildInput({ query: "smartwatch", limit: 8 });
    expect(input).toEqual({ searchQueries: ["smartwatch"], maxProducts: 8 });
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

  test("buildInput", () => {
    const input = shein.buildInput({ query: "vestido", limit: 6 });
    expect(input).toEqual({ query: "vestido", maxItems: 6, countryCode: "US" });
  });
});
