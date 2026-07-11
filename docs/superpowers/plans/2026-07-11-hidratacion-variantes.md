# Plan de implementación final — hidratación de detalle bajo demanda

Verificado contra el código real (`revalidate.ts`, `attrs.ts`, `pipeline.ts`, `checkout/revalidate/route.ts`, `rapidapi/client.ts`, `contract.ts`, `map.ts`, `tuki/lib.ts`, `ProductView.tsx`, migraciones de `mock_calls`) y contra los fixtures RAW reales en el scratchpad. Incorpora los 4 hallazgos ALTA/MEDIA de los tres verificadores; el de BAJA no requiere fix (confirmado inofensivo). Un hallazgo del diseño original quedó corregido por verificación directa contra datos reales (ver nota en Fixtures, Amazon).

## Mapeo hallazgo → fix

| # | Severidad | Hallazgo | Fix aplicado |
|---|---|---|---|
| 1 | ALTA | Race en el guard de cuota global (N productos aliexpress distintos en paralelo) | `pg_advisory_xact_lock` + reserva del slot en `mock_calls` **antes** del fetch, dentro de una transacción corta (no abarca la llamada de red) |
| 2 | ALTA | Guard no cuenta el consumo de `checkout/revalidate` sobre el mismo host aliexpress | El `count(*)` del guard suma `params->>'source' IN ('hydrate_aliexpress','checkout_revalidate')`; cuota bajada a 40 (conservador, ver nota) |
| 3 | MEDIA | ¿Amazon/Walmart/Shein-otapi también tienen tope duro? | Verificado contra las REGLAS DURAS del negocio (dadas explícitamente, no inferidas): solo AliExpress DataHub (100/mes) y Pinto Shein (10/mes, nunca tocado por hidratación) son cuotas duras declaradas. No se añade guard a los otros tres — YAGNI, con comentario `ponytail:` dejando el techo explícito |
| 4 | BAJA | Fail-open cuenta como 1 llamada aunque el fetch falle antes de tocar red | Sin fix — conservador, gasta presupuesto propio nunca ajeno |
| 5 | ALTA | Cron diario (`pipeline.ts` `DO UPDATE SET metadata = EXCLUDED.metadata`) pisa `hydrated_at`/`variants` en cada re-ingesta | `DO UPDATE` pasa a preservar `attrs.hydrated_at` y `attrs.variants` de la fila existente cuando ya estaba hidratada |
| 6 | ALTA | `jsonb_set(...,'{attrs,hydrated_at}',...,true)` no crea `attrs` si la clave intermedia no existe (no-op silencioso en filas legacy) | Claim query usa `jsonb_set(metadata,'{attrs}', COALESCE(metadata->'attrs','{}'::jsonb) || jsonb_build_object(...), true)` — garantiza el nivel intermedio |
| 7 | ALTA | Claim no filtra por `source`: puede escribir `attrs.hydrated_at` en productos demo/mock (`generated:true`, sin `attrs` hoy) y romper `mergeAttrs` (pierde swatches inventados sin ganar nada real) | `WHERE ... AND source IN ('amazon','aliexpress','walmart','shein')` en el claim |

---

## 1. `src/sectors/b-catalog/enrichment/attrs.ts`

Exportar lo que hoy es privado y añadir el shape de variantes.

```ts
// exportar (eran privados):
export function curateColors(v: unknown): CuratedColor[] | undefined { ... }  // sin cambios de lógica
export function curateStrings(v: unknown): string[] | undefined { ... }        // sin cambios de lógica

const CAP_VARIANTS = 30;

export interface CuratedVariant {
  color?: string;
  size?: string;
  price_cents?: number;
  available?: boolean;
  image?: string;
}

function curateVariant(v: unknown): CuratedVariant | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const color = typeof o.color === "string" && o.color.trim() ? o.color.trim() : undefined;
  const size = typeof o.size === "string" && o.size.trim() ? o.size.trim() : undefined;
  if (!color && !size) return undefined; // sin ninguna dimensión no es una variante útil
  const price_cents = typeof o.price_cents === "number" && Number.isInteger(o.price_cents) && o.price_cents > 0 ? o.price_cents : undefined;
  const available = typeof o.available === "boolean" ? o.available : undefined;
  const image = typeof o.image === "string" && o.image.trim() ? o.image.trim() : undefined;
  return {
    ...(color && { color }), ...(size && { size }),
    ...(price_cents !== undefined && { price_cents }),
    ...(available !== undefined && { available }),
    ...(image && { image }),
  };
}

export function curateVariants(v: unknown): CuratedVariant[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  const out: CuratedVariant[] = [];
  for (const item of v) {
    const c = curateVariant(item);
    if (!c) continue;
    const key = `${c.color ?? ""}|${c.size ?? ""}`;
    if (seen.has(key)) continue; // dedupe antes de cortar
    seen.add(key);
    out.push(c);
    if (out.length >= CAP_VARIANTS) break;
  }
  return out.length ? out : undefined;
}
```

