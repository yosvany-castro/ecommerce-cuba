import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { eventInputSchema } from "@/sectors/a-tracking/events/schema";
import { insertEvent } from "@/sectors/a-tracking/events/insert";
import { ensureIdentityRows } from "@/sectors/a-tracking/identity";
import { withPg } from "@/lib/db/helpers";
import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { handleDismissAutoExclude } from "@/sectors/d-personalization/exclusion/dismiss-handler";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
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

  let envelope;
  try {
    envelope = eventInputSchema.parse(parsedBody);
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "invalid_input", detail: e.issues }, { status: 400 });
    }
    throw e;
  }

  const auth0Session = await auth0.getSession(req).catch(() => null);

  try {
    // ONE pooled connection for the whole request (before: 3-4 separate
    // withPg = 3-4 pool round-trips per event against a 15-slot pooler).
    const result = await withPg(async (pg) => {
      // Resolve user_id from Auth0 session if logged in.
      let user_id: string | null = null;
      if (auth0Session?.user?.sub) {
        const sub = auth0Session.user.sub as string;
        const email = (auth0Session.user.email as string) ?? `${sub}@noemail.local`;
        const name = (auth0Session.user.name as string | null) ?? null;
        user_id = (await getOrCreateUserByAuth0Sub(pg, sub, email, name)).id;
      }

      // First-writer (F2): the proxy no longer touches the DB — identity rows
      // are born here, with the first tracked event of the visit/session.
      await ensureIdentityRows(pg, { anonymous_id, session_id, user_id });

      const inserted = await insertEvent(envelope, { pg, anonymous_id, session_id, user_id });

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
      if (envelope.event_type === "dismiss") {
        try {
          const payload = envelope.payload as { product_id: string };
          await handleDismissAutoExclude(
            { anonymous_id, user_id, product_id: payload.product_id },
            pg,
          );
        } catch (e) {
          console.warn("[track] dismiss auto-exclude failed:", e);
        }
      }
      return inserted;
    });
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "invalid_payload", detail: e.issues }, { status: 400 });
    }
    throw e;
  }
}
