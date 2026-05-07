import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { createUser, createAnonymousSession, seedProduct } from "@/../tests/helpers/seed";
import { putCartItem } from "@/sectors/a-tracking/cart-repo";
import { createCheckoutOrder } from "@/sectors/a-tracking/checkout";

beforeEach(async () => {
  await truncateTestTables(["events", "order_items", "orders", "cart_items", "products", "users", "anonymous_sessions"]);
});

describe("createCheckoutOrder", () => {
  test("creates order with status='pendiente', items with snapshot, totals correct, clears cart, emits purchase event", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      const anonId = await createAnonymousSession(pg);
      const p1 = await seedProduct(pg, { title: "P1", price_cents: 1000 });
      const p2 = await seedProduct(pg, { title: "P2", price_cents: 2500 });
      await putCartItem(pg, { user_id: user.id, product_id: p1.id, quantity: 2 });
      await putCartItem(pg, { user_id: user.id, product_id: p2.id, quantity: 1 });
      const sessionId = "11111111-1111-1111-1111-111111111111";

      const result = await createCheckoutOrder(pg, {
        user_id: user.id,
        anonymous_id: anonId,
        session_id: sessionId,
      });
      expect(result.order_id).toMatch(/^[0-9a-f-]{36}$/);

      const order = (await pg.query(`SELECT * FROM orders WHERE id=$1`, [result.order_id])).rows[0];
      expect(order.user_id).toBe(user.id);
      expect(order.status).toBe("pendiente");
      expect(order.total_charged_cents).toBe(1000 * 2 + 2500); // 4500
      expect(order.total_cost_cents).toBe(Math.round(4500 * 0.6));

      const items = (await pg.query(`SELECT product_id, quantity, unit_price_cents, product_snapshot FROM order_items WHERE order_id=$1 ORDER BY product_id`, [result.order_id])).rows;
      expect(items).toHaveLength(2);
      const byPid = Object.fromEntries(items.map((r: { product_id: string; quantity: number; unit_price_cents: number; product_snapshot: { title: string } }) => [r.product_id, r]));
      expect(byPid[p1.id].quantity).toBe(2);
      expect(byPid[p1.id].unit_price_cents).toBe(1000);
      expect(byPid[p1.id].product_snapshot.title).toBe("P1");

      const cart = await pg.query(`SELECT count(*)::int FROM cart_items WHERE user_id=$1`, [user.id]);
      expect(cart.rows[0].count).toBe(0);

      const ev = await pg.query(`SELECT event_type, payload FROM events WHERE user_id=$1 AND event_type='purchase'`, [user.id]);
      expect(ev.rows).toHaveLength(1);
      expect(ev.rows[0].payload.order_id).toBe(result.order_id);
      expect(ev.rows[0].payload.total_cents).toBe(4500);
      expect(ev.rows[0].payload.product_ids).toEqual(expect.arrayContaining([p1.id, p2.id]));
    });
  });

  test("throws when cart is empty", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      const anonId = await createAnonymousSession(pg);
      await expect(
        createCheckoutOrder(pg, { user_id: user.id, anonymous_id: anonId, session_id: "11111111-1111-1111-1111-111111111111" }),
      ).rejects.toThrow(/empty_cart/);
    });
  });
});
