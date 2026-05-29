/**
 * EXPERIMENT 4 — Multi-modal user within ONE cohort (feedback "Idea 1").
 *
 * A femenino_adulta shopper with TWO distinct interests in the same cohort:
 * women's CLOTHING and JEWELRY. 20+ events should trigger k-means → 2 modes.
 *
 * HYPOTHESES:
 *  H1. ≥20 weighted events in the bucket → modesForEvents=2 → recompute creates
 *      2 modes.
 *  H2. The two modes separate (one ≈ clothing centroid, one ≈ jewelry centroid),
 *      NOT two copies of the global "women's luxury" centroid (ghost vector).
 *  H3. The feed (listA = all modes, RRF-fused) represents BOTH interests, not a
 *      blurred average that is neither.
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

    const clothing = ["Vestido de noche largo elegante negro", "Vestido coctel midi rojo", "Blazer entallado formal para oficina", "Abrigo largo de lana camel", "Tacones altos de cuero negro", "Cartera de mano de cuero genuino"];
    const jewelry = ["Collar de perlas elegante", "Reloj de pulsera dorado para dama", "Pulsera de oro fino"];

    console.log("############ drive 24 femenino_adulta events: 12 clothing + 12 jewelry ############");
    // interleave so cohort stays femenino_adulta and both clusters accumulate
    for (let round = 0; round < 4; round++) {
      for (const t of clothing.slice(0, 3)) await sendEvent(pg, p, "product_view", { product_id: id(t), source: "home" });
      for (const t of jewelry) await sendEvent(pg, p, "product_view", { product_id: id(t), source: "home" });
    }
    await printState(pg, p, "after 24 femenino events");

    // dump each mode → nearest catalogue products (what does each mode represent?)
    const prof = await pg.query(`SELECT id::text FROM user_profiles WHERE anonymous_id=$1`, [p.anonymous_id]);
    const modes = await pg.query(
      `SELECT id::text, mode_index, n_events_in_mode, vector_unnormalized::text v
       FROM user_profile_modes WHERE user_profile_id=$1 AND cohort_id='femenino_adulta' ORDER BY mode_index`,
      [prof.rows[0].id]);
    console.log(`\nMODES in femenino_adulta bucket: ${modes.rows.length}`);
    for (const m of modes.rows as { mode_index: number; n_events_in_mode: number; v: string }[]) {
      const near = await pg.query(
        `SELECT title, metadata->>'category' cat,
                1 - (embedding <=> $1::vector) cos
         FROM products WHERE source='audit-explore'
         ORDER BY embedding <=> $1::vector LIMIT 5`, [m.v]);
      console.log(`\n  mode#${m.mode_index} (n=${m.n_events_in_mode}) nearest:`);
      near.rows.forEach((r: { title: string; cat: string; cos: number }) =>
        console.log(`     ${Number(r.cos).toFixed(3)} ${r.title.slice(0, 38).padEnd(38)} [${r.cat}]`));
    }

    await printFeed(pg, p, "multimodal feed (clothing + jewelry?)");
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
