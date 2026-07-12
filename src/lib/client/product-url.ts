// src/lib/client/product-url.ts — re-exporta parseProductUrl para que
// src/components/tuki/** (useTukiSearch) pueda usarlo sin violar la frontera
// storefront (tests/unit/storefront-boundary.test.ts: tuki/** nunca importa
// @/sectors/** directo, solo @/lib/client/*). La lógica real vive en
// b-catalog/url-resolver.ts — el server la usa ahí mismo, en
// /api/products/resolve-url. parseProductUrl es puro (solo usa el global
// `URL`), así que reexportarlo para el bundle de cliente es seguro.
export { parseProductUrl, type ParsedProductUrl } from "@/sectors/b-catalog/url-resolver";
