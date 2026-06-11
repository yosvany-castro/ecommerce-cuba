import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { POST as trackPOST } from "@/app/api/track/route";

beforeEach(async () => {
  await truncateTestTables(["events", "anonymous_sessions", "user_profiles"]);
});

function makeTrackReq(body: unknown, cookies: { anon: string; sess: string }): NextRequest {
  return new NextRequest("http://localhost:3000/api/track", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `anonymous_id=${cookies.anon}; session_id=${cookies.sess}`,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/track batch (C4)", () => {
  test("N eventos en UN POST; el retry del MISMO batch (client_event_id) no duplica nada", async () => {
    await withTestDb(async (pg) => {
      const anon = randomUUID();
      const sess = randomUUID();
      const batch = {
        events: [
          {
            client_event_id: randomUUID(),
            event_type: "product_view",
            occurred_at: new Date().toISOString(),
            payload: { product_id: randomUUID(), source: "home" },
          },
          {
            client_event_id: randomUUID(),
            event_type: "search",
            occurred_at: new Date().toISOString(),
            payload: { raw_query: "audifonos", results_count: 3, method: "hybrid_rrf" },
          },
        ],
      };

      const res1 = await trackPOST(makeTrackReq(batch, { anon, sess }));
      expect(res1.status).toBe(200);
      const body1 = (await res1.json()) as { results: unknown[] };
      expect(body1.results).toHaveLength(2);

      // Retry del MISMO batch (sendBeacon reenviado tras red dudosa):
      const res2 = await trackPOST(makeTrackReq(batch, { anon, sess }));
      expect(res2.status).toBe(200);

      const events = await pg.query(
        `SELECT event_type FROM events WHERE anonymous_id = $1 ORDER BY event_type`,
        [anon],
      );
      // 2 del batch + 1 session_start sintetizado por el first-writer. Sin duplicados.
      expect(events.rows.map((r) => r.event_type)).toEqual([
        "product_view",
        "search",
        "session_start",
      ]);
    });
  });

  test("envelope suelto sigue funcionando (back-compat) y >50 eventos se rechaza", async () => {
    await withTestDb(async (pg) => {
      const anon = randomUUID();
      const sess = randomUUID();
      const single = await trackPOST(
        makeTrackReq(
          {
            event_type: "product_view",
            occurred_at: new Date().toISOString(),
            payload: { product_id: randomUUID(), source: "home" },
          },
          { anon, sess },
        ),
      );
      expect(single.status).toBe(200);
      const r = await pg.query(`SELECT count(*)::int AS c FROM events WHERE anonymous_id = $1`, [anon]);
      expect(r.rows[0].c).toBe(2); // evento + session_start

      const tooMany = await trackPOST(
        makeTrackReq(
          {
            events: Array.from({ length: 51 }, () => ({
              event_type: "product_view",
              occurred_at: new Date().toISOString(),
              payload: { product_id: randomUUID(), source: "home" },
            })),
          },
          { anon, sess },
        ),
      );
      expect(tooMany.status).toBe(400);
    });
  });
});
