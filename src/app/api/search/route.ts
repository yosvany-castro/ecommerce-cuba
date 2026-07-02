import { NextRequest, NextResponse } from "next/server";
import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { RequestTiming } from "@/lib/timing";
import { hybridSearch } from "@/sectors/c-search/search";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const debug = req.nextUrl.searchParams.get("debug") === "true";

  if (debug) {
    const session = await auth0.getSession(req).catch(() => null);
    if (!session?.user?.sub) {
      return NextResponse.json({ error: "debug_requires_auth" }, { status: 401 });
    }
  }

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

  const timing = new RequestTiming();
  const result = await timing.time("search", () =>
    withPg((pg) => hybridSearch(q, { pg, anonymous_id, user_id }, { trace: debug })),
  );
  return NextResponse.json(
    {
      products: result.products,
      count: result.products.length,
      hit_cache: result.hitCache,
      called_mock: result.calledMock,
      method: result.method,
      normalized: result.normalized,
      ...(debug ? { trace: result.trace } : {}),
    },
    { headers: { "server-timing": timing.toServerTimingHeader() } },
  );
}
