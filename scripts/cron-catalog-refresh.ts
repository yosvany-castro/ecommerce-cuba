#!/usr/bin/env tsx
/**
 * CLI: pnpm cron:catalog-refresh --limit 10 --queries 5
 * Fuentes vía env APIFY_CRON_SOURCES (csv, default "amazon").
 * Corre las búsquedas REALES de la gente contra cada fuente Apify, budget-aware.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { parseArgs } from "node:util";
import { runCatalogRefresh } from "@/sectors/b-catalog/cron/catalog-refresh";
import { makeApifyProvider, type ApifySource } from "@/sectors/b-catalog/apify/provider";
import { withPgDirect } from "@/lib/db/helpers";

const ALL_SOURCES: ApifySource[] = ["amazon", "aliexpress", "shein"];

const { values } = parseArgs({
  options: {
    limit: { type: "string", default: "10" },
    queries: { type: "string", default: "5" },
  },
});

const requested = (process.env.APIFY_CRON_SOURCES ?? "amazon")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
const validSources = requested.filter((s): s is ApifySource => ALL_SOURCES.includes(s as ApifySource));
if (validSources.length !== requested.length) {
  console.warn("Unknown source in APIFY_CRON_SOURCES, filtering:", requested);
  console.warn("Allowed:", ALL_SOURCES.join(", "));
}
const sources = [...new Set(validSources)]; // dedupe in case csv has duplicates

async function main() {
  const providers = sources.map((s) => makeApifyProvider(s));
  const summary = await withPgDirect((pg) =>
    runCatalogRefresh(pg, providers, {
      limit: parseInt(values.limit!, 10),
      queries: parseInt(values.queries!, 10),
    }),
  );

  console.log(JSON.stringify(summary, null, 2));
  console.log(
    "\n# crontab sugerido (diario 6am):\n" +
      "0 6 * * * cd /home/yosvany/ecommerce-cuba && pnpm cron:catalog-refresh >> logs/catalog-refresh.log 2>&1",
  );
  process.exit(summary.errors.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
