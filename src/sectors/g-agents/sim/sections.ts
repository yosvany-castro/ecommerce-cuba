import { rrfFuse } from "@/sectors/d-personalization/retrieve/rrf";
import {
  predictTopSubcategories,
  rankByViewedCategoriesQuota,
} from "@/sectors/d-personalization/ranking/views-categories";
import type { ArmArtifacts } from "./crons";

/**
 * Resolvers sim espejo 1:1 de producción (blueprint §5.6):
 * - popular(global)      ≡ fetchPopularGlobal: events época t-1 DESC, id ASC,
 *                          solo productos con popularidad > 0, over-fetch ×2.
 * - popular(cohort)      ≡ filtrado a session_cohort (= subcategoría modal del
 *                          log del brazo); si vacío cae a global (registry.ts:84-94).
 *                          Desviación: prod pondera log-weighted por demografía;
 *                          el sim usa el conteo plano de la misma ventana.
 * - popular(pdp_category) en home (pdp_category=null) ⇒ cae a GLOBAL — el
 *   registry real hace fallback, no salta la sección (gana el repo sobre el
 *   blueprint §5.6 que decía "vacío").
 * - cross_sell           ≡ NPMI top del last-viewed del log (desviación 2.C.1:
 *                          prod ancla en el PDP actual).
 * - cart_addons          ⇒ sin carrito en el sim ⇒ [] (cae por min_items,
 *                          igual que en prod sin cart_product_ids).
 * - hero_grid            ≡ rrf-sess-pop (campeón exp-K): rrfFuse de cabeza
 *                          subcat-quota (módulo de producción) + cabeza
 *                          pop-global, cola por popularidad.
 * Todos enmascarados a activeIds(t) por construcción (los rankings se derivan
 * de listas ya filtradas a activos — anti-trampa #13).
 */

export interface SimSectionCtx {
  userId: string;
  sessionCohort: string | null;
  artifacts: ArmArtifacts;
  /** Activos con popularidad>0, orden events DESC + id ASC (≡ fetchPopularGlobal). */
  popularRank: readonly string[];
  /** TODOS los activos ordenados por popularidad (cola del hero / candidatos). */
  activeByPop: readonly string[];
  activeIds: ReadonlySet<string>;
  lastViewed: string | null;
  /** Vistas DISTINTAS pasadas del usuario (orden de primera vista), épocas < t. */
  viewedSubs: readonly (string | null)[];
  subcategoryOf: (id: string) => string | null;
  popOf: (id: string) => number;
  /** Cache por usuario del ranking hero (depende solo del estado del usuario). */
  heroCache: Map<string, string[]>;
}

function heroRrfSessPop(ctx: SimSectionCtx): string[] {
  const cached = ctx.heroCache.get(ctx.userId);
  if (cached) return cached;
  const sessHead = rankByViewedCategoriesQuota({
    topSubcategories: predictTopSubcategories(ctx.viewedSubs, 4),
    candidates: ctx.activeByPop,
    subcategoryOf: ctx.subcategoryOf,
    popOf: ctx.popOf,
    headSize: 10,
  }).slice(0, 20);
  const popHead = ctx.activeByPop.slice(0, 20);
  const fused = rrfFuse([
    { source: "sess", items: sessHead.map((id, i) => ({ id, rank: i + 1 })) },
    { source: "pop", items: popHead.map((id, i) => ({ id, rank: i + 1 })) },
  ])
    .sort((a, b) => b.rrf_score - a.rrf_score || a.id.localeCompare(b.id))
    .map((x) => x.id);
  const inFused = new Set(fused);
  const tail = ctx.activeByPop.filter((id) => !inFused.has(id));
  const out = [...fused, ...tail];
  ctx.heroCache.set(ctx.userId, out);
  return out;
}

/** Devuelve candidatos en over-fetch ×2 (≡ resolvers de registry.ts); el
 *  claiming/limit/min_items los aplica el policy (≡ resolve.ts). */
export function resolveSimSection(
  sectionType: string,
  params: Record<string, unknown>,
  ctx: SimSectionCtx,
): string[] {
  switch (sectionType) {
    case "hero_grid":
      return heroRrfSessPop(ctx);

    case "popular": {
      const limit = typeof params.limit === "number" ? params.limit : 10;
      const mode = typeof params.mode === "string" ? params.mode : "global";
      if (mode === "cohort" && ctx.sessionCohort !== null) {
        const inCohort = ctx.popularRank.filter(
          (id) => ctx.subcategoryOf(id) === ctx.sessionCohort,
        );
        if (inCohort.length > 0) return inCohort.slice(0, limit * 2);
      }
      // mode global, cohort sin items, o pdp_category sin pdp ⇒ global (registry verbatim)
      return ctx.popularRank.slice(0, limit * 2);
    }

    case "cross_sell": {
      const limit = typeof params.limit === "number" ? params.limit : 8;
      if (ctx.lastViewed === null) return [];
      const top = ctx.artifacts.npmiTop.get(ctx.lastViewed) ?? [];
      return top
        .filter((x) => ctx.activeIds.has(x.id))
        .slice(0, limit * 2)
        .map((x) => x.id);
    }

    case "cart_addons":
      return []; // sin carrito persistente en el sim (desviación 2.C.2)

    default:
      return []; // sección desconocida ⇒ skip con warn en prod
  }
}
