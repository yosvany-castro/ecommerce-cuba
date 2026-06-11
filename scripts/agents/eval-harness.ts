#!/usr/bin/env tsx
/**
 * Eval-harness del gate ≥2x (blueprint §5.13): agente merchandiser REAL vs
 * motor congelado en un mundo no estacionario, in-memory, cero DB.
 *
 *   tsx scripts/agents/eval-harness.ts
 *     --gate                    # seeds {42,7,2026,31337,777}, mundo full, agente LLM
 *     --smoke                   # 1 seed (123), mundo 1500/300, 3 épocas medidas (~$0.03)
 *     --seeds 42,7              # override explícito (solo dev)
 *     --agent=llm|scripted|none # alias: real=llm. scripted/none VETADOS con --gate
 *     --aa                      # A/A: ambos brazos congelados
 *     --escalate                # añade ESCALATION_SEEDS y recalcula sobre N=10
 *     --epochs N                # override de épocas medidas (solo dev/smoke)
 *
 * Caché write-once de decisiones LLM por hash (transcripts commiteables):
 * re-runs del harness = $0; los runs del gate quedan congelados y auditables.
 * El veredicto sale de stats.gateVerdict (lecturas pre-comprometidas en su
 * header) — JAMÁS de la capa de métricas (A4 §6.4).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEV_SEED,
  ESCALATION_SEEDS,
  GATE_SEEDS,
  GATE_WORLD,
  SIM_WORLD_VERSION,
  SMOKE_WORLD,
  type WorldSpec,
} from "@/sectors/g-agents/sim/constants";
import {
  runSeedPipeline,
  type AgentMode,
  type LlmFrontierRunner,
  type SeedRunResult,
} from "@/sectors/g-agents/sim/engine";
import { gateVerdict } from "@/sectors/g-agents/sim/stats";
import type { PlacementProposal } from "@/sectors/g-agents/write/schema";
import type { ProposalResult } from "@/sectors/g-agents/runtime/backend";

const CACHE_DIR = resolve(process.cwd(), "scripts/agents/cache");
const RESULTS_DIR = resolve(process.cwd(), "scripts/agents/results");

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

interface CachedTranscript {
  key: { worldVersion: string; promptVersion: string; seed: number; epoch: number; metricsHash: string };
  proposals: PlacementProposal[];
  results: ProposalResult[];
  finalText: string;
  truncated: boolean;
  runId: string;
  createdAt: string;
}

/**
 * Runner LLM con caché write-once: key = sha256(worldVersion + promptVersion +
 * seed + epoch + sha256(metricsJson)). Hit ⇒ REPLAY de las propuestas contra
 * el backend (mismas validaciones/caps, cero tokens). Miss ⇒ runMerchandiserOnce
 * (import diferido: el grafo LangChain solo se paga si hay misses).
 */
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

    // graba los INPUTS del tool (replay exacto) además de los resultados
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
      key: { worldVersion: SIM_WORLD_VERSION, promptVersion, seed, epoch, metricsHash },
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

function parseArgs() {
  const argv = process.argv.slice(2);
  const has = (f: string) => argv.includes(f);
  const val = (f: string): string | null => {
    const eq = argv.find((a) => a.startsWith(`${f}=`));
    if (eq) return eq.slice(f.length + 1);
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
  };
  const gate = has("--gate");
  const smoke = has("--smoke");
  const aa = has("--aa");
  const escalate = has("--escalate");
  let agent = (val("--agent") ?? (gate ? "llm" : "scripted")) as AgentMode | "real";
  if (agent === "real") agent = "llm";
  if (gate && agent !== "llm") {
    throw new Error("--gate exige --agent=llm: scripted/none están VETADOS en el gate");
  }
  if (gate && val("--epochs") !== null) {
    throw new Error("--epochs está VETADO con --gate (el calendario del gate es fijo)");
  }
  let seeds: number[];
  const seedsArg = val("--seeds");
  if (seedsArg) {
    seeds = seedsArg.split(",").map(Number);
    if (gate) throw new Error("--gate usa los seeds pre-registrados; --seeds es solo dev");
  } else if (gate) {
    seeds = [...GATE_SEEDS, ...(escalate ? ESCALATION_SEEDS : [])];
  } else {
    seeds = [DEV_SEED];
  }
  const spec: WorldSpec = gate ? { ...GATE_WORLD } : { ...SMOKE_WORLD };
  const epochs = val("--epochs");
  if (epochs !== null) spec.measuredEpochs = Math.max(1, Number(epochs));
  if (!gate && !smoke && !seedsArg) {
    console.log("(sin --gate/--smoke: asumo --smoke)");
  }
  return { gate, aa, agent: agent as AgentMode, seeds, spec };
}