`CuratedAttrs` gana dos campos opcionales:

```ts
export interface CuratedAttrs {
  colors?: CuratedColor[];
  sizes?: string[];
  images?: string[];
  old_price_cents?: number;
  rating?: number;
  orders?: string | number;
  brand?: string;
  variants?: CuratedVariant[];
  hydrated_at?: string;
}
```

`attrsForStorage`/`curateAttrs` **no se tocan** — `hydrated_at`/`variants` nunca vienen del pipeline de listado, solo del endpoint de hidratación.

---

## 2. `src/sectors/b-catalog/revalidate.ts` — extraer `fetchDetailJson`

Reuso real de hosts/paths/params entre `revalidate.ts` (precio) y `hydrate.ts` (variantes), sin duplicar el switch.

```ts
export interface ProviderRef { source: string; source_product_id: string; url: string | null }
interface DetailFetch { source: string; json: unknown }

export async function fetchDetailJson(p: ProviderRef): Promise<DetailFetch | null> {
  switch (p.source) {
    case "amazon":
      return { source: p.source, json: await rapidApiGet("real-time-amazon-data.p.rapidapi.com", "/product-details", { asin: p.source_product_id, country: "US" }, LOOKUP_TIMEOUT_MS) };
    case "aliexpress":
      return { source: p.source, json: await rapidApiGet("aliexpress-datahub.p.rapidapi.com", "/item_detail_2", { itemId: p.source_product_id }, LOOKUP_TIMEOUT_MS) };
    case "walmart": {
      if (!p.url) return null;
      return { source: p.source, json: await rapidApiGet("axesso-walmart-data-service.p.rapidapi.com", "/wlm/walmart-lookup-product", { url: p.url }, LOOKUP_TIMEOUT_MS) };
    }
    case "shein":
      return { source: p.source, json: await rapidApiGet("otapi-shein.p.rapidapi.com", "/BatchGetItemFullInfo", { language: "en", itemId: `sh-${p.source_product_id}` }, LOOKUP_TIMEOUT_MS) };
    default:
      return null;
  }
}

async function liveLookup(p: RevalidateProductRow): Promise<DetailResult | null> {
  const fetched = await fetchDetailJson(p);
  if (!fetched) return null;
  switch (fetched.source) {
    case "amazon": return parseAmazonDetail(fetched.json);
    case "aliexpress": return parseAliexpressDetail(fetched.json);
    case "walmart": return parseWalmartDetail(fetched.json);
    case "shein": return parseSheinDetail(fetched.json);
    default: return null;
  }
}
```

Borrar el cuerpo viejo del `switch` de `liveLookup` (líneas 131-176 actuales), reemplazándolo por lo de arriba. `RevalidateProductRow` ya cumple `ProviderRef` estructuralmente. Cero cambio de comportamiento — `tests/unit/revalidate.test.ts` sigue pasando sin tocar.

---

## 3. Archivo nuevo `src/sectors/b-catalog/hydrate.ts`

