import { describe, test, expect } from "vitest";
import { parseProductUrl } from "@/sectors/b-catalog/url-resolver";

describe("parseProductUrl — amazon", () => {
  test("amazon.com/dp/ASIN", () => {
    expect(parseProductUrl("https://www.amazon.com/dp/B0018QS5HU")).toEqual({
      source: "amazon",
      source_product_id: "B0018QS5HU",
    });
  });

  test("amazon.com/*/dp/ASIN con slug de título y query string", () => {
    expect(
      parseProductUrl("https://www.amazon.com/Levis-505-Jeans/dp/B0018QS5HU/ref=sr_1_1?th=1"),
    ).toEqual({ source: "amazon", source_product_id: "B0018QS5HU" });
  });

  test("amazon.com/gp/product/ASIN", () => {
    expect(parseProductUrl("https://www.amazon.com/gp/product/B0018QS5HU")).toEqual({
      source: "amazon",
      source_product_id: "B0018QS5HU",
    });
  });

  test("sin protocolo (se acepta igual)", () => {
    expect(parseProductUrl("amazon.com/dp/B0018QS5HU")).toEqual({
      source: "amazon",
      source_product_id: "B0018QS5HU",
    });
  });

  test("ASIN se normaliza a mayúsculas", () => {
    expect(parseProductUrl("https://www.amazon.com/dp/b0018qs5hu")).toEqual({
      source: "amazon",
      source_product_id: "B0018QS5HU",
    });
  });

  test("URL de amazon sin ASIN (página de búsqueda) → null", () => {
    expect(parseProductUrl("https://www.amazon.com/s?k=jeans")).toBeNull();
  });

  test("ASIN corto (9 chars) → null", () => {
    expect(parseProductUrl("https://www.amazon.com/dp/B0018QS5H")).toBeNull();
  });
});

describe("parseProductUrl — aliexpress", () => {
  test("aliexpress.com/item/<id>.html", () => {
    expect(parseProductUrl("https://www.aliexpress.com/item/1005006109476487.html")).toEqual({
      source: "aliexpress",
      source_product_id: "1005006109476487",
    });
  });

  test("con query string", () => {
    expect(
      parseProductUrl("https://es.aliexpress.com/item/1005006109476487.html?spm=abc"),
    ).toEqual({ source: "aliexpress", source_product_id: "1005006109476487" });
  });

  test("id no numérico → null", () => {
    expect(parseProductUrl("https://www.aliexpress.com/item/abc.html")).toBeNull();
  });
});

describe("parseProductUrl — shein", () => {
  test("shein.com/*-p-<id>.html", () => {
    expect(
      parseProductUrl("https://shein.com/Cute-Summer-Dress-p-12345678.html"),
    ).toEqual({ source: "shein", source_product_id: "12345678" });
  });

  test("us.shein.com también resuelve", () => {
    expect(
      parseProductUrl("https://us.shein.com/Cute-Summer-Dress-p-12345678.html"),
    ).toEqual({ source: "shein", source_product_id: "12345678" });
  });

  test("source_product_id NO lleva el prefijo sh-", () => {
    const r = parseProductUrl("https://shein.com/Dress-p-999.html");
    expect(r?.source_product_id).toBe("999");
    expect(r?.source_product_id.startsWith("sh-")).toBe(false);
  });

  test("sin el patrón -p-<id>.html → null", () => {
    expect(parseProductUrl("https://shein.com/Cute-Summer-Dress.html")).toBeNull();
  });
});

describe("parseProductUrl — walmart", () => {
  test("walmart.com/ip/<slug>/<id>", () => {
    expect(
      parseProductUrl("https://www.walmart.com/ip/Wrangler-Jeans-Relaxed-Fit/388037456"),
    ).toEqual({ source: "walmart", source_product_id: "388037456" });
  });

  test("walmart.com/ip/<id> sin slug", () => {
    expect(parseProductUrl("https://www.walmart.com/ip/388037456")).toEqual({
      source: "walmart",
      source_product_id: "388037456",
    });
  });

  test("id no numérico al final → null", () => {
    expect(parseProductUrl("https://www.walmart.com/ip/Wrangler-Jeans/abc")).toBeNull();
  });

  test("ruta que no es /ip/ → null", () => {
    expect(parseProductUrl("https://www.walmart.com/cp/some-category/123456")).toBeNull();
  });
});

describe("parseProductUrl — negativos generales", () => {
  test("texto normal de búsqueda (con espacios) → null", () => {
    expect(parseProductUrl("fan 20000mah")).toBeNull();
    expect(parseProductUrl("zapatillas nike talla 40")).toBeNull();
  });

  test("string vacío / solo espacios → null", () => {
    expect(parseProductUrl("")).toBeNull();
    expect(parseProductUrl("   ")).toBeNull();
  });

  test("una sola palabra que no es URL de producto → null", () => {
    expect(parseProductUrl("gorra")).toBeNull();
    expect(parseProductUrl("amazon.com")).toBeNull();
  });

  test("dominio desconocido → null", () => {
    expect(parseProductUrl("https://www.ebay.com/itm/123456789012")).toBeNull();
  });

  test("dominio correcto pero producto de otra tienda mezclado → null", () => {
    expect(parseProductUrl("https://www.amazon.com/ip/388037456")).toBeNull();
  });
});
