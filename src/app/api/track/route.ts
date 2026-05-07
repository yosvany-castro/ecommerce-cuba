import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { eventInputSchema } from "@/sectors/a-tracking/events/schema";
import { insertEvent } from "@/sectors/a-tracking/events/insert";
import { withPg } from "@/lib/db/helpers";

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

  // user_id resolution from Auth0 deferred to Task 14 — Phase 1 starting state: always null.
  const user_id: string | null = null;

  try {
    const result = await withPg((pg) =>
      insertEvent(envelope, { pg, anonymous_id, session_id, user_id }),
    );
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "invalid_payload", detail: e.issues }, { status: 400 });
    }
    throw e;
  }
}
