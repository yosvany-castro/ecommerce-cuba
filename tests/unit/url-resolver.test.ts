import { describe, test, expect } from "vitest";
import { parseProductUrl, slugQueryFromUrl } from "@/sectors/b-catalog/url-resolver";

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

  test("aliexpress.us con x_object_id en query → gana el ID del query (el del path es SEO)", () => {
    expect(
      parseProductUrl(
        "https://www.aliexpress.us/item/3256812204334285.html?spm=a2g0o.productlist.main.18&x_object_id=1005012390649037&gatewayAdapt=glo2usa",
      ),
    ).toEqual({ source: "aliexpress", source_product_id: "1005012390649037" });
  });

  test("aliexpress con object_id (variante del param) también gana al path", () => {
    expect(
      parseProductUrl("https://es.aliexpress.com/item/3256812204334285.html?object_id=1005012390649037"),
    ).toEqual({ source: "aliexpress", source_product_id: "1005012390649037" });
  });

  test("x_object_id no numérico se ignora → ID del path", () => {
    expect(
      parseProductUrl("https://www.aliexpress.com/item/1005006109476487.html?x_object_id=abc"),
    ).toEqual({ source: "aliexpress", source_product_id: "1005006109476487" });
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

  test("formato real con sufijo de categoría …-p-<id>-cat-<n>.html (el bug)", () => {
    expect(
      parseProductUrl("https://es.shein.com/Portable-Mini-Fan-p-23456789-cat-1727.html"),
    ).toEqual({ source: "shein", source_product_id: "23456789" });
  });

  test("con -cat- y query string de tracking", () => {
    expect(
      parseProductUrl("https://es.shein.com/Vestido-Floral-p-11223344-cat-1727.html?src_identifier=fc%3DES&mallCode=1"),
    ).toEqual({ source: "shein", source_product_id: "11223344" });
  });

  test("ccTLD shein.com.mx también resuelve", () => {
    expect(parseProductUrl("https://shein.com.mx/Blusa-p-555666.html")).toEqual({
      source: "shein",
      source_product_id: "555666",
    });
  });

  test("link de compartir con goods_id en query", () => {
    expect(parseProductUrl("https://es.shein.com/share/landing?goods_id=778899")).toEqual({
      source: "shein",
      source_product_id: "778899",
    });
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

  test("ccTLD amazon.com.mx resuelve; marca con sufijo pegado NO", () => {
    expect(parseProductUrl("https://www.amazon.com.mx/dp/B0018QS5HU")).toEqual({
      source: "amazon",
      source_product_id: "B0018QS5HU",
    });
    expect(parseProductUrl("https://sheinoutlet.com/Vestido-p-123.html")).toBeNull();
  });
});

describe("slugQueryFromUrl", () => {
  test("shein: slug largo → primeras 10 palabras sin ids ni stopwords de URL", () => {
    expect(
      slugQueryFromUrl(
        "https://us.shein.com/24pcs-Random-Color-Women-s-Men-s-Multi-Color-Minimalist-Comfortable-Elastic-Sports-Headbands-Sweat-Absorbent-Durable-p-423099565.html",
      ),
    ).toBe("24pcs Random Color Women s Men s Multi Color Minimalist");
  });

  test("amazon con slug de título", () => {
    expect(slugQueryFromUrl("https://www.amazon.com/Levis-505-Regular-Fit-Jeans/dp/B0018QS5HU")).toBe(
      "Levis 505 Regular Fit Jeans",
    );
  });

  test("aliexpress /item/ID.html no trae título → null", () => {
    expect(
      slugQueryFromUrl("https://www.aliexpress.us/item/3256812204334285.html?x_object_id=1005012390649037"),
    ).toBeNull();
  });

  test("texto que no es URL → null", () => {
    expect(slugQueryFromUrl("mini camera 1080p")).toBeNull();
  });
});
