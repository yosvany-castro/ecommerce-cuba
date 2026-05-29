/**
 * AUDIT EXPLORATION — shared catalog + driver helpers (NOT a test).
 *
 * Manual, behavioural exploration of the personalization/search system:
 * seed a realistic Spanish catalogue ONCE into test_schema, then drive personas
 * through the real entry points (insertEvent → generateFeed / hybridSearch) and
 * print what a user would actually see, so we can judge adaptation by eye.
 *
 * Run helpers via the persona scripts in this dir. Cleaned up at end of audit.
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { randomUUID } from "node:crypto";
import { getPgClient } from "@/lib/db/pg";
import { embed } from "@/lib/embeddings/voyage";

export type Gender = "femenino" | "masculino" | null;
export interface Item {
  title: string;
  description: string;
  price_cents: number;
  category: string;
  brand: string;
  gender: Gender;
  age: { min: number; max: number };
  tag: string; // cluster label for our own analysis
}

// age bands: bebe 0-3, nino 4-11, joven 12-25, adulto 26-59, mayor 60-130
const ADULT = { min: 26, max: 59 };
const JOVEN = { min: 12, max: 25 };
const NINO = { min: 4, max: 11 };

export const CATALOG: Item[] = [
  // ── Women luxury / formal (femenino, adulto) ─────────────────────────────
  ig("Vestido de noche largo elegante negro", "Vestido formal de gala en seda negra, corte sirena, para eventos elegantes y cenas de noche.", 8900, "moda_mujer", "Zara", "femenino", ADULT, "women_luxury"),
  ig("Tacones altos de cuero negro", "Zapatos de tacón alto de cuero genuino, estilizados, ideales para oficina y eventos formales.", 6500, "moda_mujer", "Guess", "femenino", ADULT, "women_luxury"),
  ig("Cartera de mano de cuero genuino", "Bolso de mano de cuero italiano, elegante y compacto, para ocasiones especiales.", 12000, "moda_mujer", "Michael Kors", "femenino", ADULT, "women_luxury"),
  ig("Blazer entallado formal para oficina", "Saco entallado de vestir para mujer, corte profesional, tela premium para el trabajo.", 7200, "moda_mujer", "Mango", "femenino", ADULT, "women_luxury"),
  ig("Collar de perlas elegante", "Gargantilla de perlas cultivadas con broche de plata, accesorio sofisticado de gala.", 4300, "joyeria", "Pandora", "femenino", ADULT, "women_luxury"),
  ig("Reloj de pulsera dorado para dama", "Reloj analógico dorado para mujer, correa de acero, diseño minimalista y elegante.", 9900, "joyeria", "Casio", "femenino", ADULT, "women_luxury"),
  ig("Gafas de sol de diseñador", "Lentes de sol estilo cat-eye con protección UV, montura de pasta, look de diseñador.", 5500, "accesorios", "Ray-Ban", "femenino", ADULT, "women_luxury"),
  ig("Pañuelo de seda estampado", "Foulard de seda pura con estampado floral, accesorio versátil y elegante.", 3800, "accesorios", "Hermes", "femenino", ADULT, "women_luxury"),
  ig("Vestido coctel midi rojo", "Vestido de coctel midi en rojo intenso, ajustado, para fiestas y celebraciones.", 6900, "moda_mujer", "Mango", "femenino", ADULT, "women_luxury"),
  ig("Pulsera de oro fino", "Brazalete de oro 18k delgado, joya fina para regalo o uso diario elegante.", 15000, "joyeria", "Pandora", "femenino", ADULT, "women_luxury"),
  ig("Perfume floral femenino 100ml", "Eau de parfum floral con notas de jazmín y rosa, fragancia femenina duradera.", 7800, "belleza", "Dior", "femenino", ADULT, "women_luxury"),
  ig("Abrigo largo de lana camel", "Abrigo de lana color camel, corte recto largo, abrigado y elegante para invierno.", 11000, "moda_mujer", "Zara", "femenino", ADULT, "women_luxury"),

  // ── Men tech / electronics (masculino, adulto) ───────────────────────────
  ig("iPhone 15 Pro 256GB titanio", "Smartphone Apple iPhone 15 Pro, 256GB, chip A17 Pro, cámara triple, titanio natural.", 99900, "tecnologia", "Apple", "masculino", ADULT, "men_tech"),
  ig("Funda protectora para iPhone 15 Pro", "Carcasa de silicona antishock compatible con iPhone 15 Pro, protección de cámara.", 1900, "accesorios_tech", "Spigen", "masculino", ADULT, "men_tech_xsell"),
  ig("Cargador rápido USB-C 30W", "Adaptador de carga rápida USB-C 30W, compatible con iPhone y Android, compacto.", 2200, "accesorios_tech", "Anker", "masculino", ADULT, "men_tech_xsell"),
  ig("Auriculares inalámbricos con cancelación de ruido", "Audífonos Bluetooth over-ear con cancelación activa de ruido, 30h de batería.", 24900, "tecnologia", "Sony", "masculino", ADULT, "men_tech"),
  ig("Smartwatch deportivo con GPS", "Reloj inteligente con GPS, monitor de ritmo cardíaco y notificaciones, resistente al agua.", 18900, "tecnologia", "Garmin", "masculino", ADULT, "men_tech"),
  ig("Laptop ultradelgada 14 pulgadas", "Portátil ligero de 14'' con 16GB RAM y SSD 512GB, para trabajo y productividad.", 79900, "tecnologia", "Lenovo", "masculino", ADULT, "men_tech"),
  ig("Mouse inalámbrico ergonómico", "Ratón inalámbrico ergonómico de precisión, silencioso, batería de larga duración.", 2900, "tecnologia", "Logitech", "masculino", ADULT, "men_tech"),
  ig("Teclado mecánico retroiluminado", "Teclado mecánico gaming con switches rojos y retroiluminación RGB.", 4900, "tecnologia", "Redragon", "masculino", JOVEN, "men_tech"),
  ig("Tablet 11 pulgadas 128GB", "Tableta Android de 11'' con 128GB, pantalla full HD, ideal para multimedia.", 32900, "tecnologia", "Samsung", "masculino", ADULT, "men_tech"),
  ig("Power bank 20000mAh", "Batería externa de 20000mAh con carga rápida y dos puertos USB.", 3500, "accesorios_tech", "Anker", "masculino", ADULT, "men_tech"),
  ig("Bocina Bluetooth portátil", "Altavoz Bluetooth resistente al agua, sonido 360°, 12h de reproducción.", 5900, "tecnologia", "JBL", "masculino", JOVEN, "men_tech"),
  ig("Consola de videojuegos portátil", "Consola portátil para juegos, pantalla HD, biblioteca amplia de títulos.", 39900, "tecnologia", "Nintendo", "masculino", JOVEN, "men_tech"),

  // ── Men sport / activewear (masculino, joven/adulto) ─────────────────────
  ig("Zapatillas de running Nike Air Zoom", "Tenis de correr Nike con amortiguación Air Zoom, ligeros y transpirables.", 13900, "deporte", "Nike", "masculino", JOVEN, "men_sport"),
  ig("Zapatillas Adidas Ultraboost", "Tenis Adidas Ultraboost con espuma Boost, máximo retorno de energía al correr.", 15900, "deporte", "Adidas", "masculino", JOVEN, "men_sport"),
  ig("Short deportivo dry-fit", "Pantaloneta deportiva de secado rápido, ligera, para correr y entrenar.", 2500, "deporte", "Nike", "masculino", JOVEN, "men_sport"),
  ig("Camiseta deportiva transpirable", "Playera deportiva de tejido transpirable, ajuste atlético, control de humedad.", 2200, "deporte", "Adidas", "masculino", JOVEN, "men_sport"),
  ig("Balón de fútbol profesional", "Balón de fútbol talla 5 cosido a máquina, apto para césped y cancha.", 3200, "deporte", "Adidas", "masculino", JOVEN, "men_sport"),
  ig("Botella térmica deportiva", "Termo de acero inoxidable 750ml, mantiene la temperatura 12h, para gimnasio.", 2800, "deporte", "Stanley", "masculino", ADULT, "men_sport"),
  ig("Guantes de gimnasio acolchados", "Guantes de entrenamiento con soporte de muñeca, agarre antideslizante.", 1800, "deporte", "Under Armour", "masculino", ADULT, "men_sport"),
  ig("Mochila deportiva resistente", "Mochila deportiva 30L con compartimento para laptop y zapatos, impermeable.", 4200, "deporte", "Nike", "masculino", JOVEN, "men_sport"),
  ig("Sudadera con capucha gris", "Buzo con capucha de algodón, corte unisex deportivo, cómodo para entrenar.", 3900, "deporte", "Adidas", "masculino", JOVEN, "men_sport"),
  ig("Pesas ajustables 20kg", "Set de mancuernas ajustables hasta 20kg para entrenamiento en casa.", 8900, "deporte", "Domyos", "masculino", ADULT, "men_sport"),

  // ── Kids / toys (nino, mixed gender) ─────────────────────────────────────
  ig("Muñeca de juguete para niña", "Muñeca articulada con accesorios y vestidos, para niñas, juego imaginativo.", 2900, "juguetes", "Barbie", "femenino", NINO, "kids"),
  ig("Set de bloques de construcción", "Set de 500 bloques de construcción compatibles, estimula la creatividad infantil.", 3900, "juguetes", "Lego", "masculino", NINO, "kids"),
  ig("Carrito de control remoto", "Auto a control remoto todoterreno recargable, alta velocidad, para niños.", 4500, "juguetes", "Hot Wheels", "masculino", NINO, "kids"),
  ig("Vestido infantil de flores", "Vestido de niña con estampado de flores, algodón suave, para ocasiones especiales.", 2400, "moda_infantil", "Carters", "femenino", NINO, "kids"),
  ig("Rompecabezas educativo 100 piezas", "Puzzle infantil de 100 piezas con ilustraciones de animales, didáctico.", 1500, "juguetes", "Ravensburger", "femenino", NINO, "kids"),
  ig("Set de tren eléctrico", "Tren eléctrico de juguete con vías y vagones, luces y sonido, para niños.", 5900, "juguetes", "Lego", "masculino", NINO, "kids"),
  ig("Tenis con luces para niño", "Zapatillas infantiles con luces LED en la suela, cómodas, para niños.", 2600, "moda_infantil", "Skechers", "masculino", NINO, "kids"),
  ig("Peluche oso grande", "Oso de peluche grande de felpa suave, abrazable, regalo para niños.", 3300, "juguetes", "Gund", "femenino", NINO, "kids"),
];

function ig(
  title: string,
  description: string,
  price_cents: number,
  category: string,
  brand: string,
  gender: Gender,
  age: { min: number; max: number },
  tag: string,
): Item {
  return { title, description, price_cents, category, brand, gender, age, tag };
}

export async function openTestPg() {
  return getPgClient({ scope: "test" });
}

export async function catalogCount(pg: Awaited<ReturnType<typeof openTestPg>>): Promise<number> {
  const r = await pg.query(`SELECT count(*)::int AS c FROM products WHERE source = 'audit-explore'`);
  return Number(r.rows[0].c);
}

/** Seed the full catalogue with real Voyage embeddings, only if not present. */
export async function seedCatalogIfEmpty(pg: Awaited<ReturnType<typeof openTestPg>>): Promise<Map<string, { id: string; item: Item }>> {
  const existing = await pg.query(
    `SELECT id::text, title FROM products WHERE source = 'audit-explore'`,
  );
  const byTitle = new Map<string, { id: string; item: Item }>();
  const itemByTitle = new Map(CATALOG.map((i) => [i.title, i]));
  if (existing.rows.length >= CATALOG.length) {
    for (const row of existing.rows as { id: string; title: string }[]) {
      const item = itemByTitle.get(row.title);
      if (item) byTitle.set(row.title, { id: row.id, item });
    }
    return byTitle;
  }
  // Fresh seed: clear partial and re-embed all.
  await pg.query(`DELETE FROM products WHERE source = 'audit-explore'`);
  const texts = CATALOG.map((i) => `${i.title}\n${i.description}`);
  const vectors = await embed(texts, { inputType: "document" });
  for (let i = 0; i < CATALOG.length; i++) {
    const it = CATALOG[i];
    const meta = {
      category: it.category,
      brand: it.brand,
      gender_target: it.gender,
      age_target: it.age,
      tag: it.tag,
    };
    const r = await pg.query(
      `INSERT INTO products (source, source_product_id, title, description, price_cents, currency, image_url, raw_category, metadata, embedding)
       VALUES ('audit-explore', $1, $2, $3, $4, 'USD', null, $5, $6::jsonb, $7::vector)
       RETURNING id::text`,
      [randomUUID(), it.title, it.description, it.price_cents, it.category, JSON.stringify(meta), "[" + vectors[i].join(",") + "]"],
    );
    byTitle.set(it.title, { id: r.rows[0].id, item: it });
  }
  return byTitle;
}

