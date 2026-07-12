import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth0, requireAdmin } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bodySchema = z.object({ grams: z.number().int().min(1).max(100_000) });

// POST /api/admin/products/[id]/weight — retroalimentación de peso REAL:
// cuando llega el paquete y se pesa en báscula, este endpoint (patrón
// admin/searches: sesión → allowlist → zod → withPg) fija weight_source=
// 'measured' (intocable de ahí en adelante) e INVALIDA los estimados LLM de
// los vecinos más cercanos por embedding: su próxima visita re-estima con
// este peso medido como contexto de calibración — pesar uno mejora los
// similares sin ningún job extra.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth0.getSession(req).catch(() => null);
  if (!session?.user?.sub) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  if (!UUID_REGEX.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", detail: parsed.error.issues }, { status: 400 });
  }

  return withPg(async (pg) => {
    const updated = await pg.query(
      `UPDATE products
         SET weight_grams = $1, weight_source = 'measured', weight_measured_at = now()
       WHERE id = $2
       RETURNING id`,
      [parsed.data.grams, id],
    );
    if (updated.rows.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const invalidated = await pg.query(
      `UPDATE products SET weight_grams = NULL, weight_source = NULL
       WHERE id IN (
         SELECT id FROM products
         WHERE weight_source = 'llm' AND id <> $1 AND embedding IS NOT NULL
           AND (SELECT embedding FROM products WHERE id = $1) IS NOT NULL
         ORDER BY embedding <=> (SELECT embedding FROM products WHERE id = $1)
         LIMIT 20
       )
       RETURNING id`,
      [id],
    );
    return NextResponse.json({ ok: true, grams: parsed.data.grams, neighbors_invalidated: invalidated.rows.length });
  });
}
