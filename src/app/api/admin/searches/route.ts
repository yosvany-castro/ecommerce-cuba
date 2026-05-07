import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth0 } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { listSearches } from "@/sectors/c-search/admin/list";

// TODO Phase 4: admin role check (currently any logged-in user accesses)

const queryParamSchema = z.object({
  from: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
  to: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
  hit_cache: z
    .enum(["true", "false"])
    .optional()
    .transform((s) => (s === undefined ? undefined : s === "true")),
  method: z.enum(["hybrid_rrf", "bm25_only", "cosine_only"]).optional(),
  page: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .transform((s) => (s ? Math.max(1, parseInt(s, 10)) : undefined)),
  limit: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .transform((s) => (s ? Math.min(200, parseInt(s, 10)) : undefined)),
});

export async function GET(req: NextRequest) {
  const session = await auth0.getSession(req).catch(() => null);
  if (!session?.user?.sub) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const parsed = queryParamSchema.safeParse({
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    hit_cache: sp.get("hit_cache") ?? undefined,
    method: sp.get("method") ?? undefined,
    page: sp.get("page") ?? undefined,
    limit: sp.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", detail: parsed.error.issues }, { status: 400 });
  }
  const result = await withPg((pg) => listSearches(parsed.data, pg));
  return NextResponse.json(result);
}
