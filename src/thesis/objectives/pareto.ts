/** A swept config's aggregate metric vector. */
export interface ParetoPoint {
  id: string;
  metrics: Record<string, number>;
}

/**
 * Non-dominated set, MAXIMIZING every objective in `objectives`. A point is
 * dominated if another is ≥ on all objectives and strictly > on at least one.
 * Pure. Deterministic (input order preserved among non-dominated points).
 */
export function paretoFrontier(points: ParetoPoint[], objectives: string[]): ParetoPoint[] {
  return points.filter((p) =>
    !points.some((q) =>
      q !== p &&
      objectives.every((o) => (q.metrics[o] ?? 0) >= (p.metrics[o] ?? 0)) &&
      objectives.some((o) => (q.metrics[o] ?? 0) > (p.metrics[o] ?? 0)),
    ),
  );
}

export interface KpiSpec {
  kpi: string; // metric to maximize
  guardrails: Record<string, { min?: number; max?: number }>;
}

/**
 * Pick the point maximizing `kpi` among those satisfying all guardrails. If no
 * point is feasible, fall back to the global max-KPI point (documented). Pure;
 * tie-break by id for determinism.
 */
export function pickByKpi(points: ParetoPoint[], spec: KpiSpec): ParetoPoint {
  const feasible = points.filter((p) =>
    Object.entries(spec.guardrails).every(([m, g]) => {
      const v = p.metrics[m] ?? 0;
      if (g.min !== undefined && v < g.min) return false;
      if (g.max !== undefined && v > g.max) return false;
      return true;
    }),
  );
  const pool = feasible.length > 0 ? feasible : points;
  return pool.slice().sort((a, b) => (b.metrics[spec.kpi] ?? 0) - (a.metrics[spec.kpi] ?? 0) || a.id.localeCompare(b.id))[0];
}
