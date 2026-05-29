/**
 * EXPERIMENT 6 — The gift-only shopper (the Cuba reseller reality).
 *
 * Many reseller customers NEVER buy for themselves — they buy gifts for varied
 * recipients (niece, mom, dad). A single per-user taste vector may be noise.
 *
 * Episodes (same session): gift for niece → gift for mom → gift for dad.
 * After each, show cohort + feed. Question: does the per-user model produce
 * anything useful, or does it ping-pong and end up worse than "popular + what
 * you're looking at right now"?
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

    const episodes: [string, string[]][] = [
      ["REGALO para sobrina (niña)", ["Muñeca de juguete para niña", "Vestido infantil de flores", "Rompecabezas educativo 100 piezas", "Peluche oso grande"]],
      ["REGALO para mamá (mujer adulta)", ["Perfume floral femenino 100ml", "Collar de perlas elegante", "Pañuelo de seda estampado"]],
      ["REGALO para papá (hombre adulto)", ["Pesas ajustables 20kg", "Botella térmica deportiva", "Guantes de gimnasio acolchados"]],
    ];

    for (const [label, items] of episodes) {
      console.log(`\n############ ${label} ############`);
      for (const t of items) await sendEvent(pg, p, "product_view", { product_id: id(t), source: "home" });
      await printState(pg, p, label);
      await printFeed(pg, p, label);
    }

    console.log("\n############ VERDICT PROBE: what does the per-user profile look like? ############");
    const prof = await pg.query(`SELECT id::text, n_events FROM user_profiles WHERE anonymous_id=$1`, [p.anonymous_id]);
    const modes = await pg.query(
      `SELECT cohort_id, mode_index, n_events_in_mode FROM user_profile_modes WHERE user_profile_id=$1 ORDER BY cohort_id`,
      [prof.rows[0].id]);
    console.log("MARKER_GIFT profile n_events:", prof.rows[0].n_events,
      "| buckets:", modes.rows.map((m) => `${m.cohort_id}#${m.mode_index}(n=${m.n_events_in_mode})`).join(", "));
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
