import type { AggregatorProvider } from "../provider";
import type { FetchOptions, FetchResult } from "../mock/aggregator";
import type { MockProduct } from "../mock/types";
import { runActorGetItems } from "./client";
import * as amazon from "./sources/amazon";
import * as aliexpress from "./sources/aliexpress";
import * as shein from "./sources/shein";

export type ApifySource = "amazon" | "aliexpress" | "shein";

const SOURCES = { amazon, aliexpress, shein };

export function makeApifyProvider(source: ApifySource): AggregatorProvider {
  const mod = SOURCES[source];
  return {
    name: `apify-${source}`,
    async fetch(opts: FetchOptions): Promise<FetchResult> {
      const { items, costCents, latencyMs } = await runActorGetItems(
        mod.ACTOR_SLUG,
        mod.buildInput(opts),
        {
          limitItems: opts.limit ?? 20,
          estimatePerItemUsd: mod.PER_ITEM_USD,
          timeoutSecs: mod.TIMEOUT_SECS,
        },
      );
      const products = items
        .map((it) => mod.mapItem(it))
        .filter((p): p is MockProduct => p !== null);
      return { products, cost_cents: costCents, latency_ms: latencyMs };
    },
  };
}
