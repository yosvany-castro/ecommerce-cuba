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

/** cross_sell: "combina con esto" — NPMI co-occurrence from the PDP anchor. */
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
    return (r.rows as { id: string }[]).map((x) => x.id);
  },
};

/** cart_addons: co-occurrence over every cart anchor, cart items excluded. */
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
    return (r.rows as { id: string }[]).map((x) => x.id);
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
  // hero_grid: caso especial del runner (slate feed completo, ya hidratado).
};
