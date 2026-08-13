// src/sectors/b-catalog/provider.ts — seam de proveedores externos (F4.1).
// Registry por env: el mock es el default e infra de tests; los 3 apify llegaron
// con proveedores reales. El swap ocurre AQUÍ (AGGREGATOR_PROVIDER), no en los call-sites.
import { fetchFromAggregator, type FetchOptions, type FetchResult } from "./mock/aggregator";
import { makeApifyProvider } from "./apify/provider";
import { withFallback } from "./fallback";
import { makeMultiProvider } from "./multi";
import * as amazonRtd from "./rapidapi/sources/amazon-rtd";
import * as aliexpressDatahub from "./rapidapi/sources/aliexpress-datahub";
import * as axessoAmazon from "./rapidapi/sources/axesso-amazon";
import * as walmartAxesso from "./rapidapi/sources/walmart-axesso";
import * as sheinPinto from "./rapidapi/sources/shein-pinto";
import * as sheinOtapi from "./rapidapi/sources/shein-otapi";

export interface AggregatorProvider {
  name: string;
  fetch(opts: FetchOptions): Promise<FetchResult>;
}

const mock: AggregatorProvider = { name: "mock", fetch: fetchFromAggregator };

// makeApifyProvider no toca la red ni el APIFY_TOKEN hasta que se llame a fetch,
// así que construir el registry con env sin setear es inocuo (suite entera verde).
// Lo mismo aplica a los providers RapidAPI: RAPIDAPI_KEY solo se lee dentro de
// rapidApiGet, al momento de fetch().
const apifyAmazon = makeApifyProvider("amazon");
const apifyAliexpress = makeApifyProvider("aliexpress");
const rapidapiAmazon: AggregatorProvider = { name: amazonRtd.PROVIDER_NAME, fetch: amazonRtd.fetchProducts };
const rapidapiAliexpress: AggregatorProvider = {
  name: aliexpressDatahub.PROVIDER_NAME,
  fetch: aliexpressDatahub.fetchProducts,
};
const rapidapiAxessoAmazon: AggregatorProvider = {
  name: axessoAmazon.PROVIDER_NAME,
  fetch: axessoAmazon.fetchProducts,
};
const rapidapiWalmart: AggregatorProvider = {
  name: walmartAxesso.PROVIDER_NAME,
  fetch: walmartAxesso.fetchProducts,
};
const rapidapiSheinPinto: AggregatorProvider = {
  name: sheinPinto.PROVIDER_NAME,
  fetch: sheinPinto.fetchProducts,
};
const rapidapiSheinOtapi: AggregatorProvider = {
  name: sheinOtapi.PROVIDER_NAME,
  fetch: sheinOtapi.fetchProducts,
};
const apifyShein = makeApifyProvider("shein");
const apifyTemu = makeApifyProvider("temu");

const PROVIDERS: Record<string, AggregatorProvider> = {
  mock,
  "apify-amazon": apifyAmazon,
  "apify-aliexpress": apifyAliexpress,
  "apify-shein": apifyShein,
  "rapidapi-amazon": rapidapiAmazon,
  "rapidapi-aliexpress": rapidapiAliexpress,
  "rapidapi-axesso-amazon": rapidapiAxessoAmazon,
  "rapidapi-axesso-walmart": rapidapiWalmart,
  "rapidapi-shein-pinto": rapidapiSheinPinto,
  "rapidapi-otapi-shein": rapidapiSheinOtapi,
  // Producción: apify primero (más rico en atributos), RapidAPI como red de
  // seguridad si el actor de Apify falla o no trae nada.
  "amazon-prod": withFallback(apifyAmazon, rapidapiAmazon),
  "aliexpress-prod": withFallback(apifyAliexpress, rapidapiAliexpress),
  // No hay actor Apify de walmart todavía — sin fallback por ahora.
  "walmart-prod": rapidapiWalmart,
  // apify (pay-per-event, más rico) → otapi (fallback intermedio) → pinto
  // (última instancia, 10 req/mes — ver comentario de cuota en shein-pinto.ts).
  "shein-prod": withFallback(apifyShein, withFallback(rapidapiSheinOtapi, rapidapiSheinPinto)),
  // Temu: SOLO Apify (amit123). El RapidAPI de Temu tiene 5 búsquedas/MES —
  // cuota sagrada de verificación manual, JAMÁS cablearlo como fallback.
  "apify-temu": apifyTemu,
  "temu-prod": apifyTemu,
};

// "multi": fan-out sobre otras entradas del registry por nombre — se construye
// DESPUÉS del objeto base (no dentro del literal) porque necesita mirar sus
// propias entradas ya resueltas. Default amazon-prod+aliexpress-prod (cadenas
// con fallback, no los providers crudos).
const DEFAULT_MULTI_SOURCES = "amazon-prod,aliexpress-prod";
const multiSourceNames = (process.env.MULTI_PROVIDER_SOURCES ?? DEFAULT_MULTI_SOURCES)
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
const multiSources = multiSourceNames
  .filter((n) => {
    if (PROVIDERS[n]) return true;
    console.warn(`MULTI_PROVIDER_SOURCES: fuente '${n}' no reconocida — omitida`);
    return false;
  })
  // Conservar la CLAVE del registry como name: el ruteo por categoría
  // (CATEGORY_PROVIDER_MAP) filtra por estos nombres — con los names internos
  // ('apify-amazon+fb:…') nunca matcheaba y toda ingesta pagaba las 4 fuentes.
  .map((n) => ({ ...PROVIDERS[n], name: n }));

if (multiSources.length > 0) {
  PROVIDERS.multi = makeMultiProvider(multiSources);
} else {
  console.warn("MULTI_PROVIDER_SOURCES sin fuentes válidas tras filtrar — 'multi' cae a mock");
  PROVIDERS.multi = mock;
}

const envProvider = process.env.AGGREGATOR_PROVIDER;
if (envProvider && !PROVIDERS[envProvider]) {
  console.warn(`AGGREGATOR_PROVIDER '${envProvider}' no reconocido — usando mock`);
}
// En producción el mock jamás entra por accidente: un deploy sin la env (o con
// typo) inventaría catálogo con LLM en silencio. Opt-in explícito o nada.
if (process.env.NODE_ENV === "production" && (!envProvider || !PROVIDERS[envProvider]) && envProvider !== "mock") {
  throw new Error("AGGREGATOR_PROVIDER inválido o ausente en producción (usa 'mock' explícito si lo quieres)");
}

export const activeProvider: AggregatorProvider =
  (envProvider && PROVIDERS[envProvider]) || mock;
