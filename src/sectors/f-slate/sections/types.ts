import type { Client } from "pg";
import type { z } from "zod";
import type { ComposeIdentity, ComposeSurfaceArgs } from "../compose";
import type { SlateRuleContext } from "../rules/types";

/** Slim card DTO — the only product shape sections ship to the client. */
export interface SectionCardDTO {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  image_url: string | null;
  category?: string | null; // metadata.category (StorefrontCard, F/T2)
  reason?: string;
  /** Posición absoluta en el slate (solo hero — reporte de viewport). */
  position?: number;
}

export interface ResolveCtx {
  identity: ComposeIdentity;
  rule_ctx: SlateRuleContext;
  surfaceArgs?: ComposeSurfaceArgs;
  /**
   * Ids already claimed by higher-priority sections PLUS the user's excluded
   * products — the resolver may consult it, but the runner enforces the
   * dedupe regardless (an agent-written resolver cannot bypass it).
   */
  claimed: ReadonlySet<string>;
}

/**
 * Section resolver contract (D3): returns CANDIDATE ids (over-fetched ~k×2,
 * NO dedupe — the compositor sees all sections and claims by priority,
 * hydrating products ONCE). hero_grid is the one special case handled by the
 * runner (its content is the materialized slate feed, already hydrated).
 */
export interface SectionResolver<P> {
  section_type: string;
  paramsSchema: z.ZodType<P>;
  resolve(params: P, ctx: ResolveCtx, pg: Client): Promise<string[]>;
}

export interface ResolvedSection {
  placement_id: string;
  section_type: string;
  slot: number;
  title: string;
  display: string;
  items: SectionCardDTO[];
  /** hero_grid only: continuation for InfiniteFeed. */
  next_cursor?: string | null;
  slate_id?: string | null;
  outcome: "served" | "empty" | "below_min" | "timeout" | "error" | "unknown_type";
  resolve_ms: number;
}
