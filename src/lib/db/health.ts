/**
 * In-process DB circuit breaker (PageSlate foundation F4).
 *
 * Distinguishes "the pooler hiccuped / one query failed" from "the database
 * is unreachable" (free-tier projects auto-pause; the pooler also lags after
 * a restore — docs/handoff-thesis-program-F0-F5.md:102). Consumers:
 *  - /api/track answers 503 IMMEDIATELY when the DB is down, so the client
 *    event queue backs off instead of each event burning the 2s
 *    connectionTimeout during recovery;
 *  - composePage (Etapa D) will short-circuit to cached/fallback slates.
 *
 * Semantics: CONNECTION-CLASS failures only (a SQL error in one query says
 * nothing about DB health). `breakerThreshold` consecutive failures open the
 * breaker for `cooldownMs`; after the cooldown the next caller is allowed
 * through (half-open) — its success closes the breaker, its failure re-opens.
 * Clock injectable for tests.
 */

const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08006", // connection_failure
]);

const CONNECTION_ERROR_PATTERNS = [
  /timeout exceeded when trying to connect/i,
  /connection terminated/i,
  /the database system is (starting up|shutting down)/i,
];

export function isConnectionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  if (code && CONNECTION_ERROR_CODES.has(code)) return true;
  const message = (err as { message?: string }).message ?? "";
  return CONNECTION_ERROR_PATTERNS.some((re) => re.test(message));
}

interface BreakerState {
  consecutiveFailures: number;
  openedAt: number | null;
}

const BREAKER_THRESHOLD = 2;
const COOLDOWN_MS = 15_000;

const state: BreakerState = { consecutiveFailures: 0, openedAt: null };

export function reportDbSuccess(): void {
  state.consecutiveFailures = 0;
  state.openedAt = null;
}

export function reportDbFailure(err: unknown, now: () => number = Date.now): void {
  if (!isConnectionError(err)) return;
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= BREAKER_THRESHOLD) {
    state.openedAt = now();
  }
}

/**
 * 'ok'   → proceed normally.
 * 'down' → fast-fail (503 / cached fallback). After the cooldown the breaker
 *          reports 'ok' again (half-open): the next real attempt decides.
 */
export function dbHealth(now: () => number = Date.now): "ok" | "down" {
  if (state.openedAt === null) return "ok";
  if (now() - state.openedAt >= COOLDOWN_MS) {
    // Half-open: let the next caller try; keep failures so one more failure
    // re-opens immediately.
    state.openedAt = null;
    state.consecutiveFailures = Math.max(0, BREAKER_THRESHOLD - 1);
    return "ok";
  }
  return "down";
}

/** Test-only: reset the module-level breaker state. */
export function resetDbHealthForTests(): void {
  state.consecutiveFailures = 0;
  state.openedAt = null;
}
