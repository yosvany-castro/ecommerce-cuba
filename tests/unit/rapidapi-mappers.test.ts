import { describe, test, expect } from "vitest";
import * as amazonRtd from "@/sectors/b-catalog/rapidapi/sources/amazon-rtd";
import * as aliexpressDatahub from "@/sectors/b-catalog/rapidapi/sources/aliexpress-datahub";
import * as axessoAmazon from "@/sectors/b-catalog/rapidapi/sources/axesso-amazon";
import type { MockProduct } from "@/sectors/b-catalog/mock/types";
// Fixtures reales capturados (T#): endurecen los mappers con las formas de verdad.
import amazonRtdFx from "../fixtures/rapidapi/amazon-rtd-search.json";
import aliexpressOkFx from "../fixtures/rapidapi/aliexpress-datahub-item-search-2.json";
import aliexpressErrFx from "../fixtures/rapidapi/aliexpress-datahub-error-205.json";
import axessoFx from "../fixtures/rapidapi/axesso-amazon-search.json";

const notNull = (p: MockProduct | null): p is MockProduct => p !== null;

describe("amazon-rtd.decodeHtmlEntities", () => {
  test("numeric hex + named entities", () => {
    expect(amazonRtd.decodeHtmlEntities("Levi&#x27;s Big &amp; Tall")).toBe("Levi's Big & Tall");
  });
  test("decimal numeric entity", () => {
    expect(amazonRtd.decodeHtmlEntities("Rock &#39;n&#39; Roll")).toBe("Rock 'n' Roll");
  });
  test("no entities → passthrough", () => {
    expect(amazonRtd.decodeHtmlEntities("Plain title")).toBe("Plain title");
  });
});

describe("amazon-rtd.mapItem — fixture real (data.products[])", () => {
  const products = amazonRtdFx.data.products;
  const mapped = products.map((p) => amazonRtd.mapItem(p)).filter(notNull);

  test("mapea todos los items del fixture", () => {
    expect(mapped.length).toBe(products.length);
  });

  test("item 0: título decodificado, price_cents exacto, url/imagen/id/old_price", () => {
    const p = amazonRtd.mapItem(products[0])!;
    expect(p.source).toBe("amazon");
    expect(p.source_product_id).toBe("B0018QS5HU");
    expect(p.title).toBe("Levi's Men's 505 Regular Fit Jeans (Also Available in Big & Tall)");
    expect(p.price_cents).toBe(3642); // "$36.42"
    expect(p.attributes.old_price_cents).toBe(7495); // "$74.95" > price
    expect(p.image_url).toBe("https://m.media-amazon.com/images/I/51XquqDhOgL._AC_UL960_QL65_.jpg");
    expect(p.url).toBe("https://www.amazon.com/dp/B0018QS5HU");
    expect(p.url!.startsWith("https://")).toBe(true);
    expect(p.attributes.rating).toBe(4.5);
  });

  test("item 1: product_original_price null → sin old_price_cents", () => {
    const p = amazonRtd.mapItem(products[1])!;
    expect(p.price_cents).toBe(1498); // "$14.98"
    expect(p.attributes.old_price_cents).toBeUndefined();
  });

  test("sin product_url → construye dp/{asin}", () => {
    const p = amazonRtd.mapItem({
      asin: "B0NOURL",
      product_title: "No url field",
      product_price: "$9.99",
    })!;
    expect(p.url).toBe("https://www.amazon.com/dp/B0NOURL");
  });

  test("garbage (sin precio) → null", () => {
    expect(amazonRtd.mapItem({ asin: "B0X", product_title: "x" })).toBeNull();
  });
  test("garbage (sin asin) → null", () => {
    expect(amazonRtd.mapItem({ product_title: "x", product_price: "$1.00" })).toBeNull();
  });
});

