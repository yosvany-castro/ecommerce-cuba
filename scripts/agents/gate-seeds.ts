#!/usr/bin/env tsx
/**
 * Runner del gate RESILIENTE a suspensiones (helper operativo — NO el harness
 * canónico). Corre los GATE_SEEDS pre-registrados de a uno y PERSISTE el ratio
 * de cada seed en results/gate-seed-<seed>.json. Re-ejecutar SALTA los seeds ya
 * guardados (solo el seed en vuelo se re-simula), de modo que las suspensiones
 * del codespace no obligan a re-simular lo ya hecho.
 *
 * Usa el MISMO runSeedPipeline + GATE_WORLD + caché LLM write-once + gateVerdict
 * que scripts/agents/eval-harness.ts ⇒ ratios idénticos a `--gate`. Determinista
 * por CRN: el ratio de un seed no depende de en qué invocación se calculó.
 * El veredicto oficial sigue saliendo de gateVerdict sobre los 5 ratios.
 *
 *   tsx scripts/agents/gate-seeds.ts            # corre/reanuda los 5 seeds + veredicto
 *   tsx scripts/agents/gate-seeds.ts --verdict  # solo recombina los ratios guardados
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { GATE_SEEDS, GATE_WORLD, SIM_WORLD_VERSION } from "@/sectors/g-agents/sim/constants";
import { runSeedPipeline, type LlmFrontierRunner } from "@/sectors/g-agents/sim/engine";
import { gateVerdict } from "@/sectors/g-agents/sim/stats";
import type { PlacementProposal } from "@/sectors/g-agents/write/schema";
import type { ProposalResult } from "@/sectors/g-agents/runtime/backend";

const CACHE_DIR = resolve(process.cwd(), "scripts/agents/cache");
const RESULTS_DIR = resolve(process.cwd(), "scripts/agents/results");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const seedFile = (seed: number) => resolve(RESULTS_DIR, `gate-seed-${seed}.json`);

interface SeedResult {
  seed: number;
  ratio: number;
  agentMarginCents: number;
  frozenMarginCents: number;
  frozenCollapse: boolean;
  giniSales: number;
  top20Share: number;
  worldVersion: string;
  savedAt: string;
}

interface CachedTranscript {
  proposals: PlacementProposal[];
  results: ProposalResult[];
  finalText: string;
  truncated: boolean;
  runId: string;
  createdAt: string;
}

/** Caché write-once IDÉNTICA a eval-harness (misma key ⇒ mismos hits). */
async function makeLlmRunner(): Promise<LlmFrontierRunner> {
  const { runMerchandiserOnce, MERCHANDISER_PROMPT, CRITIC_PROMPT, TASK_MESSAGE } = await import(
    "@/sectors/g-agents/runtime/merchandiser"
  );
  const promptVersion = sha256(MERCHANDISER_PROMPT + CRITIC_PROMPT + TASK_MESSAGE).slice(0, 16);
  mkdirSync(CACHE_DIR, { recursive: true });

  return async ({ backend, seed, epoch, metricsJson }) => {
    const metricsHash = sha256(metricsJson);
    const key = sha256(`${SIM_WORLD_VERSION}|${promptVersion}|${seed}|${epoch}|${metricsHash}`);
    const file = resolve(CACHE_DIR, `${key}.json`);

    if (existsSync(file)) {
      const cached = JSON.parse(readFileSync(file, "utf8")) as CachedTranscript;
      const results: ProposalResult[] = [];
      for (const p of cached.proposals) results.push(await backend.proposeWrite(p));
      return { proposals: results, truncated: cached.truncated, cached: true };
    }

    const inputs: PlacementProposal[] = [];
    const recording = {
      ...backend,
      proposeWrite: async (i: PlacementProposal) => {
        inputs.push(i);
        return backend.proposeWrite(i);
      },
    };
    const out = await runMerchandiserOnce({ backend: recording, timeoutMs: 600_000 });
    const transcript: CachedTranscript = {
      proposals: inputs,
      results: out.proposals,
      finalText: out.finalText,
      truncated: out.truncated,
      runId: out.runId,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(file, JSON.stringify(transcript, null, 2));
    return { proposals: out.proposals, truncated: out.truncated, cached: false };
  };
}

function loadSeed(seed: number): SeedResult | null {
  const f = seedFile(seed);
  if (!existsSync(f)) return null;
  const r = JSON.parse(readFileSync(f, "utf8")) as SeedResult;
  // un resultado de otra versión de mundo NO sirve (re-correr)
  return r.worldVersion === SIM_WORLD_VERSION ? r : null;
}

function printVerdict(results: SeedResult[]): void {
  for (const r of results) {
    console.log(
      `[seed ${r.seed}] ratio=${r.ratio.toFixed(4)} agent=${r.agentMarginCents}¢ frozen=${r.frozenMarginCents}¢ ` +
        `gini=${r.giniSales.toFixed(3)} top20=${(100 * r.top20Share).toFixed(1)}% ` +
        `${r.frozenCollapse ? "⚠ FROZEN COLLAPSE — RUN INVÁLIDO" : ""}`,
    );
  }
  const ratios = results.map((r) => r.ratio);
  const invalid = results.some((r) => r.frozenCollapse);
  if (ratios.length >= 2) {
    const v = gateVerdict(ratios);
    console.log(
      `[gate] n=${ratios.length} Ĝ=${v.geomMean.toFixed(3)} CI95=[${v.ci95[0].toFixed(3)}, ${v.ci95[1].toFixed(3)}] ` +
        `unanimidad=${v.unanimous} ⇒ ${invalid ? "RUN INVÁLIDO (frozenCollapse)" : v.pass ? "PASS" : v.escalate ? "ESCALADA N=10" : "FAIL"}`,
    );
  }
}

async function main() {
  const verdictOnly = process.argv.includes("--verdict");
  mkdirSync(RESULTS_DIR, { recursive: true });

  if (verdictOnly) {
    const results = GATE_SEEDS.map(loadSeed).filter((r): r is SeedResult => r !== null);
    console.log(`[gate] ${results.length}/${GATE_SEEDS.length} seeds guardados`);
    printVerdict(results);
    return;
  }

  const llmRunner = await makeLlmRunner();
  const t0 = Date.now();
  const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

  for (const seed of GATE_SEEDS) {
    const existing = loadSeed(seed);
    if (existing) {
      console.log(`[seed ${seed}] ya guardado: ratio=${existing.ratio.toFixed(4)} — salto`);
      continue;
    }
    console.log(`[seed ${seed}] corriendo (GATE_WORLD ${GATE_WORLD.users}u × ${GATE_WORLD.measuredEpochs}ep)…`);
    const r = await runSeedPipeline({
      worldSeed: seed,
      spec: { ...GATE_WORLD },
      mode: "llm",
      llmRunner,
      log: (s) => console.log(`[seed ${seed}] ${s} t=${el()}`),
    });
    const out: SeedResult = {
      seed,
      ratio: r.ratio,
      agentMarginCents: r.agentMarginCents,
      frozenMarginCents: r.frozenMarginCents,
      frozenCollapse: r.sanity.frozenCollapse,
      giniSales: r.sanity.giniSales,
      top20Share: r.sanity.top20Share,
      worldVersion: SIM_WORLD_VERSION,
      savedAt: new Date().toISOString(),
    };
    writeFileSync(seedFile(seed), JSON.stringify(out, null, 2));
    console.log(`[seed ${seed}] GUARDADO ratio=${r.ratio.toFixed(4)} (t=${el()})`);
  }

  const results = GATE_SEEDS.map(loadSeed).filter((r): r is SeedResult => r !== null);
  console.log("\n=== VEREDICTO ===");
  printVerdict(results);
}

main().catch((e) => {
  console.error("[gate-seeds] failed:", e);
  process.exit(1);
});
