import { describe, test, expect } from "vitest";
import {
  parseAmazonDetail,
  parseAliexpressDetail,
  parseWalmartDetail,
  parseSheinDetail,
  computeVerdict,
  revalidateProduct,
  type RevalidateProductRow,
} from "@/sectors/b-catalog/revalidate";
import amazonFx from "../fixtures/rapidapi/amazon-rtd-detail.json";
import aliexpressFx from "../fixtures/rapidapi/aliexpress-datahub-detail.json";
import walmartFx from "../fixtures/rapidapi/walmart-axesso-detail.json";
import sheinFx from "../fixtures/rapidapi/shein-otapi-detail.json";

// helper de test: copia sin una clave (evita el "unused var" del rest-destructure).
function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const clone: T = { ...obj };
  delete clone[key];
  return clone;
}

describe("parseAmazonDetail (fixture real /product-details)", () => {
  test("precio exacto en cents + disponible", () => {
    const d = parseAmazonDetail(amazonFx)!;
    expect(d.price_cents).toBe(3642); // "36.42"
    expect(d.available).toBe(true); // "In Stock"
  });

  test("'Out of Stock' (case-insensitive) → no disponible", () => {
    const json = { data: { ...amazonFx.data, product_availability: "currently OUT OF STOCK" } };
    expect(parseAmazonDetail(json)!.available).toBe(false);
  });

  test("'unavailable' → no disponible", () => {
    const json = { data: { ...amazonFx.data, product_availability: "Unavailable" } };
    expect(parseAmazonDetail(json)!.available).toBe(false);
  });

  test("availability vacía/ausente → disponible-desconocido (no bloquea por dato faltante)", () => {
    const json = { data: { ...amazonFx.data, product_availability: "" } };
    expect(parseAmazonDetail(json)!.available).toBe(true);
    expect(parseAmazonDetail({ data: omit(amazonFx.data, "product_availability") })!.available).toBe(true);
  });

  test("sin product_price → parse-fail (null)", () => {
    expect(parseAmazonDetail({ data: omit(amazonFx.data, "product_price") })).toBeNull();
  });
});

describe("parseAliexpressDetail (fixture real /item_detail_2)", () => {
  test("precio exacto (promotionPrice) + disponible", () => {
    const d = parseAliexpressDetail(aliexpressFx)!;
    expect(d.price_cents).toBe(1077); // sku.def.promotionPrice 10.77 (price 57.46 se ignora)
    expect(d.available).toBe(true);
  });

  test("available:false → no disponible", () => {
    const json = {
      result: { status: { code: 200 }, item: { ...aliexpressFx.result.item, available: false } },
    };
    expect(parseAliexpressDetail(json)!.available).toBe(false);
  });

  test("status.code !== 200 → parse-fail (null)", () => {
    const json = { result: { status: { code: 205 }, item: aliexpressFx.result.item } };
    expect(parseAliexpressDetail(json)).toBeNull();
  });
});

describe("parseWalmartDetail (fixture real /wlm/walmart-lookup-product)", () => {
  test("precio exacto + IN_STOCK disponible", () => {
    const d = parseWalmartDetail(walmartFx)!;
    expect(d.price_cents).toBe(2098); // 20.98
    expect(d.available).toBe(true);
  });

  test("OUT_OF_STOCK → no disponible", () => {
    const product = walmartFx.item.props.pageProps.initialData.data.product;
    const json = {
      item: { props: { pageProps: { initialData: { data: { product: { ...product, availabilityStatus: "OUT_OF_STOCK" } } } } } },
    };
    expect(parseWalmartDetail(json)!.available).toBe(false);
  });

  test("availabilityStatus ausente → disponible-desconocido", () => {
    const product = walmartFx.item.props.pageProps.initialData.data.product;
    const json = { item: { props: { pageProps: { initialData: { data: { product: omit(product, "availabilityStatus") } } } } } };
    expect(parseWalmartDetail(json)!.available).toBe(true);
  });

  test("sin producto en la cadena → parse-fail (null)", () => {
    expect(parseWalmartDetail({ item: { props: {} } })).toBeNull();
  });
});