describe("aliexpress-datahub.mapItem + parseSearchResponse", () => {
  test("caso error 205 (item_search v1 roto): lista vacía, sin throw", () => {
    expect(aliexpressDatahub.parseSearchResponse(aliexpressErrFx)).toEqual([]);
  });

  test("caso item_search_2 code 200: mapea los 3 items del fixture", () => {
    const mapped = aliexpressDatahub.parseSearchResponse(aliexpressOkFx);
    expect(mapped.length).toBe(aliexpressOkFx.result.resultList.length);
    for (const p of mapped) {
      expect(p.source).toBe("aliexpress");
      expect(Number.isInteger(p.price_cents)).toBe(true);
      expect(p.price_cents).toBeGreaterThan(0);
      expect(p.url).not.toBeNull();
      expect(p.url!.startsWith("https://")).toBe(true);
      expect(p.image_url.startsWith("https://")).toBe(true);
    }
  });

  test("item 0: id/precio (promotionPrice)/url y image https (protocol-relative → https)", () => {
    const raw = aliexpressOkFx.result.resultList[0].item;
    const p = aliexpressDatahub.mapItem(raw)!;
    expect(p.source_product_id).toBe("3256812460504572");
    expect(p.price_cents).toBe(1077); // sku.def.promotionPrice 10.77 (price es null)
    expect(p.url).toBe("https://www.aliexpress.com/item/3256812460504572.html");
    expect(p.image_url).toBe("https://ae-pic-a1.aliexpress-media.com/kf/Seaeae057665745519815ee06dd849619a.jpg");
  });

  test("sin itemUrl → url null", () => {
    const p = aliexpressDatahub.mapItem({
      itemId: "999",
      title: "Sin url",
      sku: { def: { promotionPrice: 5 } },
    })!;
    expect(p.url).toBeNull();
  });

  test("garbage (sin id ni precio) → null", () => {
    expect(aliexpressDatahub.mapItem({ title: "no id no price" })).toBeNull();
  });
});

describe("axesso-amazon.mapItem — fixture real (searchProductDetails[])", () => {
  const items = axessoFx.searchProductDetails;
  const mapped = items.map((it) => axessoAmazon.mapItem(it)).filter(notNull);

  test("responseStatus PRODUCT_FOUND_RESPONSE + mapea todos los items", () => {
    expect(axessoFx.responseStatus).toBe("PRODUCT_FOUND_RESPONSE");
    expect(mapped.length).toBe(items.length);
  });

  test("item 0: precio numérico → cents, url dp/{asin} (ignora dpUrl con tracking)", () => {
    const p = axessoAmazon.mapItem(items[0])!;
    expect(p.source).toBe("amazon");
    expect(p.source_product_id).toBe("B0018QS5HU");
    expect(p.title).toBe("Men's 505 Regular Fit Jeans (Also Available in Big & Tall)");
    expect(p.price_cents).toBe(3642); // price: 36.42
    expect(p.attributes.old_price_cents).toBe(7495); // retailPrice: 74.95
    expect(p.image_url).toBe("https://m.media-amazon.com/images/I/51XquqDhOgL._AC_UL320_.jpg");
    expect(p.url).toBe("https://www.amazon.com/dp/B0018QS5HU");
    expect(p.brand).toBe("Levi's"); // manufacturer
  });

  test("item 1: retailPrice 0.0 → sin old_price_cents (0 no es un precio válido)", () => {
    const p = axessoAmazon.mapItem(items[1])!;
    expect(p.attributes.old_price_cents).toBeUndefined();
  });

  test("productRating con texto ('4.5 out of 5 stars') → 4.5", () => {
    const p = axessoAmazon.mapItem(items[0])!;
    expect(p.attributes.rating).toBe(4.5);
  });

  test("garbage (sin asin) → null", () => {
    expect(axessoAmazon.mapItem({ productDescription: "x", price: 5 })).toBeNull();
  });
  test("garbage (sin precio) → null", () => {
    expect(axessoAmazon.mapItem({ asin: "B0X", productDescription: "x" })).toBeNull();
  });
});
