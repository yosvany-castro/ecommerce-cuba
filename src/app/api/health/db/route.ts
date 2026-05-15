import { NextResponse } from "next/server";
import { getPgClient } from "@/lib/db/pg";

export const dynamic = "force-dynamic";

export async function GET() {
  const client = await getPgClient();
  try {
    const ext = await client.query(`SELECT 1 FROM pg_extension WHERE extname = 'vector'`);
    const tables = await client.query(
      `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`,
    );
    return NextResponse.json({
      ok: true,
      vector_extension: ext.rowCount === 1,
      tables_count: tables.rows[0].n,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  } finally {
    await client.end();
  }
}
