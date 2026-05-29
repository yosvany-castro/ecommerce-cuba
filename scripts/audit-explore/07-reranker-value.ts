/**
 * EXPERIMENT 7 — Does the LLM reranker earn its keep over plain MMR?
 *
 * Same profile & same top-30 candidates, two runs:
 *   A) valid DeepSeek key → LLM reranker top-10 (+ latency, + reasons)
 *   B) invalid key → fallback = MMR top-10 (the cheap, deterministic order)
 * Compare set overlap + reordering + latency. If A≈B in ordering, the LLM only
 * buys you the reason strings (at the cost of a call + multi-second latency).
 */
import { openTestPg, seedCatalogIfEmpty, newPersona, ensureAnon } from "./catalog";
import { sendEvent } from "./driver";
import { generateFeed } from "@/sectors/d-personalization/feed";

async function clearCache(pg: Awaited<ReturnType<typeof openTestPg>>) {
  await pg.query(`TRUNCATE feed_rerank_cache`);
}

async function main() {
  const pg = await openTestPg();
  const saved = process.env.DEEPSEEK_API_KEY;
  try {
    const byTitle = await seedCatalogIfEmpty(pg);
    const id = (t: string) => byTitle.get(t)!.id;
    const p = newPersona();
    await ensureAnon(pg, p.anonymous_id);

    // Build a coherent women-luxury profile (mix clothing + jewelry so top-30 has variety)
    for (const t of ["Vestido de noche largo elegante negro", "Tacones altos de cuero negro", "Collar de perlas elegante", "Blazer entallado formal para oficina", "Reloj de pulsera dorado para dama", "Cartera de mano de cuero genuino", "Perfume floral femenino 100ml"]) {
      await sendEvent(pg, p, "product_view", { product_id: id(t), source: "home" });
    }

    const run = async (validKey: boolean) => {
      await clearCache(pg);
      process.env.DEEPSEEK_API_KEY = validKey ? (saved ?? "") : "invalid-key-force-fallback";
      const t0 = Date.now();
      const feed = await generateFeed({ user_id: null, anonymous_id: p.anonymous_id, session_id: p.session_id, limit: 10 }, pg);
      const ms = Date.now() - t0;
      return { feed, ms };
    };

    const A = await run(true);   // LLM reranker
    const B = await run(false);  // MMR fallback

    const aIds = A.feed.map((f) => f.product.id);
    const bIds = B.feed.map((f) => f.product.id);
    const aTitles = A.feed.map((f) => f.product.title.slice(0, 30));
    const bTitles = B.feed.map((f) => f.product.title.slice(0, 30));
    const overlap = aIds.filter((x) => bIds.includes(x)).length;
    // position changes among common items
    let reordered = 0;
    aIds.forEach((x, i) => { const j = bIds.indexOf(x); if (j >= 0 && j !== i) reordered++; });
    const reasonsNonEmpty = A.feed.filter((f) => f.reason && f.reason.length > 0).length;

    console.log("\n=== A: LLM RERANKER top-10 ===");
    A.feed.forEach((f, i) => console.log(`${i + 1}. ${aTitles[i].padEnd(30)} | ${f.reason ?? "—"}`));
    console.log("\n=== B: MMR FALLBACK top-10 ===");
    B.feed.forEach((f, i) => console.log(`${i + 1}. ${bTitles[i].padEnd(30)} | ${f.reason ?? "—"}`));

    console.log("\nMARKER_RRK", JSON.stringify({
      latency_llm_ms: A.ms,
      latency_mmr_ms: B.ms,
      llm_overhead_ms: A.ms - B.ms,
      set_overlap_of_10: overlap,
      common_items_reordered: reordered,
      llm_reasons_nonempty: reasonsNonEmpty,
    }));
  } finally {
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved; else delete process.env.DEEPSEEK_API_KEY;
    await pg.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
