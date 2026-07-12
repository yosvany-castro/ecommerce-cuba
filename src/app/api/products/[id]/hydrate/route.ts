import { NextRequest, NextResponse } from "next/server";
import { withPg } from "@/lib/db/helpers";
import { liveLookupVariants } from "@/sectors/b-catalog/hydrate";
import { curateColors, curateStrings, type CuratedAttrs, type CuratedVariant } from "@/sectors/b-catalog/enrichment/attrs";
import type { ProviderRef } from "@/sectors/b-catalog/revalidate";

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
// reserva para ese source.
const ALIEXPRESS_QUOTA = Number(process.env.HYDRATE_QUOTA_ALIEXPRESS) || 40;

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

    // Guard de cuota AliExpress — lock + reserva del slot ANTES del fetch, en
    // una transacción corta (no abarca la llamada de red: el lock se libera al
    // COMMIT, mucho antes de que termine el fetch). Cierra la carrera real:
    // N productos aliexpress distintos vistos en paralelo ya no pueden leer
    // todos el mismo count antes de que ninguno reserve.
    if (row.source === "aliexpress") {
      await pg.query("BEGIN");
      try {
        await pg.query(`SELECT pg_advisory_xact_lock(hashtext('hydrate_aliexpress_quota'))`);
        // 'rapidapi_aliexpress_search' (item 1.4 roadmap): el fallback de búsqueda
        // aliexpress-datahub.ts audita ahí su propio consumo del mismo pozo de
        // cuota — este guard también debe verlo, no solo el de hidratación PDP.
        const q = await pg.query(
          `SELECT count(*)::int AS n FROM mock_calls
           WHERE params->>'source' IN ('hydrate_aliexpress','checkout_revalidate','rapidapi_aliexpress_search')
             AND called_at >= date_trunc('month', now())`,
        );
        if (q.rows[0].n >= ALIEXPRESS_QUOTA) {
          await pg.query("ROLLBACK");
          // hydrated_at ya quedó comiteado por el claim de arriba (single-statement,
          // autocommit) — el producto queda "intentado, sin variantes", honesto,
          // no vuelve a reintentar en cada visita.
          return NextResponse.json({ skipped: true, reason: "quota" });
        }
        // Reserva ya cuenta como la auditoría de esta llamada — no se inserta de
        // nuevo después del fetch para aliexpress (sí para los otros 3 sources).
        await pg.query(
          `INSERT INTO mock_calls (params, response_size, simulated_cost_cents, was_error)
           VALUES ($1::jsonb, 0, 0, false)`,
          [JSON.stringify({ source: "hydrate_aliexpress", product_id: id })],
        );
        await pg.query("COMMIT");
      } catch (e) {
        await pg.query("ROLLBACK");
        throw e;
      }
    }

    let variants: CuratedVariant[] | undefined;
    let lookupFailed = false;
    try {
      variants = await liveLookupVariants(row as ProviderRef);
    } catch {
      variants = undefined; // fail-open, mismo criterio que revalidateProduct
      lookupFailed = true;
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
      await pg.query(`UPDATE products SET metadata = jsonb_set(metadata, '{attrs}', $1::jsonb, true) WHERE id = $2`, [
        JSON.stringify(attrs),
        id,
      ]);
    }

    if (row.source !== "aliexpress") {
      await pg.query(
        `INSERT INTO mock_calls (params, response_size, simulated_cost_cents, was_error) VALUES ($1::jsonb, $2, 0, $3)`,
        [JSON.stringify({ source: `hydrate_${row.source}`, product_id: id }), variants?.length ?? 0, lookupFailed],
      );
    }
    return NextResponse.json({ ok: true });
  });
}
