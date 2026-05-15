import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { captureCoOccurrence } from "@/sectors/d-personalization/co-occurrence/capture";

beforeEach(async () => {
  await truncateTestTables(["co_occurrence", "events", "products"]);
});

describe("captureCoOccurrence", () => {
  test("inserts pair (a<b) when two product_views co-occur in same session", async () => {
    await withTestDb(async (pg) => {
      const pA = await seedProductWithEmbedding(pg, { title: "A" });
      const pB = await seedProductWithEmbedding(pg, { title: "B" });
      const session_id = randomUUID();
      const anonymous_id = randomUUID();
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', now() - interval '5 minutes', $3::jsonb)`,
        [anonymous_id, session_id, JSON.stringify({ product_id: pA.id, source: "home" })],
      );

      const n = await captureCoOccurrence(
        {
          session_id,
          current_product_id: pB.id,
          current_event_type: "product_view",
        },
        pg,
      );
      expect(n).toBe(1);

      const r = await pg.query(
        `SELECT product_a_id::text AS a, product_b_id::text AS b, count
         FROM co_occurrence`,
      );
      expect(r.rows.length).toBe(1);
      const [low, high] = pA.id < pB.id ? [pA.id, pB.id] : [pB.id, pA.id];
      expect(r.rows[0].a).toBe(low);
      expect(r.rows[0].b).toBe(high);
      expect(Number(r.rows[0].count)).toBe(1);
    });
  });

  test("MAX weight when current is purchase and other is view", async () => {
    await withTestDb(async (pg) => {
      const pA = await seedProductWithEmbedding(pg, { title: "A" });
      const pB = await seedProductWithEmbedding(pg, { title: "B" });
      const session_id = randomUUID();
      const anonymous_id = randomUUID();
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', now() - interval '2 minutes', $3::jsonb)`,
        [anonymous_id, session_id, JSON.stringify({ product_id: pA.id, source: "home" })],
      );
      await captureCoOccurrence(
        {
          session_id,
          current_product_id: pB.id,
          current_event_type: "purchase",
        },
        pg,
      );
      const r = await pg.query(`SELECT count FROM co_occurrence`);
      expect(Number(r.rows[0].count)).toBe(5);
    });
  });

  test("ignores events outside 30 min window", async () => {
    await withTestDb(async (pg) => {
      const pA = await seedProductWithEmbedding(pg, { title: "A" });
      const pB = await seedProductWithEmbedding(pg, { title: "B" });
      const session_id = randomUUID();
      const anonymous_id = randomUUID();
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', now() - interval '1 hour', $3::jsonb)`,
        [anonymous_id, session_id, JSON.stringify({ product_id: pA.id, source: "home" })],
      );
      await captureCoOccurrence(
        {
          session_id,
          current_product_id: pB.id,
          current_event_type: "product_view",
        },
        pg,
      );
      const r = await pg.query(`SELECT count(*)::int AS c FROM co_occurrence`);
      expect(r.rows[0].c).toBe(0);
    });
  });

  test("idempotent: count increments per call", async () => {
    await withTestDb(async (pg) => {
      const pA = await seedProductWithEmbedding(pg, { title: "A" });
      const pB = await seedProductWithEmbedding(pg, { title: "B" });
      const session_id = randomUUID();
      const anonymous_id = randomUUID();
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', now() - interval '5 minutes', $3::jsonb)`,
        [anonymous_id, session_id, JSON.stringify({ product_id: pA.id, source: "home" })],
      );
      await captureCoOccurrence(
        { session_id, current_product_id: pB.id, current_event_type: "product_view" },
        pg,
      );
      await captureCoOccurrence(
        { session_id, current_product_id: pB.id, current_event_type: "product_view" },
        pg,
      );
      const r = await pg.query(`SELECT count FROM co_occurrence`);
      expect(Number(r.rows[0].count)).toBe(2);
    });
  });
});
