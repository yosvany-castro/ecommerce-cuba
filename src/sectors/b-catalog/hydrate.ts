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
      color,
      size,
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
      const id = str(vo?.id),
        name = str(vo?.name);
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
      color,
      size,
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
    const pid = str(ao?.Pid),
      vid = str(ao?.Vid);
    const propName = str(ao?.PropertyName),
      value = str(ao?.Value);
    if (pid && vid && propName && value) configMap.set(`${pid}:${vid}`, { propName, value });
  }

  const configured = Array.isArray(item.ConfiguredItems) ? item.ConfiguredItems : [];
  return configured.map((ci) => {
    const cio = asRecord(ci);
    let color: string | undefined, size: string | undefined;
    for (const cfg of Array.isArray(cio?.Configurators) ? cio!.Configurators : []) {
      const cfgO = asRecord(cfg);
      const pid = str(cfgO?.Pid),
        vid = str(cfgO?.Vid);
      const label = pid && vid ? configMap.get(`${pid}:${vid}`) : undefined;
      if (!label) continue;
      if (/color/i.test(label.propName)) color = label.value;
      else if (/size/i.test(label.propName)) size = label.value;
    }
    const priceObj = asRecord(asRecord(asRecord(cio?.Price)?.ConvertedPriceList)?.Internal);
    const qty = toNumber(cio?.Quantity);
    return {
      color,
      size,
      price_cents: usdToCents(priceObj?.Price) ?? undefined,
      available: qty !== undefined ? qty > 0 : undefined,
    };
  });
}

// La hidratación tolera respuestas pesadas (el detalle de Amazon con ~1800
// variantes tarda >8s en frío y Otapi/Shein supera los 20s en su cola larga —
// visto en vivo 2026-07-11/12); no bloquea checkout: timeout generoso.
const HYDRATE_TIMEOUT_MS = 30_000;

export async function liveLookupVariants(p: ProviderRef): Promise<CuratedVariant[] | undefined> {
  const fetched = await fetchDetailJson(p, HYDRATE_TIMEOUT_MS);
  if (!fetched) return undefined;
  const raw =
    fetched.source === "amazon"
      ? parseAmazonVariants(fetched.json)
      : fetched.source === "aliexpress"
        ? parseAliexpressVariants(fetched.json)
        : fetched.source === "walmart"
          ? parseWalmartVariants(fetched.json)
          : fetched.source === "shein"
            ? parseSheinVariants(fetched.json)
            : [];
  return curateVariants(raw);
}
