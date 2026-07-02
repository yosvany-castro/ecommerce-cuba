import { describe, test, expect, beforeEach } from "vitest";
import type { Client } from "pg";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { composePage, type ComposedPage } from "@/sectors/f-slate/compose";
import { invalidateSlateConfigCache } from "@/sectors/f-slate/config";
import { applyPlacementWrite } from "@/sectors/f-slate/write";
import { pgMerchandiserBackend } from "@/sectors/g-agents/runtime/backend-pg";

/**
 * Soberanía del motor (A5 §5): nada que el agente pueda escribir cambia la
 * página sin aprobación — y nada que escriba a medias la rompe. Cruza las 3
 * capas reales que un mock taparía: el WHERE status='approved' del loader, el
 * trigger killed de Postgres y el caché module-global (invalidado entre
 * fases).
 */

const RATIONALE =
  "ctr_seen del placement abc cayó de 0.041 a 0.012 en la ventana 7d segun read_metrics.";

// excluye composition_id (randomUUID por request) y config_version (bump por refresh)
const canon = (page: ComposedPage) =>
  JSON.stringify(
    page.placements.map(({ placement_id, slot, section_type, params, version }) => ({
      placement_id,
      slot,
      section_type,
      params,
      version,
    })),
  );

const IDENT = { user_id: null, anonymous_id: null, session_id: null };

async function composeAll(pg: Client): Promise<string> {
  invalidateSlateConfigCache();
  const home = await composePage({ surface: "home", identity: IDENT }, pg);
  const pdp = await composePage({ surface: "pdp", identity: IDENT }, pg);
  const cart = await composePage({ surface: "cart", identity: IDENT }, pg);
  return canon(home) + canon(pdp) + canon(cart);
}

async function seedBaseline(pg: Client): Promise<{ heroId: string }> {
  for (const [type, display] of [
    ["hero_grid", "grid"],
    ["cross_sell", "carousel"],
    ["cart_addons", "carousel"],
    ["popular", "carousel"],
  ] as const) {
    await pg.query(
      `INSERT INTO ui_sections (section_type, title_default, display, priority, min_items, budget_ms, default_params)
       VALUES ($1, $2, $3, 1, 2, 800, '{"limit":6}'::jsonb)
       ON CONFLICT (section_type) DO NOTHING`,
      [type, `Sección ${type}`, display],
    );
  }
  let heroId = "";
  for (const [surface, type] of [
    ["home", "hero_grid"],
    ["pdp", "cross_sell"],
    ["cart", "cart_addons"],
  ] as const) {
    const r = await pg.query(
      `INSERT INTO ui_placements (surface, slot, section_type, params, scope, status, version, created_by)
       VALUES ($1, 10, $2, '{"limit":10}'::jsonb, 'global', 'approved', 1, 'test')
       RETURNING id::text`,
      [surface, type],
    );
    if (surface === "home") heroId = (r.rows[0] as { id: string }).id;
  }
  return { heroId };
}

beforeEach(async () => {
  invalidateSlateConfigCache();
  await truncateTestTables(["ui_placements", "ui_sections", "slate_decisions", "session_vectors"]);
});

describe("agent sovereignty (C2)", () => {
  test("(b1) crash a mitad de batch: la propuesta pending escrita no cambia la página", async () => {
    await withTestDb(async (pg) => {
      await seedBaseline(pg);
      const baseline = await composeAll(pg);

      // 1 de 3 propuestas escrita antes del crash — quedó pending
      const w = await applyPlacementWrite(
        {
          surface: "home",
          slot: 20,
          section_type: "popular",
          params: { limit: 10 },
          rule: null,
          scope: "global",
          scope_ref: null,
          status: "pending",
          risk_tier: "medium",
          experiment_id: null,
          ttl_until: null,
          created_by: "agent:merchandiser/v1",
          proposal_key: "test-key-b1",
          proposal_meta: { rationale: RATIONALE },
        },
        pg,
      );
      expect(w.ok).toBe(true);

      expect(await composeAll(pg)).toBe(baseline);
    });
  });

  test("(b2) fila basura approved con rule inválida: descartada al load, composePage no lanza", async () => {
    await withTestDb(async (pg) => {
      await seedBaseline(pg);
      const baseline = await composeAll(pg);

      // INSERT directo saltándose la validación a propósito (post-validación corrupta)
      await pg.query(
        `INSERT INTO ui_placements (surface, slot, section_type, params, rule, scope, status, version, created_by)
         VALUES ('home', 30, 'popular', '{}'::jsonb, '{"field":"hacked","op":"eq"}'::jsonb,
                 'global', 'approved', 1, 'agent:merchandiser/v1')`,
      );

      expect(await composeAll(pg)).toBe(baseline); // red 2: skip con warn, jamás throw
    });
  });

  test("(c) propuestas high reales del backend quedan pending e invisibles", async () => {
    await withTestDb(async (pg) => {
      const { heroId } = await seedBaseline(pg);
      const baseline = await composeAll(pg);

      const backend = pgMerchandiserBackend(pg);
      const results = [
        await backend.proposeWrite({
          action: "supersede", surface: "home", slot: 10, section_type: "popular",
          params: {}, rule: null, scope: "global", scope_ref: null, ttl_hours: 72,
          rationale: RATIONALE,
        }),
        await backend.proposeWrite({
          action: "supersede", surface: "pdp", slot: 10, section_type: "popular",
          params: {}, rule: null, scope: "global", scope_ref: null, ttl_hours: 72,
          rationale: RATIONALE,
        }),
        await backend.proposeWrite({
          action: "supersede", surface: "cart", slot: 10, section_type: "cart_addons",
          params: {}, rule: null, scope: "global", scope_ref: null, ttl_hours: 72,
          rationale: RATIONALE,
        }),
        await backend.proposeWrite({
          action: "request_pause", target_placement_id: heroId, rationale: RATIONALE,
        }),
      ];
      for (const r of results) {
        expect(r.accepted, r.reason).toBe(true);
        expect(r.effective_tier).toBe("high"); // slots seed/protegidos + tocar lo humano
        expect(r.status).toBe("pending");
      }

      expect(await composeAll(pg)).toBe(baseline);
      // verificación negativa: existen pero no sirven
      const n = await pg.query(
        `SELECT count(*) AS n FROM ui_placements WHERE status = 'pending' AND created_by LIKE 'agent:%'`,
      );
      expect(Number((n.rows[0] as { n: string }).n)).toBe(4);
    });
  });

  test("(d) killed es irreversible: el trigger lanza ante la resurrección", async () => {
    await withTestDb(async (pg) => {
      await seedBaseline(pg);
      const r = await pg.query(
        `INSERT INTO ui_placements (surface, slot, section_type, params, scope, status, version, created_by)
         VALUES ('home', 40, 'popular', '{}'::jsonb, 'global', 'killed', 1, 'agent:merchandiser/v1')
         RETURNING id`,
      );
      await expect(
        pg.query(`UPDATE ui_placements SET status = 'approved' WHERE id = $1`, [r.rows[0].id]),
      ).rejects.toThrow(/irreversible/);
    });
  });
});
