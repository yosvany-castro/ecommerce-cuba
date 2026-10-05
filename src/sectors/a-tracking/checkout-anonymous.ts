import type { Client } from "pg";
import { getOrCreateUserBySub } from "@/lib/auth";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { insertEvent } from "./events/insert";
import { attributePurchaseAndExclude } from "./attribution";
import { findVariantPriceCents, type CuratedAttrs } from "@/sectors/b-catalog/enrichment/attrs";
import { findPriceMismatches, PriceChangedError, TotalsChangedError, UnavailableError } from "./checkout-schema";
import { shipQuote, taxCents, type ShipVia } from "@/lib/shipping";
import { estimateWeightGrams, gramsToLb } from "@/lib/weight";

export interface AnonymousOrderInput {
  anonymous_id: string;
  session_id: string;
  // Sesión Supabase si existe: la orden cuelga del usuario REAL, no del demo
  // sintético (antes TODO pedido, logueado o no, iba a demo|anonymous_id).
  auth_sub?: string | null;
  auth_email?: string | null;
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
    /** Cupón aplicado en la UI + el descuento que se le MOSTRÓ (regla de oro:
     * el server lo recalcula y 409 si difiere). */
    coupon_code?: string;
    discount_cents?: number;
    pago?: string;
    pay_token?: string;
    pay_hide_items?: boolean;
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
  // Con sesión: usuario real. Sin sesión: demo sintético (idempotente por
  // anonymous_id). Fuera de la tx: upsert inofensivo aunque la orden falle.
  const user = input.auth_sub
    ? await getOrCreateUserBySub(pg, input.auth_sub, input.auth_email ?? `${input.auth_sub}@tuki.local`, input.shipping.nombre ?? null)
    : await getOrCreateUserBySub(
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
       FROM products WHERE id = ANY($1::uuid[]) AND is_active = true`,
      [productIds],
    );
    const byId = new Map(prodRows.rows.map((r) => [r.product_id, r]));

    // Un id inexistente o desactivado NO se salta en silencio (eso cobraría un
    // carrito distinto al que el usuario vio): 409 con los ids para que la UI
    // ofrezca quitarlos.
    const unavailable = productIds.filter((id) => !byId.has(id));
    if (unavailable.length > 0) throw new UnavailableError(unavailable);

    // Empareja cada item del body con su producto real (precio siempre del
    // catálogo, jamás del cliente). Si el item trae color/size, se valida
    // contra products.metadata.attrs.variants.
    const lineItems: { item: AnonymousOrderInput["items"][number]; prod: ProdRow; unitPriceCents: number }[] = [];
    for (const item of input.items) {
      const prod = byId.get(item.product_id)!;
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

    const productsSubtotal = lineItems.reduce((s, { item, unitPriceCents }) => s + unitPriceCents * item.quantity, 0);
    // Envío POR LIBRA + tax (spec B1) — recalculado server-side con la MISMA
    // aritmética compartida (src/lib/shipping.ts) y el peso de la DB (cascada
    // weight_grams > heurística pura, idéntica a la del cliente).
    const via: ShipVia = input.shipping.via ?? "aereo";
    const grams = lineItems.reduce((s, { item, prod }) => {
      const meta = prod.metadata as { category?: string } | null;
      // description incluida: la MISMA entrada que usa el cliente (PDP pasa la
      // descripción) — sin ella el estimado diverge y dispara 409 espurios.
      const g = prod.weight_grams ?? estimateWeightGrams({ title: prod.title, category: meta?.category ?? null, description: prod.description }).grams;
      return s + g * item.quantity;
    }, 0);
    const quote = shipQuote(grams === 0 ? 0 : gramsToLb(grams), via);
    if (!quote) throw new Error("bad_via"); // vía sin tarifa: el cliente no debería mandarla
    const tax = taxCents(productsSubtotal);

    // Cupón (campañas del admin): validación server-side CON lock — el uso se
    // consume dentro de la misma tx que crea la orden. Descuento sobre el
    // subtotal de PRODUCTOS (envío/tax intactos: margen y costo reales).
    let discount = 0;
    const couponCode = (input.shipping.coupon_code ?? "").toString().trim().toUpperCase();
    if (couponCode) {
      const c = await pg.query(
        `SELECT code, pct FROM coupons
         WHERE code = $1 AND active
           AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
           AND (max_uses IS NULL OR uses < max_uses)
         FOR UPDATE`,
        [couponCode],
      );
      if (c.rows[0]) discount = Math.round((productsSubtotal * c.rows[0].pct) / 100);
      // cupón inválido/expirado ⇒ discount 0: si la UI mostró otro, salta el 409
    }
    if (
      (input.shipping.ship_total_cents !== undefined && input.shipping.ship_total_cents !== quote.ship_cents) ||
      (input.shipping.tax_cents !== undefined && input.shipping.tax_cents !== tax) ||
      (input.shipping.discount_cents !== undefined && input.shipping.discount_cents !== discount)
    ) {
      throw new TotalsChangedError(quote.ship_cents, tax, discount);
    }
    if (couponCode && discount > 0) {
      await pg.query(`UPDATE coupons SET uses = uses + 1 WHERE code = $1`, [couponCode]);
    }
    // pago=familiar: la orden se crea "completada" para el comprador pero en
    // 'esperando_pago' hasta que el familiar pague por /pagar/<pay_token>.
    const familiar = input.shipping.pago === "familiar";
    if (familiar && !input.shipping.pay_token) throw new Error("missing_pay_token");
    const { pay_token, pay_hide_items, ...shippingRest } = input.shipping;
    const shippingWithPrice = { ...shippingRest, ...quote, via, tax_cents: tax, discount_cents: discount };

    // Contabilidad honesta (0038): total_charged = el cobro COMPLETO al
    // cliente (productos + envío + tax). El costo real no se conoce aquí —
    // NULL hasta capturarlo en preparación (cuando Yosvany compra al
    // proveedor); margin_cents (generada) queda NULL: nada de 60% inventado.
    const totalCharged = productsSubtotal - discount + quote.ship_cents + tax;
    const order = await pg.query(
      `INSERT INTO orders (user_id, status, total_charged_cents, total_cost_cents, shipping, pay_token, pay_hide_items)
       VALUES ($1, $4::order_status, $2, NULL, $3::jsonb, $5, $6)
       RETURNING id`,
      [
        userId,
        totalCharged,
        JSON.stringify(shippingWithPrice),
        familiar ? "esperando_pago" : "pendiente",
        familiar ? pay_token : null,
        familiar ? (pay_hide_items ?? false) : false,
      ],
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
      await pg.query(
        `INSERT INTO order_items
          (order_id, product_id, product_snapshot, quantity, unit_price_cents, unit_cost_cents)
         VALUES ($1, $2, $3::jsonb, $4, $5, NULL)`,
        [orderId, item.product_id, JSON.stringify(snapshot), item.quantity, unitPriceCents],
      );
    }

    const purchaseEnvelope = {
      event_type: "purchase" as const,
      occurred_at: new Date().toISOString(),
      payload: {
        order_id: orderId,
        product_ids: lineItems.map(({ item }) => item.product_id),
        total_cents: totalCharged,
        products_subtotal_cents: productsSubtotal,
      },
    };
    await insertEvent(purchaseEnvelope, { pg, anonymous_id: input.anonymous_id, session_id: input.session_id, user_id: userId });

    await pg.query("COMMIT");

    // P1-7: la compra alimenta el vector EN VIVO (peso 5.0) — antes solo
    // llegaba con el recompute nocturno manual. Best-effort como en /api/track:
    // un fallo aquí jamás falla la venta.
    try {
      await processEventForPersonalization(
        {
          anonymous_id: input.anonymous_id,
          user_id: userId,
          session_id: input.session_id,
          event_type: purchaseEnvelope.event_type,
          payload: purchaseEnvelope.payload as Record<string, unknown>,
          occurred_at: purchaseEnvelope.occurred_at,
        },
        pg,
      );
    } catch (e) {
      console.warn("[checkout-anonymous] personalization hook failed (order unaffected):", e);
    }

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
