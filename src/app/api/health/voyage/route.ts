import { NextResponse } from "next/server";
import { embed, EMBEDDING_DIM } from "@/lib/embeddings/voyage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [vec] = await embed(["health check"], { inputType: "document" });
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    return NextResponse.json({
      ok: true,
      dim: vec.length,
      expected_dim: EMBEDDING_DIM,
      unit_norm: Math.abs(norm - 1) < 1e-3,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
