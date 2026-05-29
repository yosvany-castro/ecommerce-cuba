/**
 * EXPERIMENT 1 — Cold start → single-intent profile formation (women's luxury).
 *
 * HYPOTHESES:
 *  H1. A brand-new shopper (0 events) gets a non-broken feed (popular/cold-start).
 *  H2. After a few women's-luxury views/carts, a cohort (femenino_adulta) is
 *      assigned and a profile mode forms pointing at that cluster.
 *  H3. The feed visibly shifts toward women's luxury as signal accumulates.
 *  H4. The reranker emits CONCRETE, context-aware reasons (not generic).
 */
import { openTestPg, seedCatalogIfEmpty, seedAmbientPopularity, newPersona, ensureAnon } from "./catalog";
import { sendEvent, printFeed, printState, printCoocc } from "./driver";
import { fetchPopularByCohort } from "@/sectors/d-personalization/retrieve/popular-by-cohort";

async function main() {
  const pg = await openTestPg();
  try {
    const byTitle = await seedCatalogIfEmpty(pg);
    await seedAmbientPopularity(pg, byTitle);
    const id = (t: string) => byTitle.get(t)!.id;

    // diagnostic: ambient + popular-by-cohort
    const amb = await pg.query(`SELECT count(*)::int c FROM events WHERE payload->>'ambient'='true'`);
    console.log("ambient events now:", amb.rows[0].c);
    for (const co of ["femenino_adulta", "masculino_adulto"] as const) {
      const pop = await fetchPopularByCohort(co, [], 5, pg);
      const titles = [];
      for (const it of pop) {
        const r = await pg.query(`SELECT title FROM products WHERE id=$1`, [it.id]);
        titles.push(r.rows[0]?.title?.slice(0, 30));
      }
      console.log(`popular[${co}]:`, titles.join(" | ") || "(empty)");
    }

    const woman = newPersona();
    await ensureAnon(pg, woman.anonymous_id);

    console.log("\n############ STEP 0 — COLD START (0 events) ############");
    await printState(pg, woman, "cold");
    await printFeed(pg, woman, "cold-start");

    console.log("\n############ STEP 1 — views 5 women's luxury + 1 cart ############");
    for (const t of [
      "Vestido de noche largo elegante negro",
      "Tacones altos de cuero negro",
      "Cartera de mano de cuero genuino",
      "Blazer entallado formal para oficina",
      "Collar de perlas elegante",
    ]) {
      await sendEvent(pg, woman, "product_view", { product_id: id(t), source: "home" });
    }
    await sendEvent(pg, woman, "add_to_cart", { product_id: id("Cartera de mano de cuero genuino"), source: "pdp" });
    await printState(pg, woman, "after 6 events");
    await printFeed(pg, woman, "after 6 women-luxury events");

    console.log("\n############ STEP 2 — 3 more views + 1 purchase ############");
    for (const t of ["Reloj de pulsera dorado para dama", "Gafas de sol de diseñador", "Perfume floral femenino 100ml"]) {
      await sendEvent(pg, woman, "product_view", { product_id: id(t), source: "home" });
    }
    await sendEvent(pg, woman, "purchase", { product_ids: [id("Vestido de noche largo elegante negro")], source: "checkout" });
    await printState(pg, woman, "after 10 events + purchase");
    await printFeed(pg, woman, "after purchase");

    // did the purchased item disappear or persist?
    const feed = await printFeed(pg, woman, "repeat (cache?)");
    const boughtId = id("Vestido de noche largo elegante negro");
    console.log("  purchased item still in feed?", feed.some((f) => f.product.id === boughtId));
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
