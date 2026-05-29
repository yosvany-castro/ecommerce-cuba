/**
 * EXPERIMENT 8 — Is personalization worth it vs "normal ecommerce" baselines?
 *
 * For each coherent-taste user we HOLD OUT one in-taste target (a "next buy"
 * that has NO popularity signal — the long tail), build the profile from other
 * in-taste items, and measure the target's RANK under:
 *   P  = personalized semantic retrieval (effective user vector)
 *   PC = popular-by-cohort (trending within demographic)   [normal ecommerce]
 *   PG = popular-global (trending overall)                  [normal ecommerce]
 *   LV = cosine "more like the last item you viewed"        [normal ecommerce]
 * Lower rank = better. MRR = mean(1/rank).  rank=0 → not found in catalogue list.
 */
import { openTestPg, seedCatalogIfEmpty, newPersona, ensureAnon } from "./catalog";
import { sendEvent } from "./driver";
import { retrieveTopKByVector } from "@/sectors/d-personalization/retrieve";
import { fetchPopularByCohort } from "@/sectors/d-personalization/retrieve/popular-by-cohort";
import { normalize } from "@/lib/math";

type Pg = Awaited<ReturnType<typeof openTestPg>>;

async function rankInList(ids: string[], target: string): Promise<number> {
  const i = ids.indexOf(target);
  return i < 0 ? 0 : i + 1;
}

async function main() {
  const pg = await openTestPg();
  try {
    const byTitle = await seedCatalogIfEmpty(pg);
    const id = (t: string) => byTitle.get(t)!.id;

    const users: { name: string; cohort: string; profile: string[]; target: string }[] = [
      { name: "woman-luxury", cohort: "femenino_adulta",
        profile: ["Vestido de noche largo elegante negro", "Tacones altos de cuero negro", "Collar de perlas elegante", "Blazer entallado formal para oficina", "Reloj de pulsera dorado para dama", "Cartera de mano de cuero genuino"],
        target: "Pulsera de oro fino" },
      { name: "tech",        cohort: "masculino_adulto",
        profile: ["iPhone 15 Pro 256GB titanio", "Laptop ultradelgada 14 pulgadas", "Smartwatch deportivo con GPS", "Auriculares inalámbricos con cancelación de ruido", "Mouse inalámbrico ergonómico", "Teclado mecánico retroiluminado"],
        target: "Power bank 20000mAh" },
      { name: "sport",       cohort: "masculino_joven",
        profile: ["Zapatillas de running Nike Air Zoom", "Zapatillas Adidas Ultraboost", "Short deportivo dry-fit", "Camiseta deportiva transpirable", "Balón de fútbol profesional", "Mochila deportiva resistente"],
        target: "Sudadera con capucha gris" },
    ];

    const results: Record<string, number>[] = [];
    for (const u of users) {
      const p = newPersona();
      await ensureAnon(pg, p.anonymous_id);
      for (const t of u.profile) await sendEvent(pg, p, "product_view", { product_id: id(t), source: "home" });

      // P — personalized: effective vector ≈ the profile mode; retrieve full catalogue
      const prof = await pg.query(`SELECT id::text FROM user_profiles WHERE anonymous_id=$1`, [p.anonymous_id]);
      const modeR = await pg.query(
        `SELECT vector_unnormalized::text v FROM user_profile_modes
         WHERE user_profile_id=$1 ORDER BY n_events_in_mode DESC LIMIT 1`, [prof.rows[0].id]);
      const modeVec = normalize(JSON.parse(modeR.rows[0].v) as number[]);
      const pretr = await retrieveTopKByVector(modeVec, [], 42, pg);
      const rP = await rankInList(pretr.map((x) => x.product.id), id(u.target));

      // PC — popular by cohort
      const pc = await fetchPopularByCohort(u.cohort as never, [], 42, pg);
      const rPC = await rankInList(pc.map((x) => x.id), id(u.target));

      // PG — popular global (last 7d event counts, any product)
      const pg7 = await pg.query(
        `SELECT (payload->>'product_id')::text pid, count(*) c
         FROM events WHERE occurred_at > now() - interval '7 days'
           AND event_type IN ('product_view','add_to_cart') AND payload->>'product_id' IS NOT NULL
         GROUP BY 1 ORDER BY c DESC`);
      const rPG = await rankInList((pg7.rows as { pid: string }[]).map((x) => x.pid), id(u.target));

      // LV — cosine neighbours of the last viewed profile item
      const lastId = id(u.profile[u.profile.length - 1]);
      const lv = await pg.query(
        `SELECT id::text FROM products WHERE source='audit-explore' AND id<>$1
         ORDER BY embedding <=> (SELECT embedding FROM products WHERE id=$1)`, [lastId]);
      const rLV = await rankInList((lv.rows as { id: string }[]).map((x) => x.id), id(u.target));

      const row = { P: rP, PC: rPC, PG: rPG, LV: rLV };
      results.push(row);
      console.log(`MARKER_LIFT ${u.name.padEnd(13)} target="${u.target.slice(0, 22)}" ranks=`, JSON.stringify(row));
    }

    const mrr = (k: string) => (results.reduce((s, r) => s + (r[k] > 0 ? 1 / r[k] : 0), 0) / results.length).toFixed(3);
    const recall10 = (k: string) => (results.filter((r) => r[k] > 0 && r[k] <= 10).length / results.length).toFixed(2);
    console.log("\nMARKER_LIFT_AGG",
      JSON.stringify({
        MRR: { P: mrr("P"), PC: mrr("PC"), PG: mrr("PG"), LV: mrr("LV") },
        recall_at_10: { P: recall10("P"), PC: recall10("PC"), PG: recall10("PG"), LV: recall10("LV") },
      }));
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
