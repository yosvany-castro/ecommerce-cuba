// src/lib/weight.ts — peso de productos: parser de unidades + heurística PURA.
// Sin imports de server/sectors: se comparte entre cliente (carrito/PDP) y
// server (ingesta, endpoint de peso) para que el peso MOSTRADO sea siempre el
// mismo número que el que factura el checkout (regla: cobro = lo mostrado).
// Cascada real de fuentes: products.weight_grams (measured|provider|llm) manda;
// esto es solo el último eslabón cuando no hay dato persistido.

export const GRAMS_PER_LB = 453.592;

const UNIT_TO_GRAMS: [RegExp, number][] = [
  [/^(?:kg|kgs|kilo|kilos|kilogram(?:s|os)?)$/i, 1000],
  [/^(?:g|gr|gram(?:s)?|gramos?)$/i, 1],
  [/^(?:lb|lbs|pound(?:s)?|libras?)$/i, GRAMS_PER_LB],
  [/^(?:oz|ounce(?:s)?|onzas?)$/i, 28.3495],
];

/** "1.76 ounces" / "0.5 Pounds" / "76,4 g" → gramos. Unidad rara → null (honesto). */
export function parseWeightToGrams(text: string): number | null {
  const m = text.trim().match(/^([\d.,]+)\s*([a-záé]+)$/i);
  if (!m) return null;
  const value = parseFloat(m[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  const factor = UNIT_TO_GRAMS.find(([re]) => re.test(m[2]))?.[1];
  if (factor === undefined) return null;
  const grams = Math.round(value * factor);
  return grams >= 1 && grams <= 100_000 ? grams : null;
}

// Peso explícito escrito dentro de título/descripción ("Mancuerna 5 kg",
// "500g coffee"). Guard anti falsos positivos: para gramos exige valor ≥ 10
// ("2.4G"/"5G" de WiFi/red quedan fuera) y nunca matchea seguido de letra
// (GB, GHz). Devuelve el PRIMER match razonable.
const INLINE_WEIGHT = /(\d+(?:[.,]\d+)?)\s*(kg|kgs|kilos?|kilogramos?|lbs?|pounds?|libras?|oz|ounces?|onzas?|g|gr|gramos?)(?![a-z])/i;

export function extractInlineWeightGrams(text: string): number | null {
  const m = text.match(INLINE_WEIGHT);
  if (!m) return null;
  // "2.4G" / "5 g" de specs de red: valores chicos en gramos son casi siempre
  // falsos positivos en títulos — se descartan, la heurística de abajo cubre.
  if (/^(g|gr|gramos?)$/i.test(m[2]) && parseFloat(m[1].replace(",", ".")) < 10) return null;
  return parseWeightToGrams(`${m[1]} ${m[2]}`);
}

// Heurística semilla por palabra clave (es/en, primer match gana) — pesos de
// PAQUETE típicos, no del objeto desnudo. ponytail: tabla naive a propósito;
// el techo lo levanta el refinado LLM en background (weight-estimate.ts), que
// persiste en products.weight_grams y deja de caer aquí.
const KEYWORD_GRAMS: [RegExp, number][] = [
  [/ventilador (?:de )?(?:pie|torre)|tower fan|pedestal fan/i, 4500],
  [/ventilador|\bfan\b|abanico/i, 2000],
  // bolsos ANTES que laptop: "Backpack with Laptop Sleeve" es una mochila
  [/bolso|mochila|backpack|cartera|bag\b/i, 650],
  [/laptop|notebook|macbook/i, 2800],
  [/\btv\b|televisor|television|monitor/i, 5000],
  [/celular|smartphone|iphone|galaxy s|xiaomi|tel[eé]fono/i, 550],
  [/tablet|ipad/i, 900],
  // \b en tokens cortos: "olla" matcheaba dentro de "Collar" (visto en eval —
  // un vestido estimado a 3.5 kg), "bota" dentro de "botanical", etc.
  [/licuadora|blender|freidora|air ?fryer|arrocera|rice cooker|cafetera|\bolla\b|microondas|microwave/i, 3500],
  [/zapat|sneaker|shoe|tenis\b|\bbota|sandalia/i, 1000],
  [/jean|pantal[oó]n|pants|trousers/i, 550],
  [/vestido|dress|falda|skirt/i, 350],
  [/abrigo|chaqueta|jacket|hoodie|sudadera|\bcoat\b/i, 700],
  [/camiseta|t-?shirt|blusa|pullover|\btop\b|camisa/i, 250],
  [/aud[ií]fono|auricular|headphone|earbud|airpod/i, 300],
  [/reloj|watch/i, 300],
  [/power ?bank|bater[ií]a externa|cargador|charger/i, 400],
  [/mu[ñn]ec|juguete|\btoy\b|lego|peluche/i, 500],
  [/perfume|colonia|crema|maquillaje|labial|serum|shampoo|champ[uú]/i, 300],
  [/s[aá]bana|cortina|toalla|\bmanta\b|edred[oó]n|colcha/i, 1300],
  [/herramienta|taladro|drill|destornillador/i, 1500],
];

// Base por categoría normalizada (metadata.category) cuando ninguna keyword
// matchea — mismas 6 categorías del catálogo.
const CATEGORY_BASE_GRAMS: Record<string, number> = {
  ropa: 350,
  electronica: 700,
  hogar: 1500,
  juguetes_bebe: 500,
  belleza: 250,
  otros: 700,
};

const MINI_RE = /\bmini\b|port[aá]til|portable|de mano|handheld|de bolsillo|pocket/i;

export interface WeightEstimate {
  grams: number;
  method: "inline" | "keyword" | "category";
}

/** Heurística pura y determinista: texto explícito → keyword → base por categoría.
 * El peso inline del texto es NETO → se le suma el empaque; keyword/categoría
 * ya son pesos de paquete típicos. */
export function estimateWeightGrams(input: { title: string; category?: string | null; description?: string | null }): WeightEstimate {
  const text = `${input.title} ${input.description ?? ""}`;
  const inline = extractInlineWeightGrams(text);
  if (inline !== null) return { grams: packagedGrams(inline, input.category), method: "inline" };

  const kw = KEYWORD_GRAMS.find(([re]) => re.test(input.title));
  if (kw) {
    const grams = MINI_RE.test(input.title) ? Math.round(kw[1] * 0.5) : kw[1];
    return { grams, method: "keyword" };
  }
  const base = CATEGORY_BASE_GRAMS[input.category ?? ""] ?? 700;
  return { grams: base, method: "category" };
}

/** Gramos → libras con 1 decimal (mínimo 0.1 lb) — unidad de facturación del envío. */
export function gramsToLb(grams: number): number {
  return Math.max(0.1, Math.round((grams / GRAMS_PER_LB) * 10) / 10);
}

// Los marketplaces publican peso NETO del artículo; el reenvío se factura por
// peso de PAQUETE. Pad de empaque por categoría (bolsa/caja típica) + 8% de
// relleno/protección. ponytail: knobs de calibración — ajustar cuando Yosvany
// compare contra pesajes reales en báscula.
const PACKAGING_PAD_GRAMS: Record<string, number> = {
  ropa: 40,
  electronica: 150,
  hogar: 200,
  juguetes_bebe: 100,
  belleza: 60,
  otros: 100,
};

/** Peso neto del proveedor → peso de paquete estimado (lo que se factura). */
export function packagedGrams(netGrams: number, category?: string | null): number {
  const pad = PACKAGING_PAD_GRAMS[category ?? ""] ?? 100;
  return Math.round(netGrams * 1.08 + pad);
}
