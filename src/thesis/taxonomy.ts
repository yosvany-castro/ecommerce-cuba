/**
 * Declarative product taxonomy for the synthetic marketplace. Pure data + pure
 * helpers.
 *
 * The factor vector is the GROUND-TRUTH latent representation of a product
 * (one-hot over taxonomy dimensions). The behavior model plants taste clusters
 * and the complement graph in this space; embedding models must recover that
 * structure from text/behaviour alone, never seeing the factors. This is what
 * lets the eval attribute lift to a model rather than to leaked labels.
 */
export type Gender = "femenino" | "masculino" | "unisex";
export type AgeBand = "bebe" | "nino" | "joven" | "adulto" | "mayor";

export interface Category {
  category: string;
  subcategories: string[];
  brands: string[];
  gender: Gender;
  ageBand: AgeBand;
  styles: string[];
  /** Indices into PRICE_BANDS that this category typically spans. */
  priceBands: number[];
}

export const PRICE_BANDS: { min: number; max: number }[] = [
  { min: 500, max: 2000 }, // 0 budget
  { min: 2000, max: 6000 }, // 1 mid
  { min: 6000, max: 20000 }, // 2 premium
  { min: 20000, max: 120000 }, // 3 high
];

export const TAXONOMY: Category[] = [
  { category: "moda_mujer", subcategories: ["vestido", "blazer", "tacones", "abrigo", "cartera"], brands: ["Zara", "Mango", "Guess", "Michael Kors"], gender: "femenino", ageBand: "adulto", styles: ["formal", "casual", "noche"], priceBands: [1, 2, 3] },
  { category: "joyeria", subcategories: ["collar", "reloj_dama", "pulsera", "aretes"], brands: ["Pandora", "Casio", "Swarovski"], gender: "femenino", ageBand: "adulto", styles: ["clasico", "moderno"], priceBands: [1, 2, 3] },
  { category: "belleza", subcategories: ["perfume", "labial", "crema"], brands: ["Dior", "Loreal", "Maybelline"], gender: "femenino", ageBand: "adulto", styles: ["floral", "amaderado"], priceBands: [1, 2] },
  { category: "tecnologia", subcategories: ["smartphone", "laptop", "tablet", "audifonos", "smartwatch", "consola"], brands: ["Apple", "Samsung", "Sony", "Lenovo"], gender: "masculino", ageBand: "adulto", styles: ["gama_alta", "gama_media"], priceBands: [2, 3] },
  { category: "accesorios_tech", subcategories: ["funda", "cargador", "powerbank", "mouse", "teclado"], brands: ["Anker", "Spigen", "Logitech"], gender: "masculino", ageBand: "adulto", styles: ["practico"], priceBands: [0, 1] },
  { category: "deporte", subcategories: ["zapatillas_running", "short", "camiseta_dep", "balon", "mochila_dep", "pesas"], brands: ["Nike", "Adidas", "Under Armour"], gender: "masculino", ageBand: "joven", styles: ["running", "gym", "futbol"], priceBands: [0, 1, 2] },
  { category: "juguetes", subcategories: ["muneca", "bloques", "rompecabezas", "peluche", "carrito_rc"], brands: ["Lego", "Barbie", "Hot Wheels"], gender: "unisex", ageBand: "nino", styles: ["educativo", "diversion"], priceBands: [0, 1] },
  { category: "moda_infantil", subcategories: ["vestido_nina", "tenis_nino", "conjunto"], brands: ["Carters", "Skechers"], gender: "unisex", ageBand: "nino", styles: ["casual"], priceBands: [0, 1] },
];

export interface LeafCategory {
  category: string;
  subcategory: string;
  brands: string[];
  gender: Gender;
  ageBand: AgeBand;
  styles: string[];
  priceBands: number[];
}

/** Flatten the taxonomy into (category, subcategory) leaves carrying the parent's attributes. */
export function allLeafCategories(): LeafCategory[] {
  const out: LeafCategory[] = [];
  for (const c of TAXONOMY) {
    for (const sub of c.subcategories) {
      out.push({ category: c.category, subcategory: sub, brands: c.brands, gender: c.gender, ageBand: c.ageBand, styles: c.styles, priceBands: c.priceBands });
    }
  }
  return out;
}

const SUBCATS = allLeafCategories().map((l) => `${l.category}/${l.subcategory}`);
const GENDERS: Gender[] = ["femenino", "masculino", "unisex"];
const AGE_BANDS: AgeBand[] = ["bebe", "nino", "joven", "adulto", "mayor"];

/** Factor vector layout: [subcategory one-hot | gender one-hot | age one-hot | price scalar]. */
export function factorDim(): number {
  return SUBCATS.length + GENDERS.length + AGE_BANDS.length + 1;
}

export interface ProductAttrs {
  category: string;
  subcategory: string;
  brand: string;
  gender: Gender;
  ageBand: AgeBand;
  priceBand: number;
  style: string;
}

export function factorVectorFor(a: ProductAttrs): number[] {
  const v = new Array<number>(factorDim()).fill(0);
  const subIdx = SUBCATS.indexOf(`${a.category}/${a.subcategory}`);
  if (subIdx >= 0) v[subIdx] = 1;
  const gIdx = GENDERS.indexOf(a.gender);
  if (gIdx >= 0) v[SUBCATS.length + gIdx] = 1;
  const aIdx = AGE_BANDS.indexOf(a.ageBand);
  if (aIdx >= 0) v[SUBCATS.length + GENDERS.length + aIdx] = 1;
  v[v.length - 1] = a.priceBand / (PRICE_BANDS.length - 1);
  return v;
}
