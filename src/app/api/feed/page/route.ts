import { NextRequest, NextResponse } from "next/server";
import { withPg } from "@/lib/db/helpers";
import { dbHealth } from "@/lib/db/health";
import { getAuthUser, getOrCreateUserBySub } from "@/lib/auth";
import { serveFeedPage } from "@/sectors/d-personalization/feed";
import { RequestTiming } from "@/lib/timing";
import type { StorefrontCard } from "@/storefront/contract";
import { toCard } from "@/storefront/map";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Slim per-card shape (Etapa C): ~0.45KB gzip per 10 items and INVARIANT to
 * real-catalog description length — the grid never ships description/metadata
 * (the PDP does). Every response is COMPLETE state for its page (no diffs):
 * resilience over marginal bytes on a lossy network. F2: la forma ES
 * StorefrontCard (contract) — campo a campo idéntica al DTO inline retirado.
 */

export async function GET(req: NextRequest) {
  if (dbHealth() === "down") {
    return NextResponse.json(
      { error: "db_unavailable" },
      { status: 503, headers: { "retry-after": "15" } },
    );
  }

  const anonymous_id = req.cookies.get("anonymous_id")?.value ?? null;
  const session_id = req.cookies.get("session_id")?.value ?? null;
  if (
    (anonymous_id && !UUID_REGEX.test(anonymous_id)) ||
    (session_id && !UUID_REGEX.test(session_id))
  ) {
    return NextResponse.json({ error: "bad_identity" }, { status: 400 });
  }

  const cursor = req.nextUrl.searchParams.get("cursor");
  // P1-7: páginas 2+ con el usuario REAL — con user_id null un logueado
  // scrolleaba el perfil de OTRO (el anónimo) y perdía sus exclusiones.
  const auth = await getAuthUser();
  const timing = new RequestTiming();
  const page = await timing.time("feed_page", () =>
    withPg(async (pg) => {
      const user_id = auth?.sub
        ? (await getOrCreateUserBySub(pg, auth.sub, auth.email ?? `${auth.sub}@noemail.local`)).id
        : null;
      return serveFeedPage({ user_id, anonymous_id, session_id, cursor }, pg);
    }),
  );

  const items: StorefrontCard[] = page.items.map((it) => toCard(it.product, it.reason, it.position));

  return NextResponse.json(
    { items, next_cursor: page.next_cursor, slate_id: page.slate_id },
    { headers: { "server-timing": timing.toServerTimingHeader(), "cache-control": "no-store" } },
  );
}
