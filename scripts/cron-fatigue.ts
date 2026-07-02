#!/usr/bin/env tsx
/**
 * Cron: fatigue exclusions (E3) — products SEEN ≥3 times in 7d without a
 * click rest for 7 days. Denominator is viewport-confirmed seen_at, never
 * served_at. Run alongside cron-popularity-7d (every 1-6h is plenty).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { withPgDirect } from "@/lib/db/helpers";
import { applyFatigueExclusions } from "@/sectors/d-personalization/exclusion/fatigue";

async function main() {
  const { excluded } = await withPgDirect((pg) => applyFatigueExclusions(pg));
  console.log(`[cron-fatigue] excluded ${excluded} fatigued (user, product) pairs`);
}

main().catch((e) => {
  console.error("[cron-fatigue] failed:", e);
  process.exit(1);
});
