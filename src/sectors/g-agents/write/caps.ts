import { createHash } from "node:crypto";

/**
 * Caps de seguridad del agente (A5 §3) — constantes compartidas por
 * backend-pg (SQL) y backend-sim (in-memory). El enforcement vive en cada
 * backend; aquí solo el contrato numérico y la llave de idempotencia, para
 * que prod y sim no puedan divergir en valores.
 */

export const AGENT_CREATED_BY = "agent:merchandiser/v1";
export const AGENT_CREATED_BY_LIKE = "agent:%";

export const DAY_WRITE_CAP = 10; // INSERTs del agente por 24h
export const LIVE_PER_SURFACE_CAP = 3; // filas agente approved no expiradas por surface
export const LIVE_TOTAL_CAP = 12; // ídem, total
export const COOLDOWN_HOURS = 48; // por (surface,slot): mata write/pause/write

export function runProposalCap(): number {
  const n = Number.parseInt(process.env.AGENT_MAX_PROPOSALS_PER_RUN ?? "5", 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export function mediumAutoapply(): boolean {
  return process.env.AGENT_MEDIUM_AUTOAPPLY === "true";
}

/** Idempotencia diaria: re-run del cron tras un crash no duplica acción. */
export function proposalKey(args: {
  surface: string;
  slot: number;
  action: string;
  /** section_type (create/supersede) o target_placement_id (request_pause). */
  target: string;
  day: string; // YYYY-MM-DD del reloj del backend
}): string {
  return createHash("sha256")
    .update(`${args.surface}|${args.slot}|${args.action}|${args.target}|${args.day}`)
    .digest("hex");
}
