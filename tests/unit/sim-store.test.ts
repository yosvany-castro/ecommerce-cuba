import { describe, test, expect } from "vitest";
import { SimPlacementStore } from "@/sectors/g-agents/sim/store";
import { selectPlacements } from "@/sectors/f-slate/select";
import type { SlateRuleContext } from "@/sectors/f-slate/rules/types";
import { epochStart } from "@/sectors/g-agents/sim/constants";

/**
 * Semántica de config sim ≡ prod: killed irreversible (trigger 0025 replicado),
 * pending no se sirve, TTL expirado no se sirve (config.ts:125), y la colisión
 * de slot la resuelve LA MISMA selectPlacements de producción.
 */

const NOW = epochStart(2);

function seedRow(store: SimPlacementStore, over: Partial<Parameters<SimPlacementStore["seed"]>[0]> = {}) {
  return store.seed({
    surface: "home",
    slot: 20,
    section_type: "popular",
    params: { limit: 10 },
    rule: null,
    scope: "global",
    scope_ref: null,
    status: "approved",
    risk_tier: "low",
    experiment_id: null,
    ttl_until: null,
    created_by: "seed",
    version: 1,
    created_at: epochStart(0),
    updated_at: epochStart(0),
    proposal_key: null,
    proposal_meta: null,
    ...over,
  });
}

const ruleCtx: SlateRuleContext = {
  surface: "home",
  hour_of_day: 12,
  day_of_week: 3,
  is_logged_in: true,
  user_segment: null,
  session_cohort: "relojes",
  recipient_active: false,
  signal_window_size: 5,
  gift_confirmed: false,
  cart_item_count: 0,
  pdp_product_id: null,
  pdp_category: null,
};

describe("SimPlacementStore (espejo 0025/config.ts)", () => {
  test("killed es irreversible: la resurrección lanza (trigger replicado)", () => {
    const store = new SimPlacementStore(123);
    const id = seedRow(store);
    store.kill(id, NOW);
    expect(() => store.updateStatus(id, "approved", NOW)).toThrow(/irreversible/);
    // pauseOwn sobre killed: rechazo legible, no throw (espejo write.ts)
    expect(store.pauseOwn({ placement_id: id, created_by_like: "%", now: NOW }).ok).toBe(false);
  });

  test("pending no se sirve; TTL expirado no se sirve", () => {
    const store = new SimPlacementStore(123);
    const r = store.insert({
      surface: "home", slot: 30, section_type: "cross_sell", params: {}, rule: null,
      scope: "global", scope_ref: null, status: "pending", risk_tier: "high",
      experiment_id: null, ttl_until: null, created_by: "agent:merchandiser/v1",
      proposal_key: null, proposal_meta: null, now: NOW,
    });
    expect(r.ok).toBe(true);
    const expired = store.insert({
      surface: "home", slot: 40, section_type: "popular", params: {}, rule: null,
      scope: "global", scope_ref: null, status: "approved", risk_tier: "low",
      experiment_id: null, ttl_until: epochStart(2), created_by: "agent:merchandiser/v1",
      proposal_key: null, proposal_meta: null, now: epochStart(0),
    });
    expect(expired.ok).toBe(true);
    // en epochStart(2) el TTL=epochStart(2) ya NO es > simNow (espejo `ttl_until > now()`)
    expect(store.selectableRows(NOW)).toHaveLength(0);
    // antes de expirar sí se sirve (y la pending sigue invisible)
    const live = store.selectableRows(epochStart(1));
    expect(live.map((p) => p.slot)).toEqual([40]);
  });

  test("colisión de slot resuelve idéntico a selectPlacements real (version DESC, scope rank)", () => {
    const store = new SimPlacementStore(123);
    seedRow(store, { slot: 20, version: 1, section_type: "popular" });
    seedRow(store, { slot: 20, version: 2, section_type: "cross_sell" });
    seedRow(store, {
      slot: 20, version: 1, section_type: "popular",
      scope: "segment", scope_ref: "relojes",
    });
    const rows = store.selectableRows(NOW);
    const selected = selectPlacements(rows, ruleCtx);
    // segment (scope rank 2) gana a global aunque la global tenga version mayor
    expect(selected).toHaveLength(1);
    expect(selected[0].scope).toBe("segment");
    // sin la fila segment, gana la global de version más alta
    const globalsOnly = rows.filter((r) => r.scope === "global");
    const winner = selectPlacements(globalsOnly, ruleCtx);
    expect(winner).toHaveLength(1);
    expect(winner[0].version).toBe(2);
  });

  test("proposal_key duplicada ⇒ rechazo idempotente (espejo unique parcial 0030)", () => {
    const store = new SimPlacementStore(123);
    const w = {
      surface: "home" as const, slot: 50, section_type: "popular",
      params: {}, rule: null, scope: "global" as const, scope_ref: null,
      status: "approved" as const, risk_tier: "low", experiment_id: null,
      ttl_until: epochStart(4), created_by: "agent:merchandiser/v1",
      proposal_key: "k1", proposal_meta: null, now: NOW,
    };
    expect(store.insert(w).ok).toBe(true);
    const dup = store.insert(w);
    expect(dup.ok).toBe(false);
    expect(dup.reason).toMatch(/duplicate/);
  });
});
