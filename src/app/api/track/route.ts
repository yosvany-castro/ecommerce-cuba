import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { eventInputSchema, validatePayload } from "@/sectors/a-tracking/events/schema";
import { insertEvent } from "@/sectors/a-tracking/events/insert";
import { ensureIdentityRows } from "@/sectors/a-tracking/identity";
import { dbHealth } from "@/lib/db/health";
import { withPg } from "@/lib/db/helpers";
import { getAuthUser, getOrCreateUserBySub } from "@/lib/auth";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { handleDismissAutoExclude } from "@/sectors/d-personalization/exclusion/dismiss-handler";
import { compactSlateForDismiss, bumpSlateVersion } from "@/sectors/d-personalization/slate/store";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  // F4 circuit breaker: with the DB down, answer 503 IMMEDIATELY so the
  // client event queue backs off and retries later — without this, every
  // queued event would burn the 2s connect timeout exactly during recovery.
  if (dbHealth() === "down") {
    return NextResponse.json({ error: "db_unavailable" }, { status: 503, headers: { "retry-after": "15" } });
  }
  const anonymous_id = req.cookies.get("anonymous_id")?.value;
  const session_id = req.cookies.get("session_id")?.value;
  if (!anonymous_id || !UUID_REGEX.test(anonymous_id) || !session_id || !UUID_REGEX.test(session_id)) {
    return NextResponse.json({ error: "no_identity" }, { status: 400 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_input", detail: "body is not valid JSON" }, { status: 400 });
  }

  // Batch contract (C4): the client event queue coalesces N events into ONE
  // POST `{events: [...]}` (≤50) — one radio wake-up, one pooled connection.
  // A bare envelope keeps working (back-compat).
  const rawEvents: unknown[] = Array.isArray((parsedBody as { events?: unknown[] })?.events)
    ? (parsedBody as { events: unknown[] }).events
    : [parsedBody];
  if (rawEvents.length === 0 || rawEvents.length > 50) {
    return NextResponse.json({ error: "invalid_input", detail: "1..50 events per batch" }, { status: 400 });
  }
  let envelopes;
  try {
    envelopes = rawEvents.map((e) => eventInputSchema.parse(e));
    // Payload-level validation UPFRONT (used to happen inside insertEvent):
    // a 400 must mean "nothing was applied" — the client queue drops the batch
    // on 4xx, so a half-inserted batch would silently lose its valid tail.
    for (const env of envelopes) validatePayload(env.event_type, env.payload);
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "invalid_input", detail: e.issues }, { status: 400 });
    }
    throw e;
  }

  const auth0Session = await getAuthUser();

  try {
    // ONE pooled connection for the whole request (before: 3-4 separate
    // withPg = 3-4 pool round-trips per event against a 15-slot pooler).
    const result = await withPg(async (pg) => {
      // Resolve user_id from Auth0 session if logged in.
      let user_id: string | null = null;
      if (auth0Session?.sub) {
        const sub = auth0Session.sub;
        const email = auth0Session.email ?? `${sub}@noemail.local`;
        const name = auth0Session.name;
        user_id = (await getOrCreateUserBySub(pg, sub, email, name)).id;
      }

      // First-writer (F2): the proxy no longer touches the DB — identity rows
      // are born here, with the first tracked event of the visit/session.
      await ensureIdentityRows(pg, { anonymous_id, session_id, user_id });

      const results = [];
      let slate_bumped = false;
      for (const envelope of envelopes) {
        const inserted = await insertEvent(envelope, { pg, anonymous_id, session_id, user_id });
        results.push(inserted);

        // Best-effort personalization hook — failures do not break tracking.
        try {
          await processEventForPersonalization(
            {
              anonymous_id,
              user_id,
              session_id,
              event_type: envelope.event_type,
              payload: envelope.payload as Record<string, unknown>,
              occurred_at: envelope.occurred_at,
            },
            pg,
          );
        } catch (e) {
          console.warn("[track] personalization hook failed:", e);
        }
        // E1: una BÚSQUEDA es intención nueva explícita — invalida el slate
        // vivo (la próxima página del scroll ya nace con la señal fresca).
        if (envelope.event_type === "search") {
          try {
            const v = await bumpSlateVersion(session_id, pg);
            if (v !== null) slate_bumped = true;
          } catch (e) {
            console.warn("[track] slate bump on search failed:", e);
          }
        }
        if (envelope.event_type === "dismiss") {
          try {
            const payload = envelope.payload as { product_id: string };
            await handleDismissAutoExclude(
              { anonymous_id, user_id, product_id: payload.product_id },
              pg,
            );
            // C5: compact the live slate (unserved tail only; no renumber —
            // outstanding cursors stay valid; a spare backfills the depth).
            await compactSlateForDismiss(session_id, payload.product_id, pg);
          } catch (e) {
            console.warn("[track] dismiss auto-exclude failed:", e);
          }
        }
      }
      return { results, slate_bumped };
    });
    // Back-compat: a bare envelope gets a bare result; batches carry the
    // piggy-backed liveness signal (~20 bytes en una respuesta ya pagada).
    return NextResponse.json(
      envelopes.length === 1 && !Array.isArray((parsedBody as { events?: unknown[] })?.events)
        ? result.results[0]
        : { results: result.results, slate_bumped: result.slate_bumped },
      { status: 200 },
    );
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "invalid_payload", detail: e.issues }, { status: 400 });
    }
    throw e;
  }
}
