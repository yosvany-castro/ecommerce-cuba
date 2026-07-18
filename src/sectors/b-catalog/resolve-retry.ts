// src/sectors/b-catalog/resolve-retry.ts — reintentos de fondo del resolve por
// URL. OTAPI shein indexa perezoso ("try again later", verificado en vivo
// 2026-07-17: 6 intentos/2min aún incompleto) y DataHub aliexpress da 205/5040
// transitorios — una sola llamada síncrona nunca alcanza. Mismo patrón
// fire-and-forget + searchPath de c-search/ingest-async.ts.
import { withPgDirect } from "@/lib/db/helpers";
import { singleFlight } from "@/sectors/c-search/decide/single-flight";
import {
  fetchDetailJson,
  classifyDetail,
  parseAmazonDetail,
  parseAliexpressDetail,
  parseWalmartDetail,
  parseSheinDetail,
  type DetailResult,
} from "./revalidate";
import { parseDetailTitleImage } from "./detail-title-image";
import { processProduct } from "./enrichment/pipeline";
import type { MockProduct, MockProductSource } from "./mock/types";

// ponytail: backoff fijo — 3 reintentos en ~2 min tras el intento inmediato de
// la ruta. Si OTAPI tarda más, el fallback por slug ya cubrió al usuario.
const RETRY_DELAYS_MS = [20_000, 40_000, 60_000];
// Mismo timeout largo que la ruta (OTAPI tarda ~16s medidos, el default de
// revalidate son 8s de checkout y abortaría cada reintento).
const RESOLVE_TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function parseDetail(source: string, json: unknown): DetailResult | null {
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

export interface ResolveRetryInput {
  ref: { source: MockProductSource; source_product_id: string; url: string | null };
  searchPath: string;
}

// ponytail: Set en memoria por instancia — suficiente en single-node; si un
// día hay N instancias, el peor caso es un fetch de más, no un error.
const inFlightRefs = new Set<string>();

/** ¿Hay un retry en vuelo para este producto? La ruta lo usa para que los
 * polls del cliente no re-fetcheen ni re-reserven cuota. */
export function resolveInFlight(source: string, id: string): boolean {
  return inFlightRefs.has(`${source}:${id}`);
}

/** Reintenta el detalle del proveedor y, si al fin resuelve, upserta el
 * producto por el pipeline normal. El cliente NO espera esto: hace poll al
 * endpoint, que encuentra el producto en catálogo cuando este job termina.
 * Nota cuota: los reintentos de aliexpress viajan sobre la reserva que ya
 * hizo la ruta (no re-reservan). */
export function queueResolveRetry(input: ResolveRetryInput): Promise<void> {
  const key = `${input.ref.source}:${input.ref.source_product_id}`;
  const p = singleFlight(`resolve-retry:${key}`, async () => {
    inFlightRefs.add(key);
    try {
      for (const delay of RETRY_DELAYS_MS) {
        await sleep(delay);
        try {
          const fetched = await fetchDetailJson(input.ref, RESOLVE_TIMEOUT_MS);
          if (!fetched) return;
          const cls = classifyDetail(input.ref.source, fetched.json);
          if (cls === "failed") return;
          if (cls === "pending") continue;
          const detail = parseDetail(input.ref.source, fetched.json);
          const titleImage = parseDetailTitleImage(input.ref.source, fetched.json);
          if (!detail || !titleImage) return;
          const raw: MockProduct = {
            id: `${input.ref.source}:${input.ref.source_product_id}`,
            source: input.ref.source,
            source_product_id: input.ref.source_product_id,
            title: titleImage.title,
            description: titleImage.title,
            image_url: titleImage.image_url,
            price_cents: detail.price_cents,
            brand: "",
            raw_category: "",
            attributes: {},
            url: input.ref.url,
          };
          await withPgDirect(async (pg) => {
            await pg.query(`SET search_path TO ${input.searchPath}`);
            await processProduct(raw, pg);
          });
          return;
        } catch {
          // red/proveedor caído: el próximo delay reintenta; agotados, se rinde
        }
      }
    } finally {
      inFlightRefs.delete(key);
    }
  });
  p.catch(() => {}); // fire-and-forget: jamás unhandled rejection
  return p;
}
