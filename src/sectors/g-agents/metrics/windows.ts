import type { ResolvedWindow, WindowSpec } from "./types";

/**
 * Resolución de ventanas (puro, reloj inyectado). Ningún SQL de esta capa usa
 * now() para ventanas: siempre $N::timestamptz calculado aquí — requisito del
 * harness (el reloj simulado avanza por días, sqlMetricsSource y
 * simMetricsSource deben resolver la MISMA ventana).
 */

const DAY_MS = 86_400_000;

/** since-change se acota a 28d: horizonte de no-estacionariedad < retención 90d. */
export const SINCE_CLAMP_DAYS = 28;

export function resolveWindow(spec: WindowSpec, now: () => Date): ResolvedWindow {
  const to = now();
  if (spec.kind === "fixed") {
    return { from: new Date(to.getTime() - spec.days * DAY_MS), to, label: `${spec.days}d` };
  }
  const floor = to.getTime() - SINCE_CLAMP_DAYS * DAY_MS;
  return {
    from: new Date(Math.max(spec.from.getTime(), floor)),
    to,
    label: "since_change",
  };
}
