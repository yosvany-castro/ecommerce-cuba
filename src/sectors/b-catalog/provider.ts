// src/sectors/b-catalog/provider.ts — seam de proveedores externos (F4.1).
// Registry por env: el mock es el default e infra de tests; los 3 apify llegaron
// con proveedores reales. El swap ocurre AQUÍ (AGGREGATOR_PROVIDER), no en los call-sites.
import { fetchFromAggregator, type FetchOptions, type FetchResult } from "./mock/aggregator";
import { makeApifyProvider } from "./apify/provider";

export interface AggregatorProvider {
  name: string;
  fetch(opts: FetchOptions): Promise<FetchResult>;
}

const mock: AggregatorProvider = { name: "mock", fetch: fetchFromAggregator };

// makeApifyProvider no toca la red ni el APIFY_TOKEN hasta que se llame a fetch,
// así que construir el registry con env sin setear es inocuo (suite entera verde).
const PROVIDERS: Record<string, AggregatorProvider> = {
  mock,
  "apify-amazon": makeApifyProvider("amazon"),
  "apify-aliexpress": makeApifyProvider("aliexpress"),
  "apify-shein": makeApifyProvider("shein"),
};

export const activeProvider: AggregatorProvider =
  PROVIDERS[process.env.AGGREGATOR_PROVIDER ?? "mock"] ?? mock;
