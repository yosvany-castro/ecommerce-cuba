#!/usr/bin/env tsx
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { withPgDirect } from "@/lib/db/helpers";
import { cleanupExpiredRerankCache } from "@/sectors/d-personalization/reranker/cache";

(async () => {
  const t0 = Date.now();
  const removed = await withPgDirect((pg) => cleanupExpiredRerankCache(pg));
  console.log(
    `[cron-rerank-cache-cleanup] removed ${removed} rows in ${Date.now() - t0}ms`,
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
