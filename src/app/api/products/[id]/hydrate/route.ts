import { NextRequest, NextResponse } from "next/server";
import { withPg } from "@/lib/db/helpers";
import { liveLookupVariants } from "@/sectors/b-catalog/hydrate";
import { curateColors, curateStrings, type CuratedAttrs, type CuratedVariant } from "@/sectors/b-catalog/enrichment/attrs";
import type { ProviderRef } from "@/sectors/b-catalog/revalidate";
import { reserveAliexpressQuota } from "@/sectors/b-catalog/aliexpress-quota";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hydrateEnabled(): boolean {
  return process.env.HYDRATE_DETAIL !== "false"; // mismo patrón que CHECKOUT_REVALIDATE
}

// Conservador a propósito: cuenta hydrate_aliexpress + checkout_revalidate (ese
// último audita TODO el carrito en una fila, no desglosado por proveedor, así
// que puede sobre-contar) — nunca sub-contar contra el tope duro real de 100/mes
// de AliExpress DataHub. Sin guard para amazon/walmart/shein-otapi: las
// REGLAS DURAS del negocio solo declaran cuota dura para AliExpress DataHub y
// Pinto Shein (nunca tocado acá). ponytail: si algún día se confirma que esos
// hosts también tienen plan free-tier limitado, replicar el mismo patrón de lock+
// reserva para ese source (ver aliexpress-quota.ts, ya compartido con resolve-url).

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id) || !hydrateEnabled()) return NextResponse.json({ skipped: true });

  return withPg(async (pg) => {
    // Claim atómico: UNA query hace de lock Y de lectura de source/url/attrs
    // previos. Filtra por source real (amazon/aliexpress/walmart/shein) — un
    // producto demo/mock nunca entra acá, evita marcarlo hidratado (ProductView
    // lee attrs.hydrated_at) sin haberlo estado de verdad. jsonb_set anidado en
    // '{attrs}' con COALESCE garantiza el nivel intermedio (filas legacy sin
    // attrs no quedan en no-op silencioso). 0 filas = ya hidratado / demo /
    // inactivo / inexistente → no-op.
    const claim = await pg.query(
      `UPDATE products
         SET metadata = jsonb_set(
               metadata, '{attrs}',
               COALESCE(metadata->'attrs','{}'::jsonb) || jsonb_build_object('hydrated_at', to_jsonb(now()::text)),
               true
             )
       WHERE id = $1 AND is_active = true
         AND source IN ('amazon','aliexpress','walmart','shein')
         AND (metadata->'attrs'->>'hydrated_at') IS NULL
       RETURNING source, source_product_id, url, metadata->'attrs' AS attrs_before`,
      [id],
    );
    const row = claim.rows[0] as { source: string; source_product_id: string; url: string | null; attrs_before: CuratedAttrs | null } | undefined;
    if (!row) return NextResponse.json({ skipped: true });

    // Guard de cuota AliExpress — lock + reserva del slot ANTES del fetch (ver
    // aliexpress-quota.ts). hydrated_at ya quedó comiteado por el claim de
    // arriba (single-statement, autocommit) — si excede cuota, el producto
    // queda "intentado, sin variantes", honesto, no reintenta en cada visita.
    if (row.source === "aliexpress") {
      const reserved = await reserveAliexpressQuota(pg, "hydrate_aliexpress", { product_id: id });
      if (!reserved) return NextResponse.json({ skipped: true, reason: "quota" });
      // Reserva ya cuenta como la auditoría de esta llamada — no se inserta de
      // nuevo después del fetch para aliexpress (sí para los otros 3 sources).
    }

    let variants: CuratedVariant[] | undefined;
    let providerWeightGrams: number | undefined;
    let providerShipDays: { min: number; max: number } | undefined;
    let lookupFailed = false;
    try {
      const detail = await liveLookupVariants(row as ProviderRef);
      variants = detail?.variants;
      providerWeightGrams = detail?.weightGrams;
      providerShipDays = detail?.shipDays;
    } catch {
      variants = undefined; // fail-open, mismo criterio que revalidateProduct
      lookupFailed = true;
    }

    // Peso de paquete del proveedor (aliexpress packageDetail — ya es peso de
    // PAQUETE, no neto: sin pad extra): dato de facturación real, se persiste
    // aunque no haya variantes. Un peso medido jamás se pisa.
    if (providerWeightGrams !== undefined) {
      await pg.query(
        `UPDATE products SET weight_grams = $1, weight_source = 'provider'
         WHERE id = $2 AND (weight_source IS NULL OR weight_source <> 'measured')`,
        [providerWeightGrams, id],
      );
    }
    // Días tienda→depósito del proveedor: acortan el rango de entrega mostrado.
    if (providerShipDays !== undefined) {
      await pg.query(
        `UPDATE products SET provider_ship_min_days = $1, provider_ship_max_days = $2 WHERE id = $3`,
        [providerShipDays.min, providerShipDays.max, id],
      );
    }

    // Error transitorio (timeout/red) ≠ "hidratado": se revierte el claim para
    // que una visita futura reintente. El caso cuota (aliexpress) NO pasa por
    // acá — ese sí conserva el claim a propósito para no re-gastar. Visto en
    // vivo 2026-07-11: el primer lookup frío superó el timeout y el producto
    // quedaba marcado para siempre sin variantes.
    if (lookupFailed) {
      await pg.query(
        `UPDATE products SET metadata = jsonb_set(metadata, '{attrs}', (metadata->'attrs') - 'hydrated_at', true) WHERE id = $1`,
        [id],
      );
    }

    // attrs frescos (solo si hubo variantes nuevas): la primera visita a la PDP
    // dispara la hidratación DESPUÉS del primer paint, así que el server-render
    // inicial nunca las tiene — devolverlas acá deja a ProductView repintar sin
    // esperar a un segundo request/reload (ver el useEffect de hidratación).
    let freshAttrs: CuratedAttrs | undefined;
    if (variants?.length) {
      const before = row.attrs_before ?? {};
      const colors = curateColors([
        ...(before.colors?.map((c) => c.name) ?? []),
        ...variants.map((v) => v.color).filter((x): x is string => !!x),
      ]);
      const sizes = curateStrings([...(before.sizes ?? []), ...variants.map((v) => v.size).filter((x): x is string => !!x)]);
      const images = curateStrings([...(before.images ?? []), ...variants.map((v) => v.image).filter((x): x is string => !!x)]);
      const attrs: CuratedAttrs = {
        ...before,
        ...(colors && { colors }),
        ...(sizes && { sizes }),
        ...(images && { images }),
        variants,
      };
      const updated = await pg.query<{ attrs: CuratedAttrs }>(
        `UPDATE products SET metadata = jsonb_set(metadata, '{attrs}', $1::jsonb, true) WHERE id = $2
         RETURNING metadata->'attrs' AS attrs`,
        [JSON.stringify(attrs), id],
      );
      freshAttrs = updated.rows[0]?.attrs;
    }

    if (row.source !== "aliexpress") {
      await pg.query(
        `INSERT INTO mock_calls (params, response_size, simulated_cost_cents, was_error) VALUES ($1::jsonb, $2, 0, $3)`,
        [JSON.stringify({ source: `hydrate_${row.source}`, product_id: id }), variants?.length ?? 0, lookupFailed],
      );
    }
    return NextResponse.json(freshAttrs ? { ok: true, attrs: freshAttrs } : { ok: true });
  });
}
