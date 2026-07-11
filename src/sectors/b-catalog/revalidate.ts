// src/sectors/b-catalog/revalidate.ts — re-validación de precio/stock en el
// checkout. Contexto de negocio: el dueño REVENDE — el cliente paga acá y el
// dueño compra después en el marketplace origen (amazon/aliexpress/shein/
// walmart). Si el precio guardado quedó viejo, el dueño compra más caro de lo
// cobrado y pierde dinero en cada venta. Este módulo re-consulta el precio/
// stock vivo justo antes de confirmar, para que el pedido salga con el precio
// real (ver createCheckoutOrder / createAnonymousOrder, que leen
// products.price_cents al armar la orden — actualizar la fila ANTES de
// confirmar es lo que hace que el pedido cobre el precio vivo).
//
// FAIL-OPEN a propósito: un fallo de red/timeout/parseo del proveedor NUNCA
// bloquea el checkout. El dueño ve el producto en pantalla antes de comprarlo
// en el marketplace origen, así que un precio no confirmado es un riesgo que
// él mismo puede pescar a mano — bloquear ventas por un RapidAPI caído sería
// peor que el problema que este módulo intenta resolver.
import { asRecord, str, toNumber, usdToCents } from "./apify/sources/shared";
import { rapidApiGet } from "./rapidapi/client";

const DEFAULT_MAX_AGE_HOURS = 6;
const LOOKUP_TIMEOUT_MS = 8_000;

export type RevalidateStatus = "ok" | "price_changed" | "unavailable" | "unverifiable";

export interface Verdict {
  status: RevalidateStatus;
  stored_price_cents: number;
  live_price_cents?: number;
  skipped?: true;
}

export interface RevalidateProductRow {
  id: string;
  source: string;
  source_product_id: string;
  url: string | null;
  price_cents: number;
  last_refreshed_at: string | Date;
}

/** Resultado vivo, ya normalizado, de cualquiera de los 4 parsers de abajo. */
export interface DetailResult {
  price_cents: number;
  available: boolean;
}

// ---------------------------------------------------------------------------
// Parsers puros por source — testeables sin red (ver tests/unit/revalidate.test.ts).
// ---------------------------------------------------------------------------

// real-time-amazon-data (RapidAPI) — endpoint /product-details.
export function parseAmazonDetail(json: unknown): DetailResult | null {
  const data = asRecord(asRecord(json)?.data);
  if (!data) return null;
  const price = usdToCents(data.product_price);
  if (price === null) return null;

  const availRaw = str(data.product_availability);
  // OJO: vacío/ausente = disponible-desconocido, NO se bloquea el checkout por
  // un dato faltante — solo un texto explícito de "sin stock" cuenta.
  const lower = (availRaw ?? "").toLowerCase();
  const available = !availRaw || !(lower.includes("unavailable") || lower.includes("out of stock"));
  return { price_cents: price, available };
}

// aliexpress-datahub (RapidAPI) — endpoint /item_detail_2.
export function parseAliexpressDetail(json: unknown): DetailResult | null {
  const result = asRecord(asRecord(json)?.result);
  const code = toNumber(asRecord(result?.status)?.code);
  if (code !== 200) return null;

  const item = asRecord(result?.item);
  if (!item) return null;
  const def = asRecord(asRecord(item.sku)?.def);
  const price = usdToCents(def?.promotionPrice ?? def?.price);
  if (price === null) return null;

  // available !== false (no solo === true): mismo criterio fail-open que amazon
  // — un campo ausente/no-boolean no debe leerse como "sin stock".
  return { price_cents: price, available: item.available !== false };
}

// axesso-walmart-data-service (RapidAPI) — endpoint /wlm/walmart-lookup-product.
export function parseWalmartDetail(json: unknown): DetailResult | null {
  const item = asRecord(asRecord(json)?.item);
  const props = asRecord(item?.props);
  const pageProps = asRecord(props?.pageProps);
  const initialData = asRecord(pageProps?.initialData);
  const product = asRecord(asRecord(initialData?.data)?.product);
  if (!product) return null;

  const currentPrice = asRecord(asRecord(product.priceInfo)?.currentPrice);
  const price = usdToCents(currentPrice?.price);
  if (price === null) return null;

  const statusRaw = str(product.availabilityStatus);
  const available = !statusRaw || statusRaw === "IN_STOCK";
  return { price_cents: price, available };
}

