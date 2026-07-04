import type { Client } from "pg";
import { getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { insertEvent } from "./events/insert";
import { attributePurchaseAndExclude } from "./attribution";

export interface AnonymousOrderInput {
  anonymous_id: string;
  session_id: string;
  items: { product_id: string; quantity: number }[];
  // Datos de envío ya validados en la ruta (zod strict) — se guardan tal cual en orders.shipping.
  shipping: Record<string, unknown> & { nombre?: string; metodo?: "rapido" | "estandar" | "lento" };
}

// Tarifas de envío (centavos). Duplicado intencional de SHIP en
// src/components/tuki/checkout-core.ts: ese archivo es capa UI (client), este
// sector es server-only — no cruzamos esa frontera por 3 números.
const SHIP_PRICE_CENTS: Record<"rapido" | "estandar" | "lento", number> = {
  rapido: 1299,
  estandar: 499,
  lento: 199,
};
const FREE_SHIP_THRESHOLD_CENTS = 5000;

export interface CheckoutResult {
  order_id: string;
}

interface ProdRow {
  product_id: string;
  title: string;
  description: string | null;
  price_cents: number;
  currency: string;
  image_url: string | null;
  metadata: unknown;
}

/**
 * Checkout anónimo (demo Tuki). Misma transacción que createCheckoutOrder pero:
 * - items vienen del body; los precios se RE-LEEN de products (nunca del cliente),
 * - no hay cart_items (no se limpia carrito — es del cliente),
 * - la orden guarda los datos de envío del formulario en orders.shipping (jsonb),
 * - el usuario es un demo sintético puente a orders.user_id NOT NULL.
 */
export async function createAnonymousOrder(
  pg: Client,
  input: AnonymousOrderInput,
): Promise<CheckoutResult> {
  // Usuario demo sintético (idempotente por anonymous_id). Fuera de la tx: es un
  // upsert inofensivo que puede sobrevivir aunque la orden falle.
  const user = await getOrCreateUserByAuth0Sub(
    pg,
    `demo|${input.anonymous_id}`,
    `demo+${input.anonymous_id}@tuki.local`,
    input.shipping.nombre ?? null,
  );
  const userId = user.id;

  await pg.query("BEGIN");
  try {
    const productIds = input.items.map((i) => i.product_id);
    const prodRows = await pg.query<ProdRow>(
      `SELECT id AS product_id, title, description, price_cents, currency, image_url, metadata
       FROM products WHERE id = ANY($1::uuid[])`,
      [productIds],
    );
    const byId = new Map(prodRows.rows.map((r) => [r.product_id, r]));

    // Empareja cada item del body con su producto real; descarta ids inexistentes
    // (precio siempre del catálogo, jamás del cliente).
    const lineItems: { item: { product_id: string; quantity: number }; prod: ProdRow }[] = [];
    for (const item of input.items) {
      const prod = byId.get(item.product_id);
      if (prod) lineItems.push({ item, prod });
    }
    if (lineItems.length === 0) throw new Error("empty_cart");

    const totalCharged = lineItems.reduce((s, { item, prod }) => s + prod.price_cents * item.quantity, 0);
    const totalCost = Math.round(totalCharged * 0.6);
    // total_charged_cents es solo-productos (igual que createCheckoutOrder); el
    // envío no se suma al cobro confirmado, se guarda aparte abajo.
    const metodo: "rapido" | "estandar" | "lento" = input.shipping.metodo ?? "estandar";
    const shipPriceCents =
      metodo === "estandar" && totalCharged >= FREE_SHIP_THRESHOLD_CENTS ? 0 : SHIP_PRICE_CENTS[metodo];
    const shippingWithPrice = { ...input.shipping, ship_price_cents: shipPriceCents };

    const order = await pg.query(
      `INSERT INTO orders (user_id, status, total_charged_cents, total_cost_cents, shipping)
       VALUES ($1, 'pendiente', $2, $3, $4::jsonb)
       RETURNING id`,
      [userId, totalCharged, totalCost, JSON.stringify(shippingWithPrice)],
    );
    const orderId: string = order.rows[0].id;

    for (const { item, prod } of lineItems) {
      const snapshot = {
        title: prod.title,
        description: prod.description,
        currency: prod.currency,
        image_url: prod.image_url,
        metadata: prod.metadata,
      };
      const unitCost = Math.round(prod.price_cents * 0.6);
      await pg.query(
        `INSERT INTO order_items
          (order_id, product_id, product_snapshot, quantity, unit_price_cents, unit_cost_cents)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
        [orderId, item.product_id, JSON.stringify(snapshot), item.quantity, prod.price_cents, unitCost],
      );
    }

    await insertEvent(
      {
        event_type: "purchase",
        occurred_at: new Date().toISOString(),
        payload: {
          order_id: orderId,
          product_ids: lineItems.map(({ item }) => item.product_id),
          total_cents: totalCharged,
        },
      },
      { pg, anonymous_id: input.anonymous_id, session_id: input.session_id, user_id: userId },
    );

    await pg.query("COMMIT");

    // F1 (post-commit, best-effort): un fallo aquí JAMÁS falla una venta.
    try {
      await attributePurchaseAndExclude(pg, {
        order_id: orderId,
        user_id: userId,
        anonymous_id: input.anonymous_id,
        session_id: input.session_id,
        items: lineItems.map(({ item, prod }) => ({
          product_id: item.product_id,
          unit_price_cents: prod.price_cents,
          quantity: item.quantity,
        })),
      });
    } catch (e) {
      console.warn("[checkout-anonymous] attribution failed (order unaffected):", e);
    }

    return { order_id: orderId };
  } catch (e) {
    await pg.query("ROLLBACK");
    throw e;
  }
}
