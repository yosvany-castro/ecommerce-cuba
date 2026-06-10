#!/usr/bin/env tsx
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { withPgDirect } from "@/lib/db/helpers";
import { recomputeProfileModes } from "@/sectors/d-personalization/recompute-nightly";

(async () => {
  const t0 = Date.now();
  await withPgDirect((pg) => recomputeProfileModes(pg));
  console.log(`[cron-profile-recompute] done in ${Date.now() - t0}ms`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
