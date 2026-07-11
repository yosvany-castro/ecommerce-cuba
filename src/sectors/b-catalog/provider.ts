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

const PROVIDERS: Record<string, AggregatorProvider> = {
  mock,
  "apify-amazon": apifyAmazon,
  "apify-aliexpress": apifyAliexpress,
  "apify-shein": makeApifyProvider("shein"),
  "rapidapi-amazon": rapidapiAmazon,
  "rapidapi-aliexpress": rapidapiAliexpress,
  "rapidapi-axesso-amazon": rapidapiAxessoAmazon,
  // Producción: apify primero (más rico en atributos), RapidAPI como red de
  // seguridad si el actor de Apify falla o no trae nada.
  "amazon-prod": withFallback(apifyAmazon, rapidapiAmazon),
  "aliexpress-prod": withFallback(apifyAliexpress, rapidapiAliexpress),
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
  .map((n) => PROVIDERS[n]);

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

export const activeProvider: AggregatorProvider =
  (envProvider && PROVIDERS[envProvider]) || mock;
