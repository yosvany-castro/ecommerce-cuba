import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { Client } from "pg";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { POST as seenPOST } from "@/app/api/feed/seen/route";
import { applyFatigueExclusions } from "@/sectors/d-personalization/exclusion/fatigue";

beforeEach(async () => {
  await truncateTestTables([
    "feed_impressions",
    "excluded_products",
    "user_profiles",
    "anonymous_sessions",
    "events",
    "products",
  ]);
});

async function seedImpression(
  pg: Client,
  o: { slate: string; session: string; pos: number; product: string; profile?: string | null; seen?: boolean },
) {
  await pg.query(
    `INSERT INTO feed_impressions
       (feed_request_id, user_profile_id, session_id, position, product_id, source, propensity, seen_at)
     VALUES ($1, $2, $3, $4, $5, 'exploit', 0.9, $6)`,
    [o.slate, o.profile ?? null, o.session, o.pos, o.product, o.seen ? new Date() : null],
  );
}

describe("POST /api/feed/seen (E3)", () => {
  test("estampa seen_at solo en impresiones de LA sesión dueña; idempotente; primera vista gana", async () => {
    await withTestDb(async (pg) => {
      const slate = randomUUID();
      const mySession = randomUUID();
      const otherSession = randomUUID();
      const p1 = randomUUID();
      const p2 = randomUUID();
      await seedImpression(pg, { slate, session: mySession, pos: 1, product: p1 });
      await seedImpression(pg, { slate, session: mySession, pos: 2, product: p2 });
      const foreignSlate = randomUUID();
      await seedImpression(pg, { slate: foreignSlate, session: otherSession, pos: 1, product: p1 });

      const post = (slateId: string, positions: number[]) =>
        seenPOST(
          new NextRequest("http://localhost:3000/api/feed/seen", {
            method: "POST",
            headers: { "content-type": "application/json", cookie: `session_id=${mySession}` },
            body: JSON.stringify({ slate_id: slateId, positions }),
          }),
        );

      const r1 = await post(slate, [1, 2]);
      expect(((await r1.json()) as { updated: number }).updated).toBe(2);
      // idempotente: segunda estampa no pisa la primera
      const r2 = await post(slate, [1, 2]);
      expect(((await r2.json()) as { updated: number }).updated).toBe(0);
      // slate ajeno con MI cookie: cero filas (la sesión debe ser dueña)
      const r3 = await post(foreignSlate, [1]);
      expect(((await r3.json()) as { updated: number }).updated).toBe(0);

      const seen = await pg.query(
        `SELECT count(*)::int AS c FROM feed_impressions WHERE seen_at IS NOT NULL`,
      );
      expect(seen.rows[0].c).toBe(2);
    });
  });
});

describe("applyFatigueExclusions (E3)", () => {
  test("≥3 VISTOS sin click ⇒ exclusión 'fatigue'; un click absuelve; sin duplicados", async () => {
    await withTestDb(async (pg) => {
      const anon = randomUUID();
      await pg.query(`INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1)`, [anon]);
      const profile = (
        await pg.query(
          `INSERT INTO user_profiles (anonymous_id, n_events) VALUES ($1, 0) RETURNING id::text`,
          [anon],
        )
      ).rows[0].id as string;
      const prod = (
        await pg.query(
          `INSERT INTO products (source, source_product_id, title, description, price_cents)
           VALUES ('test', $1, 'Fatigado', '', 1000) RETURNING id::text`,
          [randomUUID()],
        )
      ).rows[0].id as string;
      const clicked = (
        await pg.query(
          `INSERT INTO products (source, source_product_id, title, description, price_cents)
           VALUES ('test', $1, 'Clickeado', '', 1000) RETURNING id::text`,
          [randomUUID()],
        )
      ).rows[0].id as string;

      const session = randomUUID();
      // 3 vistos del fatigado (slates distintos = exposiciones distintas) y 3 del clickeado
      for (let i = 0; i < 3; i++) {
        await seedImpression(pg, { slate: randomUUID(), session, pos: i + 1, product: prod, profile, seen: true });
        await seedImpression(pg, { slate: randomUUID(), session, pos: i + 1, product: clicked, profile, seen: true });
      }
      // pero el clickeado tiene un product_view del MISMO usuario → absuelto
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', now(), $3::jsonb)`,
        [anon, session, JSON.stringify({ product_id: clicked })],
      );
      // y 2 vistos de un tercero (bajo umbral) → no se toca
      const under = randomUUID();
      for (let i = 0; i < 2; i++) {
        await seedImpression(pg, { slate: randomUUID(), session, pos: i + 1, product: under, profile, seen: true });
      }

      const first = await applyFatigueExclusions(pg);
      expect(first.excluded).toBe(1);
      const ex = await pg.query(
        `SELECT product_id::text AS pid, reason FROM excluded_products WHERE anonymous_id = $1`,
        [anon],
      );
      expect(ex.rows).toEqual([{ pid: prod, reason: "fatigue" }]);

      // re-correr el cron no duplica mientras la exclusión viva
      const second = await applyFatigueExclusions(pg);
      expect(second.excluded).toBe(0);
    });
  });
});
