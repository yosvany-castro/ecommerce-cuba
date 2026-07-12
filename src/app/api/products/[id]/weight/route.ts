import { NextRequest, NextResponse } from "next/server";
import { withPg } from "@/lib/db/helpers";
import { getOrEstimateWeight } from "@/sectors/b-catalog/weight-estimate";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/products/[id]/weight — la PDP lo llama DESPUÉS del primer paint
// (skeleton mientras). Responde el mejor peso disponible al instante; si no
// hay dato persistido devuelve la heurística y deja el refinado LLM corriendo
// en background (la próxima visita ya lo encuentra en products.weight_grams).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  return withPg(async (pg) => {
    const answer = await getOrEstimateWeight(id, pg);
    if (!answer) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(answer);
  });
}
