import { sampleBehavior, type BehaviorOutput } from "@/thesis/data/behavior-model";
import type { MerchandiserBackend, ProposalResult } from "@/sectors/g-agents/runtime/backend";
import { simMerchandiserBackend } from "@/sectors/g-agents/runtime/backend-sim";
import {
  CASCADE_LAMBDA,
  EPOCH_DAYS,
  MEASURED_EPOCH_START,
  SIM_CONFIG,
  epochStart,
  type WorldSpec,
} from "./constants";
import { buildWorld, type World } from "./world";
import { SimPlacementStore } from "./store";
import { runEpochCrons, type ArmArtifacts } from "./crons";
import { buildUserState, makeArmJourneyPolicy } from "./policy";
import {
  gmvCents,
  ingestEpoch,
  ledgerToNdjson,
  makeArm,
  marginByEpoch,
  realizedMarginCents,
  type ArmState,
} from "./ledger";
import { frozenCollapsed, gini, top20Share } from "./stats";

/**
 * Pipeline por seed del harness (blueprint §5.13) como librería: el CLI
 * (scripts/agents/eval-harness.ts) solo parsea flags y reporta. Vivir en src/
 * permite testear los invariantes (inactivos, DEFAULT, hashes) sin ejecutar
 * el script — desviación declarada (+1 archivo engine.ts sobre el blueprint).
 *
 * Flujo: buildWorld → e0 orgánica compartida → e1 congelada bit-idéntica →
 * t=2..N: crons por brazo → frontera del agente (solo brazo agente) →
 * diffHash/assertUnchanged → época con sampleBehavior(exposurePolicy) →
 * invariante post-época → ledger. El agente LLM corre vía `llmRunner`
 * inyectado (caché write-once + deepagents viven en el CLI, no aquí).
 */

export type AgentMode = "llm" | "scripted" | "none";

export interface FrontierRecord {
  epoch: number;
  proposals: ProposalResult[];
  cached: boolean;
  truncated: boolean;
  storeChanged: boolean;
}

export type LlmFrontierRunner = (args: {
  backend: MerchandiserBackend;
  seed: number;
  epoch: number;
  metricsJson: string;
}) => Promise<{ proposals: ProposalResult[]; truncated: boolean; cached: boolean }>;

export interface SeedRunResult {
  seed: number;
  measuredEpochs: number;
  agentMarginCents: number;
  frozenMarginCents: number;
  ratio: number;
  agentGmvCents: number;
  frozenGmvCents: number;
  trajectories: { frozen: number[]; agent: number[] };
  sanity: { giniSales: number; top20Share: number; frozenCollapse: boolean };
  frontiers: FrontierRecord[];
  ndjson: { frozen: string; agent: string };
}

function baseOpts(world: World, t: number) {
  return {
    users: world.spec.users,
    days: EPOCH_DAYS,
    seed: world.worldSeed,
    priceGamma: SIM_CONFIG.PRICE_GAMMA,
    pGiftMax: SIM_CONFIG.P_GIFT_MAX,
    stochasticChoice: true,
    cascadeLambda: CASCADE_LAMBDA,
    attractivenessById: world.attractiveness(t),
  };
}

/** Invariante anti-trampa #4c: ningún evento de época expuesta referencia inactivos. */
function assertNoInactiveEvents(out: BehaviorOutput, world: World, t: number): void {
  const active = world.activeIds(t);
  for (const e of out.events) {
    if (!active.has(e.product_id)) {
      throw new Error(
        `run inválido: evento ${e.event_type} sobre producto inactivo ${e.product_id} en época ${t}`,
      );
    }
  }
}

/** Config congelada = filas 0026 aplicables al sim (home: SOLO hero slot 10 — 2.B.9). */
function seedFrozenConfig(store: SimPlacementStore): string[] {
  const t0 = epochStart(0);
  const heroId = store.seed({
    surface: "home",
    slot: 10,
    section_type: "hero_grid",
    params: { limit: 20 },
    rule: null,
    scope: "global",
    scope_ref: null,
    status: "approved",
    risk_tier: "low",
    experiment_id: null,
    ttl_until: null,
    created_by: "seed",
    version: 1,
    created_at: t0,
    updated_at: t0,
    proposal_key: null,
    proposal_meta: null,
  });
  return [heroId];
}

