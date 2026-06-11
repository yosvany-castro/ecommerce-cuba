#!/usr/bin/env tsx
/** Cron: data retention (F4) — 90d raw logs, 1d grace for expired slates. */
import { config } from "dotenv";
config({ path: ".env.local" });
import { withPgDirect } from "@/lib/db/helpers";
import { pruneOldData } from "@/sectors/d-personalization/prune";

async function main() {
  const r = await withPgDirect((pg) => pruneOldData(pg));
  console.log(
    `[cron-prune] impressions=${r.impressions} decisions=${r.decisions} slates=${r.slates}`,
  );
}

main().catch((e) => {
  console.error("[cron-prune] failed:", e);
  process.exit(1);
});
