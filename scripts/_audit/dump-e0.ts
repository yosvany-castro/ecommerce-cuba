import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { writeFileSync } from "fs";
import { getPgClient } from "@/lib/db/pg";

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    const rows = (await pg.query(
      `SELECT id::text id, embedding::text v FROM thesis.products WHERE embedding IS NOT NULL`,
    )).rows.map((r: { id: string; v: string }) => ({ id: r.id, v: JSON.parse(r.v) as number[] }));
    writeFileSync(resolve(process.cwd(), "scripts/_audit/data/item_vectors_e0.json"), JSON.stringify(rows));
    console.log(`[dump-e0] ${rows.length} text vectors, dim=${rows[0]?.v.length}`);
  } finally { await pg.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
