#!/usr/bin/env tsx
// scripts/seed-demo-profiles.ts — T11: siembra un historial de eventos REAL para
// cada perfil demo (mismos uuids que src/components/tuki/profiles.ts) para que
// elegir un perfil en el Shell no sea un cambio de tema, sino adoptar la cookie
// anonymous_id de una identidad que YA tiene señal de personalización.
//
// Reusa el pipeline exacto de /api/track (insertEvent + ensureIdentityRows +
// processEventForPersonalization) en vez de SQL a mano: cron-profile-recompute
// solo RE-deriva vectores de user_profile_modes que YA EXISTEN (no crea perfiles
// ni asigna cohortes) — la creación de user_profiles/user_profile_modes ocurre
// únicamente en el hook de personalización que corre en cada evento tracked.
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { withPgDirect } from "@/lib/db/helpers";
import { insertEvent } from "@/sectors/a-tracking/events/insert";
import { ensureIdentityRows } from "@/sectors/a-tracking/identity";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { DEMO_PROFILES } from "@/components/tuki/profiles";

const DAY_MS = 24 * 3600 * 1000;
const IDEMPOTENCY_SKIP_THRESHOLD = 20; // re-correr el script no debe duplicar historiales

const SEARCH_TEMPLATES: Record<string, string[]> = {
  ropa: ["vestido casual", "jeans slim", "chaqueta de cuero"],
  belleza: ["serum vitamina c", "labial mate", "crema hidratante"],
  hogar: ["freidora de aire", "juego de sartenes", "organizador de cocina"],
  electronica: ["audífonos bluetooth", "cargador rápido", "teclado mecánico"],
};

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** N días distintos entre los últimos 14, ordenados del más viejo al más nuevo. */
function pickDays(n: number): number[] {
  const pool = Array.from({ length: 14 }, (_, i) => i);
  const days: number[] = [];
  while (days.length < n && pool.length > 0) {
    days.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return days.sort((a, b) => b - a);
}

async function fetchCategoryProductIds(pg: Client, cats: string[]): Promise<string[]> {
  const r = await pg.query<{ id: string }>(
    `SELECT id FROM products
     WHERE metadata->>'category' = ANY($1) AND is_active = true AND embedding IS NOT NULL
     ORDER BY random() LIMIT 25`,
    [cats],
  );
  return r.rows.map((x) => x.id);
}

async function countEvents(pg: Client, anonymousId: string): Promise<number> {
  const r = await pg.query<{ n: string }>(`SELECT count(*)::text AS n FROM events WHERE anonymous_id = $1`, [
    anonymousId,
  ]);
  return Number(r.rows[0]?.n ?? 0);
}

async function trackProductView(
  pg: Client,
  anonymous_id: string,
  session_id: string,
  occurred_at: string,
  product_id: string,
): Promise<void> {
  const payload = { product_id, source: "home" as const };
  await insertEvent({ event_type: "product_view", occurred_at, payload }, { pg, anonymous_id, session_id, user_id: null });
  // El insert por sí solo no mueve el vector del perfil — eso lo hace el mismo
  // hook que corre en /api/track en cada evento tracked (warmup de cohorte +
  // acumulación decaída sobre user_profile_modes).
  await processEventForPersonalization(
    { anonymous_id, user_id: null, session_id, event_type: "product_view", payload, occurred_at },
    pg,
  );
}

async function seedProfile(pg: Client, profile: (typeof DEMO_PROFILES)[number]): Promise<void> {
  const anonymousId = profile.anonId;
  if (!anonymousId) return; // Explorador: usuario frío, sin identidad fija que sembrar

  const existing = await countEvents(pg, anonymousId);
  if (existing > IDEMPOTENCY_SKIP_THRESHOLD) {
    console.log(`  ${profile.name}: ya tiene ${existing} eventos — skip (idempotente)`);
    return;
  }

  const productIds = await fetchCategoryProductIds(pg, profile.favs);
  if (productIds.length === 0) {
    console.log(`  ${profile.name}: sin productos activos en [${profile.favs.join(", ")}] — skip`);
    return;
  }

  const totalEvents = randInt(40, 60);
  const nSearch = randInt(3, 5);
  const nClicks = randInt(3, 5);
  const nViews = totalEvents - nSearch - nClicks;
  // Al menos 5 product_view por sesión: 3 se queman en el warmup de cohorte
  // (session/shift-detection.ts WARMUP_SIZE=3) antes de que el vector empiece
  // a moverse — con menos, una sesión entera podría no aportar nada.
  const nDays = Math.min(randInt(6, 9), Math.floor(nViews / 5));
  const days = pickDays(nDays);

  const viewsPerDay = days.map((_, i) => Math.floor(nViews / nDays) + (i < nViews % nDays ? 1 : 0));
  const searchPerDay = new Array(nDays).fill(0);
  for (let i = 0; i < nSearch; i++) searchPerDay[i % nDays]++;
  const clicksPerDay = new Array(nDays).fill(0);
  for (let i = 0; i < nClicks; i++) clicksPerDay[i % nDays]++;

  const searchQueries = profile.favs.flatMap((c) => SEARCH_TEMPLATES[c] ?? []);
  let inserted = 0;

  for (let i = 0; i < days.length; i++) {
    const sessionId = randomUUID();
    let t = Date.now() - days[i] * DAY_MS - randInt(0, 6 * 3600 * 1000);

    // anonymous_sessions upsert (last_seen_at) + session_start sintético — el
    // "first writer" canónico, una vez por sesión (igual que /api/track).
    await ensureIdentityRows(pg, { anonymous_id: anonymousId, session_id: sessionId, user_id: null });

    for (let v = 0; v < viewsPerDay[i]; v++) {
      t += randInt(30_000, 5 * 60_000);
      await trackProductView(pg, anonymousId, sessionId, new Date(t).toISOString(), pick(productIds));
      inserted++;
    }
    for (let s = 0; s < searchPerDay[i]; s++) {
      t += randInt(30_000, 3 * 60_000);
      await insertEvent(
        {
          event_type: "search",
          occurred_at: new Date(t).toISOString(),
          payload: { raw_query: pick(searchQueries), results_count: 10, method: "hybrid_rrf" },
        },
        { pg, anonymous_id: anonymousId, session_id: sessionId, user_id: null },
      );
      inserted++;
    }
    for (let c = 0; c < clicksPerDay[i]; c++) {
      t += randInt(30_000, 3 * 60_000);
      await insertEvent(
        { event_type: "category_click", occurred_at: new Date(t).toISOString(), payload: { category: pick(profile.favs) } },
        { pg, anonymous_id: anonymousId, session_id: sessionId, user_id: null },
      );
      inserted++;
    }
  }

  console.log(`  ${profile.name}: sembrados ${inserted} eventos en ${days.length} sesiones (últimos 14 días)`);
}

async function main() {
  console.log("Sembrando perfiles demo...");
  await withPgDirect(async (pg) => {
    for (const profile of DEMO_PROFILES) {
      await seedProfile(pg, profile);
    }
  });
  console.log("\n→ ahora corre: pnpm cron:profile-recompute && pnpm cron:cohort-centroids");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
