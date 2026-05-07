import { NextRequest, NextResponse } from "next/server";
import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { hybridSearch } from "@/sectors/c-search/search";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json(
      { products: [], count: 0, hit_cache: false, called_mock: false, method: "bm25_only", normalized: null },
      { status: 200 },
    );
  }

  const anonymous_id = req.cookies.get("anonymous_id")?.value ?? null;
  const session = await auth0.getSession(req).catch(() => null);
  let user_id: string | null = null;
  if (session?.user?.sub) {
    const sub = session.user.sub as string;
    const email = (session.user.email as string) ?? `${sub}@noemail.local`;
    user_id = await withPg(async (pg) => (await getOrCreateUserByAuth0Sub(pg, sub, email)).id);
  }

  const result = await withPg((pg) => hybridSearch(q, { pg, anonymous_id, user_id }));
  return NextResponse.json({
    products: result.products,
    count: result.products.length,
    hit_cache: result.hitCache,
    called_mock: result.calledMock,
    method: result.method,
    normalized: result.normalized,
  });
}
