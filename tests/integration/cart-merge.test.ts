import { describe, test, expect, beforeEach } from "vitest";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { createUser, seedProduct } from "@/../tests/helpers/seed";
import { mergeLocalCartIntoUser } from "@/sectors/a-tracking/cart-repo";

beforeEach(async () => {
  await truncateTestTables(["cart_items", "products", "users", "anonymous_sessions", "events"]);
});

describe("mergeLocalCartIntoUser", () => {
  test("inserts new items when user cart is empty", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      const p = await seedProduct(pg);
      await mergeLocalCartIntoUser(pg, user.id, [{ product_id: p.id, quantity: 2 }]);
      const r = await pg.query(`SELECT quantity FROM cart_items WHERE user_id=$1 AND product_id=$2`, [user.id, p.id]);
      expect(r.rows[0].quantity).toBe(2);
    });
  });

  test("sums quantities when items overlap with existing user cart", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      const p = await seedProduct(pg);
      await pg.query(`INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, 3)`, [user.id, p.id]);
      await mergeLocalCartIntoUser(pg, user.id, [{ product_id: p.id, quantity: 4 }]);
      const r = await pg.query(`SELECT quantity FROM cart_items WHERE user_id=$1 AND product_id=$2`, [user.id, p.id]);
      expect(r.rows[0].quantity).toBe(7);
    });
  });

  test("ignores invalid items (missing product, qty <=0)", async () => {
    await withTestDb(async (pg) => {
      const user = await createUser(pg);
      await mergeLocalCartIntoUser(pg, user.id, [
        { product_id: "00000000-0000-0000-0000-000000000000", quantity: 1 }, // FK fail → silently skipped
        { product_id: "any", quantity: 0 } as never, // qty<=0 skipped
      ]);
      const r = await pg.query(`SELECT count(*)::int FROM cart_items`);
      expect(r.rows[0].count).toBe(0);
    });
  });
});
