import type { Client } from "pg";

export interface CartRowWithProduct {
  product_id: string;
  quantity: number;
  title: string;
  price_cents: number;
  image_url: string | null;
  added_at: string;
}

export async function getCartByUserId(pg: Client, userId: string): Promise<CartRowWithProduct[]> {
  const r = await pg.query(
    `SELECT ci.product_id, ci.quantity, ci.added_at, p.title, p.price_cents, p.image_url
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.user_id = $1
     ORDER BY ci.added_at DESC`,
    [userId],
  );
  return r.rows;
}

export interface PutCartInput {
  user_id: string;
  product_id: string;
  quantity: number;
}

export async function putCartItem(pg: Client, input: PutCartInput): Promise<{ quantity: number }> {
  const r = await pg.query(
    `INSERT INTO cart_items (user_id, product_id, quantity)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, product_id) DO UPDATE SET
       quantity = cart_items.quantity + EXCLUDED.quantity,
       updated_at = now()
     RETURNING quantity`,
    [input.user_id, input.product_id, input.quantity],
  );
  return { quantity: r.rows[0].quantity };
}

export async function removeCartItem(
  pg: Client,
  input: { user_id: string; product_id: string; quantity: number },
): Promise<void> {
  // Decrement only when the remaining quantity stays positive; otherwise delete.
  await pg.query(
    `WITH updated AS (
       UPDATE cart_items
       SET quantity = quantity - $3, updated_at = now()
       WHERE user_id = $1 AND product_id = $2 AND quantity > $3
       RETURNING user_id, product_id
     )
     DELETE FROM cart_items
     WHERE user_id = $1 AND product_id = $2
       AND NOT EXISTS (SELECT 1 FROM updated)`,
    [input.user_id, input.product_id, input.quantity],
  );
}

export async function clearCart(pg: Client, userId: string): Promise<void> {
  await pg.query(`DELETE FROM cart_items WHERE user_id = $1`, [userId]);
}
