// /api/admin/coupons — CRUD mínimo de cupones de campaña (los crea Yosvany).
// POST {code, pct, ends_at?, max_uses?} · PATCH {code, active}.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, requireAdmin } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";

const createSchema = z.object({
  code: z.string().min(3).max(24).transform((s) => s.trim().toUpperCase()),
  pct: z.number().int().min(1).max(90),
  ends_at: z.string().datetime().optional(),
  max_uses: z.number().int().min(1).optional(),
});
const patchSchema = z.object({ code: z.string().min(3).max(24), active: z.boolean() });

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
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", detail: parsed.error.issues }, { status: 400 });
  const { code, pct, ends_at, max_uses } = parsed.data;
  try {
    await withPg((pg) =>
      pg.query(
        `INSERT INTO coupons (code, pct, ends_at, max_uses) VALUES ($1, $2, $3, $4)`,
        [code, pct, ends_at ?? null, max_uses ?? null],
      ),
    );
  } catch {
    return NextResponse.json({ error: "duplicate_or_invalid" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, code });
}

export async function PATCH(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const r = await withPg((pg) =>
    pg.query(`UPDATE coupons SET active = $2 WHERE code = $1 RETURNING code`, [parsed.data.code.toUpperCase(), parsed.data.active]),
  );
  if (r.rows.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
