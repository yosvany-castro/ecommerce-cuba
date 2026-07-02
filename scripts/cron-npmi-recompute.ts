#!/usr/bin/env tsx
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { withPgDirect } from "@/lib/db/helpers";
import { recomputeNPMI } from "@/sectors/d-personalization/co-occurrence/npmi-recompute";

(async () => {
  const t0 = Date.now();
  await withPgDirect((pg) => recomputeNPMI(pg));
  console.log(`[cron-npmi-recompute] done in ${Date.now() - t0}ms`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
