// scripts/weight-eval.ts — banco de pruebas del grafo de peso (LangGraph).
// Corre el grafo sobre N productos SIN peso persistido y muestra heurística vs
// grafo, si escaló al modelo pro y cuántos vecinos medidos usó. Para calibrar:
//   pnpm weight:eval             → 8 productos al azar sin peso
//   pnpm weight:eval -- 15       → 15 productos
//   pnpm weight:eval -- <uuid>   → un producto puntual
// OJO: persiste el resultado como weight_source='llm' (comportamiento real del
// grafo) y gasta llamadas DeepSeek (flash, y pro solo si escala).
import { Client } from "pg";
import * as dotenv from "dotenv";
import { runWeightGraph } from "../src/sectors/b-catalog/weight-graph";
import { estimateWeightGrams, gramsToLb } from "../src/lib/weight";

async function main() {
  dotenv.config({ path: ".env.local" });
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("[weight-eval] falta DEEPSEEK_API_KEY");
    process.exit(1);
  }
  const arg = process.argv[2];
  const isUuid = arg && /^[0-9a-f-]{36}$/i.test(arg);
  const n = !arg || isUuid ? 8 : Math.min(50, parseInt(arg, 10) || 8);

  const pg = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await pg.connect();

  const rows = isUuid
    ? (await pg.query(`SELECT id, title, metadata->>'category' AS cat FROM products WHERE id = $1`, [arg])).rows
    : (
        await pg.query(
          `SELECT id, title, metadata->>'category' AS cat FROM products
           WHERE is_active = true AND weight_grams IS NULL
           ORDER BY random() LIMIT $1`,
          [n],
        )
      ).rows;

  console.log(`[weight-eval] ${rows.length} productos\n`);
  for (const row of rows as { id: string; title: string; cat: string | null }[]) {
    const heur = estimateWeightGrams({ title: row.title, category: row.cat });
    const t0 = Date.now();
    const res = await runWeightGraph(row.id, pg);
    const ms = Date.now() - t0;
    console.log(
      [
        `• ${row.title.slice(0, 70)}`,
        `  cat=${row.cat ?? "?"} heurística=${heur.grams}g(${heur.method})`,
        `  grafo=${res.grams != null ? `${res.grams}g (~${gramsToLb(res.grams)} lb)` : "SIN RESULTADO"}` +
          ` pro=${res.usedPro ? "SÍ" : "no"} vecinos=${res.neighborsUsed} ${ms}ms`,
      ].join("\n"),
    );
  }
  await pg.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
