import type { Client } from "pg";
import { isValidRule } from "./rules/schema";
import { SECTION_REGISTRY } from "./sections/registry";
import type { Surface } from "./config";

/**
 * Shared write surface for ui_placements (Fase 2 C2). ONE state machine, one
 * validation, two callers: the merchandiser agent (which adds whitelists+caps
 * on top, g-agents/write) and the future /api/admin/placements (which adds
 * requireAdmin and no caps). Lives in f-slate because f-slate owns the
 * contract — the agent is just another caller.
 */

export interface PlacementWrite {
  surface: Surface;
  slot: number;
  section_type: string;
  params: Record<string, unknown>;
  rule: unknown | null;
  scope: "global" | "segment";
  scope_ref: string | null;
  status: "approved" | "pending";
  risk_tier: "low" | "medium" | "high";
  experiment_id: string | null;
  ttl_until: Date | null;
  created_by: string;
  proposal_key: string | null;
  proposal_meta: unknown | null;
}

export interface WriteResult {
  ok: boolean;
  placement_id?: string;
  reason?: string;
}

const SURFACES: ReadonlySet<string> = new Set(["home", "pdp", "cart", "search"]);

/** Mirrors the 0025 CHECKs + load-time nets so a bad row is rejected at write
 *  time with a legible reason instead of dying on a DB constraint. */
export function validatePlacementWrite(w: PlacementWrite): { ok: true } | { ok: false; reason: string } {
  if (!SURFACES.has(w.surface)) return { ok: false, reason: `unknown surface '${w.surface}'` };
  if (!Number.isInteger(w.slot) || w.slot < 0) return { ok: false, reason: `invalid slot ${w.slot}` };
  if (!(w.section_type in SECTION_REGISTRY) && w.section_type !== "hero_grid") {
    return { ok: false, reason: `unknown section_type '${w.section_type}'` };
  }
  if (!isValidRule(w.rule)) return { ok: false, reason: "invalid rule (RuleSchema)" };
  if (w.scope !== "global" && w.scope !== "segment") {
    return { ok: false, reason: `scope '${String(w.scope)}' not writable` };
  }
  if (w.scope === "segment" && (w.scope_ref === null || w.scope_ref === "")) {
    return { ok: false, reason: "scope=segment requires scope_ref" };
  }
  if (w.status !== "approved" && w.status !== "pending") {
    return { ok: false, reason: `status '${String(w.status)}' not writable` };
  }
  if (w.status === "approved" && w.created_by.startsWith("agent:") && w.ttl_until === null) {
    // toda escritura directa de un agente expira sola — el rollback es del loader
    return { ok: false, reason: "agent-approved rows require ttl_until" };
  }
  return { ok: true };
}

/**
 * INSERT in one atomic statement: version = MAX(version of same
 * surface+slot+scope)+1 computed in SQL (never an input), idempotency via the
 * partial unique index on proposal_key — 0 rows back means the same
 * action/day already exists.
 */
export async function applyPlacementWrite(w: PlacementWrite, pg: Client): Promise<WriteResult> {
  const valid = validatePlacementWrite(w);
  if (!valid.ok) return { ok: false, reason: valid.reason };
  const r = await pg.query(
    `INSERT INTO ui_placements
       (surface, slot, section_type, params, rule, scope, scope_ref, status,
        risk_tier, experiment_id, ttl_until, created_by, version, proposal_key, proposal_meta)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11, $12,
             COALESCE((SELECT MAX(version) FROM ui_placements
                       WHERE surface = $1 AND slot = $2 AND scope = $6), 0) + 1,
             $13, $14::jsonb)
     ON CONFLICT (proposal_key) WHERE proposal_key IS NOT NULL DO NOTHING
     RETURNING id::text`,
    [
      w.surface,
      w.slot,
      w.section_type,
      JSON.stringify(w.params),
      w.rule === null ? null : JSON.stringify(w.rule),
      w.scope,
      w.scope_ref,
      w.status,
      w.risk_tier,
      w.experiment_id,
      w.ttl_until,
      w.created_by,
      w.proposal_key,
      w.proposal_meta === null ? null : JSON.stringify(w.proposal_meta),
    ],
  );
  if (r.rowCount === 0) return { ok: false, reason: "duplicate (proposal_key already written today)" };
  return { ok: true, placement_id: (r.rows[0] as { id: string }).id };
}

/** Pause restricted by ownership IN the WHERE — 0 rows is a legible rejection,
 *  never an exception (the caller may be an LLM that should reformulate). */
export async function pauseOwnPlacement(
  args: { placement_id: string; created_by_like: string },
  pg: Client,
): Promise<WriteResult> {
  const r = await pg.query(
    `UPDATE ui_placements SET status = 'paused', updated_at = now()
     WHERE id = $1 AND created_by LIKE $2 AND status IN ('approved', 'pending')`,
    [args.placement_id, args.created_by_like],
  );
  if (r.rowCount === 0) {
    return { ok: false, reason: "placement not found, not yours, or not pausable" };
  }
  return { ok: true, placement_id: args.placement_id };
}
