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
// Shein acepta sufijo de thumbnail en su CDN: original 343 KB (jpg) / 150 KB
// (webp) → _thumbnail_220x293 ≈ 12-15 KB (verificado 200 OK 2026-07-12,
// también sobre originales .webp conservando la extensión). Las URLs que ya
// traen _thumbnail_<dims> se REESCRIBEN al tamaño del slot (una _900x se
// colaba entera).
const SHEIN_CDN = /img\.ltwebstatic\.com/i;
const RAW_IMAGE = /\.(jpe?g|png|webp)$/i;
const SHEIN_THUMB = /(_(?:square_)?thumbnail)_\d+x\d*/i;
// Amazon: el token de tamaño/calidad de la URL es editable (verificado
// ._AC_SX220_QL60_FMwebp_. → 200 OK image/webp, −15/18%).
const AMAZON_TOKEN = /\._AC_[^.]*_\./;
const WALMART_ODN = /walmartimages\.com.*odnWidth=\d+/i;

export type ImgSize = 350 | 640; // 350 = cards/rieles, 640 = imagen grande de PDP

/** URL lista para <img>: normalizada y, si el CDN lo permite, pedida al
 * tamaño/calidad del slot. AliExpress usa la variante q75 webp (−50% vs
 * _350x350, verificado); Walmart ya sirve odnWidth chico — intacta. */
export function imgSrc(url: string | null | undefined, source: string | null | undefined, size: ImgSize): string | null {
  const u = normalizeImageUrl(url);
  if (!u) return null;
  if (source === "aliexpress" && ALIEXPRESS_CDN.test(u) && RAW_IMAGE.test(u) && !/_\d+x\d+/.test(u)) {
    return size === 350 ? `${u}_220x220q75.jpg_.webp` : `${u}_640x640q75.jpg_.webp`;
  }
  if (source === "shein" && SHEIN_CDN.test(u)) {
    const dims = size === 350 ? "220x293" : "405x552";
    if (SHEIN_THUMB.test(u)) return u.replace(SHEIN_THUMB, `$1_${dims}`);
    // cruda (.jpg O .webp — las webp de 150KB se colaban): sufijo conservando extensión
    const m = u.match(RAW_IMAGE);
    if (m) return u.replace(RAW_IMAGE, `_thumbnail_${dims}${m[0]}`);
    return u;
  }
  if (source === "amazon" && AMAZON_TOKEN.test(u)) {
    // la URL guardada trae SX300: sin reescribir, la foto "grande" de la PDP
    // era de 300px (borrosa). SX640 verificado 200 OK 2026-10-05 (~7 KB webp).
    return u.replace(AMAZON_TOKEN, size === 350 ? "._AC_SX220_QL60_FMwebp_." : "._AC_SX640_QL65_FMwebp_.");
  }
  if (source === "walmart" && WALMART_ODN.test(u)) {
    // guardada con odnWidth=180: la PDP mostraba 180px. 640 verificado 200 OK.
    const px = size === 350 ? 350 : 640;
    return u.replace(/odnHeight=\d+/, `odnHeight=${px}`).replace(/odnWidth=\d+/, `odnWidth=${px}`);
  }
  return u;
}

/** srcset por ANCHO a partir de una URL ya servida por imgSrc: el navegador
 * baja la que su pantalla necesita. `max` = techo del slot: tarjetas 350
 * (punto medio 3G/calidad: ~12 KB, nítida en una tarjeta), hero/PDP 640.
 * Devuelve undefined si el CDN no admite tamaños (la <img> usa solo src). */
export function imgSrcSet(url: string | null | undefined, max: 350 | 640 = 350): string | undefined {
  if (!url) return undefined;
  const set = (sizes: number[], f: (n: number) => string) =>
    sizes.filter((n) => n <= max).map((n) => `${f(n)} ${n}w`).join(", ");
  const ae = url.match(/_(\d+)x\1q75\.jpg_\.webp$/);
  if (ae) return set([220, 350, 640], (n) => url.replace(ae[0], `_${n}x${n}q75.jpg_.webp`));
  if (AMAZON_TOKEN.test(url)) return set([220, 350, 640], (n) => url.replace(AMAZON_TOKEN, `._AC_SX${n}_QL${n > 350 ? 65 : 60}_FMwebp_.`));
  if (SHEIN_THUMB.test(url)) {
    return max === 640 ? `${url.replace(SHEIN_THUMB, "$1_220x293")} 220w, ${url.replace(SHEIN_THUMB, "$1_405x552")} 405w` : undefined;
  }
  if (WALMART_ODN.test(url)) {
    return set([180, 350, 640], (n) => url.replace(/odnHeight=\d+/, `odnHeight=${n}`).replace(/odnWidth=\d+/, `odnWidth=${n}`));
  }
  return undefined;
}

/** Vista previa diminuta (0,3–4,5 KB, verificado 2026-10-05) que se pinta
 * borrosa DETRÁS de la foto: en 3G aparece casi al instante y se ve el
 * producto en vez de un hueco; la nítida la tapa al llegar. */
export function imgTiny(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const ae = url.match(/_(\d+)x\1q75\.jpg_\.webp$/);
  if (ae) return url.replace(ae[0], "_50x50q75.jpg_.webp");
  if (AMAZON_TOKEN.test(url)) return url.replace(AMAZON_TOKEN, "._AC_SX40_QL50_FMwebp_.");
  if (SHEIN_THUMB.test(url)) return url.replace(SHEIN_THUMB, "$1_50x67");
  if (WALMART_ODN.test(url)) return url.replace(/odnHeight=\d+/, "odnHeight=40").replace(/odnWidth=\d+/, "odnWidth=40");
  return undefined;
}