```ts
// src/sectors/b-catalog/hydrate.ts — parsers de variantes (talla/color/precio/
// foto por SKU) para la hidratación de detalle bajo demanda de la PDP. Hermano
// de revalidate.ts (ese archivo queda acotado a precio de checkout).
import { asRecord, str, toNumber, usdToCents } from "./apify/sources/shared";
import { fetchDetailJson, type ProviderRef } from "./revalidate";
import { curateVariants, type CuratedVariant } from "./enrichment/attrs";

// Amazon RTD: data.all_product_variations = {asin: {size,color}}. Verificado
// contra el fixture real (1767 entradas): NO son duplicados masivos como se
// asumió en el diseño inicial — solo 2 pares colapsan a la misma combinación
// color+size. El límite real es CAP_VARIANTS=30, no el dedupe. Sin precio ni
// foto por variante (N+1 inviable, nunca se hace).
export function parseAmazonVariants(json: unknown): unknown[] {
  const all = asRecord(asRecord(asRecord(json)?.data)?.all_product_variations);
  if (!all) return [];
  return Object.values(all).map((v) => {
    const o = asRecord(v);
    return { color: str(o?.color), size: str(o?.size) };
  });
}

// AliExpress DataHub: sku.props (pid→nombre, vid→valor) + sku.base[] (skuId,
// propMap "pid:vid;pid:vid", price/promotionPrice, quantity). Precio+stock sí;
// skuImages viene vacío en el fixture real → image queda undefined.
export function parseAliexpressVariants(json: unknown): unknown[] {
  const item = asRecord(asRecord(asRecord(json)?.result)?.item);
  const sku = asRecord(item?.sku);
  const props = Array.isArray(sku?.props) ? sku!.props : [];
  const base = Array.isArray(sku?.base) ? sku!.base : [];
  const vidToValue = new Map<string, { propName: string; name: string }>();
  for (const p of props) {
    const po = asRecord(p);
    const propName = str(po?.name) ?? "";
    for (const val of Array.isArray(po?.values) ? po!.values : []) {
      const vo = asRecord(val);
      const vid = vo?.vid != null ? String(vo.vid) : undefined;
      const name = str(vo?.name);
      if (vid && name) vidToValue.set(vid, { propName, name });
    }
  }
  return base.map((b) => {
    const bo = asRecord(b);
    let color: string | undefined, size: string | undefined;
    for (const pair of (str(bo?.propMap) ?? "").split(";")) {
      const vid = pair.split(":")[1];
      const r = vid ? vidToValue.get(vid) : undefined;
      if (!r) continue;
      if (/color/i.test(r.propName)) color = r.name;
      else if (/size/i.test(r.propName)) size = r.name;
    }
    const qty = toNumber(bo?.quantity);
    return {
      color, size,
      price_cents: usdToCents(bo?.promotionPrice ?? bo?.price) ?? undefined,
      available: qty !== undefined ? qty > 0 : undefined,
    };
  });
}

// Walmart Axesso: variantCriteria[] (id→nombre de dimensión + variantList
// id→nombre) + variantsMap (por SKU: variants[ids], priceInfo, availabilityStatus,
// imageInfo.allImages[0].url) — única fuente completa (precio+stock+foto).
export function parseWalmartVariants(json: unknown): unknown[] {
  const item = asRecord(asRecord(json)?.item);
  const props = asRecord(item?.props);
  const pageProps = asRecord(props?.pageProps);
  const initialData = asRecord(pageProps?.initialData);
  const product = asRecord(asRecord(initialData?.data)?.product);
  if (!product) return [];

  const criteria = Array.isArray(product.variantCriteria) ? product.variantCriteria : [];
  const idToLabel = new Map<string, { dimName: string; value: string }>();
  for (const c of criteria) {
    const co = asRecord(c);
    const dimName = str(co?.name) ?? "";
    for (const v of Array.isArray(co?.variantList) ? co!.variantList : []) {
      const vo = asRecord(v);
      const id = str(vo?.id), name = str(vo?.name);
      if (id && name) idToLabel.set(id, { dimName, value: name });
    }
  }

  const variantsMap = asRecord(product.variantsMap) ?? {};
  return Object.values(variantsMap).map((v) => {
    const vo = asRecord(v);
    let color: string | undefined, size: string | undefined;
    for (const id of Array.isArray(vo?.variants) ? vo!.variants : []) {
      const label = idToLabel.get(String(id));
      if (!label) continue;
      if (/color/i.test(label.dimName)) color = label.value;
      else if (/size/i.test(label.dimName)) size = label.value;
    }
    const currentPrice = asRecord(asRecord(vo?.priceInfo)?.currentPrice);
    const availRaw = str(vo?.availabilityStatus);
    const imageInfo = asRecord(vo?.imageInfo);
    const firstImage = Array.isArray(imageInfo?.allImages) ? asRecord(imageInfo!.allImages[0]) : null;
    return {
      color, size,
      price_cents: usdToCents(currentPrice?.price) ?? undefined,
      available: !availRaw || availRaw === "IN_STOCK",
      image: str(firstImage?.url),
    };
  });
}

// Shein Otapi (NO Pinto): Attributes[IsConfigurator=true] (Pid/Vid→PropertyName/
// Value) + ConfiguredItems[] (Configurators[{Pid,Vid}], Price.ConvertedPriceList.
// Internal.Price, Quantity). Precio+stock sí, sin foto (Pictures es del padre).
export function parseSheinVariants(json: unknown): unknown[] {
  const o = asRecord(json);
  if (o?.ErrorCode !== "Ok") return [];
  const item = asRecord(asRecord(o.Result)?.Item);
  if (!item) return [];

  const attrs = Array.isArray(item.Attributes) ? item.Attributes : [];
  const configMap = new Map<string, { propName: string; value: string }>();
  for (const a of attrs) {
    const ao = asRecord(a);
    if (ao?.IsConfigurator !== true) continue;
    const pid = str(ao?.Pid), vid = str(ao?.Vid);
    const propName = str(ao?.PropertyName), value = str(ao?.Value);
    if (pid && vid && propName && value) configMap.set(`${pid}:${vid}`, { propName, value });
  }

  const configured = Array.isArray(item.ConfiguredItems) ? item.ConfiguredItems : [];
  return configured.map((ci) => {
    const cio = asRecord(ci);
    let color: string | undefined, size: string | undefined;
    for (const cfg of Array.isArray(cio?.Configurators) ? cio!.Configurators : []) {
      const cfgO = asRecord(cfg);
      const pid = str(cfgO?.Pid), vid = str(cfgO?.Vid);
      const label = pid && vid ? configMap.get(`${pid}:${vid}`) : undefined;
      if (!label) continue;
      if (/color/i.test(label.propName)) color = label.value;
      else if (/size/i.test(label.propName)) size = label.value;
    }
    const priceObj = asRecord(asRecord(asRecord(cio?.Price)?.ConvertedPriceList)?.Internal);
    const qty = toNumber(cio?.Quantity);
    return {
      color, size,
      price_cents: usdToCents(priceObj?.Price) ?? undefined,
      available: qty !== undefined ? qty > 0 : undefined,
    };
  });
}

export async function liveLookupVariants(p: ProviderRef): Promise<CuratedVariant[] | undefined> {
  const fetched = await fetchDetailJson(p);
  if (!fetched) return undefined;
  const raw =
    fetched.source === "amazon" ? parseAmazonVariants(fetched.json) :
    fetched.source === "aliexpress" ? parseAliexpressVariants(fetched.json) :
    fetched.source === "walmart" ? parseWalmartVariants(fetched.json) :
    fetched.source === "shein" ? parseSheinVariants(fetched.json) : [];
  return curateVariants(raw);
}
```

