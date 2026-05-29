/**
 * EXPERIMENT 3 — Cross-sell via co-occurrence vs pure semantic similarity.
 * (Feedback "Idea 2": commercial relation ≠ linguistic proximity.)
 *
 * Build co-purchase bundles across several sessions, recompute NPMI, then for
 * each anchor compare its CO-OCCURRENCE neighbours vs its COSINE neighbours.
 * Finally drive a shopper who views the anchor and check whether the feed's
 * co-occurrence source (listB) actually injects the complements.
 *
 * HYPOTHESES:
 *  H1. Pairs co-viewed in >=3 sessions land in co_occurrence_top after NPMI.
 *  H2. For "Laptop", co-occurrence surfaces mouse/teclado (complements) which
 *      cosine ranks BELOW other laptops/tablets — i.e. it adds commercial signal.
 *  H3. A shopper who just viewed the iPhone gets funda/cargador injected into the
 *      feed via listB (co-occurrence), not only more phones.
 */
import { openTestPg, seedCatalogIfEmpty, newPersona, ensureAnon } from "./catalog";
import { sendEvent, printFeed } from "./driver";
import { recomputeNPMI } from "@/sectors/d-personalization/co-occurrence/npmi-recompute";

async function main() {
  const pg = await openTestPg();
  try {
    const byTitle = await seedCatalogIfEmpty(pg);
    const id = (t: string) => byTitle.get(t)!.id;

    // clean co-occurrence so this run is deterministic
    await pg.query(`TRUNCATE co_occurrence, co_occurrence_top`);

    const bundles: string[][] = [
      ["iPhone 15 Pro 256GB titanio", "Funda protectora para iPhone 15 Pro", "Cargador rápido USB-C 30W"],
      ["Laptop ultradelgada 14 pulgadas", "Mouse inalámbrico ergonómico", "Teclado mecánico retroiluminado"],
      ["Vestido de noche largo elegante negro", "Tacones altos de cuero negro", "Cartera de mano de cuero genuino"],
      ["Zapatillas de running Nike Air Zoom", "Short deportivo dry-fit", "Botella térmica deportiva"],
    ];
    const SESSIONS_PER_BUNDLE = 5;
    for (const bundle of bundles) {
      for (let s = 0; s < SESSIONS_PER_BUNDLE; s++) {
        const shopper = newPersona();
        await ensureAnon(pg, shopper.anonymous_id);
        for (const t of bundle) {
          await sendEvent(pg, shopper, "product_view", { product_id: id(t), source: "home" });
        }
      }
    }
    const pairCount = await pg.query(`SELECT count(*)::int c, max(count)::int mx FROM co_occurrence`);
    console.log("co_occurrence pairs:", JSON.stringify(pairCount.rows[0]));
    await recomputeNPMI(pg);
    const topCount = await pg.query(`SELECT count(*)::int c FROM co_occurrence_top`);
    console.log("co_occurrence_top rows:", topCount.rows[0].c);

    // Compare co-occurrence vs cosine neighbours for anchors
    for (const anchor of ["Laptop ultradelgada 14 pulgadas", "iPhone 15 Pro 256GB titanio", "Vestido de noche largo elegante negro"]) {
      const aid = id(anchor);
      console.log(`\n===== ANCHOR: ${anchor} =====`);
      const co = await pg.query(
        `SELECT p.title, p.metadata->>'tag' tag, c.rank, c.npmi_score AS npmi,
                1 - (p.embedding <=> (SELECT embedding FROM products WHERE id=$1)) cos
         FROM co_occurrence_top c JOIN products p ON p.id=c.related_product_id
         WHERE c.product_id=$1 ORDER BY c.rank LIMIT 6`, [aid]);
      console.log("  CO-OCCURRENCE neighbours (rank | npmi | cosine):");
      co.rows.forEach((r: { title: string; tag: string; rank: number; npmi: number; cos: number }) =>
        console.log(`    #${r.rank} ${r.title.slice(0, 40).padEnd(40)} [${String(r.tag).padEnd(14)}] npmi=${Number(r.npmi).toFixed(3)} cos=${Number(r.cos).toFixed(3)}`));
      const cos = await pg.query(
        `SELECT title, metadata->>'tag' tag,
                1 - (embedding <=> (SELECT embedding FROM products WHERE id=$1)) cos
         FROM products WHERE source='audit-explore' AND id<>$1
         ORDER BY embedding <=> (SELECT embedding FROM products WHERE id=$1) LIMIT 6`, [aid]);
      console.log("  COSINE neighbours (semantic):");
      cos.rows.forEach((r: { title: string; tag: string; cos: number }) =>
        console.log(`        ${r.title.slice(0, 40).padEnd(40)} [${String(r.tag).padEnd(14)}] cos=${Number(r.cos).toFixed(3)}`));
    }

    // Now: a shopper views the iPhone — does listB inject funda/cargador?
    console.log("\n############ shopper views iPhone → feed (cross-sell injection?) ############");
    const buyer = newPersona();
    await ensureAnon(pg, buyer.anonymous_id);
    // light tech warmup so cohort = masculino_adulto and reranker path engages
    for (const t of ["iPhone 15 Pro 256GB titanio", "Laptop ultradelgada 14 pulgadas", "Smartwatch deportivo con GPS"]) {
      await sendEvent(pg, buyer, "product_view", { product_id: id(t), source: "home" });
    }
    // the decisive last view = iPhone (drives listB co-occurrence with last-viewed)
    await sendEvent(pg, buyer, "product_view", { product_id: id("iPhone 15 Pro 256GB titanio"), source: "pdp" });
    const feed = await printFeed(pg, buyer, "after viewing iPhone");
    const funda = id("Funda protectora para iPhone 15 Pro");
    const carg = id("Cargador rápido USB-C 30W");
    console.log("  funda in feed?", feed.some((f) => f.product.id === funda), "| cargador in feed?", feed.some((f) => f.product.id === carg));
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
