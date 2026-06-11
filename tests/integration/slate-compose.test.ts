import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { Client } from "pg";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { composePage } from "@/sectors/f-slate/compose";
import { invalidateSlateConfigCache } from "@/sectors/f-slate/config";
import { POST as slateResolvePOST } from "@/app/api/slate/resolve/route";

beforeEach(async () => {
  invalidateSlateConfigCache();
  await truncateTestTables([
    "ui_placements",
    "ui_sections",
    "products",
    "co_occurrence_top",
    "excluded_products",
    "slate_decisions",
    "session_vectors",
  ]);
});

async function seedSection(pg: Client, type: string, over: Record<string, unknown> = {}) {
  await pg.query(
    `INSERT INTO ui_sections (section_type, title_default, display, priority, min_items, budget_ms, default_params)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (section_type) DO NOTHING`,
    [
      type,
      (over.title as string) ?? `Sección ${type}`,
      over.display ?? "carousel",
      over.priority ?? 1,
      over.min_items ?? 2,
      over.budget_ms ?? 800,
      JSON.stringify(over.default_params ?? { limit: 6 }),
    ],
  );
}

async function seedPlacement(pg: Client, p: Record<string, unknown>) {
  const r = await pg.query(
    `INSERT INTO ui_placements (surface, slot, section_type, params, rule, scope, scope_ref, status, version, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, 'approved', $8, 'test')
     RETURNING id::text`,
    [
      p.surface,
      p.slot,
      p.section_type,
      JSON.stringify(p.params ?? {}),
      p.rule ? JSON.stringify(p.rule) : null,
      p.scope ?? "global",
      p.scope_ref ?? null,
      p.version ?? 1,
    ],
  );
  return r.rows[0].id as string;
}

async function seedProduct(pg: Client): Promise<string> {
  const r = await pg.query(
    `INSERT INTO products (source, source_product_id, title, description, price_cents, currency, metadata)
     VALUES ('test', $1, $2, '', 1500, 'USD', '{"category":"audio"}'::jsonb)
     RETURNING id::text`,
    [randomUUID(), `P-${randomUUID().slice(0, 8)}`],
  );
  return r.rows[0].id as string;
}

describe("composePage (D2)", () => {
  test("reglas filtran por contexto y la colisión de slot la gana la especificidad", async () => {
    await withTestDb(async (pg) => {
      await seedSection(pg, "cross_sell");
      await seedSection(pg, "popular");

      // slot 10: global vs segment — debe ganar segment.
      await seedPlacement(pg, { surface: "pdp", slot: 10, section_type: "cross_sell", version: 1 });
      const segmentId = await seedPlacement(pg, {
        surface: "pdp", slot: 10, section_type: "popular", scope: "segment", scope_ref: "seg-x", version: 1,
      });
      // slot 20: gated por regla que NO se cumple (cart vacío en PDP).
      await seedPlacement(pg, {
        surface: "pdp", slot: 20, section_type: "popular",
        rule: { field: "cart_item_count", op: "gte", value: 3 },
      });
      // slot 30: regla MALFORMADA → el load la descarta (fail-closed), no 500.
      await seedPlacement(pg, {
        surface: "pdp", slot: 30, section_type: "popular",
        rule: { field: "password", op: "eq", value: "x" },
      });

      const page = await composePage(
        { surface: "pdp", identity: { user_id: null, anonymous_id: randomUUID(), session_id: null } },
        pg,
      );
      expect(page.placements.map((p) => p.placement_id)).toEqual([segmentId]);
      expect(page.config_source).toBe("db");
    });
  });
});

describe("POST /api/slate/resolve (D3)", () => {
  test("cart add-ons: co-ocurrencia sobre el carrito, dedupe de exclusiones, min_items, hidratación", async () => {
    await withTestDb(async (pg) => {
      await seedSection(pg, "cart_addons", { min_items: 2 });
      await seedPlacement(pg, {
        surface: "cart", slot: 10, section_type: "cart_addons", params: { limit: 4 },
        rule: { field: "cart_item_count", op: "gte", value: 1 },
      });

      const anchor = await seedProduct(pg);
      const related = await Promise.all([seedProduct(pg), seedProduct(pg), seedProduct(pg)]);
      const excluded = related[2];
      for (let i = 0; i < related.length; i++) {
        await pg.query(
          `INSERT INTO co_occurrence_top (product_id, related_product_id, npmi_score, rank)
           VALUES ($1, $2, $3, $4)`,
          [anchor, related[i], 0.9 - i * 0.1, i + 1],
        );
      }
      const anon = randomUUID();
      await pg.query(
        `INSERT INTO excluded_products (anonymous_id, product_id, ttl_until)
         VALUES ($1, $2, now() + interval '1 day')`,
        [anon, excluded],
      );

      const req = new NextRequest("http://localhost:3000/api/slate/resolve", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `anonymous_id=${anon}; session_id=${randomUUID()}` },
        body: JSON.stringify({ surface: "cart", surface_args: { cart_product_ids: [anchor] } }),
      });
      const res = await slateResolvePOST(req);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        sections: { section_type: string; title: string; items: { id: string; price_cents: number }[] }[];
      };
      expect(body.sections).toHaveLength(1);
      const addons = body.sections[0];
      expect(addons.section_type).toBe("cart_addons");
      const ids = addons.items.map((x) => x.id);
      expect(ids).toEqual([related[0], related[1]]); // orden por rank; excluido fuera; ancla fuera
      expect(ids).not.toContain(excluded);
      expect(addons.items[0].price_cents).toBe(1500); // hidratado

      // Decisión registrada para atribución Fase 2:
      const dec = await pg.query(`SELECT surface, placements FROM slate_decisions`);
      expect(dec.rows).toHaveLength(1);
      expect(dec.rows[0].surface).toBe("cart");

      // Carrito vacío → la regla apaga la sección (la página no la lleva):
      invalidateSlateConfigCache();
      const reqEmpty = new NextRequest("http://localhost:3000/api/slate/resolve", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `anonymous_id=${anon}; session_id=${randomUUID()}` },
        body: JSON.stringify({ surface: "cart", surface_args: { cart_product_ids: [] } }),
      });
      const resEmpty = await slateResolvePOST(reqEmpty);
      const bodyEmpty = (await resEmpty.json()) as { sections: unknown[] };
      expect(bodyEmpty.sections).toHaveLength(0);
    });
  });

  test("pdp cross-sell por ancla; min_items sin cumplir ⇒ sección omitida (riesgo cero)", async () => {
    await withTestDb(async (pg) => {
      await seedSection(pg, "cross_sell", { min_items: 3 });
      await seedPlacement(pg, { surface: "pdp", slot: 10, section_type: "cross_sell", params: { limit: 8 } });

      const anchor = await seedProduct(pg);
      const only = await seedProduct(pg); // 1 relacionado < min_items 3
      await pg.query(
        `INSERT INTO co_occurrence_top (product_id, related_product_id, npmi_score, rank) VALUES ($1, $2, 0.8, 1)`,
        [anchor, only],
      );

      const req = new NextRequest("http://localhost:3000/api/slate/resolve", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `anonymous_id=${randomUUID()}; session_id=${randomUUID()}` },
        body: JSON.stringify({ surface: "pdp", surface_args: { pdp_product_id: anchor } }),
      });
      const res = await slateResolvePOST(req);
      const body = (await res.json()) as { sections: unknown[] };
      expect(body.sections).toHaveLength(0); // below_min ⇒ no se sirve nada a medias
    });
  });
});
