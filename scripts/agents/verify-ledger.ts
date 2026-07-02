#!/usr/bin/env tsx
/**
 * Fase D ataque 1 (blueprint §7.3): recuento INDEPENDIENTE del ledger.
 * Re-suma el margen realizado desde los NDJSON crudos por brazo y lo compara
 * al centavo con el reporte del harness; recomputa ratio, Ĝ y CI95 con una
 * implementación propia. PROHIBIDO importar nada de src/ (en especial sim/):
 * solo node:fs/path — si el harness miente, esto no puede heredar la mentira.
 *
 *   tsx scripts/agents/verify-ledger.ts [results.json ...]   # sin args: todos
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";

// Pre-registrado (blueprint §5.2): e0 warmup + e1 baseline; medidas desde e2.
const MEASURED_EPOCH_START = 2;
const AA_BAND: [number, number] = [0.97, 1.03]; // §7.1, pre-registrada
const T_975: Record<number, number> = {
  1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
  6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
};

interface NdjsonPurchase {
  epoch: number;
  unit_price_cents: number;
  quantity: number;
  margin_pct: number;
}

function recount(file: string, fromEpoch: number, toEpoch: number) {
  let margin = 0;
  let gmv = 0;
  let rows = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const p = JSON.parse(line) as NdjsonPurchase;
    rows++;
    if (p.epoch < fromEpoch || p.epoch > toEpoch) continue;
    margin += p.unit_price_cents * p.quantity * p.margin_pct;
    gmv += p.unit_price_cents * p.quantity;
  }
  return { margin, gmv, rows };
}

function independentVerdict(ratios: number[]) {
  const logs = ratios.map((r) => Math.log(r));
  const n = logs.length;
  const mean = logs.reduce((s, x) => s + x, 0) / n;
  const geomMean = Math.exp(mean);
  if (n < 2) return { geomMean, ci95: [Number.NaN, Number.NaN] as [number, number] };
  const sd = Math.sqrt(logs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  const half = ((T_975[n - 1] ?? 1.96) * sd) / Math.sqrt(n);
  return { geomMean, ci95: [Math.exp(mean - half), Math.exp(mean + half)] as [number, number] };
}

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error(`  ✗ ${msg}`);
};
const closeRel = (a: number, b: number, eps = 1e-9) =>
  Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

function verifyReport(reportPath: string): void {
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
    aa: boolean;
    spec: { measuredEpochs: number };
    ratios: number[];
    verdict: { geomMean: number; ci95: [number, number] } | null;
    results: {
      seed: number;
      ratio: number;
      agentMarginCents: number;
      frozenMarginCents: number;
      agentGmvCents: number;
      frozenGmvCents: number;
    }[];
  };
  const dir = dirname(reportPath);
  const base = basename(reportPath, ".json");
  const lastEpoch = 1 + report.spec.measuredEpochs;
  console.log(`${base} (épocas medidas ${MEASURED_EPOCH_START}..${lastEpoch}${report.aa ? ", A/A" : ""})`);

  const ratios: number[] = [];
  for (const r of report.results) {
    const frozen = recount(resolve(dir, `${base}-seed${r.seed}-frozen.ndjson`), MEASURED_EPOCH_START, lastEpoch);
    const agent = recount(resolve(dir, `${base}-seed${r.seed}-agent.ndjson`), MEASURED_EPOCH_START, lastEpoch);
    const ratio = agent.margin / Math.max(1, frozen.margin);
    ratios.push(ratio);
    console.log(
      `  seed ${r.seed}: recuento agent=${Math.round(agent.margin)}¢ frozen=${Math.round(frozen.margin)}¢ ` +
        `ratio=${ratio.toFixed(6)} (filas ${agent.rows}/${frozen.rows})`,
    );
    if (Math.round(agent.margin) !== r.agentMarginCents)
      fail(`seed ${r.seed}: margen agente ${Math.round(agent.margin)}¢ ≠ reporte ${r.agentMarginCents}¢`);
    if (Math.round(frozen.margin) !== r.frozenMarginCents)
      fail(`seed ${r.seed}: margen frozen ${Math.round(frozen.margin)}¢ ≠ reporte ${r.frozenMarginCents}¢`);
    if (agent.gmv !== r.agentGmvCents)
      fail(`seed ${r.seed}: GMV agente ${agent.gmv}¢ ≠ reporte ${r.agentGmvCents}¢`);
    if (frozen.gmv !== r.frozenGmvCents)
      fail(`seed ${r.seed}: GMV frozen ${frozen.gmv}¢ ≠ reporte ${r.frozenGmvCents}¢`);
    if (!closeRel(ratio, r.ratio))
      fail(`seed ${r.seed}: ratio recontado ${ratio} ≠ reporte ${r.ratio}`);
    if (report.aa && (ratio < AA_BAND[0] || ratio > AA_BAND[1]))
      fail(`seed ${r.seed}: A/A fuera de banda [${AA_BAND}]: ${ratio} — el harness fabrica diferencias`);
  }

  if (report.verdict && ratios.length >= 2) {
    const v = independentVerdict(ratios);
    if (!closeRel(v.geomMean, report.verdict.geomMean, 1e-12))
      fail(`Ĝ recontado ${v.geomMean} ≠ reporte ${report.verdict.geomMean}`);
    if (!closeRel(v.ci95[0], report.verdict.ci95[0], 1e-12) || !closeRel(v.ci95[1], report.verdict.ci95[1], 1e-12))
      fail(`CI95 recontado [${v.ci95}] ≠ reporte [${report.verdict.ci95}]`);
    console.log(`  Ĝ=${v.geomMean.toFixed(4)} CI95=[${v.ci95[0].toFixed(4)}, ${v.ci95[1].toFixed(4)}] (recuento independiente)`);
  }
}

const args = process.argv.slice(2);
const resultsDir = resolve(process.cwd(), "scripts/agents/results");
const reports = args.length > 0
  ? args.map((a) => resolve(process.cwd(), a))
  : readdirSync(resultsDir).filter((f) => f.endsWith(".json")).sort().map((f) => resolve(resultsDir, f));

for (const r of reports) verifyReport(r);
console.log(failures === 0 ? `\n✓ ${reports.length} reporte(s): ledger verificado al centavo` : `\n✗ ${failures} discrepancia(s)`);
process.exit(failures === 0 ? 0 : 1);
