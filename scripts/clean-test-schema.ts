#!/usr/bin/env tsx
/**
 * Wipes products + caches + searches + mock_calls in test_schema for clean eval runs.
 * Does NOT touch public schema.
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getPgClient } from "@/lib/db/pg";

(async () => {
  const pg = await getPgClient({ scope: "test" });
  await pg.query(
    "TRUNCATE test_schema.products, test_schema.product_query_cache, test_schema.searches, test_schema.mock_calls CASCADE",
  );
  const r = await pg.query("SELECT count(*)::int as c FROM products");
  console.log("Products in test_schema after truncate:", r.rows[0].c);
  await pg.end();
})();
