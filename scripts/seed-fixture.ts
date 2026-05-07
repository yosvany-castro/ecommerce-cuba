#!/usr/bin/env tsx
import { loadFixture, FIXTURE_SIZE } from "@/sectors/b-catalog/mock/fixture";

async function main() {
  const f = await loadFixture();
  console.log(`Fixture loaded: ${f.length}/${FIXTURE_SIZE} products`);
  const counts: Record<string, number> = {};
  for (const p of f) counts[p.raw_category] = (counts[p.raw_category] ?? 0) + 1;
  for (const [cat, n] of Object.entries(counts)) {
    console.log(`  ${cat.padEnd(20)} ${n} (${((n / f.length) * 100).toFixed(1)}%)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
