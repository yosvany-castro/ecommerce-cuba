import type { Client } from "pg";
import { insertEvent } from "./events/insert";
import { attributePurchaseAndExclude } from "./attribution";
import { findVariantPriceCents, type CuratedAttrs } from "@/sectors/b-catalog/enrichment/attrs";

export interface CheckoutInput {
  user_id: string;
  anonymous_id: string;
  session_id: string;
  // Selección color/talla del carrito LOCAL (localStorage, ver cart.tsx),
  // cruzada por product_id con las filas de cart_items — esa tabla NO tiene
  // columnas color/size (UNIQUE(user_id,product_id), ver cart-repo.ts), así
  // que es el camino de menor cambio para que la variante viaje también en
  // el checkout autenticado (ver nota en /api/checkout/route.ts). Si el
  // carrito local trae 2+ variantes del MISMO product_id, cart_items ya las
  // colapsó en una sola fila al sincronizar — se usa la primera selección
  // encontrada para ese product_id; limitación preexistente del carrito
  // autenticado, no de este checkout.
  items?: { product_id: string; color?: string | null; size?: string | null }[];
}

export interface CheckoutResult {
  order_id: string;
}

export async function createCheckoutOrder(
  pg: Client,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  await pg.query("BEGIN");
  try {
    const cartRows = await pg.query(
      `SELECT ci.product_id, ci.quantity,
              p.title, p.description, p.price_cents, p.currency, p.image_url, p.metadata
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
       WHERE ci.user_id = $1`,
      [input.user_id],
    );
    if (cartRows.rows.length === 0) {
      throw new Error("empty_cart");
    }

    const variantByProduct = new Map<string, { color: string | null; size: string | null }>();
    for (const it of input.items ?? []) {
      if (!variantByProduct.has(it.product_id)) {
        variantByProduct.set(it.product_id, { color: it.color ?? null, size: it.size ?? null });
      }
    }

    // Precio de línea: si el cliente eligió color/talla, se valida contra
    // products.metadata.attrs.variants — el precio del cliente JAMÁS se usa.
    const lines = cartRows.rows.map(
      (row: {
        product_id: string;
        quantity: number;
        title: string;
        description: string | null;
        price_cents: number;
        currency: string;
        image_url: string | null;
        metadata: unknown;
      }) => {
        const sel = variantByProduct.get(row.product_id) ?? null;
        const meta = row.metadata as { attrs?: CuratedAttrs } | null;
        const variantPrice = sel ? findVariantPriceCents(meta?.attrs?.variants, sel.color, sel.size) : undefined;
        const unitPriceCents = variantPrice ?? row.price_cents;
        return { row, sel, unitPriceCents };
      },
    );

    const totalCharged = lines.reduce((s, { row, unitPriceCents }) => s + unitPriceCents * row.quantity, 0);
    const totalCost = Math.round(totalCharged * 0.6);

    const order = await pg.query(
      `INSERT INTO orders (user_id, status, total_charged_cents, total_cost_cents)
       VALUES ($1, 'pendiente', $2, $3)
       RETURNING id`,
      [input.user_id, totalCharged, totalCost],
    );
    const orderId: string = order.rows[0].id;

    for (const { row, sel, unitPriceCents } of lines) {
      const snapshot = {
        title: row.title,
        description: row.description,
        currency: row.currency,
        image_url: row.image_url,
        metadata: row.metadata,
        color: sel?.color ?? null,
        size: sel?.size ?? null,
      };
      const unitCost = Math.round(unitPriceCents * 0.6);
      await pg.query(
        `INSERT INTO order_items
          (order_id, product_id, product_snapshot, quantity, unit_price_cents, unit_cost_cents)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
        [orderId, row.product_id, JSON.stringify(snapshot), row.quantity, unitPriceCents, unitCost],
      );
    }

    await pg.query(`DELETE FROM cart_items WHERE user_id = $1`, [input.user_id]);

    const productIds = cartRows.rows.map((r: { product_id: string }) => r.product_id);
    await insertEvent(
      {
        event_type: "purchase",
        occurred_at: new Date().toISOString(),
        payload: { order_id: orderId, product_ids: productIds, total_cents: totalCharged },
      },
      { pg, anonymous_id: input.anonymous_id, session_id: input.session_id, user_id: input.user_id },
    );

    await pg.query("COMMIT");

    // F1 (post-commit, best-effort): atribución compra↔impresión + exclusión
    // 'purchased' 30d. Un fallo aquí JAMÁS falla una venta.
    try {
      await attributePurchaseAndExclude(pg, {
        order_id: orderId,
        user_id: input.user_id,
        anonymous_id: input.anonymous_id,
        session_id: input.session_id,
        items: lines.map(({ row, unitPriceCents }) => ({
          product_id: row.product_id,
          unit_price_cents: unitPriceCents,
          quantity: row.quantity,
        })),
      });
    } catch (e) {
      console.warn("[checkout] attribution failed (order unaffected):", e);
    }

    return { order_id: orderId };
  } catch (e) {
    await pg.query("ROLLBACK");
    throw e;
  }
}
