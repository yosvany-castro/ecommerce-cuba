#!/usr/bin/env tsx
/**
 * Cron: materialize 7-day product popularity (every 10-15 min).
 * Replaces per-request 7-day aggregations in fetchPopularGlobal /
 * fetchEventCounts7d / views-categories (they fall back to live aggregation
 * while this has never run).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { withPgDirect } from "@/lib/db/helpers";
import { recomputePopularity7d } from "@/sectors/d-personalization/popularity/recompute";

async function main() {
  const { products } = await withPgDirect((pg) => recomputePopularity7d(pg));
  console.log(`[cron-popularity-7d] materialized ${products} products`);
}

main().catch((e) => {
  console.error("[cron-popularity-7d] failed:", e);
  process.exit(1);
});
