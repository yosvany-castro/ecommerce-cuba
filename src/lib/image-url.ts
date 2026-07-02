/**
 * Product image URL builder (F3) — custom proxy, NEVER the Vercel optimizer
 * (deep-dive resolution: free at catalog scale, no infra, srcset-compatible).
 * wsrv.nl resizes + re-encodes to WebP on the fly with global CDN caching;
 * Amazon/AliExpress originals weigh 100-800KB — at 300px/q60 a grid card is
 * ~8-15KB. Two variants only (grid 300w / pdp 800w), saver mode drops
 * quality further. Cuba-first: every byte is metered.
 *
 * Relative/local URLs pass through untouched (dev fixtures, placeholders).
 */

const PROXY = "https://wsrv.nl/";

export type ImageVariant = "grid" | "pdp";

const VARIANTS: Record<ImageVariant, { width: number; q: number; qSaver: number }> = {
  grid: { width: 300, q: 60, qSaver: 45 },
  pdp: { width: 800, q: 70, qSaver: 55 },
};

export function productImageUrl(
  raw: string | null | undefined,
  variant: ImageVariant,
  opts: { saver?: boolean } = {},
): string | null {
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return raw; // relativa/local: sin proxy
  const v = VARIANTS[variant];
  const q = opts.saver ? v.qSaver : v.q;
  return `${PROXY}?url=${encodeURIComponent(raw)}&w=${v.width}&q=${q}&output=webp`;
}

/**
 * Data-saver: default ON (en Cuba la conexión buena es el caso raro; el
 * default protege el caso común). El usuario puede apagarlo con la cookie
 * data_saver=off; el header Save-Data del navegador actúa de piso (si el
 * navegador lo pide, ahorro aunque la cookie diga off).
 */
export function isDataSaver(cookieValue: string | undefined, saveDataHeader: boolean): boolean {
  if (saveDataHeader) return true;
  return cookieValue !== "off";
}
