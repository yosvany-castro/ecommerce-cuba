import { describe, test, expect, beforeEach } from "vitest";
import type { Client } from "pg";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { composePage, type ComposedPage } from "@/sectors/f-slate/compose";
import { invalidateSlateConfigCache } from "@/sectors/f-slate/config";
import { pgMerchandiserBackend } from "@/sectors/g-agents/runtime/backend-pg";

/**
 * ATAQUE 3 (Fase D) — casos que agent-sovereignty.test.ts (C2) no cubre,
 * actualizados POST-REMEDIACIÓN: fija los guards de select.ts contra el
 * secuestro de slots protegidos (H1) y el desalojo de incumbentes vía cap
 * (H3). La frontera honesta queda documentada: filas no-agente por SQL
 * directo son superficie de admin humano, fuera del contrato de soberanía.
 */

const RATIONALE =
  "ctr_seen del placement cayó de 0.041 a 0.012 en la ventana 7d segun read_metrics, propongo ajuste.";

const IDENT = { user_id: null, anonymous_id: null, session_id: null };

const canon = (page: ComposedPage) =>
  JSON.stringify(
    page.placements.map(({ slot, section_type, version }) => ({ slot, section_type, version })),
  );

async function compose(pg: Client, surface: "home" | "pdp" | "cart" = "home"): Promise<ComposedPage> {
  invalidateSlateConfigCache();
  return composePage({ surface, identity: IDENT }, pg);
}

async function seedSections(pg: Client) {
  for (const [type, display, priority] of [
    ["hero_grid", "grid", 0],
    ["popular", "carousel", 1],
    ["cross_sell", "carousel", 1],
    ["cart_addons", "carousel", 1],
  ] as const) {
    await pg.query(
      `INSERT INTO ui_sections (section_type, title_default, display, priority, min_items, budget_ms, default_params)
       VALUES ($1, $2, $3, $4, 2, 800, '{"limit":6}'::jsonb)
       ON CONFLICT (section_type) DO NOTHING`,
      [type, `Sección ${type}`, display, priority],
    );
  }
}

async function seedHero(pg: Client) {
  await pg.query(
    `INSERT INTO ui_placements (surface, slot, section_type, params, scope, status, version, created_by)
     VALUES ('home', 10, 'hero_grid', '{"limit":20}'::jsonb, 'global', 'approved', 1, 'seed')`,
  );
}

beforeEach(async () => {
  invalidateSlateConfigCache();
  await truncateTestTables(["ui_placements", "ui_sections", "slate_decisions", "session_vectors"]);
});