---

## 4. `src/sectors/b-catalog/enrichment/pipeline.ts` — fix ALTA #5

Cambiar solo la cláusula `metadata` del `DO UPDATE`:

```ts
     ON CONFLICT (source, source_product_id) DO UPDATE SET
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       price_cents = EXCLUDED.price_cents,
       image_url = EXCLUDED.image_url,
       raw_category = EXCLUDED.raw_category,
       url = EXCLUDED.url,
       metadata = CASE
         WHEN products.metadata->'attrs'->>'hydrated_at' IS NOT NULL THEN
           jsonb_set(
             EXCLUDED.metadata, '{attrs}',
             (EXCLUDED.metadata->'attrs')
               || jsonb_build_object('hydrated_at', products.metadata->'attrs'->'hydrated_at')
               || CASE WHEN products.metadata->'attrs' ? 'variants'
                       THEN jsonb_build_object('variants', products.metadata->'attrs'->'variants')
                       ELSE '{}'::jsonb END,
             true
           )
         ELSE EXCLUDED.metadata
       END,
       embedding = EXCLUDED.embedding,
       last_refreshed_at = now()
```

Si la fila existente ya tiene `hydrated_at`, se preservan `hydrated_at` y (si existe) `variants` por encima del `metadata` fresco del cron; el resto de `attrs` (colors/sizes/images/etc. re-curados) se actualiza normalmente. Sin cambio para filas nunca hidratadas.

---

