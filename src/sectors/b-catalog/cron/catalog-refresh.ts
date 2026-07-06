// src/sectors/b-catalog/cron/catalog-refresh.ts — cron diario budget-aware (T6).
// Refresca el catálogo con las búsquedas REALES de la gente (top raw_query de
// searches) por cada fuente Apify habilitada. A diferencia del catalog-fill viejo,
// chequea el breaker de presupuesto ANTES de cada llamada y corta limpio si excede.
// El/los provider(s) entran INYECTADOS: los tests pasan un fake, el script los reales.
import type { Client } from "pg";
import type { AggregatorProvider } from "@/sectors/b-catalog/provider";
import type { MockCategory, MockProduct } from "@/sectors/b-catalog/mock/types";
import { processProduct } from "@/sectors/b-catalog/enrichment/pipeline";
import { queryFromOpts } from "@/sectors/b-catalog/apify/sources/shared";
import {
  fetchSpentLast24h,
  budgetExceeded,
  AGGREGATOR_DAILY_BUDGET_CENTS,
} from "@/sectors/c-search/decide/budget";

// Orden fijo de rotación de categorías cuando faltan búsquedas reales para llenar n.
const CATEGORIES: MockCategory[] = [
  "ropa",
  "electronica",
  "hogar",
  "juguetes_bebe",
  "belleza",
  "otros",
];

export interface RefreshOptions {
  queries?: number; // cuántas queries correr (default 5)
  limit?: number; // items por llamada al provider (default 10)
  concurrency?: number; // chunks de processProduct (default 3)
  budgetCents?: number; // override del breaker (default AGGREGATOR_DAILY_BUDGET_CENTS)
}

export interface RefreshSummary {
  queries: string[];
  sources: string[];
  calls: number;
  products_processed: number;
  products_failed: number;
  spent_today_cents: number;
  skipped_by_budget: boolean;
  errors: { context: string; message: string }[];
}

/**
 * Top `raw_query` de searches en los últimos 7 días (excluye vacías/espacios).
 * Si hay menos de n, completa con el mapa fijo categoría→query (rotando el orden
 * de CATEGORIES), sin duplicar una query ya presente.
 * ponytail: la rotación son 6 categorías; si n > 6 + búsquedas reales devuelve
 * menos de n. Suficiente para el default (queries=5); ampliar solo si hace falta.
 */
export async function selectQueries(pg: Client, n: number): Promise<string[]> {
  const r = await pg.query(
    `SELECT raw_query, count(*)::int AS c
       FROM searches
      WHERE occurred_at > now() - interval '7 days'
        AND btrim(raw_query) <> ''
      GROUP BY raw_query
      ORDER BY c DESC, raw_query
      LIMIT $1`,
    [n],
  );
  const queries = r.rows.map((row) => row.raw_query as string);
  for (const cat of CATEGORIES) {
    if (queries.length >= n) break;
    const q = queryFromOpts({ category: cat });
    if (!queries.includes(q)) queries.push(q);
  }
  return queries.slice(0, n);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function dedupe(products: MockProduct[]): MockProduct[] {
  const seen = new Set<string>();
  return products.filter((p) => {
    const key = `${p.source}:${p.source_product_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function runCatalogRefresh(
  pg: Client,
  providers: AggregatorProvider[],
  opts: RefreshOptions = {},
): Promise<RefreshSummary> {
  const nQueries = opts.queries ?? 5;
  const limit = opts.limit ?? 10;
  const concurrency = opts.concurrency ?? 3;
  const budget = opts.budgetCents ?? AGGREGATOR_DAILY_BUDGET_CENTS;

  const queries = await selectQueries(pg, nQueries);
  const summary: RefreshSummary = {
    queries,
    sources: providers.map((p) => p.name),
    calls: 0,
    products_processed: 0,
    products_failed: 0,
    spent_today_cents: 0,
    skipped_by_budget: false,
    errors: [],
  };

  outer: for (const query of queries) {
    for (const provider of providers) {
      // Breaker: chequear gasto real ANTES de cada llamada; si excede, corta TODO.
      const spent = await fetchSpentLast24h(pg);
      if (budgetExceeded(spent, budget)) {
        summary.skipped_by_budget = true;
        break outer;
      }

      const t0 = Date.now();
      let result;
      try {
        result = await provider.fetch({ query, limit });
      } catch (e) {
        // ponytail: piso 1¢ — el costo real de un run fallido es inconocible sin propagarlo desde client.ts (el throw lo descarta); si el gasto en errores importa, propagar usageTotalUsd en el error.
        await pg.query(
          `INSERT INTO mock_calls (params, response_size, simulated_cost_cents, latency_ms, was_error)
           VALUES ($1::jsonb, 0, 1, $2, true)`,
          [JSON.stringify({ source: "catalog_refresh", provider: provider.name, query }), Date.now() - t0],
        );
        summary.calls++;
        summary.errors.push({ context: `fetch ${provider.name} "${query}"`, message: String(e) });
        continue;
      }

      await pg.query(
        `INSERT INTO mock_calls (params, response_size, simulated_cost_cents, latency_ms, was_error)
         VALUES ($1::jsonb, $2, $3, $4, false)`,
        [
          JSON.stringify({ source: "catalog_refresh", provider: provider.name, query }),
          result.products.length,
          result.cost_cents,
          Math.round(result.latency_ms),
        ],
      );
      summary.calls++;

      for (const batch of chunk(dedupe(result.products), concurrency)) {
        const settled = await Promise.allSettled(batch.map((p) => processProduct(p, pg)));
        settled.forEach((s, i) => {
          if (s.status === "fulfilled") summary.products_processed++;
          else {
            summary.products_failed++;
            summary.errors.push({ context: `process ${batch[i].source_product_id}`, message: String(s.reason) });
          }
        });
      }
    }
  }

  summary.spent_today_cents = await fetchSpentLast24h(pg);
  return summary;
}
