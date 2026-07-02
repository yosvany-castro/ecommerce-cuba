import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { getPgClient } from "@/lib/db/pg";

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    const q = async (sql: string) => (await pg.query(sql)).rows;
    console.log("products:", (await q(`SELECT count(*)::int c FROM thesis.products`))[0].c);
    console.log("events:", (await q(`SELECT count(*)::int c FROM thesis.events`))[0].c);
    console.log("sessions:", (await q(`SELECT count(*)::int c FROM thesis.sim_sessions`))[0].c);
    console.log("users:", (await q(`SELECT count(*)::int c FROM thesis.sim_users`))[0].c);
    console.log("holdout:", JSON.stringify(await q(`SELECT split, count(*)::int c FROM thesis.holdout GROUP BY split ORDER BY split`)));
    console.log("item_vectors:", JSON.stringify(await q(`SELECT space, count(*)::int c FROM thesis.item_vectors GROUP BY space ORDER BY space`)));
    console.log("co_occurrence pairs:", (await q(`SELECT count(*)::int c FROM thesis.co_occurrence`))[0].c);
    console.log("co_occurrence_top:", (await q(`SELECT count(*)::int c FROM thesis.co_occurrence_top`))[0].c);
    console.log("products with E0:", (await q(`SELECT count(*)::int c FROM thesis.products WHERE embedding IS NOT NULL`))[0].c);
  } finally { await pg.end(); }
}
main().catch((e) => { console.error("DB ERROR:", e.message); process.exit(1); });
