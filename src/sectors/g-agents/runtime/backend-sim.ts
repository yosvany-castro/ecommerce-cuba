import { createHash } from "node:crypto";
import { buildMetricsReport } from "@/sectors/g-agents/metrics/report";
import {
  PlacementProposalSchema,
  proposalSemanticReason,
  type PlacementProposal,
} from "@/sectors/g-agents/write/schema";
import { paramsReason } from "@/sectors/g-agents/write/params";
import {
  deriveEffectiveTier,
  isProtectedSlot,
  type EffectiveTier,
} from "@/sectors/g-agents/write/tier";
import {
  AGENT_CREATED_BY,
  AGENT_CREATED_BY_LIKE,
  COOLDOWN_HOURS,
  DAY_WRITE_CAP,
  LIVE_PER_SURFACE_CAP,
  LIVE_TOTAL_CAP,
  proposalKey,
  runProposalCap,
} from "@/sectors/g-agents/write/caps";
import { epochStart, SIM_TTL_EPOCHS } from "@/sectors/g-agents/sim/constants";
import { simMetricsSource } from "@/sectors/g-agents/sim/sim-metrics-source";
import type { ArmArtifacts } from "@/sectors/g-agents/sim/crons";
import type { ArmState } from "@/sectors/g-agents/sim/ledger";
import type { World } from "@/sectors/g-agents/sim/world";
import type { Rule } from "@/sectors/f-slate/rules/types";
import type { Surface } from "@/sectors/f-slate/config";
import type { MerchandiserBackend, ProposalResult } from "./backend";

/**
 * Backend sim del merchandiser (blueprint §5.12): el agente REAL de C2 corre
 * con sus MISMAS tools contra el mundo simulado. MISMO pipeline que backend-pg
 * (schema→params→caps→deriveEffectiveTier→mapping tier→status) contra
 * sim/store.ts; los caps (5/run, 10/día, 3 vivas/surface, 12 totales,
 * cooldown 48h) aplican idénticos sobre el reloj simulado.
 *
 * AGENT_MEDIUM_AUTOAPPLY=true es la POLÍTICA GATEADA (decisión 2.B.5, fijada
 * antes del primer run del gate): se fija por opción del harness, no por env —
 * desplegar con otro valor invalida la transferencia del resultado (R8).
 * TTL: conversión SIM_TTL_EPOCHS (desviación sim↔prod nº4 declarada).
 */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const HOUR_MS = 3_600_000;

