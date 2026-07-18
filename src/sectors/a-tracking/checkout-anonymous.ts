import type { Client } from "pg";
import { getOrCreateUserBySub } from "@/lib/auth";
import { insertEvent } from "./events/insert";
import { attributePurchaseAndExclude } from "./attribution";
import { findVariantPriceCents, type CuratedAttrs } from "@/sectors/b-catalog/enrichment/attrs";
import { findPriceMismatches, PriceChangedError, TotalsChangedError } from "./checkout-schema";
import { shipQuote, taxCents, type ShipVia } from "@/lib/shipping";
import { estimateWeightGrams, gramsToLb } from "@/lib/weight";

export interface AnonymousOrderInput {
  anonymous_id: string;
  session_id: string;
  // color/size: selección del comprador, opcional (products sin variantes o
  // combos sin variant matching no las traen). El precio NUNCA sale de acá —
  // se valida contra products.metadata.attrs.variants abajo. unit_price_cents:
  // lo que la UI le mostró al usuario — se compara contra lo calculado server-
  // side; si difiere, PriceChangedError ANTES de tocar la DB (REGLA DE ORO).
  items: { product_id: string; quantity: number; unit_price_cents: number; color?: string | null; size?: string | null }[];
  // Datos de envío ya validados en la ruta (zod strict) — se guardan (junto al
  // desglose por libra recalculado) en orders.shipping. ship_total_cents/
  // tax_cents = lo que la UI le MOSTRÓ al usuario, para comparar contra el
  // recálculo server-side (misma regla de oro que unit_price_cents).
  shipping: Record<string, unknown> & {
    nombre?: string;
    via?: ShipVia;
    ship_total_cents?: number;
    tax_cents?: number;
  };
}

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
  weight_grams: number | null;
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
  const user = await getOrCreateUserBySub(
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
      `SELECT id AS product_id, title, description, price_cents, currency, image_url, metadata, weight_grams
       FROM products WHERE id = ANY($1::uuid[])`,
      [productIds],
    );
    const byId = new Map(prodRows.rows.map((r) => [r.product_id, r]));

    // Empareja cada item del body con su producto real; descarta ids inexistentes
    // (precio siempre del catálogo, jamás del cliente). Si el item trae
    // color/size, se valida contra products.metadata.attrs.variants — el
    // precio del cliente JAMÁS se usa, solo la combinación elegida.
    const lineItems: { item: AnonymousOrderInput["items"][number]; prod: ProdRow; unitPriceCents: number }[] = [];
    for (const item of input.items) {
      const prod = byId.get(item.product_id);
      if (!prod) continue;
      const meta = prod.metadata as { attrs?: CuratedAttrs } | null;
      const variantPrice = findVariantPriceCents(meta?.attrs?.variants, item.color ?? null, item.size ?? null);
      lineItems.push({ item, prod, unitPriceCents: variantPrice ?? prod.price_cents });
    }
    if (lineItems.length === 0) throw new Error("empty_cart");

    // El precio que la UI mostró (unit_price_cents del body) DEBE coincidir
    // con lo que el server acaba de calcular — si no, 409 sin crear la orden
    // (el catch de abajo hace ROLLBACK; la ruta HTTP traduce a 409).
    const mismatches = findPriceMismatches(
      lineItems.map(({ item, unitPriceCents }) => ({
        product_id: item.product_id,
        color: item.color ?? null,
        size: item.size ?? null,
        shown_cents: item.unit_price_cents,
        current_cents: unitPriceCents,
      })),
    );
    if (mismatches.length > 0) throw new PriceChangedError(mismatches);

    const totalCharged = lineItems.reduce((s, { item, unitPriceCents }) => s + unitPriceCents * item.quantity, 0);
    const totalCost = Math.round(totalCharged * 0.6);
    // total_charged_cents es solo-productos (igual que createCheckoutOrder); el
    // envío/tax no se suman al cobro confirmado, se guardan aparte abajo.
    // Envío POR LIBRA + tax (spec B1) — recalculado server-side con la MISMA
    // aritmética compartida (src/lib/shipping.ts) y el peso de la DB (cascada
    // weight_grams > heurística pura, idéntica a la del cliente).
    const via: ShipVia = input.shipping.via ?? "aereo";
    const grams = lineItems.reduce((s, { item, prod }) => {
      const meta = prod.metadata as { category?: string } | null;
      const g = prod.weight_grams ?? estimateWeightGrams({ title: prod.title, category: meta?.category ?? null }).grams;
      return s + g * item.quantity;
    }, 0);
    const quote = shipQuote(grams === 0 ? 0 : gramsToLb(grams), via);
    if (!quote) throw new Error("bad_via"); // vía sin tarifa: el cliente no debería mandarla
    const tax = taxCents(totalCharged);
    if (
      (input.shipping.ship_total_cents !== undefined && input.shipping.ship_total_cents !== quote.ship_cents) ||
      (input.shipping.tax_cents !== undefined && input.shipping.tax_cents !== tax)
    ) {
      throw new TotalsChangedError(quote.ship_cents, tax);
    }
    const shippingWithPrice = { ...input.shipping, ...quote, via, tax_cents: tax };

    const order = await pg.query(
      `INSERT INTO orders (user_id, status, total_charged_cents, total_cost_cents, shipping)
       VALUES ($1, 'pendiente', $2, $3, $4::jsonb)
       RETURNING id`,
      [userId, totalCharged, totalCost, JSON.stringify(shippingWithPrice)],
    );
    const orderId: string = order.rows[0].id;

    for (const { item, prod, unitPriceCents } of lineItems) {
      const snapshot = {
        title: prod.title,
        description: prod.description,
        currency: prod.currency,
        image_url: prod.image_url,
        metadata: prod.metadata,
        color: item.color ?? null,
        size: item.size ?? null,
      };
      const unitCost = Math.round(unitPriceCents * 0.6);
      await pg.query(
        `INSERT INTO order_items
          (order_id, product_id, product_snapshot, quantity, unit_price_cents, unit_cost_cents)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
        [orderId, item.product_id, JSON.stringify(snapshot), item.quantity, unitPriceCents, unitCost],
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
        items: lineItems.map(({ item, unitPriceCents }) => ({
          product_id: item.product_id,
          unit_price_cents: unitPriceCents,
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
