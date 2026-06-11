import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import {
  generateFeed,
  serveFeedPage,
} from "@/sectors/d-personalization/feed";
import { GET as feedPageGET } from "@/app/api/feed/page/route";
import { PAGE_SIZE_CURSOR } from "@/sectors/d-personalization/slate/constants";

/**
 * Etapa C lifecycle — ONE test, one seeding pass (Voyage embeds are real API
 * calls; frugality memory applies): miss→materialize, hit, cursor paging with
 * absolute positions, exhaustion, corrupt-cursor regeneration with dedupe,
 * and the HTTP route DTO.
 */

beforeEach(async () => {
  await truncateTestTables([
    "feed_impressions",
    "feed_slates",
    "events",
    "products",
    "product_popularity_7d",
    "anonymous_sessions",
    "user_profiles",
  ]);
});

const N_PRODUCTS = 26;

describe("slate serving lifecycle (C1/C2)", () => {
  test("miss→hit→cursor pages→end→regeneración con dedupe→ruta HTTP", async () => {
    await withTestDb(async (pg) => {
      // ── Seed: products + view events from ANOTHER visitor so popular-global
      //    fills the fusion (a store with zero events = catalog fallback, no slate).
      const productIds: string[] = [];
      for (let i = 0; i < N_PRODUCTS; i++) {
        const { id } = await seedProductWithEmbedding(pg, {
          title: `Producto slate ${i}`,
          metadata: { category: i % 2 === 0 ? "audio" : "hogar" },
        });
        productIds.push(id);
      }
      const otherAnon = randomUUID();
      const otherSess = randomUUID();
      for (const pid of productIds) {
        await pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, 'product_view', now() - interval '1 hour', $3::jsonb)`,
          [otherAnon, otherSess, JSON.stringify({ product_id: pid })],
        );
      }

      const anonymous_id = randomUUID();
      const session_id = randomUUID();
      const identity = { user_id: null, anonymous_id, session_id };

      // ── 1. MISS: first call materializes a slate to full candidate depth. ──
      const page1 = await generateFeed({ ...identity, limit: 20 }, pg);
      expect(page1.length).toBe(20);
      const slates = await pg.query(
        `SELECT slate_id, version, jsonb_array_length(items) AS depth FROM feed_slates WHERE session_id = $1`,
        [session_id],
      );
      expect(slates.rows).toHaveLength(1);
      const slateId = slates.rows[0].slate_id;
      expect(Number(slates.rows[0].depth)).toBe(N_PRODUCTS); // depth = todos los candidatos (< SLATE_DEPTH)

      // Impressions: feed_request_id = slate_id, posiciones absolutas 1..20.
      const imp1 = await pg.query(
        `SELECT count(*)::int AS c, max(position) AS maxp, min(position) AS minp
         FROM feed_impressions WHERE feed_request_id = $1`,
        [slateId],
      );
      expect(imp1.rows[0]).toEqual({ c: 20, maxp: 20, minp: 1 });

      // ── 2. HIT: reload serves the SAME items from the snapshot, no new slate,
      //    impressions idempotent (unique slate_id×position). ──
      const page1again = await generateFeed({ ...identity, limit: 20 }, pg);
      expect(page1again.map((x) => x.product.id)).toEqual(page1.map((x) => x.product.id));
      const slateCount = await pg.query(
        `SELECT count(*)::int AS c FROM feed_slates WHERE session_id = $1`,
        [session_id],
      );
      expect(slateCount.rows[0].c).toBe(1);
      const imp2 = await pg.query(
        `SELECT count(*)::int AS c FROM feed_impressions WHERE feed_request_id = $1`,
        [slateId],
      );
      expect(imp2.rows[0].c).toBe(20); // sin duplicados

      // ── 3. CURSOR: page 2 continues at absolute positions 21+, no overlap. ──
      const first = await serveFeedPage({ ...identity, cursor: null }, pg);
      expect(first.slate_id).toBe(slateId);
      expect(first.next_cursor).not.toBeNull();

      const page2 = await serveFeedPage({ ...identity, cursor: first.next_cursor }, pg);
      expect(page2.slate_id).toBe(slateId);
      expect(page2.items.length).toBe(Math.min(PAGE_SIZE_CURSOR, N_PRODUCTS - 20));
      const ids1 = new Set(page1.map((x) => x.product.id));
      for (const it of page2.items) expect(ids1.has(it.product.id)).toBe(false);
      const imp3 = await pg.query(
        `SELECT count(*)::int AS c, max(position) AS maxp FROM feed_impressions WHERE feed_request_id = $1`,
        [slateId],
      );
      expect(imp3.rows[0].c).toBe(N_PRODUCTS);
      expect(Number(imp3.rows[0].maxp)).toBe(N_PRODUCTS); // posiciones ABSOLUTAS

      // ── 4. END: exhausted slate ⇒ explicit end of feed. ──
      expect(page2.next_cursor).toBeNull();
      const afterEnd = await serveFeedPage(
        { ...identity, cursor: first.next_cursor }, // re-pedir la misma página es idempotente
        pg,
      );
      expect(afterEnd.items.length).toBeGreaterThan(0); // re-serve del snapshot, no error

      // ── 5. CORRUPT cursor: transparent regeneration, deduped against todo lo servido. ──
      const regen = await serveFeedPage({ ...identity, cursor: "garbage!!" }, pg);
      const servedIds = new Set([...page1.map((x) => x.product.id), ...page2.items.map((x) => x.product.id)]);
      for (const it of regen.items) expect(servedIds.has(it.product.id)).toBe(false);
      // (con 26 productos y 26 servidos, la regeneración legítimamente puede venir vacía)

      // ── 6. HTTP route: DTO slim + headers. ──
      const req = new NextRequest(`http://localhost:3000/api/feed/page?cursor=${first.next_cursor}`, {
        headers: { cookie: `anonymous_id=${anonymous_id}; session_id=${session_id}` },
      });
      const res = await feedPageGET(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("server-timing")).toMatch(/feed_page;dur=/);
      const body = (await res.json()) as {
        items: { id: string; title: string; price_cents: number; description?: string }[];
        next_cursor: string | null;
        slate_id: string;
      };
      expect(body.slate_id).toBe(slateId);
      expect(body.items.length).toBeGreaterThan(0);
      // DTO slim: jamás description/metadata en el grid.
      expect(body.items[0]).not.toHaveProperty("description");
      expect(body.items[0]).toHaveProperty("price_cents");
    });
  }, 240_000);
});
