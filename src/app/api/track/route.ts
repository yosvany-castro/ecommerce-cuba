import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { eventInputSchema } from "@/sectors/a-tracking/events/schema";
import { insertEvent } from "@/sectors/a-tracking/events/insert";
import { withPg } from "@/lib/db/helpers";
import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";

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

  // Resolve user_id from Auth0 session if logged in.
  let user_id: string | null = null;
  const auth0Session = await auth0.getSession(req).catch(() => null);
  if (auth0Session?.user?.sub) {
    const sub = auth0Session.user.sub as string;
    const email = (auth0Session.user.email as string) ?? `${sub}@noemail.local`;
    const name = (auth0Session.user.name as string | null) ?? null;
    user_id = await withPg(async (pg) => (await getOrCreateUserByAuth0Sub(pg, sub, email, name)).id);
  }

  try {
    const result = await withPg((pg) =>
      insertEvent(envelope, { pg, anonymous_id, session_id, user_id }),
    );
    // Best-effort personalization hook — failures do not break tracking.
    try {
      await withPg((pg) =>
        processEventForPersonalization(
          {
            anonymous_id,
            user_id,
            session_id,
            event_type: envelope.event_type,
            payload: envelope.payload as Record<string, unknown>,
            occurred_at: envelope.occurred_at,
          },
          pg,
        ),
      );
    } catch (e) {
      console.warn("[track] personalization hook failed:", e);
    }
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "invalid_payload", detail: e.issues }, { status: 400 });
    }
    throw e;
  }
}
