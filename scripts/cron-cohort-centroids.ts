#!/usr/bin/env tsx
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { withPg } from "@/lib/db/helpers";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";

(async () => {
  const t0 = Date.now();
  await withPg((pg) => computeCohortCentroids(pg));
  console.log(`[cron-cohort-centroids] done in ${Date.now() - t0}ms`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