export function simMerchandiserBackend(args: {
  arm: ArmState;
  world: World;
  epoch: number;
  artifacts: ArmArtifacts;
  runId?: string;
  mediumAutoapply?: boolean;
}): MerchandiserBackend {
  const { arm, world, epoch, artifacts } = args;
  const mediumAutoapply = args.mediumAutoapply ?? true; // política gateada
  const now = () => epochStart(epoch);
  const runId = args.runId ?? `sim-run-${world.worldSeed}-e${epoch}`;
  const store = arm.store;

  let acceptedCount = 0;
  let lastMetricsHash: string | null = null;

  const agentRows = () =>
    store.allRows().filter((r) => r.created_by.startsWith(AGENT_CREATED_BY_LIKE.replace(/%$/, "")));

  function capReason(p: PlacementProposal): string | null {
    if (acceptedCount >= runProposalCap()) {
      return `run cap reached (${runProposalCap()} proposals/run)`;
    }
    if (p.action === "pause_own") return null;
    const ts = now().getTime();
    const rows = agentRows();
    const dayWrites = rows.filter((r) => r.created_at.getTime() > ts - 24 * HOUR_MS).length;
    if (dayWrites >= DAY_WRITE_CAP) return `daily write cap reached (${DAY_WRITE_CAP}/24h)`;
    if (p.action === "request_pause") return null;
    const live = rows.filter(
      (r) => r.status === "approved" && (r.ttl_until === null || r.ttl_until.getTime() > ts),
    );
    const liveSurface = live.filter((r) => r.surface === p.surface).length;
    if (liveSurface >= LIVE_PER_SURFACE_CAP) {
      return `live cap reached for ${p.surface} (${LIVE_PER_SURFACE_CAP} agent rows)`;
    }
    if (live.length >= LIVE_TOTAL_CAP) return `total live cap reached (${LIVE_TOTAL_CAP} agent rows)`;
    const cooldown = rows.some(
      (r) =>
        r.surface === p.surface &&
        r.slot === p.slot &&
        r.updated_at.getTime() > ts - COOLDOWN_HOURS * HOUR_MS,
    );
    if (cooldown) return `cooldown: agent already touched ${p.surface}:${p.slot} <${COOLDOWN_HOURS}h ago`;
    return null;
  }

  function mapTier(
    tier: EffectiveTier,
    ttlHours: number,
  ): { status: "approved" | "pending"; ttl_until: Date | null; experiment_id: string | null } {
    const ttl = epochStart(epoch + SIM_TTL_EPOCHS(ttlHours));
    if (tier === "low") return { status: "approved", ttl_until: ttl, experiment_id: null };
    if (tier === "medium" && mediumAutoapply) {
      return { status: "approved", ttl_until: ttl, experiment_id: runId };
    }
    return { status: "pending", ttl_until: null, experiment_id: null };
  }

  function proposeCreateOrSupersede(
    p: Extract<PlacementProposal, { action: "create" | "supersede" }>,
  ): ProposalResult {
    const base: ProposalResult = { accepted: false, action: p.action, surface: p.surface, slot: p.slot };
    const semantic = proposalSemanticReason(p);
    if (semantic) return { ...base, reason: semantic };
    const badParams = paramsReason(p.section_type, p.params);
    if (badParams) return { ...base, reason: badParams };
    const capped = capReason(p);
    if (capped) return { ...base, reason: capped };

    const ts = now();
    const nonAgent = store
      .allRows()
      .some(
        (r) =>
          r.surface === p.surface &&
          r.slot === p.slot &&
          (r.status === "approved" || r.status === "pending") &&
          !r.created_by.startsWith("agent:"),
      );
    const tier = deriveEffectiveTier(p, {
      slotHasNonAgentRow: nonAgent,
      isProtectedSlot: isProtectedSlot(p.surface, p.slot),
    });
    const mapped = mapTier(tier, p.ttl_hours);

    let supersedes: string | null = null;
    if (p.action === "supersede") {
      const live = store
        .allRows()
        .filter(
          (r) =>
            r.surface === p.surface &&
            r.slot === p.slot &&
            r.status === "approved" &&
            (r.ttl_until === null || r.ttl_until.getTime() > ts.getTime()),
        )
        .sort((a, b) => b.version - a.version);
      supersedes = live[0]?.id ?? null;
    }

    const key = proposalKey({
      surface: p.surface,
      slot: p.slot,
      action: p.action,
      target: p.section_type,
      day: ts.toISOString().slice(0, 10),
    });
    const w = store.insert({
      surface: p.surface as Surface,
      slot: p.slot,
      section_type: p.section_type,
      params: p.params,
      rule: p.rule as Rule | null,
      scope: p.scope,
      scope_ref: p.scope_ref,
      status: mapped.status,
      risk_tier: tier,
      experiment_id: mapped.experiment_id,
      ttl_until: mapped.status === "approved" ? mapped.ttl_until : null,
      created_by: AGENT_CREATED_BY,
      proposal_key: key,
      proposal_meta: {
        rationale: p.rationale,
        run_id: runId,
        action: p.action,
        ...(supersedes ? { supersedes } : {}),
        metrics_hash: lastMetricsHash,
      },
      now: ts,
    });
    if (!w.ok) return { ...base, reason: w.reason };
    acceptedCount += 1;
    return { ...base, accepted: true, placement_id: w.placement_id, effective_tier: tier, status: mapped.status };
  }

  function proposePauseOwn(
    p: Extract<PlacementProposal, { action: "pause_own" }>,
  ): ProposalResult {
    const base: ProposalResult = { accepted: false, action: p.action, placement_id: p.placement_id };
    const capped = capReason(p);
    if (capped) return { ...base, reason: capped };
    const tier = deriveEffectiveTier(p, { slotHasNonAgentRow: false, isProtectedSlot: false });
    const w = store.pauseOwn({
      placement_id: p.placement_id,
      created_by_like: AGENT_CREATED_BY_LIKE,
      now: now(),
    });
    if (!w.ok) return { ...base, reason: w.reason };
    acceptedCount += 1;
    return { ...base, accepted: true, effective_tier: tier, status: "paused" };
  }

  function proposeRequestPause(
    p: Extract<PlacementProposal, { action: "request_pause" }>,
  ): ProposalResult {
    const base: ProposalResult = { accepted: false, action: p.action };
    const capped = capReason(p);
    if (capped) return { ...base, reason: capped };
    const target = store.getRow(p.target_placement_id);
    if (!target) return { ...base, reason: "target placement not found" };
    if (target.status === "killed" || target.status === "archived" || target.status === "paused") {
      return { ...base, reason: `target already ${target.status}` };
    }
    const tier = deriveEffectiveTier(p, { slotHasNonAgentRow: false, isProtectedSlot: false });
    const ts = now();
    const w = store.insert({
      surface: target.surface,
      slot: target.slot,
      section_type: target.section_type,
      params: {},
      rule: null,
      scope: "global",
      scope_ref: null,
      status: "pending",
      risk_tier: tier,
      experiment_id: null,
      ttl_until: null,
      created_by: AGENT_CREATED_BY,
      proposal_key: proposalKey({
        surface: target.surface,
        slot: target.slot,
        action: p.action,
        target: p.target_placement_id,
        day: ts.toISOString().slice(0, 10),
      }),
      proposal_meta: {
        action: "pause_target",
        target_placement_id: p.target_placement_id,
        rationale: p.rationale,
        run_id: runId,
        metrics_hash: lastMetricsHash,
      },
      now: ts,
    });
    if (!w.ok) return { ...base, reason: w.reason };
    acceptedCount += 1;
    return { ...base, accepted: true, surface: target.surface, slot: target.slot, placement_id: w.placement_id, effective_tier: tier, status: "pending" };
  }

  return {
    runId,
    dryRun: false,

    async readMetrics(input) {
      const report = await buildMetricsReport(
        simMetricsSource({
          log: arm.log,
          placements: () => store.allRows(),
          categoryOf: world.categoryOf,
          now,
        }),
        { surface: input.surface, windowDays: input.window_days, now },
      );
      const json = JSON.stringify(report);
      lastMetricsHash = sha256(json);
      return json;
    },

    async readCatalog(input) {
      const active = world.activeIds(epoch);
      const pop = artifacts.popularity;
      // views/purchases de la última época observada (t-1), del log propio
      const views = new Map<string, number>();
      const buys = new Map<string, number>();
      for (const e of arm.log.events) {
        if (e.epoch !== epoch - 1) continue;
        if (e.event_type === "product_view") {
          views.set(e.product_id, (views.get(e.product_id) ?? 0) + 1);
        } else if (e.event_type === "purchase") {
          buys.set(e.product_id, (buys.get(e.product_id) ?? 0) + 1);
        }
      }
      const ids = [...active]
        .filter((id) => input.category === undefined || world.categoryOf(id) === input.category)
        .sort((a, b) => (pop.get(b) ?? 0) - (pop.get(a) ?? 0) || a.localeCompare(b))
        .slice(0, input.limit);
      const products = ids.map((id) => ({
        product_id: id,
        title: world.universe.find((p) => p.source_product_id === id)?.title ?? id,
        category: world.categoryOf(id) ?? "uncategorized",
        price_cents: world.priceAt(epoch, id),
        is_active: true,
        age_days: (epoch - world.launchEpochOf(id)) * 14,
        events_7d: pop.get(id) ?? 0,
        views_7d: views.get(id) ?? 0,
        purchases_7d: buys.get(id) ?? 0,
        margin_pct: world.marginOf(id), // visible per-product en el sim (2.C.5)
      }));
      const byCat = new Map<string, { events_7d: number; purchases_7d: number; products: number }>();
      for (const id of active) {
        const cat = world.categoryOf(id) ?? "uncategorized";
        const c = byCat.get(cat) ?? { events_7d: 0, purchases_7d: 0, products: 0 };
        c.events_7d += pop.get(id) ?? 0;
        c.purchases_7d += buys.get(id) ?? 0;
        c.products += 1;
        byCat.set(cat, c);
      }
      const categories = [...byCat.entries()]
        .map(([category, c]) => ({ category, ...c }))
        .sort((a, b) => b.events_7d - a.events_7d || a.category.localeCompare(b.category))
        .slice(0, 8);
      return JSON.stringify({ products, categories });
    },

    async proposeWrite(input) {
      try {
        const parsed = PlacementProposalSchema.safeParse(input);
        if (!parsed.success) {
          return {
            accepted: false,
            action: (input as { action?: string })?.action ?? "unknown",
            reason: `invalid proposal: ${parsed.error.issues
              .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
              .join("; ")}`,
          };
        }
        const p = parsed.data;
        if (p.action === "pause_own") return proposePauseOwn(p);
        if (p.action === "request_pause") return proposeRequestPause(p);
        return proposeCreateOrSupersede(p);
      } catch (e) {
        return {
          accepted: false,
          action: (input as { action?: string })?.action ?? "unknown",
          reason: `internal error: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    },
  };
}
