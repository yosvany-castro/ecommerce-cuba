/**
 * EXPERIMENT 9 — Verify two suspicions from exp6:
 *  (a) duplicate product_ids in a single feed (rerank validates unique ranks but
 *      NOT unique product_ids → LLM can repeat an item).
 *  (b) does the cohort actually flip across gift recipients, or get stuck?
 */
import { openTestPg, seedCatalogIfEmpty, newPersona, ensureAnon } from "./catalog";
import { sendEvent } from "./driver";
import { generateFeed } from "@/sectors/d-personalization/feed";

type Pg = Awaited<ReturnType<typeof openTestPg>>;

async function cohortOf(pg: Pg, session_id: string) {
  const r = await pg.query(`SELECT current_cohort_id c, signal_window_size w FROM session_vectors WHERE session_id=$1`, [session_id]);
  return r.rows[0] ? `${r.rows[0].c}(win=${r.rows[0].w})` : "none";
}

async function dupCheck(pg: Pg, label: string, anon: string, sess: string) {
  const feed = await generateFeed({ user_id: null, anonymous_id: anon, session_id: sess, limit: 10 }, pg);
  const ids = feed.map((f) => f.product.id);
  const uniq = new Set(ids);
  const dups = ids.filter((x, i) => ids.indexOf(x) !== i);
  console.log(`MARKER_DUP ${label.padEnd(18)} items=${ids.length} unique=${uniq.size} duplicates=${dups.length}`);
}

async function main() {
  const pg = await openTestPg();
  try {
    const byTitle = await seedCatalogIfEmpty(pg);
    const id = (t: string) => byTitle.get(t)!.id;

    // (b) cohort flip trace across gift recipients
    const p = newPersona();
    await ensureAnon(pg, p.anonymous_id);
    const seq: [string, string][] = [
      ["niña", "Muñeca de juguete para niña"], ["niña", "Vestido infantil de flores"], ["niña", "Rompecabezas educativo 100 piezas"], ["niña", "Peluche oso grande"],
      ["mamá", "Perfume floral femenino 100ml"], ["mamá", "Collar de perlas elegante"], ["mamá", "Pañuelo de seda estampado"], ["mamá", "Reloj de pulsera dorado para dama"],
      ["papá", "Pesas ajustables 20kg"], ["papá", "Botella térmica deportiva"], ["papá", "Guantes de gimnasio acolchados"], ["papá", "Mochila deportiva resistente"],
    ];
    for (const [who, title] of seq) {
      await sendEvent(pg, p, "product_view", { product_id: id(title), source: "home" });
      console.log(`MARKER_COHORT after ${who.padEnd(5)} view "${title.slice(0, 22).padEnd(22)}" → cohort=${await cohortOf(pg, p.session_id)}`);
    }
    await dupCheck(pg, "gift-shopper", p.anonymous_id, p.session_id);

    // (a) dup check on a few coherent personas (force reranker path)
    for (const taste of [
      ["Vestido de noche largo elegante negro", "Tacones altos de cuero negro", "Collar de perlas elegante", "Blazer entallado formal para oficina", "Reloj de pulsera dorado para dama", "Cartera de mano de cuero genuino"],
      ["iPhone 15 Pro 256GB titanio", "Laptop ultradelgada 14 pulgadas", "Smartwatch deportivo con GPS", "Auriculares inalámbricos con cancelación de ruido", "Mouse inalámbrico ergonómico", "Teclado mecánico retroiluminado"],
    ]) {
      const q = newPersona();
      await ensureAnon(pg, q.anonymous_id);
      for (const t of taste) await sendEvent(pg, q, "product_view", { product_id: id(t), source: "home" });
      await dupCheck(pg, taste[0].slice(0, 16), q.anonymous_id, q.session_id);
    }
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
