/**
 * Matemática del gate (blueprint §5.11, A3 §5 — PRE-REGISTRADA).
 *
 * Por seed: ratio = M_agent/M_frozen (margen realizado, épocas 2..13).
 * Punto: media geométrica Ĝ = exp(mean(ln r)). CI95: t-Student en log-espacio.
 * PASA ⇔ Ĝ ≥ 2.0 ∧ CI95-low > 1.0 ∧ ratio > 1 en TODOS los seeds.
 * Escalada única a N=10 si Ĝ ≥ 2 con CI-low ≤ 1 (sin más extensiones).
 *
 * LECTURAS PRE-COMPROMETIDAS (A3 §5.3 — literales, sin reframing):
 * - Ĝ=1.4 CI[1.2,1.6]  ⇒ NO se despliega ("+40% significativo pero no 2x").
 * - Ĝ=1.9 CI[1.5,2.4]  ⇒ FAIL. 1.9 ≠ 2.0; jamás se redondea.
 * - Ĝ=2.1 CI[0.9,4.9]  ⇒ escalada única a N=10; veredicto sobre los 10.
 * - Ĝ=2.3 CI[1.4,3.8] 5/5>1 ⇒ se despliega (con trayectorias + audit).
 * - Brazo congelado colapsando >50% entre épocas ⇒ RUN INVÁLIDO (revisar
 *   mundo ANTES de mirar ratios; el cambio invalida los seeds usados).
 */

/** t(0.975, df) — tabla embebida, sin dependencias. df>10 ⇒ aproximación z. */
const T_975: Record<number, number> = {
  1: 12.706,
  2: 4.303,
  3: 3.182,
  4: 2.776,
  5: 2.571,
  6: 2.447,
  7: 2.365,
  8: 2.306,
  9: 2.262,
  10: 2.228,
};

export interface GateVerdict {
  geomMean: number;
  ci95: [number, number];
  unanimous: boolean;
  pass: boolean;
  /** Ĝ≥2 con CI-low≤1: dispara la extensión única pre-registrada a N=10. */
  escalate: boolean;
}

export function gateVerdict(ratios: number[]): GateVerdict {
  if (ratios.length === 0 || ratios.some((r) => !(r > 0))) {
    throw new Error("gateVerdict: ratios must be positive and non-empty");
  }
  const logs = ratios.map((r) => Math.log(r));
  const n = logs.length;
  const mean = logs.reduce((s, x) => s + x, 0) / n;
  const geomMean = Math.exp(mean);
  let ci95: [number, number];
  if (n < 2) {
    ci95 = [Number.NaN, Number.NaN]; // sin réplicas no hay CI — jamás pasa
  } else {
    const sd = Math.sqrt(logs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
    const t = T_975[n - 1] ?? 1.96;
    const half = (t * sd) / Math.sqrt(n);
    ci95 = [Math.exp(mean - half), Math.exp(mean + half)];
  }
  const unanimous = ratios.every((r) => r > 1.0);
  const pass = geomMean >= 2.0 && ci95[0] > 1.0 && unanimous;
  // escalada solo con CI real (n≥2): sin réplicas no hay nada que escalar
  const escalate = geomMean >= 2.0 && Number.isFinite(ci95[0]) && ci95[0] <= 1.0;
  return { geomMean, ci95, unanimous, pass, escalate };
}

/** Gini sobre conteos no negativos (sanity del mundo: ~heavy-tail retail). */
export function gini(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  const sum = v.reduce((s, x) => s + x, 0);
  if (n === 0 || sum === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * v[i];
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

/** Cuota de ventas del top-20% de productos (calibración exp-G/K: ~72/28). */
export function top20Share(salesByProduct: number[]): number {
  const sorted = [...salesByProduct].sort((a, b) => b - a);
  const total = sorted.reduce((s, x) => s + x, 0);
  if (total === 0) return 0;
  const k = Math.max(1, Math.floor(sorted.length * 0.2));
  return sorted.slice(0, k).reduce((s, x) => s + x, 0) / total;
}