## 5. Endpoint nuevo `src/app/api/products/[id]/hydrate/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { withPg } from "@/lib/db/helpers";
import { fetchDetailJson } from "@/sectors/b-catalog/revalidate";
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
    // producto demo/mock nunca entra acá, evita corromper mergeAttrs (tuki/lib.ts)
    // con un attrs.hydrated_at truthy que no tenía antes. jsonb_set anidado en
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
        const q = await pg.query(
          `SELECT count(*)::int AS n FROM mock_calls
           WHERE params->>'source' IN ('hydrate_aliexpress','checkout_revalidate')
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
    try {
      variants = await liveLookupVariants(row as ProviderRef);
    } catch {
      variants = undefined; // fail-open, mismo criterio que revalidateProduct
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
        `INSERT INTO mock_calls (params, response_size, simulated_cost_cents, was_error) VALUES ($1::jsonb, $2, 0, false)`,
        [JSON.stringify({ source: `hydrate_${row.source}`, product_id: id }), variants?.length ?? 0],
      );
    }
    return NextResponse.json({ ok: true });
  });
}
```

Nota de diseño (`withPg` da un `Client` pooled): el `BEGIN`/`COMMIT`/`ROLLBACK` explícitos sobre `pg` calcan el patrón ya usado en `checkout.ts`/`checkout-anonymous.ts`/`events/merge.ts` — no se introduce ninguna función de Postgres nueva ni abstracción extra.

---

## 6. Passthrough — `src/storefront/contract.ts` y `src/storefront/map.ts`

`contract.ts`, dentro de `attrs?: {...}`:
```ts
  attrs?: {
    colors?: { name: string; hex?: string }[];
    sizes?: string[];
    images?: string[];
    old_price_cents?: number;
    rating?: number;
    sold?: string;
    hydrated_at?: string; // nuevo — gate cliente
  };
```

`map.ts`, dentro de `toCardAttrs`:
```ts
function toCardAttrs(attrs: CuratedAttrs | undefined): StorefrontCard["attrs"] {
  if (!attrs) return undefined;
  return {
    ...(attrs.colors ? { colors: attrs.colors } : {}),
    ...(attrs.sizes ? { sizes: attrs.sizes } : {}),
    ...(attrs.images ? { images: attrs.images } : {}),
    ...(attrs.old_price_cents !== undefined ? { old_price_cents: attrs.old_price_cents } : {}),
    ...(attrs.rating !== undefined ? { rating: attrs.rating } : {}),
    ...(attrs.orders !== undefined ? { sold: formatSold(attrs.orders) } : {}),
    ...(attrs.hydrated_at ? { hydrated_at: attrs.hydrated_at } : {}),
  };
}
```

`variants` **no** viaja al contract — nada en UI lo consume todavía (skip explícito, ver §8).

---

## 7. Trigger — `src/components/tuki/ProductView.tsx`

Justo después del `useEffect` de `product_view` (líneas 44-51 actuales):

```tsx
  // Hidratación de detalle bajo demanda: dispara UNA vez por producto real
  // (source amazon/aliexpress/walmart/shein) que aún no tiene attrs.hydrated_at.
  // Gate cliente = puro ahorro de request; el gate atómico real vive en el
  // UPDATE...WHERE...IS NULL del servidor (ver route.ts).
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (card.attrs?.hydrated_at || hydratedFor.current === card.id) return;
    hydratedFor.current = card.id;
    const ctrl = new AbortController();
    fetch(`/api/products/${card.id}/hydrate`, { method: "POST", signal: ctrl.signal }).catch(() => {});
    return () => ctrl.abort();
  }, [card.id, card.attrs?.hydrated_at]);
```

Sin `router.refresh()` — "visitas siguientes sirven de DB", esta visita no se repinta.

---

## 8. Fixtures nuevos (contenido exacto, reales, recortados)

Verificados directamente contra los RAW en el scratchpad (`amazon-rtd-detail.json` 190KB, `aliexpress-datahub-detail.json` 7.5KB, `walmart-axesso-detail.json` 808KB, `shein-otapi-detail.json` 241KB). **Corrección de honestidad sobre el diseño original**: la afirmación "Amazon dedupe 1767→≤30" es engañosa — se verificó que de las 1767 entradas reales solo 2 pares colapsan a la misma combinación color+size; el límite real que actúa es `CAP_VARIANTS=30`, el dedupe casi no reduce nada. El comentario del parser ya refleja esto correctamente (§3).

### `tests/fixtures/rapidapi/amazon-rtd-detail-variants.json`
```json
{
  "data": {
    "all_product_variations": {
      "B0G1YXJ7Z9": { "special_size_type": "Standard", "size": "36W x 30L", "color": "River Bank Cool" },
      "B0DJV6VYJ4": { "special_size_type": "Standard", "size": "35W x 30L", "color": "Olive Night" },
      "B00GW7HILO": { "special_size_type": "Tall", "size": "32W x 32L", "color": "Rinse" },
      "B0018OKMBO": { "special_size_type": "Standard", "size": "32W x 32L", "color": "Rinse" }
    }
  }
}
```
`B00GW7HILO`/`B0018OKMBO` son el par de duplicado **real** confirmado (mismo color+size, distinto ASIN) — prueba el dedupe con dato genuino, no inventado.

### `tests/fixtures/rapidapi/aliexpress-datahub-detail-variants.json`
```json
{
  "result": {
    "status": { "code": 200 },
    "item": {
      "sku": {
        "props": [
          { "pid": 14, "name": "Color", "values": [{ "vid": 691, "name": "GRAY", "propTips": "GRAY" }] },
          { "pid": 5, "name": "Size", "values": [
            { "vid": 100014064, "name": "S", "propTips": "S" },
            { "vid": 361386, "name": "M", "propTips": "M" },
            { "vid": 361385, "name": "L", "propTips": "L" },
            { "vid": 100014065, "name": "XL", "propTips": "XL" },
            { "vid": 4182, "name": "XXL", "propTips": "XXL" },
            { "vid": 4183, "name": "XXXL", "propTips": "XXXL" }
          ]},
          { "pid": 200007763, "name": "Ships From", "values": [{ "vid": 201336106, "name": "United States", "propTips": "United States" }] },
          { "pid": 200370261, "name": "Sale by Pack", "values": [{ "vid": 581452131, "name": "Pack of 1", "propTips": "Pack of 1" }] }
        ],
        "base": [
          { "skuId": "12000058970112493", "propMap": "14:691;5:100014065;200007763:201336106;200370261:581452131", "price": 57.46, "promotionPrice": 10.77, "quantity": 30 },
          { "skuId": "12000058970112492", "propMap": "14:691;5:361385;200007763:201336106;200370261:581452131", "price": 57.46, "promotionPrice": 10.77, "quantity": 30 },
          { "skuId": "12000058970112495", "propMap": "14:691;5:4183;200007763:201336106;200370261:581452131", "price": 57.46, "promotionPrice": 10.77, "quantity": 30 }
        ],
        "skuImages": []
      }
    }
  }
}
```
(campo `ext` — token opaco de paginación, no usado por el parser — omitido; resto verbatim del fixture real)

### `tests/fixtures/rapidapi/walmart-axesso-detail-variants.json`
```json
{
  "item": {
    "props": {
      "pageProps": {
        "initialData": {
          "data": {
            "product": {
              "variantCriteria": [
                { "id": "actual_color", "name": "Color", "variantList": [
                  { "id": "actual_color-coalblack", "name": "Coal Black" },
                  { "id": "actual_color-mediumstone", "name": "Medium Stone" }
                ]},
                { "id": "clothing_size", "name": "Clothing Size", "variantList": [
                  { "id": "clothing_size-38x29", "name": "38X29" },
                  { "id": "clothing_size-38x32", "name": "38X32" }
                ]}
              ],
              "variantsMap": {
                "1KJZ47Z7XGQZ": {
                  "id": "1KJZ47Z7XGQZ",
                  "variants": ["actual_color-coalblack", "clothing_size-38x32"],
                  "availabilityStatus": "IN_STOCK",
                  "priceInfo": { "currentPrice": { "price": 20.98 } },
                  "imageInfo": { "allImages": [{ "url": "https://i5.walmartimages.com/seo/Wrangler-Men-s-and-Big-Men-s-Relaxed-Fit-Jeans-with-Flex_5406a8e4-57fd-4086-98be-f5e27e533557.156f6b596695bb3fce1d74434644ad15.jpeg" }] }
                },
                "1H0PCOMO1E3D": {
                  "id": "1H0PCOMO1E3D",
                  "variants": ["actual_color-mediumstone", "clothing_size-38x29"],
                  "availabilityStatus": "IN_STOCK",
                  "priceInfo": { "currentPrice": { "price": 20.98 } },
                  "imageInfo": { "allImages": [{ "url": "https://i5.walmartimages.com/seo/Wrangler-Men-s-and-Big-Men-s-Relaxed-Fit-Jeans-with-Flex_560563ca-9edb-41dc-bcd9-e14fd7868fed.1970619230618e280e04ca05d8430e65.jpeg" }] }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

### `tests/fixtures/rapidapi/shein-otapi-detail-variants.json`
```json
{
  "ErrorCode": "Ok",
  "Result": {
    "Item": {
      "Attributes": [
        { "Pid": "87", "Vid": "568", "PropertyName": "Size", "Value": "S", "IsConfigurator": true },
        { "Pid": "87", "Vid": "417", "PropertyName": "Size", "Value": "M", "IsConfigurator": true },
        { "Pid": "87", "Vid": "387", "PropertyName": "Size", "Value": "L", "IsConfigurator": true },
        { "Pid": "87", "Vid": "754", "PropertyName": "Size", "Value": "XL", "IsConfigurator": true }
      ],
      "ConfiguredItems": [
        { "Id": "I97lw8t16823", "Configurators": [{ "Pid": "87", "Vid": "754" }], "Quantity": 20, "Price": { "ConvertedPriceList": { "Internal": { "Price": 17.0, "Code": "USD", "Sign": "$" } } } },
        { "Id": "I97lw8t12a0g", "Configurators": [{ "Pid": "87", "Vid": "387" }], "Quantity": 20, "Price": { "ConvertedPriceList": { "Internal": { "Price": 20.0, "Code": "USD", "Sign": "$" } } } },
        { "Id": "I97lw8t0qgus", "Configurators": [{ "Pid": "87", "Vid": "568" }], "Quantity": 3, "Price": { "ConvertedPriceList": { "Internal": { "Price": 13.0, "Code": "USD", "Sign": "$" } } } },
        { "Id": "I97lw8t0ws60", "Configurators": [{ "Pid": "87", "Vid": "417" }], "Quantity": 20, "Price": { "ConvertedPriceList": { "Internal": { "Price": 16.0, "Code": "USD", "Sign": "$" } } } }
      ]
    }
  }
}
```

---

## 9. Tests

### `tests/unit/hydrate.test.ts` (nuevo)
```ts
import { describe, test, expect } from "vitest";
import { parseAmazonVariants, parseAliexpressVariants, parseWalmartVariants, parseSheinVariants } from "@/sectors/b-catalog/hydrate";
import amazonFx from "../fixtures/rapidapi/amazon-rtd-detail-variants.json";
import aliexpressFx from "../fixtures/rapidapi/aliexpress-datahub-detail-variants.json";
import walmartFx from "../fixtures/rapidapi/walmart-axesso-detail-variants.json";
import sheinFx from "../fixtures/rapidapi/shein-otapi-detail-variants.json";

describe("parseAmazonVariants", () => {
  test("extrae color+size, sin precio/foto; 2 asins con misma combo (dedupe lo resuelve curateVariants, no el parser)", () => {
    const out = parseAmazonVariants(amazonFx);
    expect(out).toHaveLength(4);
    expect(out).toContainEqual({ color: "Rinse", size: "32W x 32L" });
  });
  test("sin all_product_variations → []", () => {
    expect(parseAmazonVariants({ data: {} })).toEqual([]);
  });
});

describe("parseAliexpressVariants", () => {
  test("mapea propMap→color/size vía props, precio en promotionPrice, available por quantity>0", () => {
    const out = parseAliexpressVariants(aliexpressFx);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ color: "GRAY", size: "XL", price_cents: 1077, available: true });
  });
});

