import { describe, test, expect } from "vitest";
import * as walmartAxesso from "@/sectors/b-catalog/rapidapi/sources/walmart-axesso";
import * as sheinPinto from "@/sectors/b-catalog/rapidapi/sources/shein-pinto";
import * as sheinOtapi from "@/sectors/b-catalog/rapidapi/sources/shein-otapi";
// Fixtures reales capturados: endurecen los mappers con las formas de verdad.
import walmartFx from "../fixtures/rapidapi/walmart-axesso-search.json";
import sheinPintoFx from "../fixtures/rapidapi/shein-pinto-search.json";
import sheinOtapiFx from "../fixtures/rapidapi/shein-otapi-search.json";

describe("walmart-axesso.mapItem + parseSearchResponse — fixture real (itemStacks[0].items[])", () => {
  const items =
    walmartFx.item.props.pageProps.initialData.searchResult.itemStacks[0].items;

  test("responseStatus PRODUCT_FOUND_RESPONSE: mapea todos los items del fixture", () => {
    expect(walmartFx.responseStatus).toBe("PRODUCT_FOUND_RESPONSE");
    const mapped = walmartAxesso.parseSearchResponse(walmartFx);
    expect(mapped.length).toBe(items.length);
  });

  test("caso responseStatus de error/sin resultados → lista vacía, sin throw", () => {
    const errFx = { ...walmartFx, responseStatus: "ITEM_NOT_FOUND_RESPONSE" };
    expect(walmartAxesso.parseSearchResponse(errFx)).toEqual([]);
  });

  test("item 0: título, price_cents exacto (linePrice), url absoluta, imagen https, source, brand, rating", () => {
    const p = walmartAxesso.mapItem(items[0])!;
    expect(p.source).toBe("walmart");
    expect(p.source_product_id).toBe("388037456");
    expect(p.title).toBe("Men's and Big Men's Relaxed Fit Jeans with Flex");
    expect(p.price_cents).toBe(2098); // "$20.98"
    expect(p.image_url).toBe(
      "https://i5.walmartimages.com/seo/Wrangler-Men-s-and-Big-Men-s-Relaxed-Fit-Jeans-with-Flex_defc5d5c-2739-428b-ab3b-cfbc0b261b5f.100c6c41b42f50e8b2aa05c4c32a1fae.jpeg?odnHeight=180&odnWidth=180&odnBg=FFFFFF",
    );
    expect(p.image_url.startsWith("https://")).toBe(true);
    expect(p.url).toBe(
      "https://www.walmart.com/ip/Wrangler-Men-s-and-Big-Men-s-Relaxed-Fit-Jeans-with-Flex/388037456?classType=VARIANT&athbdg=L1600",
    );
    expect(p.url!.startsWith("https://")).toBe(true);
    expect(p.brand).toBe("Wrangler");
    expect(p.raw_category).toBe("Clothing");
    expect(p.attributes.rating).toBe(4.6);
  });

  test("sin canonicalUrl → construye /ip/{usItemId}", () => {
    const p = walmartAxesso.mapItem({
      usItemId: "999",
      name: "Sin url",
      priceInfo: { linePrice: "$9.99" },
    })!;
    expect(p.url).toBe("https://www.walmart.com/ip/999");
  });

  test("garbage (sin usItemId) → null", () => {
    expect(walmartAxesso.mapItem({ name: "x", priceInfo: { linePrice: "$1.00" } })).toBeNull();
  });
  test("garbage (sin precio en linePrice ni itemPrice) → null", () => {
    expect(walmartAxesso.mapItem({ usItemId: "1", name: "x", priceInfo: {} })).toBeNull();
  });
});

describe("shein-pinto.mapItem + parseSearchResponse — fixture real (products[])", () => {
  test("mapea todos los items del fixture", () => {
    const mapped = sheinPinto.parseSearchResponse(sheinPintoFx);
    expect(mapped.length).toBe(sheinPintoFx.products.length);
  });

  test("caso sin array products (error/cuota agotada) → lista vacía, sin throw", () => {
    expect(sheinPinto.parseSearchResponse({ error: "quota exceeded" })).toEqual([]);
    expect(sheinPinto.parseSearchResponse(null)).toEqual([]);
  });

  test("item 0: título, price_cents exacto (salePrice.usdAmount), url shein.com, imagen https, source, rating", () => {
    const raw = sheinPintoFx.products[0];
    const p = sheinPinto.mapItem(raw)!;
    expect(p.source).toBe("shein");
    expect(p.source_product_id).toBe("439485118");
    expect(p.title).toBe(raw.goods_name);
    expect(p.price_cents).toBe(1579); // salePrice.usdAmount "15.79"
    expect(p.image_url).toBe(`https:${raw.goods_img}`);
    expect(p.image_url.startsWith("https://")).toBe(true);
    expect(p.url).toBe(`https://us.shein.com/${raw.goods_url_name}-p-439485118.html`);
    expect(p.url!.startsWith("https://")).toBe(true);
    expect(p.raw_category).toBe("Women Sweater Dresses");
    expect(p.attributes.rating).toBe(4.8);
  });

  test("sin goods_url_name → url null", () => {
    const p = sheinPinto.mapItem({
      goods_id: "1",
      goods_name: "Sin url",
      salePrice: { usdAmount: "5.00" },
    })!;
    expect(p.url).toBeNull();
  });

  test("garbage (sin id ni precio) → null", () => {
    expect(sheinPinto.mapItem({ goods_name: "no id no price" })).toBeNull();
  });
});

describe("shein-otapi.mapItem + parseSearchResponse — fixture real (Result.Items.Items.Content[])", () => {
  const content = sheinOtapiFx.Result.Items.Items.Content;

  test("ErrorCode Ok: mapea todos los items del fixture", () => {
    expect(sheinOtapiFx.ErrorCode).toBe("Ok");
    const mapped = sheinOtapi.parseSearchResponse(sheinOtapiFx);
    expect(mapped.length).toBe(content.length);
  });

  test("caso ErrorCode de fallo (no Ok, no vacío) → lista vacía, sin throw", () => {
    const errFx = { ...sheinOtapiFx, ErrorCode: "Fail" };
    expect(sheinOtapi.parseSearchResponse(errFx)).toEqual([]);
  });

  test("item 0: id sin prefijo sh-, título, price_cents exacto, url/imagen absolutas https, source, brand", () => {
    const p = sheinOtapi.mapItem(content[0])!;
    expect(p.source).toBe("shein");
    expect(p.source_product_id).toBe("64037112");
    expect(p.title).toBe(content[0].Title);
    expect(p.price_cents).toBe(1300); // Price.ConvertedPriceList.Internal.Price 13.0
    expect(p.image_url).toBe(content[0].MainPictureUrl);
    expect(p.image_url.startsWith("https://")).toBe(true);
    expect(p.url).toBe(content[0].ExternalItemUrl);
    expect(p.url!.startsWith("https://")).toBe(true);
    expect(p.brand).toBe("SHEIN");
  });

  test("garbage (sin Id) → null", () => {
    expect(
      sheinOtapi.mapItem({ Title: "x", Price: { ConvertedPriceList: { Internal: { Price: 5 } } } }),
    ).toBeNull();
  });
  test("garbage (sin precio) → null", () => {
    expect(sheinOtapi.mapItem({ Id: "sh-1", Title: "x" })).toBeNull();
  });
});
