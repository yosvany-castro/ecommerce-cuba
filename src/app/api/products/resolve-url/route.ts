// src/app/api/products/resolve-url/route.ts — POST {url} → {product_id}.
// Modelo de reventa: el cliente pega el link del producto que quiere (amazon/
// aliexpress/shein/walmart) en vez de buscarlo por texto (ver Tarea 2, bug
// "fan 20000mah" de search.ts). Si ya está en catálogo, resuelve sin gastar
// cuota; si no, trae el detalle vivo UNA vez y lo mete al pipeline normal de
// enriquecimiento (embedding + attrs), igual que cualquier otro producto.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withPg } from "@/lib/db/helpers";
import { parseProductUrl, toAbsoluteUrl } from "@/sectors/b-catalog/url-resolver";
import {
  fetchDetailJson,
  parseAmazonDetail,
  parseAliexpressDetail,
  parseWalmartDetail,
  parseSheinDetail,
  type DetailResult,
  type ProviderRef,
} from "@/sectors/b-catalog/revalidate";
import { parseDetailTitleImage } from "@/sectors/b-catalog/detail-title-image";
import { reserveAliexpressQuota } from "@/sectors/b-catalog/aliexpress-quota";
import { processProduct } from "@/sectors/b-catalog/enrichment/pipeline";
import type { MockProduct } from "@/sectors/b-catalog/mock/types";

const bodySchema = z.object({ url: z.string().min(1) }).strict();

function parseDetail(source: string, json: unknown): DetailResult | null {
  switch (source) {
    case "amazon":
      return parseAmazonDetail(json);
    case "aliexpress":
      return parseAliexpressDetail(json);
    case "walmart":
      return parseWalmartDetail(json);
    case "shein":
      return parseSheinDetail(json);
    default:
      return null;
  }
}

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

  return withPg(async (pg) => {
    const existing = await pg.query<{ id: string }>(
      `SELECT id FROM products WHERE source = $1 AND source_product_id = $2 AND is_active = true`,
      [source, source_product_id],
    );
    if (existing.rows[0]) {
      return NextResponse.json({ product_id: existing.rows[0].id });
    }

    // Producto nuevo: cuota AliExpress ANTES del fetch — mismo guard que
    // hydrate/route.ts (mismos sources contados, ver aliexpress-quota.ts).
    if (source === "aliexpress") {
      const reserved = await reserveAliexpressQuota(pg, "resolve_url_aliexpress", { url: absoluteUrl });
      if (!reserved) return NextResponse.json({ error: "quota" }, { status: 429 });
    }

    try {
      const ref: ProviderRef = { source, source_product_id, url: absoluteUrl };
      const fetched = await fetchDetailJson(ref);
      if (!fetched) return NextResponse.json({ error: "fetch_failed" }, { status: 422 });

      const detail = parseDetail(source, fetched.json);
      const titleImage = parseDetailTitleImage(source, fetched.json);
      if (!detail || !titleImage) {
        return NextResponse.json({ error: "parse_failed" }, { status: 422 });
      }

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
    } catch {
      return NextResponse.json({ error: "fetch_failed" }, { status: 422 });
    }
  });
}
