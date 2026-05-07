#!/usr/bin/env tsx
/**
 * CLI: pnpm tsx scripts/eval-30-queries.ts > docs/superpowers/reports/$(date +%Y-%m-%d)-fase-2-eval-30-queries.md
 *
 * For each of 30 representative queries, runs both hybridSearch and searchLike,
 * captures top-10 of each, and emits a Markdown report with checkbox columns
 * for the user to audit subjectively.
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { withPg } from "@/lib/db/helpers";
import { hybridSearch } from "@/sectors/c-search/search";
import { searchLike } from "@/sectors/b-catalog/repository/products";

const QUERIES: { category: string; q: string }[] = [
  { category: "literal", q: "Nike Air Max 270 talle 42" },
  { category: "literal", q: "iPhone 15 Pro 256GB" },
  { category: "literal", q: "Samsung Galaxy S24 Ultra" },
  { category: "literal", q: "Sony WH-1000XM5" },
  { category: "literal", q: "Adidas Stan Smith blanco" },
  { category: "sinónimos", q: "audifonos bluetooth con cancelación de ruido" },
  { category: "sinónimos", q: "bocinas portátiles" },
  { category: "sinónimos", q: "remera deportiva" },
  { category: "sinónimos", q: "pantalón corto verano" },
  { category: "sinónimos", q: "auriculares para correr" },
  { category: "receptor", q: "regalo para mi sobrina de 8 años" },
  { category: "receptor", q: "regalo para mi abuelo" },
  { category: "receptor", q: "ropa para mi esposo de 35 años" },
  { category: "receptor", q: "juguete educativo para niño de 5 años" },
  { category: "receptor", q: "vestido para boda femenino" },
  { category: "estilo", q: "algo bonito y barato" },
  { category: "estilo", q: "vestido elegante para fiesta" },
  { category: "estilo", q: "ropa deportiva colorida" },
  { category: "estilo", q: "algo formal masculino" },
  { category: "estilo", q: "estilo vintage" },
  { category: "categórico", q: "ropa de niño" },
  { category: "categórico", q: "electrónica para oficina" },
  { category: "categórico", q: "productos para la cocina" },
  { category: "categórico", q: "belleza para mujer" },
  { category: "categórico", q: "juguetes bebé" },
  { category: "edge", q: "asdfgh" },
  { category: "edge", q: "?" },
  { category: "edge", q: "1234" },
  { category: "edge", q: "AAAAAAAA" },
  { category: "edge", q: "" },
];

const TODAY = new Date().toISOString().slice(0, 10);

console.log(`# Fase 2 — Evaluación 30 queries · ${TODAY}\n`);
console.log(
  `**Compuerta:** ≥ 21 de 30 marcadas \`hybrid mejor\`. Las 5 *edge/basura* pueden contar como N/A; el threshold también es válido sobre las 25 no-garbage (≥ 18 de 25 ≈ 70%).\n`,
);
console.log(
  `**Procedimiento:** Para cada query, comparar top-10 de hybrid vs LIKE. Marca con \`x\` la columna ganadora.\n`,
);
console.log(`---\n`);

(async () => {
  let i = 0;
  for (const { category, q } of QUERIES) {
    i++;
    console.log(`## ${i}. [${category}] \`${q || "(empty)"}\`\n`);

    if (!q) {
      console.log(`*Empty query — both methods short-circuit to empty.*\n`);
      console.log(`| | hybrid | LIKE |`);
      console.log(`|---|---|---|`);
      console.log(`| Top-10 | (empty) | (empty) |`);
      console.log();
      console.log(`- [ ] hybrid mejor`);
      console.log(`- [ ] LIKE mejor`);
      console.log(`- [x] empate / N/A`);
      console.log();
      continue;
    }

    let hybridTop: string[] = [];
    let likeTop: string[] = [];
    let hybridErr: string | null = null;
    try {
      const r = await withPg((pg) => hybridSearch(q, { pg, anonymous_id: null, user_id: null }));
      hybridTop = r.products.slice(0, 10).map((p) => `${p.title} ($${(p.price_cents / 100).toFixed(2)})`);
    } catch (e) {
      hybridErr = e instanceof Error ? e.message : String(e);
    }
    try {
      const products = await withPg((pg) => searchLike({ query: q, limit: 10, pg }));
      likeTop = products.map((p) => `${p.title} ($${(p.price_cents / 100).toFixed(2)})`);
    } catch (e) {
      likeTop = [`(LIKE error: ${e instanceof Error ? e.message : String(e)})`];
    }

    if (hybridErr) {
      console.log(`> hybrid threw: ${hybridErr}`);
    }

    console.log(`| Rank | hybrid | LIKE |`);
    console.log(`|---|---|---|`);
    for (let r = 0; r < 10; r++) {
      const h = hybridTop[r] ?? "—";
      const l = likeTop[r] ?? "—";
      console.log(`| ${r + 1} | ${h.replace(/\|/g, "\\|")} | ${l.replace(/\|/g, "\\|")} |`);
    }
    console.log();
    console.log(`- [ ] hybrid mejor`);
    console.log(`- [ ] LIKE mejor`);
    console.log(`- [ ] empate / N/A`);
    console.log();
  }

  console.log(`---\n`);
  console.log(`## Resumen (rellenar manualmente al final)\n`);
  console.log(`- Hybrid mejor: ___ / 30`);
  console.log(`- LIKE mejor:   ___ / 30`);
  console.log(`- Empate / N/A: ___ / 30`);
  console.log();
  console.log(`**Compuerta:** ≥ 21 de 30 (o ≥ 18 de 25 no-edge): ✅ pass / ❌ fail`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
