/**
 * AUDIT EXPLORATION — observation helpers (NOT a test).
 * Wrap the real entry points and pretty-print what a shopper would see.
 */
import { generateFeed } from "@/sectors/d-personalization/feed";
import { hybridSearch } from "@/sectors/c-search/search";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import type { openTestPg, Persona } from "./catalog";

type Pg = Awaited<ReturnType<typeof openTestPg>>;

/**
 * Drive a real user interaction: insert the event row (popularity / profile
 * summary read from `events`) AND run the personalization hook (cohort, session
 * & profile vectors, co-occurrence) — exactly the two-step path the F3c
 * integration tests use.
 */
export async function sendEvent(
  pg: Pg,
  p: Persona,
  event_type: "product_view" | "add_to_cart" | "purchase" | "search" | "dismiss",
  payload: Record<string, unknown>,
) {
  const occurred_at = new Date().toISOString();
  await pg.query(
    `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
     VALUES ($1, $2, $3, $4::timestamptz, $5::jsonb)`,
    [p.anonymous_id, p.session_id, event_type, occurred_at, JSON.stringify(payload)],
  );
  await processEventForPersonalization(
    { anonymous_id: p.anonymous_id, user_id: null, session_id: p.session_id, event_type, payload, occurred_at },
    pg,
  );
}

function tagOf(metadata: Record<string, unknown> | null): string {
  if (!metadata) return "?";
  const t = (metadata.tag as string) ?? "?";
  const c = (metadata.category as string) ?? "?";
  const g = (metadata.gender_target as string) ?? "u";
  return `${t}/${c}/${g}`;
}

export async function printFeed(pg: Pg, p: Persona, label: string, limit = 10) {
  const feed = await generateFeed(
    { user_id: null, anonymous_id: p.anonymous_id, session_id: p.session_id, limit },
    pg,
  );
  console.log(`\n=== FEED [${label}] → ${feed.length} items ===`);
  feed.forEach((it, i) => {
    const m = it.product.metadata as Record<string, unknown> | null;
    const title = it.product.title.slice(0, 46).padEnd(46);
    console.log(
      `${String(i + 1).padStart(2)}. ${title} | ${tagOf(m).padEnd(34)} | sim=${it.similarity.toFixed(3)} | ${it.reason ?? "—"}`,
    );
  });
  // cluster histogram
  const hist: Record<string, number> = {};
  for (const it of feed) {
    const t = ((it.product.metadata as Record<string, unknown>)?.tag as string) ?? "?";
    hist[t] = (hist[t] ?? 0) + 1;
  }
  console.log("   mix:", JSON.stringify(hist));
  return feed;
}

export async function printState(pg: Pg, p: Persona, label: string) {
  const s = await pg.query(
    `SELECT current_cohort_id, current_recipient_id::text AS rcp, signal_window_size,
            weight_sum, (vector_unnormalized IS NOT NULL) AS has_vec
     FROM session_vectors WHERE session_id = $1`,
    [p.session_id],
  );
  const prof = await pg.query(
    `SELECT id::text, n_events FROM user_profiles WHERE anonymous_id = $1`,
    [p.anonymous_id],
  );
  let modesInfo = "no-profile";
  if (prof.rows.length > 0) {
    const modes = await pg.query(
      `SELECT cohort_id, mode_index, n_events_in_mode, weight_sum
       FROM user_profile_modes WHERE user_profile_id = $1 ORDER BY cohort_id, mode_index`,
      [prof.rows[0].id],
    );
    modesInfo = modes.rows
      .map((m) => `${m.cohort_id}#${m.mode_index}(n=${m.n_events_in_mode},w=${Number(m.weight_sum).toFixed(1)})`)
      .join(", ") || "no-modes";
  }
  const sv = s.rows[0];
  console.log(`\n--- STATE [${label}] ---`);
  console.log(
    `  session: cohort=${sv?.current_cohort_id ?? "—"} recipient=${sv?.rcp ?? "—"} sigWin=${sv?.signal_window_size ?? 0} sessVecW=${sv ? Number(sv.weight_sum).toFixed(2) : "—"}`,
  );
  console.log(`  profile: n_events=${prof.rows[0]?.n_events ?? "—"} | modes: ${modesInfo}`);
}

export async function printCoocc(pg: Pg, productId: string, title: string) {
  const r = await pg.query(
    `SELECT p.title, p.metadata->>'tag' AS tag, c.rank, c.npmi_score AS npmi
     FROM co_occurrence_top c JOIN products p ON p.id = c.related_product_id
     WHERE c.product_id = $1 ORDER BY c.rank ASC LIMIT 10`,
    [productId],
  );
  console.log(`\n~~~ CO-OCCURRENCE for "${title.slice(0, 40)}" → ${r.rows.length} related ~~~`);
  r.rows.forEach((row: { title: string; tag: string; rank: number; npmi: number }) =>
    console.log(`   #${row.rank} ${row.title.slice(0, 46).padEnd(46)} [${row.tag}] npmi=${Number(row.npmi).toFixed(3)}`),
  );
}

export async function printSearch(pg: Pg, query: string, p: Persona | null, label: string) {
  const res = await hybridSearch(
    query,
    { pg, anonymous_id: p?.anonymous_id ?? null, user_id: null },
    { trace: true },
  );
  console.log(`\n>>> SEARCH "${query}" [${label}] method=${res.method} → ${res.products.length} items`);
  res.products.slice(0, 8).forEach((pr, i) => {
    const m = pr.metadata as Record<string, unknown> | null;
    console.log(`  ${i + 1}. ${pr.title.slice(0, 48).padEnd(48)} | ${tagOf(m)}`);
  });
  return res;
}
