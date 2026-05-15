import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import {
  handleDismissAutoExclude,
  DISMISS_TTL_DAYS,
} from "@/sectors/d-personalization/exclusion/dismiss-handler";

beforeEach(async () => {
  await truncateTestTables(["excluded_products", "products"]);
});

describe("dismiss → excluded_products", () => {
  test("TTL is 14 days", () => {
    expect(DISMISS_TTL_DAYS).toBe(14);
  });

  test("inserts row with ttl_until ≈ now + 14 days for anonymous user", async () => {
    await withTestDb(async (pg) => {
      const p = await seedProductWithEmbedding(pg, { title: "X" });
      const anonymous_id = randomUUID();
      await handleDismissAutoExclude(
        { anonymous_id, user_id: null, product_id: p.id },
        pg,
      );
      const r = await pg.query(
        `SELECT ttl_until, excluded_at, anonymous_id::text, user_id::text
         FROM excluded_products WHERE product_id = $1`,
        [p.id],
      );
      expect(r.rows.length).toBe(1);
      expect(r.rows[0].anonymous_id).toBe(anonymous_id);
      expect(r.rows[0].user_id).toBeNull();
      const ttl = new Date(r.rows[0].ttl_until).getTime();
      const ex = new Date(r.rows[0].excluded_at).getTime();
      const diffDays = (ttl - ex) / (24 * 3600 * 1000);
      expect(Math.abs(diffDays - 14)).toBeLessThan(0.1);
    });
  });

  test("idempotent: two dismisses on same product → one row (ON CONFLICT)", async () => {
    await withTestDb(async (pg) => {
      const p = await seedProductWithEmbedding(pg, { title: "Y" });
      const anonymous_id = randomUUID();
      await handleDismissAutoExclude(
        { anonymous_id, user_id: null, product_id: p.id },
        pg,
      );
      await handleDismissAutoExclude(
        { anonymous_id, user_id: null, product_id: p.id },
        pg,
      );
      const r = await pg.query(
        `SELECT count(*)::int AS c FROM excluded_products WHERE product_id = $1`,
        [p.id],
      );
      expect(r.rows[0].c).toBe(1);
    });
  });

  test("when user_id is present, exclusion is stored against user_id (anonymous_id null)", async () => {
    await withTestDb(async (pg) => {
      const p = await seedProductWithEmbedding(pg, { title: "Z" });
      const u = await pg.query(
        `INSERT INTO users (email) VALUES ($1) RETURNING id::text`,
        [`u-${randomUUID()}@test.local`],
      );
      const user_id = u.rows[0].id;
      const anonymous_id = randomUUID();
      await handleDismissAutoExclude(
        { anonymous_id, user_id, product_id: p.id },
        pg,
      );
      const r = await pg.query(
        `SELECT anonymous_id::text, user_id::text
         FROM excluded_products WHERE product_id = $1`,
        [p.id],
      );
      expect(r.rows[0].anonymous_id).toBeNull();
      expect(r.rows[0].user_id).toBe(user_id);
    });
  });
});
