import { createHash, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { applyPlacementWrite, pauseOwnPlacement } from "@/sectors/f-slate/write";
import { buildMetricsReport } from "@/sectors/g-agents/metrics/report";
import { fetchCatalogContext, sqlMetricsSource } from "@/sectors/g-agents/metrics/queries";
import {
  PlacementProposalSchema,
  effectiveRule,
  proposalSemanticReason,
  type PlacementProposal,
} from "@/sectors/g-agents/write/schema";
import { paramsReason } from "@/sectors/g-agents/write/params";
import { deriveEffectiveTier, isProtectedSlot, type EffectiveTier } from "@/sectors/g-agents/write/tier";
import {
  AGENT_CREATED_BY,
  AGENT_CREATED_BY_LIKE,
  COOLDOWN_HOURS,
  DAY_WRITE_CAP,
  LIVE_PER_SURFACE_CAP,
  LIVE_TOTAL_CAP,
  mediumAutoapply,
  proposalKey,
  runProposalCap,
} from "@/sectors/g-agents/write/caps";
import { PROD_MARGIN_PCT, type MerchandiserBackend, type ProposalResult } from "./backend";

/**
 * Backend de producción del merchandiser (blueprint §4.8). proposeWrite NUNCA
 * lanza: cada rechazo es {accepted:false, reason} legible para que el LLM
 * reformule (una excepción rompería el loop). dryRun ejecuta TODO el pipeline
 * (validación→caps→tier→mapping) y se detiene justo antes del INSERT — el
 * dry-run ejercita el código real, no una rama paralela.
 */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function pgMerchandiserBackend(
  pg: Client,
  opts: { dryRun?: boolean; now?: () => Date; runId?: string } = {},
): MerchandiserBackend {
  const now = opts.now ?? (() => new Date());
  const dryRun = opts.dryRun ?? false;
  const runId = opts.runId ?? `agent-run-${now().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;

  // estado POR RUN: contador de caps + hash del último report servido (audit)
  let acceptedCount = 0;
  let lastMetricsHash: string | null = null;

  async function countRows(sql: string, params: unknown[]): Promise<number> {
    const r = await pg.query(sql, params);
    return Number((r.rows[0] as { n: string | number }).n);
  }

  async function capReason(p: PlacementProposal): Promise<string | null> {
    if (acceptedCount >= runProposalCap()) {
      return `run cap reached (${runProposalCap()} proposals/run)`;
    }
    if (p.action === "pause_own") return null; // UPDATE: no consume caps de INSERT
    const ts = now();
    const dayWrites = await countRows(
      `SELECT count(*) AS n FROM ui_placements
       WHERE created_by LIKE $1 AND created_at > $2::timestamptz - interval '24 hours'`,
      [AGENT_CREATED_BY_LIKE, ts],
    );
    if (dayWrites >= DAY_WRITE_CAP) return `daily write cap reached (${DAY_WRITE_CAP}/24h)`;
    if (p.action === "request_pause") return null; // no añade filas vivas ni toca slots propios
    const liveSurface = await countRows(
      `SELECT count(*) AS n FROM ui_placements
       WHERE created_by LIKE $1 AND status = 'approved'
         AND (ttl_until IS NULL OR ttl_until > $2::timestamptz) AND surface = $3`,
      [AGENT_CREATED_BY_LIKE, ts, p.surface],
    );
    if (liveSurface >= LIVE_PER_SURFACE_CAP) {
      return `live cap reached for ${p.surface} (${LIVE_PER_SURFACE_CAP} agent rows)`;
    }
    const liveTotal = await countRows(
      `SELECT count(*) AS n FROM ui_placements
       WHERE created_by LIKE $1 AND status = 'approved'
         AND (ttl_until IS NULL OR ttl_until > $2::timestamptz)`,
      [AGENT_CREATED_BY_LIKE, ts],
    );
    if (liveTotal >= LIVE_TOTAL_CAP) return `total live cap reached (${LIVE_TOTAL_CAP} agent rows)`;
    const cooldown = await countRows(
      `SELECT count(*) AS n FROM ui_placements
       WHERE created_by LIKE $1 AND surface = $2 AND slot = $3
         AND updated_at > $4::timestamptz - interval '${COOLDOWN_HOURS} hours'`,
      [AGENT_CREATED_BY_LIKE, p.surface, p.slot, ts],
    );
    if (cooldown > 0) return `cooldown: agent already touched ${p.surface}:${p.slot} <${COOLDOWN_HOURS}h ago`;
    return null;
  }

  function mapTier(
    tier: EffectiveTier,
    ttlHours: number,
  ): { status: "approved" | "pending"; ttl_until: Date | null; experiment_id: string | null } {
    if (tier === "low") {
      return { status: "approved", ttl_until: new Date(now().getTime() + ttlHours * 3_600_000), experiment_id: null };
    }
    if (tier === "medium" && mediumAutoapply()) {
      return { status: "approved", ttl_until: new Date(now().getTime() + ttlHours * 3_600_000), experiment_id: runId };
    }
    return { status: "pending", ttl_until: null, experiment_id: null }; // high SIEMPRE; medium sin env
  }

  async function proposeCreateOrSupersede(
    p: Extract<PlacementProposal, { action: "create" | "supersede" }>,
  ): Promise<ProposalResult> {
    const base: ProposalResult = { accepted: false, action: p.action, surface: p.surface, slot: p.slot };
    const semantic = proposalSemanticReason(p);
    if (semantic) return { ...base, reason: semantic };
    const badParams = paramsReason(p.section_type, p.params);
    if (badParams) return { ...base, reason: badParams };
    const capped = await capReason(p);
    if (capped) return { ...base, reason: capped };

    const ts = now();
    const nonAgent = await countRows(
      `SELECT count(*) AS n FROM ui_placements
       WHERE surface = $1 AND slot = $2 AND status IN ('approved', 'pending')
         AND created_by NOT LIKE $3`,
      [p.surface, p.slot, AGENT_CREATED_BY_LIKE],
    );
    const tier = deriveEffectiveTier(p, {
      slotHasNonAgentRow: nonAgent > 0,
      isProtectedSlot: isProtectedSlot(p.surface, p.slot),
    });
    const mapped = mapTier(tier, p.ttl_hours);

    let supersedes: string | null = null;
    if (p.action === "supersede") {
      const r = await pg.query(
        `SELECT id::text FROM ui_placements
         WHERE surface = $1 AND slot = $2 AND status = 'approved'
           AND (ttl_until IS NULL OR ttl_until > $3::timestamptz)
         ORDER BY version DESC LIMIT 1`,
        [p.surface, p.slot, ts],
      );
      supersedes = (r.rows[0] as { id: string } | undefined)?.id ?? null;
    }

    const key = proposalKey({
      surface: p.surface,
      slot: p.slot,
      action: p.action,
      target: p.section_type,
      day: ts.toISOString().slice(0, 10),
    });
    if (dryRun) {
      return { ...base, accepted: true, effective_tier: tier, status: mapped.status, reason: "dry-run" };
    }
    const w = await applyPlacementWrite(
      {
        surface: p.surface,
        slot: p.slot,
        section_type: p.section_type,
        params: p.params,
        rule: effectiveRule(p),
        scope: p.scope,
        scope_ref: p.scope_ref,
        status: mapped.status,
        risk_tier: tier,
        experiment_id: mapped.experiment_id,
        ttl_until: mapped.ttl_until,
        created_by: AGENT_CREATED_BY,
        proposal_key: key,
        proposal_meta: {
          rationale: p.rationale,
          run_id: runId,
          action: p.action,
          ...(supersedes ? { supersedes } : {}),
          metrics_hash: lastMetricsHash,
        },
      },
      pg,
    );
    if (!w.ok) return { ...base, reason: w.reason };
    acceptedCount += 1;
    return { ...base, accepted: true, placement_id: w.placement_id, effective_tier: tier, status: mapped.status };
  }

  async function proposePauseOwn(
    p: Extract<PlacementProposal, { action: "pause_own" }>,
  ): Promise<ProposalResult> {
    const base: ProposalResult = { accepted: false, action: p.action, placement_id: p.placement_id };
    const capped = await capReason(p);
    if (capped) return { ...base, reason: capped };
    const tier = deriveEffectiveTier(p, { slotHasNonAgentRow: false, isProtectedSlot: false });
    if (dryRun) {
      const r = await pg.query(
        `SELECT count(*) AS n FROM ui_placements
         WHERE id = $1 AND created_by LIKE $2 AND status IN ('approved', 'pending')`,
        [p.placement_id, AGENT_CREATED_BY_LIKE],
      );
      if (Number((r.rows[0] as { n: string }).n) === 0) {
        return { ...base, reason: "placement not found, not yours, or not pausable" };
      }
      return { ...base, accepted: true, effective_tier: tier, status: "paused", reason: "dry-run" };
    }
    const w = await pauseOwnPlacement(
      { placement_id: p.placement_id, created_by_like: AGENT_CREATED_BY_LIKE },
      pg,
    );
    if (!w.ok) return { ...base, reason: w.reason };
    acceptedCount += 1;
    return { ...base, accepted: true, effective_tier: tier, status: "paused" };
  }

  async function proposeRequestPause(
    p: Extract<PlacementProposal, { action: "request_pause" }>,
  ): Promise<ProposalResult> {
    const base: ProposalResult = { accepted: false, action: p.action };
    const capped = await capReason(p);
    if (capped) return { ...base, reason: capped };
    const r = await pg.query(
      `SELECT surface, slot, section_type, status FROM ui_placements WHERE id = $1`,
      [p.target_placement_id],
    );
    const target = r.rows[0] as
      | { surface: "home" | "pdp" | "cart" | "search"; slot: number; section_type: string; status: string }
      | undefined;
    if (!target) return { ...base, reason: "target placement not found" };
    if (target.status === "killed" || target.status === "archived" || target.status === "paused") {
      return { ...base, reason: `target already ${target.status}` };
    }
    const tier = deriveEffectiveTier(p, { slotHasNonAgentRow: false, isProtectedSlot: false });
    const ts = now();
    if (dryRun) {
      return { ...base, accepted: true, surface: target.surface, slot: target.slot, effective_tier: tier, status: "pending", reason: "dry-run" };
    }
    // fila pending = work item para el humano (proposal_meta.action), no un
    // placement a aprobar tal cual; el endpoint de aprobación ejecuta la pausa.
    const w = await applyPlacementWrite(
      {
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
      },
      pg,
    );
    if (!w.ok) return { ...base, reason: w.reason };
    acceptedCount += 1;
    return { ...base, accepted: true, surface: target.surface, slot: target.slot, placement_id: w.placement_id, effective_tier: tier, status: "pending" };
  }

  return {
    runId,
    dryRun,

    async readMetrics(input) {
      const report = await buildMetricsReport(sqlMetricsSource(pg, { now }), {
        surface: input.surface,
        windowDays: input.window_days,
        now,
      });
      const json = JSON.stringify(report);
      lastMetricsHash = sha256(json);
      return json;
    },

    async readCatalog(input) {
      const ts = now();
      const r = await pg.query(
        `SELECT p.id::text AS product_id, p.title,
                COALESCE(p.metadata->>'category','uncategorized') AS category,
                p.price_cents, p.is_active,
                floor(extract(epoch FROM ($3::timestamptz - p.created_at))/86400)::int AS age_days,
                COALESCE(pp.events_7d,0) AS events_7d, COALESCE(pp.views_7d,0) AS views_7d,
                COALESCE(pp.purchases_7d,0) AS purchases_7d
         FROM products p
         LEFT JOIN product_popularity_7d pp ON pp.product_id = p.id
         WHERE p.is_active AND ($1::text IS NULL OR p.metadata->>'category' = $1)
         ORDER BY COALESCE(pp.events_7d,0) DESC
         LIMIT $2`,
        [input.category ?? null, input.limit, ts],
      );
      const products = (r.rows as Record<string, unknown>[]).map((row) => ({
        ...row,
        margin_pct: PROD_MARGIN_PCT,
      }));
      const categories = await fetchCatalogContext({ limit: 8 }, pg);
      return JSON.stringify({ products, categories });
    },

    async proposeWrite(input) {
      try {
        // re-parse defensivo: los llamadores scripted (harness C3) no pasan
        // por el parse del tool; un input malformado es rechazo, no throw.
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
        if (p.action === "pause_own") return await proposePauseOwn(p);
        if (p.action === "request_pause") return await proposeRequestPause(p);
        return await proposeCreateOrSupersede(p);
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
