import { describe, test, expect } from "vitest";
import {
  parseAmazonDetailTitleImage,
  parseAliexpressDetailTitleImage,
  parseWalmartDetailTitleImage,
  parseSheinDetailTitleImage,
  parseDetailTitleImage,
} from "@/sectors/b-catalog/detail-title-image";
import amazonFx from "../fixtures/rapidapi/amazon-rtd-detail.json";
import aliexpressFx from "../fixtures/rapidapi/aliexpress-datahub-detail.json";
import walmartFx from "../fixtures/rapidapi/walmart-axesso-detail.json";
import walmartVariantsFx from "../fixtures/rapidapi/walmart-axesso-detail-variants.json";
import sheinFx from "../fixtures/rapidapi/shein-otapi-detail.json";

describe("parseAmazonDetailTitleImage (fixture real /product-details)", () => {
  test("título + imagen exactos del fixture", () => {
    const d = parseAmazonDetailTitleImage(amazonFx)!;
    expect(d.title).toBe("Levi's Men's 505 Regular Fit Jeans (Also Available in Big & Tall)");
    expect(d.image_url).toBe("https://m.media-amazon.com/images/I/51XquqDhOgL._AC_SL1000_.jpg");
  });

  test("sin product_title → null", () => {
    const json = { data: { ...amazonFx.data, product_title: undefined } };
    expect(parseAmazonDetailTitleImage(json)).toBeNull();
  });

  test("sin product_photo → image_url vacío, no revienta", () => {
    const json = { data: { ...amazonFx.data, product_photo: undefined } };
    expect(parseAmazonDetailTitleImage(json)!.image_url).toBe("");
  });
});

describe("parseAliexpressDetailTitleImage (fixture real /item_detail_2)", () => {
  test("título + primera imagen normalizada a https", () => {
    const d = parseAliexpressDetailTitleImage(aliexpressFx)!;
    expect(d.title).toBe(
      "HME Men's Casual Denim Pants, Light Blue Straight Fit Jeans with Vintage Wash for Daily Wear",
    );
    expect(d.image_url.startsWith("https://")).toBe(true);
    expect(d.image_url).not.toMatch(/^\/\//);
  });

  test("status.code != 200 → null", () => {
    const json = { result: { status: { code: 400 }, item: { title: "x", images: [] } } };
    expect(parseAliexpressDetailTitleImage(json)).toBeNull();
  });

  test("sin title → null", () => {
    const json = { result: { status: { code: 200 }, item: { images: [] } } };
    expect(parseAliexpressDetailTitleImage(json)).toBeNull();
  });
});

describe("parseWalmartDetailTitleImage (fixture real detalle)", () => {
  test("título del fixture mínimo (sin imagen a nivel producto) → image_url vacío", () => {
    const d = parseWalmartDetailTitleImage(walmartFx)!;
    expect(d.title).toBe("Wrangler Men's and Big Men's Relaxed Fit Jeans with Flex");
    expect(d.image_url).toBe("");
  });

  test("con variantsMap (fixture de variantes) → toma la imagen de la primera variante", () => {
    // el fixture de variantes no trae "name" (está recortado a variantsMap) —
    // se combina con un título real para probar el fallback de imagen aislado.
    const product = walmartVariantsFx.item.props.pageProps.initialData.data.product;
    const json = {
      item: { props: { pageProps: { initialData: { data: { product: { ...product, name: "Jeans" } } } } } },
    };
    const d = parseWalmartDetailTitleImage(json)!;
    expect(d.title).toBe("Jeans");
    expect(d.image_url.length).toBeGreaterThan(0); // el fixture sí trae imageInfo por variante
  });

  test("sin product → null", () => {
    expect(parseWalmartDetailTitleImage({ item: { props: {} } })).toBeNull();
  });
});

describe("parseSheinDetailTitleImage (fixture real /BatchGetItemFullInfo)", () => {
  test("título del fixture (sin Pictures) → image_url vacío", () => {
    const d = parseSheinDetailTitleImage(sheinFx)!;
    expect(d.title).toBe(
      "SHEIN Clasi 2pcs Women Casual Minimalist Polka Dot Pattern Set, Suitable For Summer,Summer Outfits For Women Summer Outfits For Women",
    );
    expect(d.image_url).toBe("");
  });

  test("ErrorCode != 'Ok' → null", () => {
    expect(parseSheinDetailTitleImage({ ErrorCode: "Fail" })).toBeNull();
  });

  test("con Pictures → toma la primera", () => {
    const json = {
      ErrorCode: "Ok",
      Result: { Item: { Title: "Vestido", Pictures: ["https://img/a.jpg", "https://img/b.jpg"] } },
    };
    expect(parseSheinDetailTitleImage(json)!.image_url).toBe("https://img/a.jpg");
  });
});

describe("parseDetailTitleImage — dispatcher por source", () => {
  test("source desconocido → null", () => {
    expect(parseDetailTitleImage("unknown", {})).toBeNull();
  });

  test("despacha amazon/aliexpress/walmart/shein a su parser", () => {
    expect(parseDetailTitleImage("amazon", amazonFx)?.title).toContain("Levi's");
    expect(parseDetailTitleImage("aliexpress", aliexpressFx)?.title).toContain("HME");
    expect(parseDetailTitleImage("walmart", walmartFx)?.title).toContain("Wrangler");
    expect(parseDetailTitleImage("shein", sheinFx)?.title).toContain("SHEIN");
  });
});