/** Ambient popularity: other shoppers' events so popular-by-cohort is non-empty. */
export async function seedAmbientPopularity(
  pg: Awaited<ReturnType<typeof openTestPg>>,
  byTitle: Map<string, { id: string; item: Item }>,
): Promise<void> {
  await pg.query(`DELETE FROM events WHERE payload->>'ambient' = 'true'`);
  const pop: Array<[string, number]> = [
    // title, number of ambient "views" from random shoppers
    ["Vestido de noche largo elegante negro", 8],
    ["Cartera de mano de cuero genuino", 6],
    ["Tacones altos de cuero negro", 5],
    ["iPhone 15 Pro 256GB titanio", 9],
    ["Auriculares inalámbricos con cancelación de ruido", 7],
    ["Zapatillas de running Nike Air Zoom", 6],
    ["Zapatillas Adidas Ultraboost", 5],
    ["Muñeca de juguete para niña", 4],
    ["Set de bloques de construcción", 4],
  ];
  for (const [title, n] of pop) {
    const entry = byTitle.get(title);
    if (!entry) continue;
    for (let k = 0; k < n; k++) {
      await pg.query(
        `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1, $2, 'product_view', now() - ($3 || ' hours')::interval, $4::jsonb)`,
        [randomUUID(), randomUUID(), String(k + 1), JSON.stringify({ product_id: entry.id, source: "home", ambient: true })],
      );
    }
  }
}

export interface Persona {
  anonymous_id: string;
  session_id: string;
}
export function newPersona(): Persona {
  return { anonymous_id: randomUUID(), session_id: randomUUID() };
}

export async function ensureAnon(pg: Awaited<ReturnType<typeof openTestPg>>, anon: string) {
  await pg.query(`INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1) ON CONFLICT DO NOTHING`, [anon]);
}