describe("sovereignty adversarial (Fase D, post-remediación H1/H3)", () => {
  test("H1a REMEDIADO: fila AGENTE approved por SQL directo en slot protegido (version mayor) NO se sirve — el hero sobrevive", async () => {
    await withTestDb(async (pg) => {
      await seedSections(pg);
      await seedHero(pg);
      const baseline = canon(await compose(pg));

      // corrupción post-validación: el write-path (tier high ⇒ pending) regresó
      // y una fila agente quedó approved en home:10 con rule válida y version 2
      await pg.query(
        `INSERT INTO ui_placements (surface, slot, section_type, params, rule, scope, status, version, created_by)
         VALUES ('home', 10, 'popular', '{}'::jsonb, NULL, 'global', 'approved', 2, 'agent:merchandiser/v1')`,
      );

      const after = await compose(pg);
      expect(after.placements[0].section_type).toBe("hero_grid"); // guard de select.ts
      expect(canon(after)).toBe(baseline);
    });
  });

  test("H1b REMEDIADO: fila AGENTE scope=segment en slot protegido tampoco gana por rank — el hero sobrevive", async () => {
    await withTestDb(async (pg) => {
      await seedSections(pg);
      await seedHero(pg);
      const baseline = canon(await compose(pg));
      await pg.query(
        `INSERT INTO ui_placements (surface, slot, section_type, params, rule, scope, scope_ref, status, version, created_by)
         VALUES ('home', 10, 'popular', '{}'::jsonb, NULL, 'segment', 'cohort_x', 'approved', 1, 'agent:merchandiser/v1')`,
      );
      const after = await compose(pg);
      expect(after.placements[0].section_type).toBe("hero_grid");
      expect(canon(after)).toBe(baseline);
    });
  });

  test("frontera honesta: una fila NO-agente por SQL directo SÍ puede tomar el slot 10 (superficie de admin humano, fuera del contrato)", async () => {
    await withTestDb(async (pg) => {
      await seedSections(pg);
      await seedHero(pg);
      await pg.query(
        `INSERT INTO ui_placements (surface, slot, section_type, params, rule, scope, status, version, created_by)
         VALUES ('home', 10, 'popular', '{}'::jsonb, NULL, 'global', 'approved', 2, 'human-admin')`,
      );
      // un humano con acceso SQL puede cambiar el hero a propósito — eso no es
      // un agujero del agente; el guard distingue procedencia, no bloquea admins
      expect((await compose(pg)).placements[0].section_type).toBe("popular");
    });
  });

  test("CONTRASTE: el write-path del agente frena el secuestro (supersede home:10 ⇒ tier high ⇒ pending ⇒ invisible)", async () => {
    await withTestDb(async (pg) => {
      await seedSections(pg);
      await seedHero(pg);
      const baseline = canon(await compose(pg));

      const backend = pgMerchandiserBackend(pg);
      const r = await backend.proposeWrite({
        action: "supersede", surface: "home", slot: 10, section_type: "popular",
        params: {}, rule: null, scope: "global", scope_ref: null, ttl_hours: 72,
        rationale: RATIONALE,
      });
      expect(r.accepted).toBe(true);
      expect(r.effective_tier).toBe("high");
      expect(r.status).toBe("pending");
      expect(canon(await compose(pg))).toBe(baseline);
    });
  });

  test("fila agente approved con TTL EXPIRADO no se sirve (rollback del loader)", async () => {
    await withTestDb(async (pg) => {
      await seedSections(pg);
      await seedHero(pg);
      const baseline = canon(await compose(pg));

      await pg.query(
        `INSERT INTO ui_placements (surface, slot, section_type, params, scope, status, version, created_by, ttl_until)
         VALUES ('home', 20, 'popular', '{}'::jsonb, 'global', 'approved', 1, 'agent:merchandiser/v1',
                 now() - interval '1 hour')`,
      );
      expect(canon(await compose(pg))).toBe(baseline);
    });
  });

  test("H2 REMEDIADO: create scope=segment auto-aplicado lleva session_cohort inyectada en la rule — fail-closed para sesiones sin cohorte", async () => {
    await withTestDb(async (pg) => {
      await seedSections(pg);
      await seedHero(pg);
      const baseline = canon(await compose(pg));
      process.env.AGENT_MEDIUM_AUTOAPPLY = "true"; // política gateada (2.B.5)
      try {
        const backend = pgMerchandiserBackend(pg);
        const r = await backend.proposeWrite({
          action: "create", surface: "home", slot: 20, section_type: "popular",
          params: {}, rule: null, scope: "segment", scope_ref: "femenino_joven", ttl_hours: 72,
          rationale: RATIONALE,
        });
        expect(r.accepted, r.reason).toBe(true);
        expect(r.effective_tier).toBe("medium");
        expect(r.status).toBe("approved");
        const row = await pg.query(`SELECT rule FROM ui_placements WHERE id = $1`, [r.placement_id]);
        // el blast radius de segment es la cohorte DE VERDAD, no global
        expect(row.rows[0].rule).toEqual({ field: "session_cohort", op: "eq", value: "femenino_joven" });
        expect(canon(await compose(pg))).toBe(baseline); // sesión sin cohorte no la ve
      } finally {
        delete process.env.AGENT_MEDIUM_AUTOAPPLY;
      }
    });
  });

  test("H3 REMEDIADO: superficie al cap de 8 filas no-agente + create LEGAL del agente ⇒ cae la fila del AGENTE, jamás el incumbente", async () => {
    await withTestDb(async (pg) => {
      await seedSections(pg);
      // 8 placements no-agente — superficie llena al cap exacto; slot 20 libre.
      const humanSlots = [10, 30, 40, 50, 60, 70, 80, 90];
      for (const slot of humanSlots) {
        await pg.query(
          `INSERT INTO ui_placements (surface, slot, section_type, params, scope, status, version, created_by)
           VALUES ('home', $1, 'popular', '{}'::jsonb, 'global', 'approved', 1, 'human-admin')`,
          [slot],
        );
      }
      expect((await compose(pg)).placements.map((p) => p.slot)).toEqual(humanSlots);

      // escritura 100% legal del agente por el backend de producción:
      const backend = pgMerchandiserBackend(pg);
      const r = await backend.proposeWrite({
        action: "create", surface: "home", slot: 20, section_type: "popular",
        params: {}, rule: null, scope: "global", scope_ref: null, ttl_hours: 72,
        rationale: RATIONALE,
      });
      expect(r.accepted, r.reason).toBe(true);
      expect(r.effective_tier).toBe("low");
      expect(r.status).toBe("approved");

      // sobre el cap cae primero la fila del agente: la página no cambia
      expect((await compose(pg)).placements.map((p) => p.slot)).toEqual(humanSlots);

      // con hueco (la fila humana del 90 se pausa), la fila agente SÍ sirve
      await pg.query(`UPDATE ui_placements SET status = 'paused' WHERE slot = 90`);
      expect((await compose(pg)).placements.map((p) => p.slot)).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
    });
  });
});
