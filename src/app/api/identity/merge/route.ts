import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, getOrCreateUserBySub } from "@/lib/auth";
import { mergeIdentities } from "@/sectors/a-tracking/events/merge";
import { withPg } from "@/lib/db/helpers";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const anonymous_id = req.cookies.get("anonymous_id")?.value;
  if (!anonymous_id || !UUID_REGEX.test(anonymous_id)) {
    return NextResponse.json({ error: "no_anonymous_id" }, { status: 400 });
  }

  const session = await getAuthUser();
  if (!session?.sub) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const sub = session.sub;
  const email = session.email ?? `${sub}@noemail.local`;
  const name = session.name;

  const result = await withPg(async (pg) => {
    const user = await getOrCreateUserBySub(pg, sub, email, name);
    const merge = await mergeIdentities(anonymous_id, user.id, pg);
    return { user_id: user.id, ...merge };
  });

  return NextResponse.json(result, { status: 200 });
}