describe("parseWalmartVariants", () => {
  test("resuelve ids de variantCriteria a nombres + precio/stock/foto por SKU", () => {
    const out = parseWalmartVariants(walmartFx);
    expect(out).toHaveLength(2);
    expect(out).toContainEqual({ color: "Coal Black", size: "38X32", price_cents: 2098, available: true, image: expect.stringContaining("walmartimages.com") });
  });
});

describe("parseSheinVariants", () => {
  test("resuelve Configurators Pid/Vid contra Attributes[IsConfigurator], precio+stock, sin foto", () => {
    const out = parseSheinVariants(sheinFx);
    expect(out).toHaveLength(4);
    expect(out).toContainEqual({ size: "XL", price_cents: 1700, available: true });
    expect(out.some((v) => "image" in v)).toBe(false);
  });
});
```

### `tests/unit/enrichment-attrs.test.ts` (agregar describe)
```ts
import { curateVariants } from "@/sectors/b-catalog/enrichment/attrs";

describe("curateVariants", () => {
  test("dedupe por color+size", () => {
    const out = curateVariants([{ color: "Rojo", size: "M" }, { color: "Rojo", size: "M" }, { color: "Azul", size: "M" }]);
    expect(out).toHaveLength(2);
  });
  test("CAP 30", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ color: `C${i}`, size: "M" }));
    expect(curateVariants(many)).toHaveLength(30);
  });
  test("entradas sin color ni size se descartan", () => {
    expect(curateVariants([{ price_cents: 100 }])).toBeUndefined();
  });
  test("tipos inválidos se descartan campo por campo (price_cents no-entero, available no-boolean)", () => {
    const out = curateVariants([{ color: "Rojo", price_cents: 12.5, available: "yes" }]);
    expect(out).toEqual([{ color: "Rojo" }]);
  });
  test("[] o no-array → undefined", () => {
    expect(curateVariants([])).toBeUndefined();
    expect(curateVariants("x")).toBeUndefined();
  });
});
```

### `tests/unit/revalidate.test.ts`
Sin cambios obligatorios (los 4 parsers de precio y `computeVerdict` quedan intactos). Opcional: un test de `fetchDetailJson` reusando el mock existente de `rapidApiGet` de ese archivo, si ya hay uno — si no existe mock de red ahí, **no** agregarlo (no se testea contra RapidAPI real, mismo criterio que hoy).

Sin test de integración con red para la ruta ni para el claim atómico — mismo criterio que `checkout/revalidate`.

---

## 10. Criterios de verificación

```bash
# 1. Typecheck completo
pnpm tsc --noEmit

