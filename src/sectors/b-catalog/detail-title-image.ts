// src/sectors/b-catalog/detail-title-image.ts — extrae título+imagen del
// mismo JSON de detalle que revalidate.ts ya parsea para precio/disponibilidad
// (fetchDetailJson). Usado por /api/products/resolve-url para construir un
// MockProduct mínimo cuando el cliente pega un link de producto que aún no
// está en catálogo (Tarea 2).
import { asRecord, str, toNumber } from "./apify/sources/shared";

export interface DetailTitleImage {
  title: string;
  image_url: string;
}

// real-time-amazon-data — mismo endpoint /product-details que parseAmazonDetail.
export function parseAmazonDetailTitleImage(json: unknown): DetailTitleImage | null {
  const data = asRecord(asRecord(json)?.data);
  const title = str(data?.product_title);
  if (!title) return null;
  return { title, image_url: str(data?.product_photo) ?? "" };
}

// aliexpress-datahub — mismo endpoint /item_detail_2 que parseAliexpressDetail.
// images[] viene con URLs protocol-relative ("//ae-pic-..."), se normalizan a https.
export function parseAliexpressDetailTitleImage(json: unknown): DetailTitleImage | null {
  const result = asRecord(asRecord(json)?.result);
  const code = toNumber(asRecord(result?.status)?.code);
  if (code !== 200) return null;
  const item = asRecord(result?.item);
  const title = str(item?.title);
  if (!title) return null;
  const images = Array.isArray(item?.images) ? item!.images : [];
  const first = typeof images[0] === "string" ? images[0] : undefined;
  const image_url = first ? (first.startsWith("//") ? `https:${first}` : first) : "";
  return { title, image_url };
}

// axesso-walmart-data-service — mismo endpoint que parseWalmartDetail.
// ponytail: los fixtures de detalle (tests/fixtures/rapidapi/walmart-axesso-
// detail*.json) no traen imagen a nivel de producto — fallback a la primera
// imagen de la primera variante (mismo campo que parseWalmartVariants usa en
// hydrate.ts). Si el detalle real trae imagen a nivel de producto, ampliar acá.
export function parseWalmartDetailTitleImage(json: unknown): DetailTitleImage | null {
  const item = asRecord(asRecord(json)?.item);
  const props = asRecord(item?.props);
  const pageProps = asRecord(props?.pageProps);
  const initialData = asRecord(pageProps?.initialData);
  const product = asRecord(asRecord(initialData?.data)?.product);
  if (!product) return null;
  const title = str(product.name);
  if (!title) return null;

  const variantsMap = asRecord(product.variantsMap) ?? {};
  const firstVariant = asRecord(Object.values(variantsMap)[0]);
  const imageInfo = asRecord(firstVariant?.imageInfo);
  const firstImage = Array.isArray(imageInfo?.allImages) ? asRecord(imageInfo!.allImages[0]) : null;
  return { title, image_url: str(firstImage?.url) ?? "" };
}

// otapi-shein — mismo endpoint /BatchGetItemFullInfo que parseSheinDetail.
// ponytail: Pictures es del padre (ver comentario en hydrate.ts), ausente en
// nuestros fixtures de detalle — si el campo real trae un array, se toma el
// primero; si no está, image_url queda "".
export function parseSheinDetailTitleImage(json: unknown): DetailTitleImage | null {
  const o = asRecord(json);
  if (o?.ErrorCode !== "Ok") return null;
  const item = asRecord(asRecord(o.Result)?.Item);
  if (!item) return null;
  const title = str(item.Title);
  if (!title) return null;
  const pictures = Array.isArray(item.Pictures) ? item.Pictures : [];
  const image_url = typeof pictures[0] === "string" ? pictures[0] : "";
  return { title, image_url };
}

export function parseDetailTitleImage(source: string, json: unknown): DetailTitleImage | null {
  switch (source) {
    case "amazon":
      return parseAmazonDetailTitleImage(json);
    case "aliexpress":
      return parseAliexpressDetailTitleImage(json);
    case "walmart":
      return parseWalmartDetailTitleImage(json);
    case "shein":
      return parseSheinDetailTitleImage(json);
    default:
      return null;
  }
}
