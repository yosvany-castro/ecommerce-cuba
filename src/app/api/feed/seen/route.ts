import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withPg } from "@/lib/db/helpers";
import { dbHealth } from "@/lib/db/health";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z
  .object({
    slate_id: z.string().regex(UUID_REGEX),
    positions: z.array(z.number().int().min(1).max(10_000)).min(1).max(100),
  })
  .strict();

/**
 * Viewport confirmation (E3): served ≠ seen. The client batches positions
 * that crossed ≥50% visibility for ≥1s (once per card per pageload) and this
 * endpoint stamps seen_at on the impression rows. seen_at NEVER overwrites
 * (first sighting wins) and the session cookie must own the impressions —
 * a forged slate_id stamps nothing. Fatigue and guardrail denominators read
 * seen_at, never served_at (a below-the-fold product the user never reached
 * must not count against itself).
 */
export async function POST(req: NextRequest) {
  if (dbHealth() === "down") {
    return NextResponse.json({ error: "db_unavailable" }, { status: 503, headers: { "retry-after": "15" } });
  }
  const session_id = req.cookies.get("session_id")?.value;
  if (!session_id || !UUID_REGEX.test(session_id)) {
    return NextResponse.json({ error: "no_identity" }, { status: 400 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const updated = await withPg(async (pg) => {
    const r = await pg.query(
      `UPDATE feed_impressions
       SET seen_at = now()
       WHERE feed_request_id = $1
         AND session_id = $2
         AND position = ANY($3::smallint[])
         AND seen_at IS NULL`,
      [body.slate_id, session_id, body.positions],
    );
    return r.rowCount ?? 0;
  });

  return NextResponse.json({ updated });
}