# 2. Tests nuevos y afectados — deben pasar todos, sin red
pnpm vitest run tests/unit/hydrate.test.ts tests/unit/enrichment-attrs.test.ts tests/unit/revalidate.test.ts

# 3. Suite completa — nada roto por el refactor de revalidate.ts/pipeline.ts
pnpm vitest run

# 4. Lint
pnpm lint
```

Qué debe dar:
- `hydrate.test.ts`: 4 describes en verde, `parseAmazonVariants` da 4 entradas (2 con combo idéntica), `parseAliexpressVariants`/`parseWalmartVariants`/`parseSheinVariants` con precio/stock exactos según los fixtures de arriba.
- `enrichment-attrs.test.ts`: dedupe, CAP 30, descarte por tipo, `[]`/no-array → `undefined` — todos en verde.
- `revalidate.test.ts`: **sin regresión** — los mismos casos que hoy (precio exacto, disponibilidad, parse-fail) siguen pasando tras el refactor `fetchDetailJson`.
- Suite completa: mismo número de tests que antes + los nuevos, 0 fallos.
- `tsc --noEmit`: 0 errores — en particular, `RevalidateProductRow` debe seguir satisfaciendo `ProviderRef` sin cast explícito en `checkout/revalidate/route.ts`.

**No hay verificación end-to-end con Postgres real ni con RapidAPI real en este plan** (prohibido por las reglas del entorno) — el claim atómico, el guard de cuota con `pg_advisory_xact_lock`, y el `jsonb_set` con `COALESCE` se verifican por lectura/razonamiento contra el SQL escrito arriba, no por ejecución. Si se quiere una verificación real de la migración de `pipeline.ts` y el guard de cuota, correrla manualmente contra una base de test local (`pnpm vitest run --config vitest.integration.config.ts` si existe, o un script ad-hoc) fuera de este plan — no se incluye aquí por la regla de "prohibido gastar cuota / llamar red externa" de esta tarea.

---

## Qué queda explícitamente fuera (skip declarado)

- Foto/precio-por-SKU wireado en `selColor`/`selSize` de `ProductView.tsx` — `variants[]` queda persistido sin consumidor de UI. Añadir cuando el negocio pida esa interacción.
- Re-hidratación periódica (`HYDRATE_MAX_AGE_DAYS`) — nadie pidió refrescar `hydrated_at`.
- Quota guard para amazon/walmart/shein-otapi — YAGNI, sin cuota dura declarada para esos tres (ver hallazgo #3 en la tabla).
- Contador exacto por-host en `checkout/revalidate` (cambiar `params.source` a `host` desglosado) — la aproximación conservadora (sobre-contar, nunca sub-contar) del guard alcanza el objetivo real (no pasarse de la cuota dura) sin tocar ese endpoint ya estable y testeado.
