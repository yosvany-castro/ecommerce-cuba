import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { createCheckoutOrder } from "@/sectors/a-tracking/checkout";

beforeEach(async () => {
  await truncateTestTables([
    "purchase_attributions",
    "excluded_products",
    "order_items",
    "orders",
    "cart_items",
    "feed_impressions",
    "events",
    "user_profiles",
    "users",
    "anonymous_sessions",
    "products",
  ]);
});

async function seedUserWithCart(pg: Client, productIds: string[]) {
  const user = (
    await pg.query(
      `INSERT INTO users (auth_sub, email) VALUES ($1, $2) RETURNING id::text`,
      [`auth0|${randomUUID()}`, `${randomUUID()}@x.com`],
    )
  ).rows[0].id as string;
  for (const pid of productIds) {
    await pg.query(`INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, 1)`, [user, pid]);
  }
  return user;
}

async function seedProduct(pg: Client, price = 2000): Promise<string> {
  return (
    await pg.query(
      `INSERT INTO products (source, source_product_id, title, description, price_cents)
       VALUES ('test', $1, 'P', '', $2) RETURNING id::text`,
      [randomUUID(), price],
    )
  ).rows[0].id as string;
}

describe("atribución de compra (F1)", () => {
  test("compra desde el feed → enlaza a la impresión (seen) ; compra orgánica → fila con NULL; exclusión 'purchased'", async () => {
    await withTestDb(async (pg) => {
      const fromFeed = await seedProduct(pg, 2000);
      const organic = await seedProduct(pg, 3000);
      const user = await seedUserWithCart(pg, [fromFeed, organic]);
      const anon = randomUUID();
      const session = randomUUID();
      await pg.query(`INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1)`, [anon]);

      // impresión previa (vista) SOLO del primero
      const slate = randomUUID();
      await pg.query(
        `INSERT INTO feed_impressions
           (feed_request_id, session_id, position, product_id, source, propensity, policy, seen_at)
         VALUES ($1, $2, 3, $3, 'exploit', 0.9, 'default', now())`,
        [slate, session, fromFeed],
      );

      const { order_id } = await createCheckoutOrder(pg, {
        user_id: user,
        anonymous_id: anon,
        session_id: session,
      });

      const attrs = await pg.query(
        `SELECT product_id::text AS pid, feed_request_id::text AS fid, position, seen, unit_price_cents
         FROM purchase_attributions WHERE order_id = $1 ORDER BY unit_price_cents`,
        [order_id],
      );
      expect(attrs.rows).toHaveLength(2);
      const [feedRow, organicRow] = attrs.rows;
      expect(feedRow.pid).toBe(fromFeed);
      expect(feedRow.fid).toBe(slate);
      expect(feedRow.position).toBe(3);
      expect(feedRow.seen).toBe(true);
      expect(feedRow.unit_price_cents).toBe(2000);
      // orgánica: contada, sin crédito del feed (NULL — cero survivor bias)
      expect(organicRow.pid).toBe(organic);
      expect(organicRow.fid).toBeNull();

      // post-compra: lo comprado descansa 30 días con reason='purchased'
      const ex = await pg.query(
        `SELECT product_id::text AS pid, reason FROM excluded_products WHERE user_id = $1 ORDER BY pid`,
        [user],
      );
      expect(ex.rows.map((r) => r.reason)).toEqual(["purchased", "purchased"]);
      expect(new Set(ex.rows.map((r) => r.pid))).toEqual(new Set([fromFeed, organic]));
    });
  });
});
