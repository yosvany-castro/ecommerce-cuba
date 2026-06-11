import { NextRequest, NextResponse } from "next/server";
import { withPg } from "@/lib/db/helpers";
import { dbHealth } from "@/lib/db/health";
import { serveFeedPage } from "@/sectors/d-personalization/feed";
import { RequestTiming } from "@/lib/timing";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Slim per-card DTO (Etapa C): ~0.45KB gzip per 10 items and INVARIANT to
 * real-catalog description length — the grid never ships description/metadata
 * (the PDP does). Every response is COMPLETE state for its page (no diffs):
 * resilience over marginal bytes on a lossy network.
 */
interface FeedCardDTO {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  image_url: string | null;
  reason?: string;
}

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
  const timing = new RequestTiming();
  const page = await timing.time("feed_page", () =>
    withPg((pg) =>
      serveFeedPage({ user_id: null, anonymous_id, session_id, cursor }, pg),
    ),
  );

  const items: FeedCardDTO[] = page.items.map((it) => ({
    id: it.product.id,
    title: it.product.title,
    price_cents: it.product.price_cents,
    currency: it.product.currency,
    image_url: it.product.image_url,
    ...(it.reason ? { reason: it.reason } : {}),
  }));

  return NextResponse.json(
    { items, next_cursor: page.next_cursor, slate_id: page.slate_id },
    { headers: { "server-timing": timing.toServerTimingHeader(), "cache-control": "no-store" } },
  );
}
