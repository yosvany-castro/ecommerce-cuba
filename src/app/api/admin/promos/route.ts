// /api/admin/promos — anuncios PROPIOS (sección 'promo' de ui_placements).
// POST {title, surfaces[], category?, products} · PATCH {id, status}.
// products = texto libre: se extraen todos los UUID (ids sueltos o links
// /products/<uuid> pegados uno por línea).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, requireAdmin } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";

const SURFACES = ["home", "search", "pdp", "cart"] as const;
// Slots terminados en 5: nunca chocan con semillas ni agente (múltiplos de 10)
// y quedan por delante de la sección automática siguiente.
const PROMO_SLOTS = [15, 25, 35, 45, 55, 65, 75, 85, 95];
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const createSchema = z.object({
  title: z.string().trim().min(2).max(60),
  surfaces: z.array(z.enum(SURFACES)).min(1),
  category: z.string().max(40).nullable().optional(),
  products: z.string().max(10_000),
});
const patchSchema = z.object({ id: z.uuid(), status: z.enum(["approved", "paused", "archived"]) });

async function guard(req: NextRequest): Promise<NextResponse | null> {
  const session = await getAuthUser();
  if (!session?.sub) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return null;
}

export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { title, surfaces, category, products } = parsed.data;
  const ids = [...new Set((products.match(UUID_RE) ?? []).map((s) => s.toLowerCase()))].slice(0, 30);
  if (ids.length === 0) return NextResponse.json({ error: "no_products" }, { status: 400 });

  return withPg(async (pg) => {
    const found = await pg.query(`SELECT id::text FROM products WHERE id = ANY($1::uuid[]) AND is_active = true`, [ids]);
    const ok = new Set((found.rows as { id: string }[]).map((r) => r.id));
    const productIds = ids.filter((id) => ok.has(id));
    if (productIds.length === 0) return NextResponse.json({ error: "no_products" }, { status: 400 });

    for (const surface of surfaces) {
      const used = await pg.query(
        `SELECT slot FROM ui_placements WHERE surface = $1 AND status IN ('approved', 'paused', 'pending')`,
        [surface],
      );
      const taken = new Set((used.rows as { slot: number }[]).map((r) => r.slot));
      const slot = PROMO_SLOTS.find((s) => !taken.has(s));
      if (slot === undefined) return NextResponse.json({ error: "no_free_slot", surface }, { status: 409 });
      // categoría: solo tiene sentido donde hay categoría de contexto (listado
      // o producto) — en home/carro la regla nunca pasaría y el anuncio no saldría.
      const rule = category && (surface === "search" || surface === "pdp") ? { field: "pdp_category", op: "eq", value: category } : null;
      await pg.query(
        `INSERT INTO ui_placements (surface, slot, section_type, params, rule, scope, status, risk_tier, created_by)
         VALUES ($1, $2, 'promo', $3::jsonb, $4::jsonb, 'global', 'approved', 'low', 'admin')`,
        [surface, slot, JSON.stringify({ title, product_ids: productIds }), rule ? JSON.stringify(rule) : null],
      );
    }
    return NextResponse.json({ ok: true, products: productIds.length, skipped: ids.length - productIds.length });
  });
}

export async function PATCH(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const r = await withPg((pg) =>
    pg.query(
      `UPDATE ui_placements SET status = $2, updated_at = now() WHERE id = $1 AND section_type = 'promo' RETURNING id`,
      [parsed.data.id, parsed.data.status],
    ),
  );
  if (r.rows.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