/**
 * Agente scripted (plomería del harness, CERO tokens): lee métricas y propone
 * placements fijos. VETADO con --gate (assertion en el CLI).
 */
export async function runScriptedAgent(backend: MerchandiserBackend): Promise<ProposalResult[]> {
  const metricsJson = await backend.readMetrics({ window_days: 7 });
  const report = JSON.parse(metricsJson) as {
    store: { seen: number; purchases: number; feed_revenue_cents: number };
    window: { label: string };
  };
  const rationale =
    `scripted: ventana ${report.window.label}, seen=${report.store.seen}, ` +
    `purchases=${report.store.purchases}, feed_revenue_cents=${report.store.feed_revenue_cents}; ` +
    `mantengo popular global y cross_sell con TTL para medir since_change.`;
  const results: ProposalResult[] = [];
  results.push(
    await backend.proposeWrite({
      action: "create",
      surface: "home",
      slot: 20,
      section_type: "popular",
      params: { limit: 10, mode: "global" },
      rule: null,
      scope: "global",
      scope_ref: null,
      ttl_hours: 168,
      rationale,
    } as never),
  );
  results.push(
    await backend.proposeWrite({
      action: "create",
      surface: "home",
      slot: 30,
      section_type: "cross_sell",
      params: { limit: 8 },
      rule: null,
      scope: "global",
      scope_ref: null,
      ttl_hours: 168,
      rationale,
    } as never),
  );
  return results;
}

