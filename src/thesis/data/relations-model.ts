/**
 * Ground-truth commercial relation graph for the thesis evaluation framework.
 *
 * WHY THIS EXISTS — COMMERCIAL VS LINGUISTIC RATIONALE:
 * The thesis's central empirical claim is that complement relations (e.g.
 * smartphone→funda, smartphone→cargador) are COMMERCIALLY grounded but NOT
 * linguistically grounded: a "funda" and a "smartphone" share no vocabulary,
 * no adjectives, and no TF-IDF signal. A text-cosine model will score them
 * near zero; only co-occurrence or latent-factor models can recover the link.
 * This module encodes that ground truth declaratively so every evaluation
 * metric (Precision@k, Recall@k, NDCG) has a shared, immutable reference.
 *
 * SUBSTITUTES: two products are substitutes when they occupy the SAME semantic
 * slot (same subcategory) but belong to DIFFERENT brands. A buyer choosing
 * between Samsung and Apple smartphones is making a substitute decision, not a
 * complement one. Text cosine WILL score substitutes highly (shared vocabulary)
 * so the complement/substitute distinction is the clean axis the thesis
 * exploits.
 *
 * DETERMINISM: this module is PURE. Given the same catalog array it always
 * returns the same relation list in the same order — sort-before-slice
 * everywhere guarantees this regardless of JS engine enumeration order.
 */

import type { SynthProduct } from "./catalog-model";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RelationType = "complement" | "substitute" | "upgrade" | "accessory";

export interface GtRelation {
  product_a_id: string;
  product_b_id: string;
  relation_type: RelationType;
  /** Normalized relevance weight. Complements = 1.0, substitutes = 0.8. */
  strength: number;
}

// ─── Commercial complement map ────────────────────────────────────────────────

/**
 * Declarative encoding of commercial complement relations.
 * Key = subcategory of the source product.
 * Value = subcategories that commonly complete a purchase decision.
 *
 * This is the GROUND TRUTH for thesis evaluation. It was built from
 * domain knowledge about Cuban e-commerce purchase bundles, NOT from
 * any textual similarity signal.
 */
const COMPLEMENTS: Record<string, string[]> = {
  smartphone:        ["funda", "cargador", "powerbank", "audifonos"],
  laptop:            ["mouse", "teclado", "powerbank"],
  tablet:            ["funda", "cargador"],
  vestido:           ["tacones", "cartera", "collar"],
  blazer:            ["tacones", "cartera"],
  tacones:           ["cartera", "vestido"],
  zapatillas_running: ["short", "camiseta_dep", "mochila_dep"],
  pesas:             ["camiseta_dep", "mochila_dep"],
  muneca:            ["vestido_nina"],
  bloques:           ["rompecabezas"],
};

// ─── Named constant for the per-relation candidate cap ────────────────────────

/** Maximum number of complement/substitute links emitted per (product, type) pair. */
const MAX_LINKS_PER_PAIR = 3;

// ─── Core builder ─────────────────────────────────────────────────────────────

/**
 * Build the complete ground-truth relation graph for a given catalog.
 *
 * Algorithm:
 *  1. Index products by subcategory for O(1) candidate lookup.
 *  2. For each product, emit complement links to up to MAX_LINKS_PER_PAIR
 *     representatives of each complementary subcategory (sorted by id for
 *     determinism, sliced before looping).
 *  3. For each product, emit substitute links to up to MAX_LINKS_PER_PAIR
 *     products in the SAME subcategory with a DIFFERENT brand (again sorted).
 *  4. Deduplicate on (product_a_id, product_b_id, relation_type) using a Set.
 *  5. Never emit self-relations (product_a_id === product_b_id).
 *
 * @param catalog - Output of sampleCatalog(); must be a stable reference.
 * @returns Immutable array of GtRelation; order is deterministic.
 */
export function buildRelations(catalog: SynthProduct[]): GtRelation[] {
  // Build subcategory → sorted product list index
  const bySubcategory = new Map<string, SynthProduct[]>();
  for (const p of catalog) {
    const key = p.attrs.subcategory;
    if (!bySubcategory.has(key)) bySubcategory.set(key, []);
    bySubcategory.get(key)!.push(p);
  }
  // Sort each bucket by source_product_id for determinism
  for (const bucket of bySubcategory.values()) {
    bucket.sort((a, b) => a.source_product_id.localeCompare(b.source_product_id));
  }

  const seen = new Set<string>();
  const relations: GtRelation[] = [];

  function addRelation(
    a_id: string,
    b_id: string,
    relation_type: RelationType,
    strength: number,
  ): void {
    if (a_id === b_id) return; // no self-relations
    const key = `${a_id}|${b_id}|${relation_type}`;
    if (seen.has(key)) return;
    seen.add(key);
    relations.push({ product_a_id: a_id, product_b_id: b_id, relation_type, strength });
  }

  // Sort catalog by source_product_id so outer iteration is deterministic
  const sorted = [...catalog].sort((a, b) =>
    a.source_product_id.localeCompare(b.source_product_id),
  );

  for (const p of sorted) {
    const sub = p.attrs.subcategory;

    // ── 1. Complements ────────────────────────────────────────────────────────
    const compTargets = COMPLEMENTS[sub];
    if (compTargets) {
      for (const targetSub of compTargets) {
        const candidates = bySubcategory.get(targetSub);
        if (!candidates) continue; // subcategory not in this catalog sample
        // candidates already sorted; just slice
        const picked = candidates.slice(0, MAX_LINKS_PER_PAIR);
        for (const candidate of picked) {
          addRelation(p.source_product_id, candidate.source_product_id, "complement", 1.0);
        }
      }
    }

    // ── 2. Substitutes ────────────────────────────────────────────────────────
    const sameSub = bySubcategory.get(sub);
    if (sameSub) {
      const diffBrand = sameSub
        .filter((q) => q.attrs.brand !== p.attrs.brand && q.source_product_id !== p.source_product_id)
        .slice(0, MAX_LINKS_PER_PAIR);
      for (const candidate of diffBrand) {
        addRelation(p.source_product_id, candidate.source_product_id, "substitute", 0.8);
      }
    }
  }

  return relations;
}
