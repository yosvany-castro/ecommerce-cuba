// GET /api/coupons/validate?code=X&subtotal_cents=N — validación de cupón para
// la UI del checkout (solo lectura; el cobro real re-valida y consume el uso
// server-side dentro de la tx del pedido). Requiere identidad de cookie (mismo
// patrón anti-abuso que revalidate).
import { NextRequest, NextResponse } from "next/server";
import { withPg } from "@/lib/db/helpers";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const anon = req.cookies.get("anonymous_id")?.value;
  if (!anon || !UUID_REGEX.test(anon)) return NextResponse.json({ error: "no_identity" }, { status: 400 });

  const code = (req.nextUrl.searchParams.get("code") ?? "").trim().toUpperCase().slice(0, 24);
  const subtotal = parseInt(req.nextUrl.searchParams.get("subtotal_cents") ?? "0", 10);
  if (!code || !Number.isFinite(subtotal) || subtotal <= 0) return NextResponse.json({ valid: false });

  const row = await withPg(async (pg) => {
    const r = await pg.query(
      `SELECT pct FROM coupons
       WHERE code = $1 AND active
         AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
         AND (max_uses IS NULL OR uses < max_uses)`,
      [code],
    );
    return r.rows[0] as { pct: number } | undefined;
  });
  if (!row) return NextResponse.json({ valid: false });
  return NextResponse.json({ valid: true, pct: row.pct, discount_cents: Math.round((subtotal * row.pct) / 100) });
}
