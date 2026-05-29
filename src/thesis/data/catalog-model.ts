/**
 * Pure synthetic catalog sampler for the thesis evaluation framework.
 *
 * `sampleCatalog(n, seed)` generates `n` `SynthProduct` entries driven entirely
 * by a seeded RNG — same (n, seed) always yields bit-for-bit identical output.
 * This determinism is a hard requirement for a defensible empirical study.
 *
 * IMPORTANT: `factor_vector` is the GROUND-TRUTH latent representation built
 * from taxonomy axes (subcategory, gender, age, price). It is used by the
 * behavior model to plant taste clusters and complement graphs. Embedding
 * models must recover this structure from text/behaviour alone and must NEVER
 * be given access to these vectors during training or ranking.
 */

import { makeRng } from "./rng";
import {
  allLeafCategories,
  factorVectorFor,
  PRICE_BANDS,
  type ProductAttrs,
} from "../taxonomy";

// ─── Lexical pools for templated Spanish titles / descriptions ────────────────

/** Adjectives for the beginning of a product title, grouped by gender+register. */
const ADJECTIVES = [
  "Elegante", "Moderno", "Clásico", "Versátil", "Exclusivo",
  "Premium", "Esencial", "Sofisticado", "Cómodo", "Resistente",
  "Ligero", "Robusto", "Práctico", "Estiloso", "Refinado",
  "Potente", "Compacto", "Duradero", "Innovador", "Auténtico",
] as const;

/** Qualifiers / context phrases that follow the core noun. */
const QUALIFIERS = [
  "de alta calidad", "con acabado premium", "edición especial",
  "de diseño contemporáneo", "con certificación de calidad",
  "de colección limitada", "con garantía extendida",
  "para uso profesional", "de última generación", "con tecnología avanzada",
  "hecho a mano", "de importación", "con materiales seleccionados",
  "estilo europeo", "con empaque de regalo",
] as const;

/** Generic opening phrases for descriptions. */
const DESC_OPENERS = [
  "Descubre la combinación perfecta de estilo y funcionalidad con",
  "Eleva tu experiencia cotidiana gracias a",
  "Diseñado para quienes exigen lo mejor,",
  "Una opción ideal para el día a día:",
  "Calidad superior al alcance de tu mano con",
  "Transforma tu rutina con",
  "El complemento perfecto para tu estilo de vida activo:",
  "Fabricado con estándares de exportación,",
] as const;

/** Closing sentences for descriptions. */
const DESC_CLOSERS = [
  "Disponible en Cuba con envío rápido.",
  "Importado directamente para garantizar calidad.",
  "La elección inteligente para el consumidor cubano.",
  "Envío seguro y garantía de satisfacción.",
  "Ideal para regalo o uso personal.",
  "Perfecta relación precio-calidad.",
  "Producto verificado y sellado de origen.",
  "Compra segura con atención personalizada.",
] as const;

// ─── Public interface ─────────────────────────────────────────────────────────

export interface SynthProduct {
  /** Unique per catalog; encodes seed+position so ids never collide between runs. */
  source_product_id: string;
  /** Spanish templated title, length > 5. */
  title: string;
  /** Spanish descriptive sentence. */
  description: string;
  /** `${title}\n${description}` — the text seen by BM25 and dense models. */
  canonicalText: string;
  /** Price in cents, sampled within the chosen PRICE_BANDS entry (> 0). */
  price_cents: number;
  /** Taxonomy attributes used to build the factor vector. */
  attrs: ProductAttrs;
  /**
   * Ground-truth latent vector (one-hot over taxonomy dims). Length equals
   * `factorDim()`. NEVER expose to any ranking model.
   */
  factor_vector: number[];
}

// ─── Sampler ─────────────────────────────────────────────────────────────────

const LEAVES = allLeafCategories(); // computed once, stable

/**
 * Generate `n` synthetic products deterministically from `seed`.
 * All randomness is drawn from `makeRng(seed)`; no external state is touched.
 */
export function sampleCatalog(n: number, seed: number): SynthProduct[] {
  const rng = makeRng(seed);
  const products: SynthProduct[] = [];

  for (let i = 0; i < n; i++) {
    // 1. Pick taxonomy leaf
    const leaf = rng.pick(LEAVES);
    const brand = rng.pick(leaf.brands);
    const style = rng.pick(leaf.styles);
    const priceBand = rng.pick(leaf.priceBands);

    // 2. Build ProductAttrs
    const attrs: ProductAttrs = {
      category: leaf.category,
      subcategory: leaf.subcategory,
      brand,
      gender: leaf.gender,
      ageBand: leaf.ageBand,
      priceBand,
      style,
    };

    // 3. Sample price within the band (inclusive min, exclusive max in cents)
    // Invariant: every PRICE_BANDS entry has max > min, so price_cents >= min > 0.
    const band = PRICE_BANDS[priceBand];
    const priceRange = band.max - band.min;
    const price_cents = band.min + rng.int(priceRange);

    // 4. Build Spanish title: "<Adjective> <brand> <display_subcategory> <qualifier>"
    const adjective = rng.pick(ADJECTIVES);
    const qualifier = rng.pick(QUALIFIERS);
    const displaySub = leaf.subcategory.replace(/_/g, " ");
    const title = `${adjective} ${brand} ${displaySub} ${qualifier}`;

    // 5. Build Spanish description
    const opener = rng.pick(DESC_OPENERS);
    const closer = rng.pick(DESC_CLOSERS);
    const description = `${opener} este ${displaySub} ${brand} estilo ${style}. ${closer}`;

    // 6. Assemble product
    products.push({
      // ids are unique within a catalog; encoding `n` prevents collisions when regenerating different sizes under the same seed.
      source_product_id: `syn-${seed}-${n}-${i}`,
      title,
      description,
      canonicalText: `${title}\n${description}`,
      price_cents,
      attrs,
      factor_vector: factorVectorFor(attrs),
    });
  }

  return products;
}
