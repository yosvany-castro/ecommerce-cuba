// src/app/api/products/resolve-url/route.ts — POST {url} → producto.
// Modelo de reventa: el cliente pega el link del producto que quiere (amazon/
// aliexpress/shein/walmart) en vez de buscarlo por texto. Si ya está en
// catálogo, resuelve sin gastar cuota; si no, intenta el detalle vivo UNA vez
// y, si el proveedor aún no lo indexó (OTAPI shein "try again later", DataHub
// 205/5040 — verificado en vivo 2026-07-17), responde 202 pending, encola
// reintentos de fondo (resolve-retry.ts) y el cliente hace poll a ESTE mismo
// endpoint: el hit de catálogo responde cuando el job termina. Los 422/202
// incluyen fallback_query (palabras del slug) para que el cliente caiga a
// búsqueda de texto y el usuario nunca vea un vacío seco.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withPg } from "@/lib/db/helpers";
import { parseProductUrl, toAbsoluteUrl, slugQueryFromUrl } from "@/sectors/b-catalog/url-resolver";
import { fetchDetailJson, classifyDetail, type ProviderRef } from "@/sectors/b-catalog/revalidate";
import { parseDetail, queueResolveRetry, resolveInFlight } from "@/sectors/b-catalog/resolve-retry";
import { parseDetailTitleImage } from "@/sectors/b-catalog/detail-title-image";
import { reserveAliexpressQuota } from "@/sectors/b-catalog/aliexpress-quota";
import { processProduct } from "@/sectors/b-catalog/enrichment/pipeline";
import type { MockProduct } from "@/sectors/b-catalog/mock/types";

const bodySchema = z.object({ url: z.string().min(1) }).strict();

// El detalle de OTAPI shein tarda ~16s medidos (2026-07-17) — el default de
// 8s de revalidate (pensado para checkout) abortaba SIEMPRE esta ruta.
const RESOLVE_TIMEOUT_MS = 20_000;

export async function POST(req: NextRequest) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const parsed = parseProductUrl(body.url);
  if (!parsed) return NextResponse.json({ error: "invalid_url" }, { status: 422 });
  const { source, source_product_id } = parsed;
  const absoluteUrl = toAbsoluteUrl(body.url); // no puede ser null: parseProductUrl ya validó la URL
  const fallbackQuery = slugQueryFromUrl(body.url);

  return withPg(async (pg) => {
    const existing = await pg.query<{ id: string }>(
      `SELECT id FROM products WHERE source = $1 AND source_product_id = $2 AND is_active = true`,
      [source, source_product_id],
    );
    if (existing.rows[0]) {
      return NextResponse.json({ product_id: existing.rows[0].id });
    }

    // Poll de un resolve pendiente: si ya hay retry en vuelo para este
    // producto, no re-fetchear ni re-reservar cuota — 202 directo.
    if (resolveInFlight(source, source_product_id)) {
      return NextResponse.json({ status: "pending", fallback_query: fallbackQuery }, { status: 202 });
    }

    // Producto nuevo: cuota AliExpress ANTES del fetch — mismo guard que
    // hydrate/route.ts (mismos sources contados, ver aliexpress-quota.ts).
    if (source === "aliexpress") {
      const reserved = await reserveAliexpressQuota(pg, "resolve_url_aliexpress", { url: absoluteUrl });
      if (!reserved) return NextResponse.json({ error: "quota", fallback_query: fallbackQuery }, { status: 429 });
    }

    try {
      const ref: ProviderRef = { source, source_product_id, url: absoluteUrl };
      // Timeout propio (20s, no los 8s del checkout): OTAPI shein tarda ~16s
      // medidos. Un throw (timeout/red) es TRANSITORIO → pending, no failed:
      // el retry de fondo puede lograrlo y el cliente igual cae al slug.
      let fetched: Awaited<ReturnType<typeof fetchDetailJson>> = null;
      let fetchThrew = false;
      try {
        fetched = await fetchDetailJson(ref, RESOLVE_TIMEOUT_MS);
      } catch {
        fetchThrew = true;
      }
      const cls = fetchThrew ? "pending" : fetched ? classifyDetail(source, fetched.json) : "failed";

      if (cls === "ok" && fetched) {
        const detail = parseDetail(source, fetched.json);
        const titleImage = parseDetailTitleImage(source, fetched.json);
        if (detail && titleImage) {
          const raw: MockProduct = {
            id: `${source}:${source_product_id}`,
            source,
            source_product_id,
            title: titleImage.title,
            description: titleImage.title,
            image_url: titleImage.image_url,
            price_cents: detail.price_cents,
            brand: "",
            raw_category: "",
            attributes: {},
            url: absoluteUrl,
          };
          const result = await processProduct(raw, pg);
          return NextResponse.json({ product_id: result.productId });
        }
      }

      if (cls === "pending") {
        // El proveedor puede indexar en 1-2 min: reintentos de fondo; el
        // cliente hace poll y el hit de catálogo de arriba responde cuando
        // el job termina. singleFlight: N polls = 1 job.
        const searchPath = (await pg.query(`SHOW search_path`)).rows[0].search_path as string;
        queueResolveRetry({ ref: { source, source_product_id, url: absoluteUrl }, searchPath });
        return NextResponse.json({ status: "pending", fallback_query: fallbackQuery }, { status: 202 });
      }

      return NextResponse.json({ error: "parse_failed", fallback_query: fallbackQuery }, { status: 422 });
    } catch {
      return NextResponse.json({ error: "fetch_failed", fallback_query: fallbackQuery }, { status: 422 });
    }
  });
}
