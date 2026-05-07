import {
  type MockProduct,
  type MockCategory,
  type MockProductSource,
  TARGET_DISTRIBUTION,
  FIXTURE_SIZE,
} from "./types";

export { TARGET_DISTRIBUTION, FIXTURE_SIZE };

const SOURCES: MockProductSource[] = ["amazon", "aliexpress", "shein"];

const TEMPLATES: Record<MockCategory, { titles: string[]; brands: string[]; priceRangeCents: [number, number] }> = {
  ropa: {
    titles: [
      "Camiseta de algodón {color} talla {size}",
      "Vestido de verano {color} con estampado floral",
      "Chaqueta vaquera {color} ajustada",
      "Pantalón cargo {color} talla {size}",
      "Sudadera con capucha {color} unisex",
    ],
    brands: ["Zara Mock", "H&M Mock", "Adidas Mock", "Nike Mock", "Mango Mock"],
    priceRangeCents: [800, 8000],
  },
  electronica: {
    titles: [
      "Auriculares inalámbricos Bluetooth {color}",
      "Cargador rápido USB-C {watts}W",
      "Smartwatch deportivo pantalla {size}\"",
      "Cámara web HD {res} para streaming",
      "Power bank {capacity}mAh portátil",
    ],
    brands: ["Sony Mock", "JBL Mock", "Anker Mock", "Xiaomi Mock", "Logitech Mock"],
    priceRangeCents: [1500, 25000],
  },
  hogar: {
    titles: [
      "Juego de sábanas 100% algodón {color}",
      "Olla antiadherente {size}cm con tapa",
      "Lámpara LED de mesa {color} regulable",
      "Set de toallas {color} (3 piezas)",
      "Organizador de cocina {color}",
    ],
    brands: ["IKEA Mock", "Tefal Mock", "Philips Mock", "Tramontina Mock", "Vileda Mock"],
    priceRangeCents: [1000, 12000],
  },
  juguetes_bebe: {
    titles: [
      "Peluche oso {color} {size}cm",
      "Set de bloques de construcción {pieces} piezas",
      "Muñeca articulada {color} con accesorios",
      "Coche de carreras radiocontrol {color}",
      "Cuento ilustrado {age} años (tapa dura)",
    ],
    brands: ["Lego Mock", "Mattel Mock", "Hasbro Mock", "Fisher-Price Mock", "Playmobil Mock"],
    priceRangeCents: [600, 6000],
  },
  belleza: {
    titles: [
      "Crema hidratante facial {ml}ml piel {tipo}",
      "Champú anticaspa {ml}ml",
      "Set de maquillaje paleta {colors} colores",
      "Perfume {gender} {ml}ml fragancia floral",
      "Aceite corporal {ml}ml",
    ],
    brands: ["L'Oréal Mock", "Maybelline Mock", "Nivea Mock", "Pantene Mock", "Dove Mock"],
    priceRangeCents: [400, 5000],
  },
  otros: {
    titles: [
      "Mochila escolar {color} {capacity}L",
      "Botella térmica acero inoxidable {ml}ml",
      "Libreta tapa dura {pages} hojas",
      "Esterilla yoga antideslizante {color}",
      "Cinturón de cuero {color} talla {size}",
    ],
    brands: ["Under Armour Mock", "Sigg Mock", "Moleskine Mock", "Decathlon Mock", "Levi's Mock"],
    priceRangeCents: [500, 7000],
  },
};

const COLORS = ["negro", "blanco", "rojo", "azul", "verde", "rosa", "gris", "marrón"];
const SIZES = ["S", "M", "L", "XL", "38", "40", "42", "44"];
const FILL_VARS: Record<string, string[]> = {
  color: COLORS,
  size: SIZES,
  watts: ["20", "30", "65", "100"],
  res: ["720p", "1080p", "2K", "4K"],
  capacity: ["10000", "20000", "30000"],
  pieces: ["50", "100", "250", "500"],
  age: ["3-5", "5-7", "7-10"],
  ml: ["100", "200", "400", "500"],
  tipo: ["seca", "mixta", "grasa", "sensible"],
  colors: ["12", "24", "48"],
  gender: ["mujer", "hombre"],
  pages: ["80", "160", "240"],
};

// Seeded mulberry32 PRNG: deterministic and reproducible.
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function fillTemplate(template: string, rng: () => number): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) => {
    const choices = FILL_VARS[key] ?? [key];
    return pick(rng, choices);
  });
}

function priceCents(rng: () => number, [lo, hi]: [number, number]): number {
  return Math.round(lo + rng() * (hi - lo));
}

function generateProduct(rng: () => number, cat: MockCategory, idx: number): MockProduct {
  const tmpl = TEMPLATES[cat];
  const title = fillTemplate(pick(rng, tmpl.titles), rng);
  const brand = pick(rng, tmpl.brands);
  const source = pick(rng, SOURCES);
  const description =
    `${title}. Marca ${brand}. Disponible en variantes seleccionadas. ` +
    `Material y acabado de calidad estándar para uso ${cat === "ropa" ? "diario" : "regular"}.`;
  const id = `${cat}-${String(idx).padStart(4, "0")}`;
  return {
    id,
    source,
    source_product_id: `${source}-${id}`,
    title,
    description,
    image_url: `https://placehold.co/400x400?text=${encodeURIComponent(title.slice(0, 20))}`,
    price_cents: priceCents(rng, tmpl.priceRangeCents),
    brand,
    raw_category: cat,
    attributes: { generated: true, seedIndex: idx, cat },
  };
}

let _cache: MockProduct[] | null = null;

export async function loadFixture(): Promise<MockProduct[]> {
  if (_cache) return _cache;
  const rng = mulberry32(20260506); // fixed seed: stable across machines
  const fixture: MockProduct[] = [];
  let idx = 0;
  for (const [cat, ratio] of Object.entries(TARGET_DISTRIBUTION) as [MockCategory, number][]) {
    const count = Math.round(ratio * FIXTURE_SIZE);
    for (let i = 0; i < count; i++) {
      fixture.push(generateProduct(rng, cat, idx++));
    }
  }
  // Adjust size: rounding can produce 499 or 501. Pad/trim to exactly 500 from "otros".
  while (fixture.length < FIXTURE_SIZE) fixture.push(generateProduct(rng, "otros", idx++));
  while (fixture.length > FIXTURE_SIZE) fixture.pop();
  _cache = fixture;
  return fixture;
}
