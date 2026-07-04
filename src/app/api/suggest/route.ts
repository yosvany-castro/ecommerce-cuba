// src/app/api/suggest/route.ts — typeahead barato para el buscador Tuki (ILIKE, sin embeddings).
import { NextRequest, NextResponse } from "next/server";
import { withPg } from "@/lib/db/helpers";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ suggestions: [] });
  const rows = await withPg(async (pg) => {
    const r = await pg.query(
      `SELECT id::text AS id, title, metadata->>'category' AS category
       FROM products WHERE is_active = true AND title ILIKE '%' || $1 || '%'
       ORDER BY last_refreshed_at DESC LIMIT 6`,
      [q],
    );
    return r.rows as { id: string; title: string; category: string | null }[];
  });
  return NextResponse.json({ suggestions: rows });
}
