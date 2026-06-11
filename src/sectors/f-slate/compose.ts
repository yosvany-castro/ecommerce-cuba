import type { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readSessionState } from "@/sectors/d-personalization/session/state";
import { dbHealth } from "@/lib/db/health";
import { selectPlacements } from "./select";
import type { SlateRuleContext } from "./rules/types";
import {
  getSurfaceConfig,
  DEFAULT_PLACEMENTS,
  type PlacementConfig,
  type Surface,
  type SurfaceConfig,
} from "./config";

/**
 * composePage (D2): WHICH sections compose a surface for THIS user, now.
 * Per-user result from a shared rule set: rules are evaluated against the
 * request's live context (session cohort, cart, PDP anchor, hour). The
 * content of each section stays personalized by its resolver (D3).
 *
 * Latency: config from the in-process cache (~0ms amortized) + ONE session
 * query when a session exists. With the DB breaker open, composition jumps
 * straight to the hardcoded defaults — the page never depends on the config
 * table to exist.
 */

export interface ComposeIdentity {
  user_id: string | null;
  anonymous_id: string | null;
  session_id: string | null;
}

export interface ComposeSurfaceArgs {
  pdp_product_id?: string;
  pdp_category?: string | null;
  cart_product_ids?: string[];
}

export interface ComposedPage {
  composition_id: string;
  surface: Surface;
  placements: PlacementConfig[]; // ordenados por slot; máx 1 por slot
  rule_ctx: SlateRuleContext;
  config_source: SurfaceConfig["source"];
  config_version: string;
}

export async function composePage(
  input: { surface: Surface; identity: ComposeIdentity; surfaceArgs?: ComposeSurfaceArgs },
  pg: Client,
): Promise<ComposedPage> {
  const { surface, identity, surfaceArgs } = input;

  // ── Contexto vivo (1 query si hay sesión; cero si no). ──
  let session_cohort: string | null = null;
  let recipient_active = false;
  let signal_window_size = 0;
  if (identity.session_id && dbHealth() === "ok") {
    try {
      const s = await readSessionState(identity.session_id, pg);
      session_cohort = s.current_cohort_id;
      recipient_active = s.current_recipient_id !== null;
      signal_window_size = s.signal_window_size;
    } catch {
      // contexto degradado: las reglas que lo necesiten fallarán cerrado
    }
  }
  const nowDate = new Date();
  const rule_ctx: SlateRuleContext = {
    surface,
    hour_of_day: nowDate.getHours(),
    day_of_week: nowDate.getDay(),
    is_logged_in: identity.user_id !== null,
    user_segment: null, // seam Fase 2
    session_cohort,
    recipient_active,
    signal_window_size,
    gift_confirmed: false, // seam gift confirmable
    cart_item_count: surfaceArgs?.cart_product_ids?.length ?? 0,
    pdp_product_id: surfaceArgs?.pdp_product_id ?? null,
    pdp_category: surfaceArgs?.pdp_category ?? null,
  };

  // ── Config (caché / stale / fallback duro). ──
  const cfg: SurfaceConfig =
    dbHealth() === "ok"
      ? await getSurfaceConfig(surface, pg)
      : { placements: DEFAULT_PLACEMENTS[surface], source: "fallback", config_version: "cfg-breaker" };

  // ── Filtrar por regla, resolver colisiones de slot y capar (select.ts). ──
  const placements = selectPlacements(cfg.placements, rule_ctx);

  return {
    composition_id: randomUUID(),
    surface,
    placements,
    rule_ctx,
    config_source: cfg.source,
    config_version: cfg.config_version,
  };
}

/** Fire-and-forget: registra QUÉ placements compusieron la página servida. */
export async function logSlateDecision(
  page: ComposedPage,
  ctx: {
    user_profile_id: string | null;
    session_id: string | null;
    slate_id?: string | null;
    holdout?: boolean;
  },
  pg: Client,
): Promise<void> {
  try {
    await pg.query(
      `INSERT INTO slate_decisions
         (slate_id, surface, user_profile_id, session_id, config_version, holdout, experiment_id, placements)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        ctx.slate_id ?? page.composition_id,
        page.surface,
        ctx.user_profile_id,
        ctx.session_id,
        page.config_version,
        ctx.holdout ?? false,
        page.placements.find((p) => p.experiment_id)?.experiment_id ?? null,
        JSON.stringify(
          page.placements.map((p) => ({
            placement_id: p.placement_id,
            slot: p.slot,
            section_type: p.section_type,
            version: p.version,
          })),
        ),
      ],
    );
  } catch (e) {
    console.warn("[slate] decision logging failed (page unaffected):", e);
  }
}
