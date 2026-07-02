#!/usr/bin/env tsx
/**
 * CLI: pnpm cron:catalog-fill --categories ropa,electronica --pages 1 --concurrency 3
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { parseArgs } from "node:util";
import { runCatalogFill } from "@/sectors/b-catalog/cron/catalog-fill";
import { withPgDirect } from "@/lib/db/helpers";
import type { MockCategory } from "@/sectors/b-catalog/mock/types";

const ALL_CATEGORIES: MockCategory[] = [
  "ropa",
  "electronica",
  "hogar",
  "juguetes_bebe",
  "belleza",
  "otros",
];

const { values } = parseArgs({
  options: {
    categories: { type: "string" },
    pages: { type: "string", default: "1" },
    concurrency: { type: "string", default: "3" },
  },
});

const requested = values.categories
  ? values.categories.split(",").map((s) => s.trim())
  : ALL_CATEGORIES;
const categories = requested.filter(
  (c): c is MockCategory => ALL_CATEGORIES.includes(c as MockCategory),
);
if (categories.length !== requested.length) {
  console.error("Unknown category in:", requested);
  console.error("Allowed:", ALL_CATEGORIES.join(", "));
  process.exit(2);
}

async function main() {
  const result = await withPgDirect((pg) =>
    runCatalogFill({
      categories,
      pagesPerCategory: parseInt(values.pages!, 10),
      concurrency: parseInt(values.concurrency!, 10),
      pg,
    }),
  );

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.errors.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
