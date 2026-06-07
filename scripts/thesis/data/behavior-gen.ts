#!/usr/bin/env tsx
/**
 * Thesis behavior generator CLI.
 *
 * Generates synthetic users/sessions/events/holdout from the thesis catalog
 * and persists them into the `thesis` Postgres schema using the generative
 * behavior model (src/thesis/data/behavior-model.ts).
 *
 * Pipeline:
 *   1. Load thesis.products catalog → reconstruct SynthProduct[] (no embeddings).
 *   2. sampleBehavior(catalog, { users, days, seed }) → BehaviorOutput.
 *   3. TRUNCATE write targets in FK-safe order.
 *   4. INSERT: anonymous_sessions → sim_users → sim_user_recipients →
 *              sim_sessions → events → holdout.
 *   5. Print counts: events= test-holdout=.
 *
 * Usage:
 *   pnpm thesis:behavior --users 500 --days 60 --seed 42
 *
 * Defaults: --users 500  --days 60  --seed 42
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { parseArgs } from "node:util";
import { getPgClient } from "@/lib/db/pg";
import { sampleBehavior } from "@/thesis/data/behavior-model";
import type { ComplementsBySource } from "@/thesis/data/behavior-model";
import { buildRelations } from "@/thesis/data/relations-model";
import type { SynthProduct } from "@/thesis/data/catalog-model";

// ─── CLI args ─────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    users: { type: "string", default: "500" },
    days:  { type: "string", default: "60" },
    seed:  { type: "string", default: "42" },
  },
});

const USERS = parseInt(values.users!, 10);
const DAYS  = parseInt(values.days!,  10);
const SEED  = parseInt(values.seed!,  10);

// ─── Age-band helper ──────────────────────────────────────────────────────────

/**
 * Map a metadata.age_target {min, max} midpoint to the AgeBand string
 * used by SynthProduct.attrs.ageBand.
 * Boundaries: bebe [0-2], nino [3-12], joven [13-24], adulto [25-59], mayor [60+].
 */
