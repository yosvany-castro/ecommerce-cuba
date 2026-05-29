/**
 * EXPERIMENT 2 — Intra-session intent shift ("adaptarse al momento").
 *
 * A shopper with an established MEN-TECH profile pivots, in the SAME session,
 * to women's dresses (e.g. shopping a gift, or a different need right now).
 *
 * HYPOTHESES:
 *  H1. Cohort flips masculino_adulto → femenino_adulta after ~3 contradicting
 *      signals (SHIFT_THRESHOLD=3, WINDOW=5).
 *  H2. On flip the signal window RESETS to size 1, so nEventsSession drops and
 *      α (session weight = min(0.7, 0.1+0.05·n)) collapses to ~0.15 — the
 *      in-session intent gets UNDER-weighted right when it matters most.
 *  H3. The new femenino bucket has no personal mode, so the feed falls back to
 *      the generic cohort prior (centroid women's) — NOT specifically dresses,
 *      and the tech history is abandoned.
 *  → Net question: does the feed actually "follow the moment" to dresses, or
 *    does it land on a muddled / generic state?
 */
import { openTestPg, seedCatalogIfEmpty, newPersona, ensureAnon } from "./catalog";
import { sendEvent, printFeed, printState } from "./driver";

async function main() {
  const pg = await openTestPg();
  try {
    const byTitle = await seedCatalogIfEmpty(pg);
    const id = (t: string) => byTitle.get(t)!.id;
    const p = newPersona();
    await ensureAnon(pg, p.anonymous_id);

    console.log("\n############ PHASE A — build a MEN-TECH profile ############");
    for (const t of [
      "iPhone 15 Pro 256GB titanio",
      "Auriculares inalámbricos con cancelación de ruido",
      "Laptop ultradelgada 14 pulgadas",
      "Smartwatch deportivo con GPS",
      "Mouse inalámbrico ergonómico",
    ]) {
      await sendEvent(pg, p, "product_view", { product_id: id(t), source: "home" });
    }
    await sendEvent(pg, p, "add_to_cart", { product_id: id("Auriculares inalámbricos con cancelación de ruido"), source: "pdp" });
    await printState(pg, p, "tech profile built");
    await printFeed(pg, p, "MEN-TECH established");

    console.log("\n############ PHASE B — pivot IN-SESSION to women's dresses ############");
    const dresses = [
      "Vestido de noche largo elegante negro",
      "Vestido coctel midi rojo",
      "Tacones altos de cuero negro",
      "Cartera de mano de cuero genuino",
      "Blazer entallado formal para oficina",
    ];
    for (let i = 0; i < dresses.length; i++) {
      await sendEvent(pg, p, "product_view", { product_id: id(dresses[i]), source: "home" });
      await printState(pg, p, `after dress view #${i + 1} (${dresses[i].slice(0, 24)})`);
      await printFeed(pg, p, `after dress view #${i + 1}`);
    }
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
