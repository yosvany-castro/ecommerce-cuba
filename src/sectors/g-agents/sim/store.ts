import { createHash } from "node:crypto";
import { makeRng, type Rng } from "@/thesis/data/rng";
import { validatePlacementWrite } from "@/sectors/f-slate/write";
import type { PlacementConfig, Surface } from "@/sectors/f-slate/config";
import type { Rule } from "@/sectors/f-slate/rules/types";
import { SIM_SECTION_META } from "./constants";

/**
 * ui_placements in-memory con la semántica EXACTA de prod (blueprint §5.5):
 * - validación de escritura = validatePlacementWrite REAL (f-slate/write.ts);
 * - version = MAX(misma surface+slot+scope)+1 (espejo del INSERT atómico);
 * - idempotencia proposal_key (espejo del unique parcial 0030);
 * - trigger killed irreversible replicado (0025:71-84) ⇒ resurrección lanza;
 * - filtro de servicio = status='approved' AND ttl vigente (config.ts:125).
 * diffHash() para el anti-trampa #9 del harness.
 */

export interface SimPlacementRow {
  id: string;
  surface: Surface;
  slot: number;
  section_type: string;
  params: Record<string, unknown>;
  rule: Rule | null;
  scope: "global" | "segment";
  scope_ref: string | null;
  status: "pending" | "approved" | "paused" | "archived" | "killed";
  risk_tier: string;
  experiment_id: string | null;
  ttl_until: Date | null;
  created_by: string;
  version: number;
  created_at: Date;
  updated_at: Date;
  proposal_key: string | null;
  proposal_meta: unknown;
}

export interface SimWriteResult {
  ok: boolean;
  placement_id?: string;
  reason?: string;
}

/** UUID v4 determinista desde el rng del store (ids estables ⇒ caché LLM estable). */
function uuidFromRng(rng: Rng): string {
  const hex = Array.from({ length: 32 }, () => rng.int(16).toString(16)).join("");
  const v = hex.slice(0, 12) + "4" + hex.slice(13);
  const variant = ["8", "9", "a", "b"][rng.int(4)];
  const full = v.slice(0, 16) + variant + v.slice(17);
  return `${full.slice(0, 8)}-${full.slice(8, 12)}-${full.slice(12, 16)}-${full.slice(16, 20)}-${full.slice(20, 32)}`;
}

export class SimPlacementStore {
  private rows = new Map<string, SimPlacementRow>();
  private keys = new Set<string>(); // proposal_key únicos
  private rng: Rng;

  constructor(idSeed: number) {
    this.rng = makeRng(idSeed >>> 0);
  }

  /** Siembra directa (config congelada 0026 / fixtures de test): sin validación. */
  seed(row: Omit<SimPlacementRow, "id"> & { id?: string }): string {
    const id = row.id ?? uuidFromRng(this.rng);
    this.rows.set(id, { ...row, id });
    if (row.proposal_key) this.keys.add(row.proposal_key);
    return id;
  }

  /** Espejo de applyPlacementWrite (validación real + version SQL + idempotencia). */
  insert(w: {
    surface: Surface;
    slot: number;
    section_type: string;
    params: Record<string, unknown>;
    rule: Rule | null;
    scope: "global" | "segment";
    scope_ref: string | null;
    status: "approved" | "pending";
    risk_tier: string;
    experiment_id: string | null;
    ttl_until: Date | null;
    created_by: string;
    proposal_key: string | null;
    proposal_meta: unknown;
    now: Date;
  }): SimWriteResult {
    const valid = validatePlacementWrite({
      surface: w.surface,
      slot: w.slot,
      section_type: w.section_type,
      params: w.params,
      rule: w.rule,
      scope: w.scope,
      scope_ref: w.scope_ref,
      status: w.status,
      risk_tier: w.risk_tier as "low" | "medium" | "high",
      experiment_id: w.experiment_id,
      ttl_until: w.ttl_until,
      created_by: w.created_by,
      proposal_key: w.proposal_key,
      proposal_meta: w.proposal_meta,
    });
    if (!valid.ok) return { ok: false, reason: valid.reason };
    if (w.proposal_key !== null && this.keys.has(w.proposal_key)) {
      return { ok: false, reason: "duplicate (proposal_key already written today)" };
    }
    let maxVersion = 0;
    for (const r of this.rows.values()) {
      if (r.surface === w.surface && r.slot === w.slot && r.scope === w.scope) {
        maxVersion = Math.max(maxVersion, r.version);
      }
    }
    const id = uuidFromRng(this.rng);
    this.rows.set(id, {
      id,
      surface: w.surface,
      slot: w.slot,
      section_type: w.section_type,
      params: w.params,
      rule: w.rule,
      scope: w.scope,
      scope_ref: w.scope_ref,
      status: w.status,
      risk_tier: w.risk_tier,
      experiment_id: w.experiment_id,
      ttl_until: w.ttl_until,
      created_by: w.created_by,
      version: maxVersion + 1,
      created_at: w.now,
      updated_at: w.now,
      proposal_key: w.proposal_key,
      proposal_meta: w.proposal_meta,
    });
    if (w.proposal_key !== null) this.keys.add(w.proposal_key);
    return { ok: true, placement_id: id };
  }

