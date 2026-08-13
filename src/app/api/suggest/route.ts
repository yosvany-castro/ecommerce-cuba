// src/app/api/suggest/route.ts — suggest v2: CONSULTAS, no productos ("el
// catálogo real vive en la búsqueda"). Devuelve búsquedas pasadas CON
// resultados parecidas a lo tecleado, tolerante a typos vía pg_trgm
// (migración 0039). Barato: un solo SELECT con índice gin_trgm.
import { NextRequest, NextResponse } from "next/server";
import { withPg } from "@/lib/db/helpers";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ queries: [] });
  const rows = await withPg(async (pg) => {
    const r = await pg.query(
      `SELECT raw_query, count(*) AS n
       FROM searches
       WHERE results_count > 0
         AND lower(raw_query) <> lower($1)
         AND similarity(raw_query, $1) > 0.3
       GROUP BY raw_query
       ORDER BY similarity(raw_query, $1) DESC, n DESC
       LIMIT 4`,
      [q],
    );
    return r.rows as { raw_query: string }[];
  });
  return NextResponse.json({ queries: rows.map((x) => x.raw_query) });
}
