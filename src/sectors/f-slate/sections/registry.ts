import { z } from "zod";
import type { Client } from "pg";
import { fetchPopularGlobal } from "@/sectors/d-personalization/retrieve/popular-global";
import { fetchPopularByCohort } from "@/sectors/d-personalization/retrieve/popular-by-cohort";
import type { CohortId } from "@/sectors/d-personalization/cohorts/definitions";
import type { ResolveCtx, SectionResolver } from "./types";

/**
 * Static section registry (D3). Unknown section_type at runtime (old lambda,
 * new config) ⇒ the runner skips the placement with a warn — forward
 * compatible by construction. Resolvers OVER-FETCH (~×2) because the
 * compositor claims by priority and dedupes downstream.
 */

const limitSchema = (def: number, max: number) =>
  z.object({ limit: z.number().int().min(1).max(max).catch(def).default(def) }).loose();

// Categoría COMPLEMENTARIA (no la misma: para "más de lo mismo" está la
// sección similar). Fallback honesto mientras co_occurrence_top acumula
// tráfico real — con pocas sesiones la tabla NPMI está vacía y los rieles
// quedaban en blanco (bug reportado: "no aparece ninguna recomendación").
/** cross_sell: "combina con esto" — NPMI co-occurrence from the PDP anchor;
 * con NPMI escaso cae a populares de la categoría complementaria. */
const crossSell: SectionResolver<{ limit: number }> = {
  section_type: "cross_sell",
  paramsSchema: limitSchema(8, 20),
  async resolve(params, ctx: ResolveCtx, pg: Client) {
    const anchor = ctx.surfaceArgs?.pdp_product_id;
    if (!anchor) return [];
    const r = await pg.query(
      `SELECT related_product_id::text AS id
       FROM co_occurrence_top
       WHERE product_id = $1
       ORDER BY rank ASC
       LIMIT $2`,
      [anchor, params.limit * 2],
    );
    const ids = (r.rows as { id: string }[]).map((x) => x.id);
    // Sin fallback de categoría complementaria: inventaba relaciones absurdas
    // (cámaras espía junto a ollas arroceras) bajo un título que afirma compras
    // reales. Con NPMI escaso la sección se OCULTA (min_items) — honesto.
    return ids;
  },
};

/** cart_addons: co-occurrence over every cart anchor, cart items excluded;
 * con NPMI escaso cae a populares de las categorías complementarias del carrito. */
const cartAddons: SectionResolver<{ limit: number }> = {
  section_type: "cart_addons",
  paramsSchema: limitSchema(6, 20),
  async resolve(params, ctx: ResolveCtx, pg: Client) {
    const cartIds = ctx.surfaceArgs?.cart_product_ids ?? [];
    if (cartIds.length === 0) return [];
    const r = await pg.query(
      `SELECT related_product_id::text AS id
       FROM co_occurrence_top
       WHERE product_id = ANY($1::uuid[])
         AND NOT (related_product_id = ANY($1::uuid[]))
       GROUP BY related_product_id
       ORDER BY MIN(rank) ASC, SUM(npmi_score) DESC, related_product_id ASC
       LIMIT $2`,
      [cartIds, params.limit * 2],
    );
    const ids = (r.rows as { id: string }[]).map((x) => x.id);
    if (ids.length >= 3) return ids;
    // Cold-start (NPMI aún sin tráfico): populares de las MISMAS categorías
    // del carrito — relevante sin inventar relaciones absurdas (el fallback
    // viejo de categoría COMPLEMENTARIA ponía cámaras espía junto a ollas).
    // UNA query (subquery de categorías): respeta el budget single-roundtrip.
    const fb = await pg.query(
      `SELECT p.id::text AS id
       FROM products p
       LEFT JOIN product_popularity_7d pop ON pop.product_id = p.id
       WHERE p.is_active = true
         AND NOT (p.id = ANY($1::uuid[]))
         AND p.metadata->>'category' IN (
           SELECT DISTINCT metadata->>'category' FROM products WHERE id = ANY($1::uuid[])
         )
       ORDER BY COALESCE(pop.events_7d, 0) DESC, p.created_at DESC, p.id ASC
       LIMIT $2`,
      [cartIds, params.limit * 2 - ids.length],
    );
    return [...ids, ...(fb.rows as { id: string }[]).map((x) => x.id).filter((id) => !ids.includes(id))];
  },
};

/** similar: "relacionados con esto" — vecinos por embedding (pgvector HNSW).
 * Siempre tiene datos: todo producto ingestado lleva embedding Voyage. */