  /** Trigger 0025 replicado: killed es FINAL — cualquier resurrección lanza. */
  private setStatus(row: SimPlacementRow, status: SimPlacementRow["status"], now: Date): void {
    if (row.status === "killed" && status !== "killed") {
      throw new Error(`ui_placements: status=killed is irreversible (placement ${row.id})`);
    }
    row.status = status;
    row.updated_at = now;
  }

  /** Espejo de pauseOwnPlacement: 0 filas = rechazo legible, jamás throw. */
  pauseOwn(args: { placement_id: string; created_by_like: string; now: Date }): SimWriteResult {
    const row = this.rows.get(args.placement_id);
    const prefix = args.created_by_like.replace(/%$/, "");
    if (
      !row ||
      !row.created_by.startsWith(prefix) ||
      (row.status !== "approved" && row.status !== "pending")
    ) {
      return { ok: false, reason: "placement not found, not yours, or not pausable" };
    }
    this.setStatus(row, "paused", args.now);
    return { ok: true, placement_id: row.id };
  }

  /** Kill directo (tests / pánico): pasa por el trigger replicado. */
  kill(placement_id: string, now: Date): void {
    const row = this.rows.get(placement_id);
    if (row) this.setStatus(row, "killed", now);
  }

  /** Resurrección explícita (solo tests adversariales): debe lanzar via trigger. */
  updateStatus(placement_id: string, status: SimPlacementRow["status"], now: Date): void {
    const row = this.rows.get(placement_id);
    if (!row) return;
    this.setStatus(row, status, now);
  }

  /** Todas las filas (catálogo de métricas: incluye pending/paused/killed). */
  allRows(): SimPlacementRow[] {
    return [...this.rows.values()].map((r) => ({ ...r, params: { ...r.params } }));
  }

  getRow(id: string): SimPlacementRow | undefined {
    const r = this.rows.get(id);
    return r ? { ...r } : undefined;
  }

  /**
   * Filtro de servicio espejo de config.ts:123-126 + mapping a PlacementConfig
   * con los metadatos de sección del seed 0026 (claiming por prioridad y
   * min_items dependen de ellos).
   */
  selectableRows(simNow: Date): PlacementConfig[] {
    const out: PlacementConfig[] = [];
    for (const r of this.rows.values()) {
      if (r.status !== "approved") continue;
      if (r.ttl_until !== null && r.ttl_until.getTime() <= simNow.getTime()) continue;
      const meta = SIM_SECTION_META[r.section_type];
      if (!meta) continue; // espejo del JOIN ui_sections: sección desconocida no carga
      out.push({
        placement_id: r.id,
        surface: r.surface,
        slot: r.slot,
        section_type: r.section_type,
        params: { ...r.params },
        rule: r.rule,
        scope: r.scope,
        scope_ref: r.scope_ref,
        experiment_id: r.experiment_id,
        version: r.version,
        created_by: r.created_by,
        priority: meta.priority,
        min_items: meta.min_items,
        budget_ms: 1000,
        freshness_policy: "per_request",
        display: r.section_type === "hero_grid" ? "grid" : "carousel",
        title_default: r.section_type,
        title_template: null,
        default_params: { ...meta.default_params },
      });
    }
    return out.sort((a, b) => a.slot - b.slot || b.version - a.version);
  }

  /** Hash del estado completo: el harness verifica que el agente solo tocó esto. */
  diffHash(): string {
    const rows = [...this.rows.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => ({ ...r, ttl_until: r.ttl_until?.getTime() ?? null, created_at: r.created_at.getTime(), updated_at: r.updated_at.getTime() }));
    return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  }
}
