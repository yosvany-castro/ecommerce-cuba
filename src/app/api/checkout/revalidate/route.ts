import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withPg } from "@/lib/db/helpers";
import { revalidateProduct, type RevalidateProductRow, type Verdict } from "@/sectors/b-catalog/revalidate";
import { findVariantPriceCents, type CuratedAttrs } from "@/sectors/b-catalog/enrichment/attrs";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const itemSchema = z
  .object({
    product_id: z.string().regex(UUID_REGEX),
    color: z.string().nullable().optional(),
    size: z.string().nullable().optional(),
  })
  .strict();

const bodySchema = z
  .object({
    items: z.array(itemSchema).max(20),
  })
  .strict();

/** Lectura por-request (testeable en ambos modos). Default: activo. */
function revalidateEnabled(): boolean {
  return process.env.CHECKOUT_REVALIDATE !== "false";
}

interface ItemResult {
  product_id: string;
  color: string | null;
  size: string | null;
  status: Verdict["status"];
  stored_price_cents: number;
  live_price_cents?: number;
  /** Precio de la combinación color/talla pedida (metadata.attrs.variants) —
   * independiente de la revalidación externa (esa solo toca el precio base).
   * Ausente = sin match de variante -> el caller cae al precio base. */
  variant_price_cents?: number;
}

interface ProductRow extends RevalidateProductRow {
  metadata: unknown;
}

/**
 * POST /api/checkout/revalidate — re-valida precio/stock de los productos del
 * carrito justo antes de confirmar el pedido (paso 1 al montar el checkout Y
 * paso "Revisar", ver CheckoutFlow.tsx) y devuelve, por item pedido, el precio
 * de la variante color/talla si aplica. Actualiza products.price_cents cuando
 * el precio vivo cambió (así createCheckoutOrder/createAnonymousOrder cobran
 * el precio real, ver src/sectors/b-catalog/revalidate.ts para el porqué).
 */
export async function POST(req: NextRequest) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  if (body.items.length === 0) return NextResponse.json({ items: [] });

  const enabled = revalidateEnabled();

  const items = await withPg(async (pg) => {
    // Una fila por product_id ÚNICO — revalidateProduct (llamada externa, cuota
    // real) corre UNA vez por producto aunque el carrito lo repita con 2
    // colores/tallas distintas.
    const uniqueIds = [...new Set(body.items.map((i) => i.product_id))];
    const rows = await pg.query<ProductRow>(
      `SELECT id, source, source_product_id, url, price_cents, last_refreshed_at, metadata
       FROM products WHERE id = ANY($1::uuid[])`,
      [uniqueIds],
    );
    const rowById = new Map(rows.rows.map((r) => [r.id, r]));

    // Kill-switch: cero llamadas a RapidAPI, todo "unverifiable" (no se toca
    // price_cents/last_refreshed_at — no hay dato vivo que justifique el UPDATE).
    const settled = await Promise.allSettled(
      rows.rows.map((row): Promise<Verdict> =>
        enabled
          ? revalidateProduct(row)
          : Promise.resolve({ status: "unverifiable", stored_price_cents: row.price_cents }),
      ),
    );

    const verdictById = new Map<string, Verdict>();
    for (let i = 0; i < rows.rows.length; i++) {
      const row = rows.rows[i];
      // revalidateProduct ya es fail-open (nunca rechaza) — este fallback cubre
      // igual un reject inesperado, jamás debe tumbar el checkout.
      const verdict: Verdict =
        settled[i].status === "fulfilled"
          ? (settled[i] as PromiseFulfilledResult<Verdict>).value
          : { status: "unverifiable", stored_price_cents: row.price_cents };
      verdictById.set(row.id, verdict);

      if (verdict.status === "price_changed" && verdict.live_price_cents != null) {
        await pg.query(`UPDATE products SET price_cents = $1, last_refreshed_at = now() WHERE id = $2`, [
          verdict.live_price_cents,
          row.id,
        ]);
      } else if (verdict.status === "ok" && !verdict.skipped) {
        await pg.query(`UPDATE products SET last_refreshed_at = now() WHERE id = $1`, [row.id]);
      }
    }

    // Resultado por ITEM pedido (no deduplicado): dos líneas del mismo producto
    // en colores distintos pueden tener variant_price_cents distinto.
    const results: ItemResult[] = [];
    for (const reqItem of body.items) {
      const row = rowById.get(reqItem.product_id);
      if (!row) continue; // producto inexistente/borrado -> el caller lo trata como "sin dato"
      const verdict = verdictById.get(row.id)!;
      const meta = row.metadata as { attrs?: CuratedAttrs } | null;
      const variantPrice = findVariantPriceCents(meta?.attrs?.variants, reqItem.color ?? null, reqItem.size ?? null);
      results.push({
        product_id: row.id,
        color: reqItem.color ?? null,
        size: reqItem.size ?? null,
        status: verdict.status,
        stored_price_cents: verdict.stored_price_cents,
        ...(verdict.live_price_cents != null ? { live_price_cents: verdict.live_price_cents } : {}),
        ...(variantPrice != null ? { variant_price_cents: variantPrice } : {}),
      });
    }

    // Una fila por request, para visibilidad en la auditoría de mock_calls
    // (mismo patrón que catalog_refresh/async_ingest — ver sectors/c-search/ingest-async.ts).
    await pg.query(
      `INSERT INTO mock_calls (params, response_size, simulated_cost_cents, was_error)
       VALUES ($1::jsonb, $2, 0, false)`,
      [JSON.stringify({ source: "checkout_revalidate", products: rows.rows.length }), rows.rows.length],
    );

    return results;
  });

  return NextResponse.json({ items });
}
