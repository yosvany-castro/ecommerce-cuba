import { createHash } from "node:crypto";

/**
 * Persistent holdout (F2): a deterministic ~10% of identities ALWAYS receive
 * the baseline store (pure popularity, no personalization, no exploration) —
 * the clean counterfactual that measures the WHOLE system's effect. Decided
 * by the user (2026-06-10): 10%, reducible cuando el tráfico crezca.
 *
 * Salted hash, no assignment table: same identity ⇒ same arm, forever (the
 * salt is part of the experiment identity — changing it IS a new holdout).
 * user_id wins over anonymous_id so login keeps the arm stable per person.
 * Holdout users keep full tracking, dismisses and exclusions (base
 * functionality, not treatment) — they are excluded from every OTHER
 * experiment (hierarchy: holdout first).
 */

const HOLDOUT_SALT = "pageslate-holdout-v1";

// Lectura por-llamada (no módulo-load): .env.local puede apagarlo en local
// (HOLDOUT_PERCENT=0, ver nota ahí) y los tests fijan el suyo sin depender
// del entorno de la máquina.
function holdoutPercent(): number {
  const raw = Number.parseInt(process.env.HOLDOUT_PERCENT ?? "10", 10);
  return Number.isFinite(raw) ? Math.min(50, Math.max(0, raw)) : 10;
}

export function isHoldout(identity: {
  user_id: string | null;
  anonymous_id: string | null;
}): boolean {
  const pct = holdoutPercent();
  const key = identity.user_id ?? identity.anonymous_id;
  if (!key || pct === 0) return false;
  const digest = createHash("sha256").update(`${HOLDOUT_SALT}:${key}`).digest();
  const bucket = digest.readUInt32BE(0) % 100;
  return bucket < pct;
}
