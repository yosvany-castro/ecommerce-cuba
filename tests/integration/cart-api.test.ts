import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { createUser, seedProduct } from "@/../tests/helpers/seed";
import { getCartByUserId, putCartItem, removeCartItem, clearCart } from "@/sectors/a-tracking/cart-repo";

beforeEach(async () => {
  await truncateTestTables(["cart_items", "products", "users", "anonymous_sessions", "events"]);
});

describe("cart_items repo", () => {
  test("putCartItem inserts a row when none exists", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      const product = await seedProduct(pg);
      const r = await putCartItem(pg, { user_id: user.id, product_id: product.id, quantity: 2 });
      expect(r.quantity).toBe(2);
      const row = await pg.query(`SELECT quantity FROM cart_items WHERE user_id=$1 AND product_id=$2`, [user.id, product.id]);
      expect(row.rows[0].quantity).toBe(2);
    });
  });

  test("putCartItem upserts (sums) when row exists", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      const product = await seedProduct(pg);
      await putCartItem(pg, { user_id: user.id, product_id: product.id, quantity: 1 });
      await putCartItem(pg, { user_id: user.id, product_id: product.id, quantity: 2 });
      const row = await pg.query(`SELECT quantity FROM cart_items WHERE user_id=$1 AND product_id=$2`, [user.id, product.id]);
      expect(row.rows[0].quantity).toBe(3);
    });
  });

  test("removeCartItem decrements; quantity reaching 0 deletes the row", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      const product = await seedProduct(pg);
      await putCartItem(pg, { user_id: user.id, product_id: product.id, quantity: 3 });
      await removeCartItem(pg, { user_id: user.id, product_id: product.id, quantity: 1 });
      let row = await pg.query(`SELECT quantity FROM cart_items WHERE user_id=$1 AND product_id=$2`, [user.id, product.id]);
      expect(row.rows[0].quantity).toBe(2);
      await removeCartItem(pg, { user_id: user.id, product_id: product.id, quantity: 5 });
      row = await pg.query(`SELECT count(*)::int FROM cart_items WHERE user_id=$1 AND product_id=$2`, [user.id, product.id]);
      expect(row.rows[0].count).toBe(0);
    });
  });

  test("getCartByUserId returns items joined with product info", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      const p1 = await seedProduct(pg, { title: "P1", price_cents: 1000 });
      const p2 = await seedProduct(pg, { title: "P2", price_cents: 2000 });
      await putCartItem(pg, { user_id: user.id, product_id: p1.id, quantity: 1 });
      await putCartItem(pg, { user_id: user.id, product_id: p2.id, quantity: 2 });
      const items = await getCartByUserId(pg, user.id);
      expect(items).toHaveLength(2);
      const byId = Object.fromEntries(items.map((i) => [i.product_id, i]));
      expect(byId[p1.id].title).toBe("P1");
      expect(byId[p1.id].quantity).toBe(1);
      expect(byId[p2.id].quantity).toBe(2);
    });
  });

  test("clearCart removes all rows for a user but not for others", async () => {
    await withTestDb(async (pg) => {
      const userA = await createUser(pg, { email: "a@x.com" });
      const userB = await createUser(pg, { email: "b@x.com" });
      const product = await seedProduct(pg);
      await putCartItem(pg, { user_id: userA.id, product_id: product.id, quantity: 1 });
      await putCartItem(pg, { user_id: userB.id, product_id: product.id, quantity: 1 });
      await clearCart(pg, userA.id);
      const all = await pg.query(`SELECT user_id FROM cart_items`);
      expect(all.rows.map((r: { user_id: string }) => r.user_id)).toEqual([userB.id]);
    });
  });
});