// otapi-shein (RapidAPI) — endpoint /BatchGetItemFullInfo.
export function parseSheinDetail(json: unknown): DetailResult | null {
  const o = asRecord(json);
  if (o?.ErrorCode !== "Ok") return null;

  const item = asRecord(asRecord(o.Result)?.Item);
  if (!item) return null;
  const priceObj = asRecord(asRecord(asRecord(item.Price)?.ConvertedPriceList)?.Internal);
  const price = usdToCents(priceObj?.Price);
  if (price === null) return null;

  const qty = toNumber(item.MasterQuantity) ?? 0;
  return { price_cents: price, available: qty > 0 };
}

// ---------------------------------------------------------------------------
// Verdict — puro, testeable sin red: dado el precio guardado y el resultado
// (ya parseado) del lookup vivo, decide qué le pasa al checkout.
// ---------------------------------------------------------------------------
export function computeVerdict(storedPriceCents: number, detail: DetailResult | null): Verdict {
  if (!detail) return { status: "unverifiable", stored_price_cents: storedPriceCents };
  if (!detail.available) return { status: "unavailable", stored_price_cents: storedPriceCents };
  if (detail.price_cents === storedPriceCents) return { status: "ok", stored_price_cents: storedPriceCents };
  return { status: "price_changed", stored_price_cents: storedPriceCents, live_price_cents: detail.price_cents };
}

// ---------------------------------------------------------------------------
// Lookup vivo — SÍ pega a RapidAPI (rapidApiGet real). No se testea acá
// (prohibido llamar red en tests); lo cubren los parsers puros de arriba +
// computeVerdict, más el fail-open de revalidateProduct.
// ---------------------------------------------------------------------------
async function liveLookup(p: RevalidateProductRow): Promise<DetailResult | null> {
  switch (p.source) {
    case "amazon": {
      const json = await rapidApiGet(
        "real-time-amazon-data.p.rapidapi.com",
        "/product-details",
        { asin: p.source_product_id, country: "US" },
        LOOKUP_TIMEOUT_MS,
      );
      return parseAmazonDetail(json);
    }
    case "aliexpress": {
      const json = await rapidApiGet(
        "aliexpress-datahub.p.rapidapi.com",
        "/item_detail_2",
        { itemId: p.source_product_id },
        LOOKUP_TIMEOUT_MS,
      );
      return parseAliexpressDetail(json);
    }
    case "walmart": {
      if (!p.url) return null; // sin url no hay cómo re-consultar walmart (lookup es por url, no por id)
      const json = await rapidApiGet(
        "axesso-walmart-data-service.p.rapidapi.com",
        "/wlm/walmart-lookup-product",
        { url: p.url },
        LOOKUP_TIMEOUT_MS,
      );
      return parseWalmartDetail(json);
    }
    case "shein": {
      // El mapper de búsqueda (rapidapi/sources/shein-otapi.ts) le QUITA el
      // prefijo "sh-" al id para quedarse con el id numérico real. El endpoint
      // de detalle lo exige de vuelta, así que acá se re-antepone.
      const json = await rapidApiGet(
        "otapi-shein.p.rapidapi.com",
        "/BatchGetItemFullInfo",
        { language: "en", itemId: `sh-${p.source_product_id}` },
        LOOKUP_TIMEOUT_MS,
      );
      return parseSheinDetail(json);
    }
    default:
      return null; // source desconocido → unverifiable (nunca throw)
  }
}

function maxAgeHours(): number {
  const raw = Number(process.env.REVALIDATE_MAX_AGE_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_AGE_HOURS;
}

/**
 * Orquestador: frescura → lookup vivo (fail-open) → verdict.
 * Nunca rechaza — un fallo cualquiera cae a {status:"unverifiable"}.
 */
export async function revalidateProduct(p: RevalidateProductRow): Promise<Verdict> {
  const ageMs = Date.now() - new Date(p.last_refreshed_at).getTime();
  if (ageMs < maxAgeHours() * 3_600_000) {
    // Fresco: no gastamos cuota RapidAPI re-consultando algo que ya vimos hace poco.
    return { status: "ok", stored_price_cents: p.price_cents, skipped: true };
  }

  let detail: DetailResult | null;
  try {
    detail = await liveLookup(p);
  } catch {
    detail = null; // red/timeout/HTTP!=200/parse-fail — ver nota FAIL-OPEN arriba
  }
  return computeVerdict(p.price_cents, detail);
}
