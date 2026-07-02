/**
 * Matemática del gate (blueprint §5.11, A3 §5 — PRE-REGISTRADA).
 *
 * Por seed: ratio = M_agent/M_frozen (margen realizado, épocas 2..13).
 * Punto: media geométrica Ĝ = exp(mean(ln r)). CI95: t-Student en log-espacio.
 * PASA ⇔ N ≥ 5 ∧ Ĝ ≥ 2.0 ∧ CI95-low > 1.0 ∧ ratio > 1 en TODOS los seeds.
 * Escalada única a N=10 si Ĝ ≥ 2 con CI-low ≤ 1 (sin más extensiones).
 * N ≥ 5 dentro del verdict (Fase D, H1): un run dev con 2 seeds cherry-picked
 * jamás puede imprimir PASS/ESCALADA — el gate son los 5 pre-registrados.
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

/** Mínimo pre-registrado de seeds para que pass/escalate sean computables. */
export const GATE_MIN_SEEDS = 5;

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
  const gateN = n >= GATE_MIN_SEEDS;
  const pass = gateN && geomMean >= 2.0 && ci95[0] > 1.0 && unanimous;
  const escalate = gateN && geomMean >= 2.0 && Number.isFinite(ci95[0]) && ci95[0] <= 1.0;
  return { geomMean, ci95, unanimous, pass, escalate };
}

/**
 * Detector de colapso del frozen — RECALIBRADO Y PRE-REGISTRADO 2026-07-02
 * (D1-H3: el detector original marcaba INVÁLIDO por dips legítimos de UNA
 * época en mundos volátiles de 12 épocas — falsos positivos en 3/5 seeds del
 * gate v1). Reglas:
 *  1. Brazo MUERTO: margen ≤0 en cualquier época medida ⇒ inválido (el
 *     exploit real que se caza: un frozen en cero daría ratio astronómico).
 *  2. Colapso SOSTENIDO: caída bajo el 50% del nivel pre-caída mantenida DOS
 *     épocas consecutivas ⇒ inválido.
 * Un dip puntual que se recupera (o en la última época, sin segunda evidencia)
 * ya NO invalida: el ratio compara SUMAS de margen — un dip de una época no
 * puede fabricar un 2×, y el brazo muerto lo cubre la regla 1.
 */
export function frozenCollapsed(
  marginByEpoch: number[],
  measuredStart: number,
  lastEpoch: number,
): boolean {
  for (let t = measuredStart; t <= lastEpoch; t++) {
    if (!(marginByEpoch[t] > 0)) return true;
  }
  for (let t = measuredStart - 1; t <= lastEpoch - 2; t++) {
    const pre = marginByEpoch[t];
    if (pre > 0 && marginByEpoch[t + 1] < 0.5 * pre && marginByEpoch[t + 2] < 0.5 * pre) {
      return true;
    }
  }
  return false;
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