function bandFromAge(ageTarget: { min: number; max: number } | null | undefined): string {
  if (!ageTarget) return "adulto"; // default for null metadata
  const mid = (ageTarget.min + ageTarget.max) / 2;
  if (mid <= 2)  return "bebe";
  if (mid <= 12) return "nino";
  if (mid <= 24) return "joven";
  if (mid <= 59) return "adulto";
  return "mayor";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[behavior] users=${USERS} days=${DAYS} seed=${SEED}`);

  const pg = await getPgClient({ scope: "thesis" });

  try {
    // ── 1. Load catalog from DB ──────────────────────────────────────────────
    console.log("[behavior] Loading catalog from thesis.products …");
    const catalogRes = await pg.query<{
      id: string;
      source_product_id: string;
      metadata: {
        category: string;
        subcategory: string;
        brand: string;
        gender_target: string | null;
        age_target: { min: number; max: number } | null;
        style: string;
        price_band: number;
      };
      price_cents: number;
    }>("SELECT id::text AS id, source_product_id, metadata, price_cents FROM thesis.products");

    if (catalogRes.rows.length === 0) {
      throw new Error("thesis.products is empty — run pnpm thesis:catalog first");
    }

    // Build uuid lookup map: source_product_id → uuid
    const idByName = new Map<string, string>();

    // Reconstruct minimal SynthProduct[] the behavior model needs.
    // Only attrs.subcategory, attrs.gender, attrs.ageBand, attrs.priceBand are read
    // by sampleBehavior(); the rest can be empty/zero defaults.
    const catalog: SynthProduct[] = catalogRes.rows.map((row) => {
      idByName.set(row.source_product_id, row.id);

      const meta = row.metadata;

      return {
        source_product_id: row.source_product_id,
        title: "",
        description: "",
        canonicalText: "",
        price_cents: row.price_cents,
        attrs: {
          category:    meta?.category    ?? "",
          subcategory: meta?.subcategory ?? "",
          brand:       meta?.brand       ?? "",
          gender:      (meta?.gender_target ?? "unisex") as "femenino" | "masculino" | "unisex",
          ageBand:     bandFromAge(meta?.age_target) as "bebe" | "nino" | "joven" | "adulto" | "mayor",
          priceBand:   meta?.price_band  ?? 1,
          style:       meta?.style       ?? "",
        },
        factor_vector: [],
      };
    });

    console.log(`[behavior] Loaded ${catalog.length} products.`);

    // ── 1b. Build GT complement adjacency (source_product_id → complements) ───
    // F0 spec §4.4: complements must co-occur intra-session. We derive the same
    // ground-truth complement graph the relations CLI persists (buildRelations,
    // filtered to relation_type='complement') and pass it to the behavior model
    // so SELF sessions seed complements into the same basket → NPMI recovers them.
    const complementsBySource: ComplementsBySource = (() => {
      const map = new Map<string, string[]>();
      for (const rel of buildRelations(catalog)) {
        if (rel.relation_type !== "complement") continue;
        const arr = map.get(rel.product_a_id) ?? [];
        arr.push(rel.product_b_id);
        map.set(rel.product_a_id, arr);
      }
      return map;
    })();
    console.log(`[behavior] GT complement anchors: ${complementsBySource.size}`);

    // ── 2. Run behavior model ────────────────────────────────────────────────
    console.log("[behavior] Generating synthetic behavior …");
    const out = sampleBehavior(catalog, { users: USERS, days: DAYS, seed: SEED }, complementsBySource);
    console.log(
      `[behavior] Generated: users=${out.users.length} sessions=${out.sessions.length} ` +
      `events=${out.events.length} holdout=${out.holdout.length}`,
    );

    // ── 3. TRUNCATE in FK-safe order ─────────────────────────────────────────
    // We truncate each table individually so FK constraints are satisfied:
    // events → sim_sessions → sim_user_recipients → sim_users → anonymous_sessions
    // holdout has no FK to anonymous_sessions but does reference sim_users indirectly.
    console.log("[behavior] Truncating prior data …");
    await pg.query("TRUNCATE thesis.events CASCADE");
    await pg.query("TRUNCATE thesis.holdout CASCADE");
    await pg.query("TRUNCATE thesis.sim_sessions CASCADE");
    await pg.query("TRUNCATE thesis.sim_user_recipients CASCADE");
    await pg.query("TRUNCATE thesis.sim_users CASCADE");
    await pg.query("TRUNCATE thesis.anonymous_sessions CASCADE");

    // ── Helper: map source_product_id → uuid, fail loudly on miss ────────────
    const pid = (name: string): string => {
      const uuid = idByName.get(name);
      if (!uuid) throw new Error(`source_product_id not found in catalog: ${name}`);
      return uuid;
    };

    // ── 4a. Insert anonymous_sessions + sim_users + recipients ───────────────
    console.log(`[behavior] Inserting ${out.users.length} users …`);
    for (const user of out.users) {
      // anonymous_sessions: anonymous_id = user_id (synthetic users are anonymous)
      await pg.query(
        `INSERT INTO thesis.anonymous_sessions (anonymous_id, user_id)
         VALUES ($1::uuid, $2::uuid)
         ON CONFLICT DO NOTHING`,
        [user.user_id, user.user_id],
      );

      // sim_users
      await pg.query(
        `INSERT INTO thesis.sim_users (user_id, latent_state, p_gift, price_sensitivity)
         VALUES ($1::uuid, $2::jsonb, $3::real, $4::real)`,
        [user.user_id, JSON.stringify(user.latent_state), user.p_gift, user.price_sensitivity],
      );

      // sim_user_recipients
      for (const r of user.recipients) {
        await pg.query(
          `INSERT INTO thesis.sim_user_recipients (id, user_id, relation, gender, age_min, age_max)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)`,
          [r.id, user.user_id, r.relation, r.gender, r.age_min, r.age_max],
        );
      }
    }

    // ── 4b. Insert sim_sessions ──────────────────────────────────────────────
    console.log(`[behavior] Inserting ${out.sessions.length} sessions …`);
    for (const s of out.sessions) {
      await pg.query(
        `INSERT INTO thesis.sim_sessions (session_id, user_id, intent, recipient_id, started_at)
         VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::timestamptz)`,
        [s.session_id, s.user_id, s.intent, s.recipient_id ?? null, s.started_at],
      );
    }

    // ── 4c. Insert events (product_id mapped to uuid via payload) ────────────
    // Batch inserts in groups of 500 to keep individual queries manageable.
    console.log(`[behavior] Inserting ${out.events.length} events …`);
    const EVENT_BATCH = 500;
    for (let i = 0; i < out.events.length; i += EVENT_BATCH) {
      const batch = out.events.slice(i, i + EVENT_BATCH);
      for (const e of batch) {
        const productUuid = pid(e.product_id);
        await pg.query(
          `INSERT INTO thesis.events
             (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1::uuid, $2::uuid, $3, $4::timestamptz, $5::jsonb)`,
          [
            e.user_id,
            e.session_id,
            e.event_type,
            e.occurred_at,
            JSON.stringify({ product_id: productUuid }),
          ],
        );
      }
      if ((i + EVENT_BATCH) % 5000 === 0 || i + EVENT_BATCH >= out.events.length) {
        console.log(`  events inserted: ${Math.min(i + EVENT_BATCH, out.events.length)}/${out.events.length}`);
      }
    }

    // ── 4d. Insert holdout (product_id mapped to uuid) ───────────────────────
    console.log(`[behavior] Inserting ${out.holdout.length} holdout rows …`);
    for (const h of out.holdout) {
      const productUuid = pid(h.product_id);
      await pg.query(
        `INSERT INTO thesis.holdout (user_id, product_id, occurred_at, split)
         VALUES ($1::uuid, $2::uuid, $3::timestamptz, $4)
         ON CONFLICT DO NOTHING`,
        [h.user_id, productUuid, h.occurred_at, h.split],
      );
    }

    // ── 5. Final verification count ──────────────────────────────────────────
    const countRes = await pg.query<{ e: number; t: number }>(
      `SELECT
         (SELECT count(*)::int FROM thesis.events) AS e,
         (SELECT count(*)::int FROM thesis.holdout WHERE split='test') AS t`,
    );
    const { e, t } = countRes.rows[0];
    console.log(`[behavior] events=${e} test-holdout=${t}`);

    if (e === 0) throw new Error("events count is 0 — something went wrong");
    if (t === 0) throw new Error("test-holdout count is 0 — no users had ≥2 purchasing sessions");
  } finally {
    await pg.end();
  }
}

main().catch((err) => {
  console.error("[behavior] FATAL:", err);
  process.exit(1);
});