const similar: SectionResolver<{ limit: number }> = {
  section_type: "similar",
  paramsSchema: limitSchema(8, 20),
  async resolve(params, ctx: ResolveCtx, pg: Client) {
    const anchor = ctx.surfaceArgs?.pdp_product_id;
    if (!anchor) return [];
    // UNA query (subquery para el vector ancla): contra Supabase remoto, 2
    // roundtrips reventaban el budget_ms de 250 y la sección moría en timeout.
    // ponytail: el subquery fuerza seq scan (sin HNSW) — irrelevante con
    // cientos de productos; si el catálogo crece a decenas de miles, volver al
    // patrón vector-como-parámetro de retrieveTopKByVector con budget mayor.
    const r = await pg.query(
      `SELECT p.id::text AS id
       FROM products p, (SELECT embedding FROM products WHERE id = $1) a
       WHERE p.is_active = true AND p.id <> $1
         AND p.embedding IS NOT NULL AND a.embedding IS NOT NULL
       ORDER BY p.embedding <=> a.embedding ASC
       LIMIT $2`,
      [anchor, params.limit * 2],
    );
    return (r.rows as { id: string }[]).map((x) => x.id);
  },
};

/** upsell: "sube de nivel" — misma categoría, precio 1.2–2.5× el del anchor,
 * mejor valorado primero. Sin candidatos en la banda → sección oculta (honesto). */
const upsell: SectionResolver<{ limit: number }> = {
  section_type: "upsell",
  paramsSchema: limitSchema(6, 20),
  async resolve(params, ctx: ResolveCtx, pg: Client) {
    const anchor = ctx.surfaceArgs?.pdp_product_id;
    const cat = ctx.rule_ctx.pdp_category;
    if (!anchor || !cat) return [];
    const r = await pg.query(
      `SELECT p.id::text AS id
       FROM products p, (SELECT price_cents FROM products WHERE id = $1) a
       WHERE p.is_active = true AND p.id <> $1
         AND p.metadata->>'category' = $2
         AND p.price_cents BETWEEN (a.price_cents * 1.2)::int AND (a.price_cents * 2.5)::int
       ORDER BY COALESCE((p.metadata->'attrs'->>'rating')::numeric, 0) DESC, p.price_cents ASC, p.id ASC
       LIMIT $3`,
      [anchor, cat, params.limit * 2],
    );
    return (r.rows as { id: string }[]).map((x) => x.id);
  },
};

/** intent_complements: EL VENDEDOR — complementos de la intención inferida de
 * la sesión (session_intents, computada fire-and-forget en product_view).
 * Lectura pura y rápida (1 query); sin intención fresca → oculto (min_items). */
const intentComplements: SectionResolver<{ limit: number }> = {
  section_type: "intent_complements",
  paramsSchema: limitSchema(8, 20),
  async resolve(params, ctx: ResolveCtx, pg: Client) {
    const sid = ctx.identity.session_id;
    if (!sid) return [];
    const r = await pg.query(
      `SELECT product_ids FROM session_intents
       WHERE session_id = $1 AND computed_at > now() - interval '2 hours'`,
      [sid],
    );
    const ids = (r.rows[0]?.product_ids ?? []) as string[];
    return ids.slice(0, params.limit * 2);
  },
};

/** popular: 7d popularity — global, cohort-targeted, or PDP-category. */
const popular: SectionResolver<{ limit: number; mode: "global" | "cohort" | "pdp_category" }> = {
  section_type: "popular",
  paramsSchema: z
    .object({
      limit: z.number().int().min(1).max(30).catch(10).default(10),
      mode: z.enum(["global", "cohort", "pdp_category"]).catch("global").default("global"),
    })
    .loose(),
  async resolve(params, ctx: ResolveCtx, pg: Client) {
    // "Lo más buscado en {categoría}" bajo el PDP: relacionados POR CATEGORÍA
    // ordenados por popularidad — activable con una fila en ui_placements.
    if (params.mode === "pdp_category" && ctx.rule_ctx.pdp_category) {
      const r = await pg.query(
        `SELECT p.id::text AS id
         FROM products p
         LEFT JOIN product_popularity_7d pop ON pop.product_id = p.id
         WHERE p.is_active = true
           AND p.metadata->>'category' = $1
           AND p.id <> COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         ORDER BY COALESCE(pop.events_7d, 0) DESC, p.created_at DESC, p.id ASC
         LIMIT $3`,
        [ctx.rule_ctx.pdp_category, ctx.surfaceArgs?.pdp_product_id ?? null, params.limit * 2],
      );
      return (r.rows as { id: string }[]).map((x) => x.id);
    }
    if (params.mode === "cohort" && ctx.rule_ctx.session_cohort) {
      const items = await fetchPopularByCohort(
        ctx.rule_ctx.session_cohort as CohortId,
        [],
        params.limit * 2,
        pg,
      );
      if (items.length > 0) return items.map((x) => x.id);
    }
    const items = await fetchPopularGlobal([], params.limit * 2, pg);
    return items.map((x) => x.id);
  },
};

export const SECTION_REGISTRY: Record<string, SectionResolver<never>> = {
  cross_sell: crossSell as SectionResolver<never>,
  cart_addons: cartAddons as SectionResolver<never>,
  popular: popular as SectionResolver<never>,
  similar: similar as SectionResolver<never>,
  upsell: upsell as SectionResolver<never>,
  intent_complements: intentComplements as SectionResolver<never>,
  // hero_grid: caso especial del runner (slate feed completo, ya hidratado).
};