async function main() {
  const t0 = Date.now();
  const { gate, aa, agent, seeds, spec } = parseArgs();
  const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
  console.log(
    `[harness] mode=${gate ? "gate" : "smoke"} agent=${aa ? "none(aa)" : agent} seeds=[${seeds.join(",")}] ` +
      `world=${spec.universeSize}/${spec.activeAtE0} users=${spec.users} measured=${spec.measuredEpochs}`,
  );

  const llmRunner = agent === "llm" && !aa ? await makeLlmRunner() : undefined;

  // Seeds concurrentes: el LLM es I/O-bound; el sim de cada seed se intercala.
  const results: SeedRunResult[] = await Promise.all(
    seeds.map((seed) =>
      runSeedPipeline({
        worldSeed: seed,
        spec,
        mode: agent,
        aa,
        llmRunner,
        log: (s) => console.log(`[seed ${seed}] ${s} t=${el()}`),
      }),
    ),
  );

  // ── Reporte. ──
  const ratios = results.map((r) => r.ratio);
  for (const r of results) {
    console.log(
      `[seed ${r.seed}] ratio=${r.ratio.toFixed(4)} agent=${r.agentMarginCents}¢ frozen=${r.frozenMarginCents}¢ ` +
        `gini=${r.sanity.giniSales.toFixed(3)} top20=${(100 * r.sanity.top20Share).toFixed(1)}% ` +
        `${r.sanity.frozenCollapse ? "⚠ FROZEN COLLAPSE >50% — RUN INVÁLIDO" : ""}`,
    );
  }
  const invalid = results.some((r) => r.sanity.frozenCollapse);
  let verdict = null;
  if (ratios.length >= 2) {
    verdict = gateVerdict(ratios);
    console.log(
      `[harness] Ĝ=${verdict.geomMean.toFixed(3)} CI95=[${verdict.ci95[0].toFixed(3)}, ${verdict.ci95[1].toFixed(3)}] ` +
        `unanimidad=${verdict.unanimous} ⇒ ${invalid ? "RUN INVÁLIDO" : verdict.pass ? "PASS" : verdict.escalate ? "ESCALADA N=10" : "FAIL"}`,
    );
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `${gate ? "gate" : "smoke"}-${aa ? "aa" : agent}-${stamp}`;
  writeFileSync(
    resolve(RESULTS_DIR, `${name}.json`),
    JSON.stringify(
      {
        mode: gate ? "gate" : "smoke",
        aa,
        agent,
        gatedPolicy: { AGENT_MEDIUM_AUTOAPPLY: true }, // R8: el flag queda escrito en el reporte
        spec,
        seeds,
        worldVersion: SIM_WORLD_VERSION,
        ratios,
        verdict,
        invalid,
        results: results.map((r) => ({
          seed: r.seed,
          ratio: r.ratio,
          agentMarginCents: r.agentMarginCents,
          frozenMarginCents: r.frozenMarginCents,
          agentGmvCents: r.agentGmvCents,
          frozenGmvCents: r.frozenGmvCents,
          trajectories: r.trajectories,
          sanity: r.sanity,
          frontiers: r.frontiers,
        })),
        wallSeconds: (Date.now() - t0) / 1000,
      },
      null,
      2,
    ),
  );
  // NDJSON crudo por brazo (verificación independiente Fase D, verify-ledger)
  for (const r of results) {
    writeFileSync(resolve(RESULTS_DIR, `${name}-seed${r.seed}-frozen.ndjson`), r.ndjson.frozen);
    writeFileSync(resolve(RESULTS_DIR, `${name}-seed${r.seed}-agent.ndjson`), r.ndjson.agent);
  }
  console.log(`[harness] reporte: scripts/agents/results/${name}.json (wall=${el()})`);
  if (invalid) process.exit(2);
}

main().catch((e) => {
  console.error("[harness] failed:", e);
  process.exit(1);
});