describe("parseSheinDetail (fixture real /BatchGetItemFullInfo)", () => {
  test("precio exacto + stock (MasterQuantity>0)", () => {
    const d = parseSheinDetail(sheinFx)!;
    expect(d.price_cents).toBe(1300); // 13.0
    expect(d.available).toBe(true);
  });

  test("MasterQuantity 0 → sin stock", () => {
    const json = { ErrorCode: "Ok", Result: { Item: { ...sheinFx.Result.Item, MasterQuantity: 0 } } };
    expect(parseSheinDetail(json)!.available).toBe(false);
  });

  test("ErrorCode distinto de 'Ok' → parse-fail (null)", () => {
    expect(parseSheinDetail({ ErrorCode: "Fail", Result: sheinFx.Result })).toBeNull();
  });
});

describe("computeVerdict (puro)", () => {
  test("precio igual → ok", () => {
    expect(computeVerdict(3642, { price_cents: 3642, available: true })).toEqual({
      status: "ok",
      stored_price_cents: 3642,
    });
  });

  test("precio distinto → price_changed con live_price_cents", () => {
    expect(computeVerdict(3642, { price_cents: 4000, available: true })).toEqual({
      status: "price_changed",
      stored_price_cents: 3642,
      live_price_cents: 4000,
    });
  });

  test("sin stock → unavailable (aunque el precio coincida)", () => {
    expect(computeVerdict(3642, { price_cents: 3642, available: false })).toEqual({
      status: "unavailable",
      stored_price_cents: 3642,
    });
  });

  test("detail null (parse-fail o lookup fallido) → unverifiable", () => {
    expect(computeVerdict(3642, null)).toEqual({ status: "unverifiable", stored_price_cents: 3642 });
  });
});

describe("revalidateProduct — skip por frescura y fail-open", () => {
  const baseRow: RevalidateProductRow = {
    id: "11111111-1111-1111-1111-111111111111",
    source: "amazon",
    source_product_id: "B0018QS5HU",
    url: null,
    price_cents: 3642,
    last_refreshed_at: new Date().toISOString(),
  };

  test("last_refreshed_at reciente (< REVALIDATE_MAX_AGE_HOURS) → ok skipped, sin llamada", async () => {
    const v = await revalidateProduct(baseRow);
    expect(v).toEqual({ status: "ok", stored_price_cents: 3642, skipped: true });
  });

  test("source desconocido + estale → unverifiable (nunca throw)", async () => {
    const staleUnknown: RevalidateProductRow = {
      ...baseRow,
      source: "ebay",
      last_refreshed_at: new Date(Date.now() - 100 * 3_600_000).toISOString(),
    };
    const v = await revalidateProduct(staleUnknown);
    expect(v.status).toBe("unverifiable");
  });

  test("lookup vivo falla (sin RAPIDAPI_KEY) → unverifiable, fail-open, sin red real", async () => {
    const prevKey = process.env.RAPIDAPI_KEY;
    delete process.env.RAPIDAPI_KEY;
    try {
      const stale: RevalidateProductRow = {
        ...baseRow,
        last_refreshed_at: new Date(Date.now() - 100 * 3_600_000).toISOString(),
      };
      const v = await revalidateProduct(stale);
      expect(v).toEqual({ status: "unverifiable", stored_price_cents: 3642 });
    } finally {
      if (prevKey !== undefined) process.env.RAPIDAPI_KEY = prevKey;
    }
  });

  test("walmart estale sin url → unverifiable sin red (lookup es por url)", async () => {
    const stale: RevalidateProductRow = {
      ...baseRow,
      source: "walmart",
      url: null,
      last_refreshed_at: new Date(Date.now() - 100 * 3_600_000).toISOString(),
    };
    const v = await revalidateProduct(stale);
    expect(v).toEqual({ status: "unverifiable", stored_price_cents: 3642 });
  });
});
