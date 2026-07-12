// src/lib/img.ts — imágenes livianas para internet MUY mala (3G). Puro, sin
// deps: se usa en server (storefront/map) y client (useTukiSearch).
//
// El CDN de AliExpress sirve el original a tamaño completo (92–225 KB medidos)
// pero acepta sufijo de resize: foto.jpg → foto.jpg_350x350.jpg (~7–22 KB,
// verificado HTTP 200 el 2026-07-12). Amazon/Walmart/Shein ya entregan
// miniaturas chicas — no se tocan. En DB siempre vive la URL ORIGINAL (fuente
// de verdad); el resize es cosa de la capa de presentación.

/** Shein guarda URLs protocolo-relativas ("//img.ltwebstatic.com/…") — el
 * navegador las resuelve pero el tooling no; se normalizan a https. */
export function normalizeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith("//") ? `https:${url}` : url;
}

const ALIEXPRESS_CDN = /(ae-pic-[a-z0-9]+\.aliexpress-media\.com|\.alicdn\.com)/i;
// Shein también acepta sufijo de thumbnail en su CDN: original 343 KB →
// _thumbnail_220x293 = 15 KB / _thumbnail_405x552 = 42 KB (verificado 200 OK
// 2026-07-12). Muchas URLs ya vienen con _thumbnail_ desde la ingesta; solo se
// sufijan las crudas.
const SHEIN_CDN = /img\.ltwebstatic\.com/i;
const RAW_IMAGE = /\.(jpe?g|png)$/i;

export type ImgSize = 350 | 640; // 350 = cards/rieles, 640 = imagen grande de PDP

/** URL lista para <img>: normalizada y, si es un CDN redimensionable
 * (AliExpress/Shein) con imagen cruda, pedida al tamaño del slot. Cualquier
 * otro caso: la URL tal cual (Amazon/Walmart ya sirven miniaturas). */
export function imgSrc(url: string | null | undefined, source: string | null | undefined, size: ImgSize): string | null {
  const u = normalizeImageUrl(url);
  if (!u) return null;
  if (!RAW_IMAGE.test(u)) return u;
  if (source === "aliexpress" && ALIEXPRESS_CDN.test(u) && !/_\d+x\d+/.test(u)) {
    return `${u}_${size}x${size}.jpg`;
  }
  if (source === "shein" && SHEIN_CDN.test(u) && !/_thumbnail_/.test(u)) {
    const dims = size === 350 ? "220x293" : "405x552";
    return u.replace(RAW_IMAGE, `_thumbnail_${dims}.jpg`);
  }
  return u;
}
