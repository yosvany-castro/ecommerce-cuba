import type { Client } from "pg";
import { activeProvider } from "@/sectors/b-catalog/provider";
import type { MockCategory } from "@/sectors/b-catalog/mock/types";
import { processProduct } from "@/sectors/b-catalog/enrichment/pipeline";
import {
  fetchSpentLast24h,
  budgetExceeded,
  AGGREGATOR_DAILY_BUDGET_CENTS,
} from "@/sectors/c-search/decide/budget";

export interface RunResult {
  totalCalls: number;
  totalProducts: number;
  errors: { context: string; message: string }[];
  skippedByBudget: boolean;
}

export interface RunOptions {
  categories: MockCategory[];
  pagesPerCategory: number;
  concurrency?: number;
  pg: Client;
  /** Override number of products per aggregator call. Default: 25. Use 2 in tests to minimize LLM cost. */
  productsPerCallOverride?: number;
  budgetCents?: number; // override del breaker (default AGGREGATOR_DAILY_BUDGET_CENTS)
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function runCatalogFill(opts: RunOptions): Promise<RunResult> {
  const concurrency = opts.concurrency ?? 3;
  const budget = opts.budgetCents ?? AGGREGATOR_DAILY_BUDGET_CENTS;
  const errors: RunResult["errors"] = [];
  let totalCalls = 0;
  let totalProducts = 0;
  let skippedByBudget = false;

  outer: for (const category of opts.categories) {
    for (let page = 1; page <= opts.pagesPerCategory; page++) {
      // Breaker: mismo guard que catalog-refresh.ts (item 1.4b roadmap) —
      // chequear gasto real ANTES de cada llamada; si excede, corta TODO. Este
      // cron es legacy y corre a mano (pnpm cron:catalog-fill), sin freno
      // propio hasta ahora.
      const spent = await fetchSpentLast24h(opts.pg);
      if (budgetExceeded(spent, budget)) {
        skippedByBudget = true;
        break outer;
      }

      const t0 = Date.now();
      let result;
      try {
        result = await activeProvider.fetch({ category, limit: opts.productsPerCallOverride });
      } catch (e) {
        await opts.pg.query(
          `INSERT INTO mock_calls (params, response_size, simulated_cost_cents, latency_ms, was_error)
           VALUES ($1::jsonb, 0, 4, $2, true)`,
          [JSON.stringify({ category, page }), Date.now() - t0],
        );
        totalCalls++;
        errors.push({ context: `fetch ${category} page ${page}`, message: String(e) });
        continue;
      }

      await opts.pg.query(
        `INSERT INTO mock_calls (params, response_size, simulated_cost_cents, latency_ms, was_error)
         VALUES ($1::jsonb, $2, $3, $4, false)`,
        [
          JSON.stringify({ category, page }),
          result.products.length,
          result.cost_cents,
          Math.round(result.latency_ms),
        ],
      );
      totalCalls++;

      // Deduplicate within the fetched page: the mock samples with replacement,
      // so the same product can appear multiple times in one call result.
      const seen = new Set<string>();
      const unique = result.products.filter((p) => {
        const key = `${p.source}:${p.source_product_id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      for (const batch of chunk(unique, concurrency)) {
        const settled = await Promise.allSettled(batch.map((p) => processProduct(p, opts.pg)));
        settled.forEach((s, i) => {
          if (s.status === "fulfilled") totalProducts++;
          else errors.push({ context: `process ${batch[i].source_product_id}`, message: String(s.reason) });
        });
      }
    }
  }

  return { totalCalls, totalProducts, errors, skippedByBudget };
}