export async function runSeedPipeline(args: {
  worldSeed: number;
  spec: WorldSpec;
  mode: AgentMode;
  /** A/A: ambos brazos congelados (mode se fuerza a none). */
  aa?: boolean;
  llmRunner?: LlmFrontierRunner;
  log?: (s: string) => void;
}): Promise<SeedRunResult> {
  const log = args.log ?? (() => {});
  const mode: AgentMode = args.aa ? "none" : args.mode;
  if (mode === "llm" && !args.llmRunner) throw new Error("mode=llm requires llmRunner");

  const world = buildWorld(args.worldSeed, args.spec);
  const epochsTotal = world.epochsTotal;
  const lastEpoch = epochsTotal - 1;

  const frozenStore = new SimPlacementStore((args.worldSeed ^ 0x0f0f0f) >>> 0);
  const agentStore = new SimPlacementStore((args.worldSeed ^ 0x3c3c3c) >>> 0);
  seedFrozenConfig(frozenStore);
  const frozenIds = new Set(seedFrozenConfig(agentStore));
  const frozen = makeArm("frozen", frozenStore);
  const agent = makeArm("agent", agentStore);
  const arms: ArmState[] = [frozen, agent];

  // ── e0: warmup orgánico compartido (fuera del gate). ──
  const out0 = sampleBehavior(world.epochView(0), baseOpts(world, 0), world.complements(0));
  for (const arm of arms) ingestEpoch({ arm, out: out0, exposures: null, world, epoch: 0 });
  log(`  e0 orgánica: events=${out0.events.length}`);

  // ── e1: baseline congelada bit-idéntica compartida (fuera del gate). ──
  {
    const t = 1;
    const artifacts = runEpochCrons(frozen.log, t);
    const userState = buildUserState(frozen.log, t, world);
    const rows = frozenStore.selectableRows(epochStart(t));
    // holdoutRows = rows: composición idéntica en e1; solo cambia la etiqueta
    const armPolicy = makeArmJourneyPolicy({ rows, holdoutRows: rows, artifacts, userState, world, epoch: t });
    const out1 = sampleBehavior(
      world.epochView(t),
      { ...baseOpts(world, t), journeyPolicy: armPolicy.policy },
      world.complements(t),
    );
    assertNoInactiveEvents(out1, world, t);
    // brazo agente: etiquetas holdout reales del journey; brazo frozen: todo
    // default (composición idéntica en e1 ⇒ misma simulación, solo re-etiqueta).
    ingestEpoch({ arm: agent, out: out1, exposures: null, world, epoch: t });
    const frozenOut1: BehaviorOutput = {
      ...out1,
      journeyExposures: (out1.journeyExposures ?? []).map((e) => ({ ...e, policyArm: "default" })),
    };
    ingestEpoch({ arm: frozen, out: frozenOut1, exposures: null, world, epoch: t });
    log(`  e1 congelada: events=${out1.events.length}`);
  }

  // ── Épocas medidas. ──
  const frontiers: FrontierRecord[] = [];
  for (let t = MEASURED_EPOCH_START; t <= lastEpoch; t++) {
    const artifactsByArm = new Map<ArmState, ArmArtifacts>(
      arms.map((arm) => [arm, runEpochCrons(arm.log, t)]),
    );

    // Frontera del agente (solo brazo agente, antes de simular t).
    if (mode !== "none") {
      const backend = simMerchandiserBackend({
        arm: agent,
        world,
        epoch: t,
        artifacts: artifactsByArm.get(agent)!,
        mediumAutoapply: true, // política gateada (2.B.5)
      });
      const storeBefore = agentStore.diffHash();
      let proposals: ProposalResult[] = [];
      let truncated = false;
      let cached = false;
      if (mode === "scripted") {
        proposals = await runScriptedAgent(backend);
      } else {
        const metricsJson = await backend.readMetrics({ window_days: 7 });
        const r = await args.llmRunner!({ backend, seed: args.worldSeed, epoch: t, metricsJson });
        proposals = r.proposals;
        truncated = r.truncated;
        cached = r.cached;
      }
      world.assertUnchanged(); // anti-trampa #9: el agente solo escribe en el store
      frontiers.push({
        epoch: t,
        proposals,
        cached,
        truncated,
        storeChanged: agentStore.diffHash() !== storeBefore,
      });
      log(
        `  e${t} frontera: ${proposals.length} propuestas (${proposals.filter((p) => p.accepted).length} aceptadas)${cached ? " [cache]" : ""}`,
      );
    }

    for (const arm of arms) {
      const artifacts = artifactsByArm.get(arm)!;
      const userState = buildUserState(arm.log, t, world);
      const rows = arm.store.selectableRows(epochStart(t));
      const holdoutRows =
        arm === agent && !args.aa && mode !== "none"
          ? rows.filter((r) => frozenIds.has(r.placement_id))
          : null;
      const armPolicy = makeArmJourneyPolicy({ rows, holdoutRows, artifacts, userState, world, epoch: t });
      const out = sampleBehavior(
        world.epochView(t),
        { ...baseOpts(world, t), journeyPolicy: armPolicy.policy },
        world.complements(t),
      );
      assertNoInactiveEvents(out, world, t);
      ingestEpoch({ arm, out, exposures: null, world, epoch: t });
    }
    log(`  e${t} simulada`);
  }

  // ── Veredicto del seed: margen realizado épocas medidas (2..N). ──
  const frozenMargin = realizedMarginCents(frozen, MEASURED_EPOCH_START, lastEpoch);
  const agentMargin = realizedMarginCents(agent, MEASURED_EPOCH_START, lastEpoch);
  const frozenTraj = marginByEpoch(frozen, epochsTotal);
  const agentTraj = marginByEpoch(agent, epochsTotal);

  // Sanity del mundo (frozen, épocas medidas): heavy-tail + sin colapso >50%.
  const salesByProduct = new Map<string, number>();
  for (const p of frozen.log.purchases) {
    if (p.epoch < MEASURED_EPOCH_START) continue;
    salesByProduct.set(p.product_id, (salesByProduct.get(p.product_id) ?? 0) + 1);
  }
  const sales = [...salesByProduct.values()];
  // detector endurecido (Fase D H2): pares consecutivos desde e1 + frozen muerto
  const frozenCollapse = frozenCollapsed(frozenTraj, MEASURED_EPOCH_START, lastEpoch);

  return {
    seed: args.worldSeed,
    measuredEpochs: args.spec.measuredEpochs,
    agentMarginCents: Math.round(agentMargin),
    frozenMarginCents: Math.round(frozenMargin),
    ratio: agentMargin / Math.max(1, frozenMargin),
    agentGmvCents: gmvCents(agent, MEASURED_EPOCH_START, lastEpoch),
    frozenGmvCents: gmvCents(frozen, MEASURED_EPOCH_START, lastEpoch),
    trajectories: { frozen: frozenTraj, agent: agentTraj },
    sanity: { giniSales: gini(sales), top20Share: top20Share(sales), frozenCollapse },
    frontiers,
    ndjson: { frozen: ledgerToNdjson(frozen), agent: ledgerToNdjson(agent) },
  };
}
